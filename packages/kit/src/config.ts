/**
 * config.ts — loads environment variables into a typed BotConfig.
 *
 * env vars:
 *   SOLANA_RPC_URL    — solana RPC endpoint (required, fallback: BOT_RPC_URL)
 *   VAULT_CREATOR     — vault creator pubkey (required)
 *   SOLANA_PRIVATE_KEY — disposable controller keypair, base58 or JSON byte array (optional)
 *   BOT_SCAN_INTERVAL_MS  — ms between scan cycles (default 60000, min 5000)
 *   BOT_SCORE_INTERVAL_MS — ms between scoring cycles (default 15000)
 *   BOT_MIN_PROFIT_LAMPORTS — minimum profit threshold (default 10000000)
 *   BOT_RISK_THRESHOLD — minimum risk score for liquidation (default 60)
 *   BOT_PRICE_HISTORY_DEPTH — price history depth (default 20)
 *   BOT_LOG_LEVEL     — debug | info | warn | error (default info)
 */

import { Keypair } from '@solana/web3.js'
import type { BotConfig, LogLevel } from './types'
import { decodeBase58 } from './utils'

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

const envOrDefault = (key: string, fallback: string): string => process.env[key] ?? fallback

/**
 * Load or generate an agent keypair.
 * If SOLANA_PRIVATE_KEY is set, decode it (JSON byte array or base58).
 * Otherwise, generate a fresh disposable keypair.
 */
export const loadKeypair = (): { keypair: Keypair; generated: boolean } => {
  const privateKey = process.env.SOLANA_PRIVATE_KEY ?? null
  if (privateKey) {
    try {
      const parsed = JSON.parse(privateKey)
      if (Array.isArray(parsed)) {
        return { keypair: Keypair.fromSecretKey(Uint8Array.from(parsed)), generated: false }
      }
      throw new Error('SOLANA_PRIVATE_KEY JSON must be a byte array')
    } catch (e: any) {
      if (e.message?.includes('byte array')) throw e
      // not JSON — try base58
      return { keypair: Keypair.fromSecretKey(decodeBase58(privateKey)), generated: false }
    }
  }
  return { keypair: Keypair.generate(), generated: true }
}

export const loadConfig = (walletOverride?: Keypair): BotConfig => {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? process.env.BOT_RPC_URL
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL env var is required (fallback: BOT_RPC_URL)')

  const vaultCreator = process.env.VAULT_CREATOR
  if (!vaultCreator) throw new Error('VAULT_CREATOR env var is required (vault creator pubkey)')

  const { keypair } = walletOverride
    ? { keypair: walletOverride }
    : loadKeypair()

  const scanIntervalMs = Number(envOrDefault('BOT_SCAN_INTERVAL_MS', '60000'))
  if (isNaN(scanIntervalMs) || scanIntervalMs < 5000) {
    throw new Error('BOT_SCAN_INTERVAL_MS must be a number >= 5000')
  }

  const logLevel = envOrDefault('BOT_LOG_LEVEL', 'info') as LogLevel
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`BOT_LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`)
  }

  return {
    rpcUrl,
    walletKeypair: keypair,
    vaultCreator,
    scanIntervalMs,
    scoreIntervalMs: Number(envOrDefault('BOT_SCORE_INTERVAL_MS', '15000')),
    minProfitLamports: Number(envOrDefault('BOT_MIN_PROFIT_LAMPORTS', '10000000')),
    riskThreshold: Number(envOrDefault('BOT_RISK_THRESHOLD', '60')),
    priceHistoryDepth: Number(envOrDefault('BOT_PRICE_HISTORY_DEPTH', '20')),
    logLevel,
  }
}
