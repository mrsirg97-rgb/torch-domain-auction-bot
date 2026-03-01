import { Connection, Keypair } from '@solana/web3.js'
import { buildCreateTokenTransaction } from 'torchsdk'
import { generateTicker } from './ticker'
import type { LaunchResult } from './types'
import type { Logger } from './logger'
import { withTimeout } from './utils'

export const launchDomainToken = async (
  connection: Connection,
  wallet: Keypair,
  domain: string,
  ticker?: string,
  log?: Logger,
): Promise<LaunchResult> => {
  const symbol = ticker ?? generateTicker(domain)
  const name = domain
  const metadataUri = `https://${domain}`

  log?.info(`launching token for ${domain} — symbol=${symbol}`)

  const result = await withTimeout(buildCreateTokenTransaction(connection, {
    creator: wallet.publicKey.toBase58(),
    name,
    symbol,
    metadata_uri: metadataUri,
  }), 30_000, 'buildCreateTokenTransaction')

  // sign and send
  result.transaction.partialSign(wallet)
  const sig = await connection.sendRawTransaction(result.transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })
  await connection.confirmTransaction(sig, 'confirmed')

  const mint = result.mint.toBase58()
  log?.info(`launched: mint=${mint.slice(0, 8)}... sig=${sig.slice(0, 8)}...`)

  return { domain, mint, signature: sig, ticker: symbol }
}
