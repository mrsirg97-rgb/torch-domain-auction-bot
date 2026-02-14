import { Connection } from '@solana/web3.js'
import {
  getTokens,
  getToken,
  getLendingInfo,
  getLoanPosition,
  getHolders,
  LAMPORTS_PER_SOL as SDK_LAMPORTS,
} from 'torchsdk'
import type { MonitoredToken } from './types'
import type { Logger } from './logger'

const MAX_PRICE_HISTORY = 50

/**
 * Probe token holders for active loan positions.
 * Returns addresses that have an active loan on this token.
 */
const discoverBorrowers = async (
  connection: Connection,
  mint: string,
  log: Logger,
): Promise<string[]> => {
  const borrowers: string[] = []
  try {
    const { holders } = await getHolders(connection, mint, 20)
    for (const holder of holders) {
      try {
        const pos = await getLoanPosition(connection, mint, holder.address)
        if (pos.health !== 'none') {
          borrowers.push(holder.address)
        }
      } catch {
        // skip — holder may not have a loan
      }
    }
  } catch (err) {
    log.debug(`borrower discovery failed for ${mint.slice(0, 8)}...: ${err}`)
  }
  return borrowers
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
    const result = await getTokens(connection, {
      status: 'migrated',
      limit: depth,
      sort: 'newest',
    })

    log.info(`found ${result.tokens.length} migrated tokens`)

    for (const summary of result.tokens) {
      try {
        // skip if recently scanned
        const prev = tokens.get(summary.mint)
        if (prev && Date.now() - prev.lastScanned < 30_000) continue

        const detail = await getToken(connection, summary.mint)
        const lending = await getLendingInfo(connection, summary.mint)

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
