import { Connection, PublicKey } from '@solana/web3.js'
import { verifySaid } from 'torchsdk'
import type { WalletProfile, TradeStats } from './types'
import type { Logger } from './logger'

const CACHE_TTL_MS = 60_000

export class WalletProfiler {
  private cache = new Map<string, WalletProfile>()
  private log: Logger

  constructor(log: Logger) {
    this.log = log
  }

  profile = async (
    connection: Connection,
    address: string,
    mint: string,
  ): Promise<WalletProfile> => {
    // check cache
    const cached = this.cache.get(address)
    if (cached && Date.now() - cached.lastUpdated < CACHE_TTL_MS) {
      this.log.debug(`cache hit: ${address.slice(0, 8)}...`)
      return cached
    }

    this.log.info(`profiling wallet: ${address.slice(0, 8)}...`)

    // SAID verification
    let saidVerified = false
    let trustTier: WalletProfile['trustTier'] = null
    try {
      const said = await verifySaid(address)
      saidVerified = said.verified
      trustTier = said.trustTier
    } catch {
      this.log.debug(`SAID lookup failed for ${address.slice(0, 8)}...`)
    }

    // analyze trade history via recent transactions
    const tradeStats = await this.analyzeTradeHistory(connection, address)

    // compute wallet risk score (0-100, higher = riskier)
    const riskScore = this.computeRiskScore(saidVerified, trustTier, tradeStats)

    const profile: WalletProfile = {
      address,
      saidVerified,
      trustTier,
      tradeStats,
      riskScore,
      lastUpdated: Date.now(),
    }

    this.cache.set(address, profile)
    return profile
  }

  private analyzeTradeHistory = async (
    connection: Connection,
    address: string,
  ): Promise<TradeStats> => {
    try {
      const pubkey = new PublicKey(address)
      const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 50 })

      const totalTrades = sigs.length
      // winRate = tx success rate (what % of submitted txs landed without error)
      const successfulTrades = sigs.filter((s) => s.err === null).length
      const winRate = totalTrades > 0 ? successfulTrades / totalTrades : 0

      // estimate avg hold time from transaction spacing
      let avgHoldTime = 0
      if (sigs.length >= 2) {
        const times = sigs
          .filter((s) => s.blockTime)
          .map((s) => s.blockTime! * 1000)
          .sort((a, b) => a - b)
        if (times.length >= 2) {
          const totalSpan = times[times.length - 1] - times[0]
          avgHoldTime = totalSpan / times.length
        }
      }

      // estimate pnlSol from current balance vs expected airdrop/funding baseline
      let pnlSol = 0
      try {
        const balanceLamports = await connection.getBalance(pubkey)
        // rough heuristic: assume wallet started with ~1 SOL in fees
        // positive balance beyond that suggests net positive trading
        pnlSol = balanceLamports / 1_000_000_000 - 1
      } catch {
        // balance check failed, leave at 0
      }

      return { totalTrades, winRate, avgHoldTime, pnlSol }
    } catch {
      return { totalTrades: 0, winRate: 0, avgHoldTime: 0, pnlSol: 0 }
    }
  }

  private computeRiskScore = (
    verified: boolean,
    tier: WalletProfile['trustTier'],
    stats: TradeStats,
  ): number => {
    let risk = 50 // baseline

    // SAID verification reduces risk
    if (verified) risk -= 15
    if (tier === 'high') risk -= 10
    else if (tier === 'medium') risk -= 5

    // more trades = more history = lower risk
    if (stats.totalTrades > 20) risk -= 10
    else if (stats.totalTrades > 5) risk -= 5

    // high win rate = lower risk
    if (stats.winRate > 0.7) risk -= 5
    else if (stats.winRate < 0.3) risk += 10

    // clamp to 0-100
    return Math.min(Math.max(risk, 0), 100)
  }
}
