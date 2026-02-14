import { Connection } from '@solana/web3.js'
import { buildLiquidateTransaction } from 'torchsdk'
import type { BotConfig, ScoredLoan, LiquidationResult } from './types'
import type { Logger } from './logger'

export class Liquidator {
  private config: BotConfig
  private log: Logger

  constructor(config: BotConfig, log: Logger) {
    this.config = config
    this.log = log
  }

  /**
   * Attempt to liquidate a scored loan position.
   * Returns null if the position should be skipped (healthy, not profitable, below threshold).
   */
  tryLiquidate = async (
    connection: Connection,
    scored: ScoredLoan,
  ): Promise<LiquidationResult | null> => {
    // skip healthy positions
    if (scored.position.health === 'healthy') {
      this.log.debug(`skipping ${scored.borrower.slice(0, 8)}... — position is healthy`)
      return null
    }

    // skip if risk score below threshold
    if (scored.riskScore < this.config.riskThreshold) {
      this.log.debug(
        `skipping ${scored.borrower.slice(0, 8)}... — risk ${scored.riskScore} < threshold ${this.config.riskThreshold}`,
      )
      return null
    }

    // skip if not profitable enough
    if (scored.estimatedProfitLamports < this.config.minProfitLamports) {
      this.log.debug(
        `skipping ${scored.borrower.slice(0, 8)}... — profit ${scored.estimatedProfitLamports} < min ${this.config.minProfitLamports}`,
      )
      return null
    }

    // only liquidate positions that are actually liquidatable
    if (scored.position.health !== 'liquidatable') {
      this.log.info(
        `skipping ${scored.borrower.slice(0, 8)}... — health=${scored.position.health} (not liquidatable)`,
      )
      return null
    }

    this.log.info(
      `liquidating ${scored.borrower.slice(0, 8)}... on ${scored.tokenName} — risk=${scored.riskScore}, profit=${scored.estimatedProfitLamports}`,
    )

    try {
      const result = await buildLiquidateTransaction(connection, {
        mint: scored.mint,
        liquidator: this.config.walletKeypair.publicKey.toBase58(),
        borrower: scored.borrower,
        vault: this.config.vaultCreator,
      })

      result.transaction.partialSign(this.config.walletKeypair)
      const sig = await connection.sendRawTransaction(result.transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      })
      await connection.confirmTransaction(sig, 'confirmed')

      this.log.info(`liquidation success: sig=${sig.slice(0, 8)}...`)

      return {
        mint: scored.mint,
        borrower: scored.borrower,
        signature: sig,
        profitLamports: scored.estimatedProfitLamports,
        timestamp: Date.now(),
        confirmed: true,
      }
    } catch (err) {
      this.log.error(`liquidation failed for ${scored.borrower.slice(0, 8)}...`, err)
      return null
    }
  }
}
