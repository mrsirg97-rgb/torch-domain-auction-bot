import { Connection } from '@solana/web3.js'
import {
  getTokens,
  getToken,
  getLendingInfo,
  getAllLoanPositions,
  LAMPORTS_PER_SOL as SDK_LAMPORTS,
} from 'torchsdk'
import type { MonitoredToken } from './types'
import type { Logger } from './logger'
import { withTimeout } from './utils'

const MAX_PRICE_HISTORY = 50

/**
 * Discover all active borrowers for a token using bulk loan scanner.
 * Returns all borrower addresses with open positions (not just top-20 holders).
 */
const discoverBorrowers = async (
  connection: Connection,
  mint: string,
  log: Logger,
): Promise<string[]> => {
  try {
    const { positions } = await withTimeout(getAllLoanPositions(connection, mint), 30_000, 'getAllLoanPositions')
    return positions.map((p: any) => p.borrower)
  } catch (err) {
    log.debug(`borrower discovery failed for ${mint.slice(0, 8)}...: ${err}`)
    return []
  }
}

/**
 * Scan for tokens with active lending markets.
 * Discovers migrated tokens, builds MonitoredToken entries, and probes for borrowers.
 */
export const scanForLendingMarkets = async (
  connection: Connection,
  existing: Map<string, MonitoredToken>,
  depth: number,
  log: Logger,
): Promise<Map<string, MonitoredToken>> => {
  const tokens = new Map(existing)

  log.info(`scanning for lending markets (depth=${depth})`)

  try {
    const result = await withTimeout(getTokens(connection, {
      status: 'migrated',
      limit: depth,
      sort: 'newest',
    }), 30_000, 'getTokens')

    log.info(`found ${result.tokens.length} migrated tokens`)

    for (const summary of result.tokens) {
      try {
        // skip if recently scanned
        const prev = tokens.get(summary.mint)
        if (prev && Date.now() - prev.lastScanned < 30_000) continue

        const detail = await withTimeout(getToken(connection, summary.mint), 30_000, 'getToken')
        const lending = await withTimeout(getLendingInfo(connection, summary.mint), 30_000, 'getLendingInfo')

        const priceSol = detail.price_sol / SDK_LAMPORTS
        const prevHistory = prev?.priceHistory ?? []
        const trimmedHistory = [...prevHistory, priceSol].slice(-MAX_PRICE_HISTORY)

        // discover borrowers when there are active loans
        let borrowers = prev?.activeBorrowers ?? []
        if (lending.active_loans && lending.active_loans > 0) {
          borrowers = await discoverBorrowers(connection, summary.mint, log)
          log.info(
            `${detail.symbol}: ${lending.active_loans} active loans, ${borrowers.length} borrowers found, price=${priceSol.toFixed(8)} SOL`,
          )
        }

        tokens.set(summary.mint, {
          mint: summary.mint,
          name: detail.name,
          symbol: detail.symbol,
          lendingInfo: lending,
          priceSol,
          priceHistory: trimmedHistory,
          activeBorrowers: borrowers,
          lastScanned: Date.now(),
        })
      } catch (err) {
        log.debug(`skipping ${summary.mint}: ${err}`)
      }
    }
  } catch (err) {
    log.error('scan failed', err)
  }

  return tokens
}
