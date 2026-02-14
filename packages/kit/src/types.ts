import type { Keypair } from '@solana/web3.js'
import type { LendingInfo, LoanPositionInfo } from 'torchsdk'

// ── log level ──────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// ── bot config ─────────────────────────────────────────────────────────────────

export interface BotConfig {
  rpcUrl: string
  walletKeypair: Keypair
  vaultCreator: string
  scanIntervalMs: number
  scoreIntervalMs: number
  minProfitLamports: number
  riskThreshold: number
  priceHistoryDepth: number
  logLevel: LogLevel
}

// ── trade stats & wallet profile ───────────────────────────────────────────────

export interface TradeStats {
  totalTrades: number
  winRate: number
  avgHoldTime: number
  pnlSol: number
}

export interface WalletProfile {
  address: string
  saidVerified: boolean
  trustTier: 'high' | 'medium' | 'low' | null
  tradeStats: TradeStats
  riskScore: number
  lastUpdated: number
}

// ── risk factors & scored loan ─────────────────────────────────────────────────

export interface RiskFactors {
  ltvProximity: number
  priceMomentum: number
  walletRisk: number
  interestBurden: number
}

export interface ScoredLoan {
  mint: string
  tokenName: string
  borrower: string
  position: LoanPositionInfo
  walletProfile: WalletProfile
  riskScore: number
  factors: RiskFactors
  estimatedProfitLamports: number
  lastScored: number
}

// ── monitored token ────────────────────────────────────────────────────────────

export interface MonitoredToken {
  mint: string
  name: string
  symbol: string
  lendingInfo: LendingInfo
  priceSol: number
  priceHistory: number[]
  activeBorrowers: string[]
  lastScanned: number
}

// ── liquidation result ─────────────────────────────────────────────────────────

export interface LiquidationResult {
  mint: string
  borrower: string
  signature: string
  profitLamports: number
  timestamp: number
  confirmed: boolean
}

// ── domain-specific types ──────────────────────────────────────────────────────

export interface DomainToken {
  domain: string
  mint: string
  tokenName: string
  ticker: string
  launchedAt: number
  status: 'bonding' | 'complete' | 'migrated'
}

export interface DomainLease {
  domain: string
  mint: string
  lessee: string
  startedAt: number
  expiresAt: number
  active: boolean
}

export interface LaunchResult {
  domain: string
  mint: string
  signature: string
  ticker: string
}
