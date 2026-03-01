/**
 * setup.ts — shared test helpers for Surfpool E2E tests.
 *
 * creates a token, bonds to completion, migrates to DEX.
 * returns the mint address + buyer wallets for further testing.
 *
 * Run surfpool first:
 *   surfpool start --network mainnet --no-tui
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  getToken,
  buildCreateTokenTransaction,
  buildDirectBuyTransaction,
  buildMigrateTransaction,
} from 'torchsdk'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const RPC_URL = 'http://localhost:8899'
const WALLET_PATH = path.join(os.homedir(), '.config/solana/id.json')

export const log = (msg: string) => {
  const ts = new Date().toISOString().substr(11, 8)
  console.log(`[${ts}] ${msg}`)
}

export const loadWallet = (): Keypair => {
  const raw = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8'))
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

export const signAndSend = async (
  connection: Connection,
  wallet: Keypair,
  tx: Transaction,
): Promise<string> => {
  tx.partialSign(wallet)
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })
  await connection.confirmTransaction(sig, 'confirmed')
  return sig
}

export const bpsToPercent = (bps: number): string => (bps / 100).toFixed(2) + '%'

export interface SetupResult {
  connection: Connection
  wallet: Keypair
  mint: string
  buyers: Keypair[]
}

/**
 * full setup: create token -> bond to completion -> migrate to DEX.
 * returns everything needed to test lending features.
 *
 * Uses buildDirectBuyTransaction for bonding and buildMigrateTransaction
 * for migration (matches torchsdk test_e2e.ts approach).
 */
export async function setupMigratedToken(): Promise<SetupResult> {
  const connection = new Connection(RPC_URL, 'confirmed')
  const wallet = loadWallet()
  const walletAddr = wallet.publicKey.toBase58()

  log(`Wallet: ${walletAddr}`)
  const balance = await connection.getBalance(wallet.publicKey)
  log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`)

  // 1. create token
  log('\n[setup] Create Token')
  const createResult = await buildCreateTokenTransaction(connection, {
    creator: walletAddr,
    name: 'Bot Test Token',
    symbol: 'BTEST',
    metadata_uri: 'https://example.com/btest.json',
  })
  const createSig = await signAndSend(connection, wallet, createResult.transaction)
  const mint = createResult.mint.toBase58()
  log(`  created: ${mint.slice(0, 8)}... sig=${createSig.slice(0, 8)}...`)

  // 2. bond to completion using buildDirectBuyTransaction
  // V27: 2% wallet cap means max ~2 SOL per wallet at initial price.
  // Use 1.5 SOL buys across many wallets for faster bonding.
  log('\n[setup] Bond to Completion')
  const NUM_BUYERS = 200
  const BUY_AMOUNT = Math.floor(1.5 * LAMPORTS_PER_SOL)
  const buyers: Keypair[] = []
  for (let i = 0; i < NUM_BUYERS; i++) buyers.push(Keypair.generate())

  // fund in batches of 20
  for (let i = 0; i < buyers.length; i += 20) {
    const batch = buyers.slice(i, i + 20)
    const fundTx = new Transaction()
    for (const b of batch) {
      fundTx.add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: b.publicKey,
          lamports: BUY_AMOUNT + Math.floor(0.05 * LAMPORTS_PER_SOL),
        }),
      )
    }
    const { blockhash } = await connection.getLatestBlockhash()
    fundTx.recentBlockhash = blockhash
    fundTx.feePayer = wallet.publicKey
    await signAndSend(connection, wallet, fundTx)
  }
  log(`  funded ${buyers.length} wallets with ${BUY_AMOUNT / LAMPORTS_PER_SOL} SOL each`)

  // buy until bonding completes
  let bondingComplete = false
  let buyCount = 0
  for (const buyer of buyers) {
    if (bondingComplete) break
    try {
      const result = await buildDirectBuyTransaction(connection, {
        mint,
        buyer: buyer.publicKey.toBase58(),
        amount_sol: BUY_AMOUNT,
        slippage_bps: 1000,
        vote: Math.random() > 0.5 ? 'burn' : 'return',
      })
      await signAndSend(connection, buyer, result.transaction)
      buyCount++

      if (buyCount % 50 === 0) {
        const detail = await getToken(connection, mint)
        log(
          `  buy ${buyCount}: ${detail.progress_percent.toFixed(1)}% (${detail.sol_raised.toFixed(1)} SOL)`,
        )
        if (detail.status !== 'bonding') bondingComplete = true
      }
    } catch (e: any) {
      if (
        e.message?.includes('Bonding curve complete') ||
        e.message?.includes('bonding_complete') ||
        e.message?.includes('BondingComplete')
      ) {
        bondingComplete = true
      } else if (buyCount === 0) {
        log(`  buy error: ${e.message?.slice(0, 120)}`)
      }
    }
  }

  // check final status
  try {
    const detail = await getToken(connection, mint)
    if (detail.status !== 'bonding') bondingComplete = true
    log(
      `  final: ${detail.progress_percent.toFixed(1)}% (${detail.sol_raised.toFixed(1)} SOL) status=${detail.status}`,
    )
  } catch {
    /* ignore */
  }

  // V28 recovery: if ephemeral buyers couldn't complete bonding
  // (auto-bundled migration requires ~1.5 SOL buffer they don't have), use main wallet
  if (!bondingComplete) {
    log('  attempting final buy with main wallet (has SOL for V28 migration buffer)...')
    try {
      const result = await buildDirectBuyTransaction(connection, {
        mint,
        buyer: walletAddr,
        amount_sol: BUY_AMOUNT,
        slippage_bps: 1000,
        vote: 'burn',
      })
      await signAndSend(connection, wallet, result.transaction)
      bondingComplete = true
      buyCount++
    } catch (e: any) {
      if (e.message?.includes('BondingComplete') || e.message?.includes('bonding_complete')) {
        bondingComplete = true
      } else {
        log(`  final buy failed: ${e.message?.slice(0, 80)}`)
      }
    }
  }

  if (!bondingComplete) {
    throw new Error(`Bonding not complete after ${buyCount} buys`)
  }
  log(`  bonding complete after ${buyCount} buys`)

  // 3. migrate to DEX via SDK
  log('\n[setup] Migrate to DEX')

  // check if auto-migration already happened (V28: bundled with last buy)
  const preCheck = await getToken(connection, mint)
  if (preCheck.status === 'migrated') {
    log('  already migrated (V28 auto-migration)')
  } else {
    const migrateResult = await buildMigrateTransaction(connection, {
      mint,
      payer: walletAddr,
    })
    await signAndSend(connection, wallet, migrateResult.transaction)
    log('  migration complete')
  }

  // time travel past Raydium pool open_time
  log('  time traveling 100 slots to pass pool open_time...')
  const slot = await connection.getSlot()
  await fetch('http://127.0.0.1:8899', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'surfnet_timeTravel',
      params: [{ absoluteSlot: slot + 100 }],
    }),
  })
  await new Promise((r) => setTimeout(r, 500))

  const postDetail = await getToken(connection, mint)
  log(`  post-migration status: ${postDetail.status}`)

  return { connection, wallet, mint, buyers }
}
