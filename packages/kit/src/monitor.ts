import { Connection } from '@solana/web3.js'
import { getLoanPosition, getToken, LAMPORTS_PER_SOL as SDK_LAMPORTS } from 'torchsdk'
import { scanForLendingMarkets } from './scanner'
import { WalletProfiler } from './wallet-profiler'
import { scoreLoan } from './risk-scorer'
import { Liquidator } from './liquidator'
import { updateLeases } from './domain-manager'
import { Logger } from './logger'
import { sleep } from './utils'
import type { BotConfig, MonitoredToken, DomainToken, DomainLease } from './types'

export const runMonitor = async (
  config: BotConfig,
  domainTokens: DomainToken[] = [],
): Promise<void> => {
  const log = new Logger('monitor', config.logLevel)
  const connection = new Connection(config.rpcUrl, 'confirmed')
  const profiler = new WalletProfiler(log.child('profiler'))
  const liquidator = new Liquidator(config, log.child('liquidator'))

  let tokens = new Map<string, MonitoredToken>()
  let leases: DomainLease[] = []

  log.info('domain auction bot monitor starting')

  while (true) {
    try {
      // scan for lending markets
      tokens = await scanForLendingMarkets(
        connection,
        tokens,
        config.priceHistoryDepth,
        log.child('scanner'),
      )

      // update domain leases (check top holders, expire/rotate)
      if (domainTokens.length > 0) {
        leases = await updateLeases(connection, domainTokens, leases, log.child('leases'))
      }

      // score and attempt liquidation for each token with borrowers
      for (const [mint, token] of tokens) {
        if (!token.lendingInfo.active_loans || token.lendingInfo.active_loans === 0) continue

        // update price
        try {
          const detail = await getToken(connection, mint)
          const newPrice = detail.price_sol / SDK_LAMPORTS
          token.priceHistory.push(newPrice)
          if (token.priceHistory.length > config.priceHistoryDepth) {
            token.priceHistory.shift()
          }
          token.priceSol = newPrice
        } catch {
          log.debug(`price update failed for ${token.symbol}`)
        }

        // score each known borrower
        for (const borrower of token.activeBorrowers) {
          try {
            const position = await getLoanPosition(connection, mint, borrower)
            if (position.health === 'none') continue

            const profile = await profiler.profile(connection, borrower, mint)
            const scored = scoreLoan(token, borrower, position, profile)

            log.info(
              `${token.symbol} — ${borrower.slice(0, 8)}... risk=${scored.riskScore} health=${position.health}`,
            )

            await liquidator.tryLiquidate(connection, scored)
          } catch (err) {
            log.debug(`error scoring ${borrower.slice(0, 8)}...`, err)
          }
        }
      }
    } catch (err) {
      log.error('monitor tick failed', err)
    }

    await sleep(config.scoreIntervalMs)
  }
}
