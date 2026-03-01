import { Connection } from '@solana/web3.js'
import { getLoanPosition, getAllLoanPositions, getToken, LAMPORTS_PER_SOL as SDK_LAMPORTS } from 'torchsdk'
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

        // score all active borrowers via bulk scan
        try {
          const { positions } = await getAllLoanPositions(connection, mint)
          for (const pos of positions) {
            try {
              const profile = await profiler.profile(connection, pos.borrower, mint)
              const scored = scoreLoan(token, pos.borrower, pos, profile)

              log.info(
                `${token.symbol} — ${pos.borrower.slice(0, 8)}... risk=${scored.riskScore} health=${pos.health}`,
              )

              await liquidator.tryLiquidate(connection, scored)
            } catch (err) {
              log.debug(`error scoring ${pos.borrower.slice(0, 8)}...`, err)
            }
          }
        } catch (err) {
          log.debug(`bulk loan scan failed for ${token.symbol}`, err)
        }
      }
    } catch (err) {
      log.error('monitor tick failed', err)
    }

    await sleep(config.scoreIntervalMs)
  }
}
