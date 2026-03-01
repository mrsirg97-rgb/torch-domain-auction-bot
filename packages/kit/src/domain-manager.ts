import { Connection } from '@solana/web3.js'
import { getHolders } from 'torchsdk'
import type { DomainToken, DomainLease } from './types'
import type { Logger } from './logger'
import { withTimeout } from './utils'

const DEFAULT_LEASE_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export const checkTopHolder = async (
  connection: Connection,
  mint: string,
): Promise<string | null> => {
  const result = await withTimeout(getHolders(connection, mint, 1), 30_000, 'getHolders')
  if (result.holders.length === 0) return null
  return result.holders[0].address
}

export const updateLeases = async (
  connection: Connection,
  domainTokens: DomainToken[],
  leases: DomainLease[],
  log?: Logger,
): Promise<DomainLease[]> => {
  const now = Date.now()
  const updated = [...leases]

  // expire old leases
  for (const lease of updated) {
    if (lease.active && lease.expiresAt <= now) {
      lease.active = false
      log?.info(`lease expired: ${lease.domain} — lessee=${lease.lessee.slice(0, 8)}...`)
    }
  }

  // check each domain token for new top holder
  for (const dt of domainTokens) {
    const topHolder = await checkTopHolder(connection, dt.mint)
    if (!topHolder) continue

    const activeLease = updated.find((l) => l.mint === dt.mint && l.active)

    if (activeLease) {
      // if top holder changed, expire current and create new
      if (activeLease.lessee !== topHolder) {
        activeLease.active = false
        log?.info(
          `top holder changed for ${dt.domain}: ${activeLease.lessee.slice(0, 8)}... → ${topHolder.slice(0, 8)}...`,
        )
        updated.push({
          domain: dt.domain,
          mint: dt.mint,
          lessee: topHolder,
          startedAt: now,
          expiresAt: now + DEFAULT_LEASE_DURATION_MS,
          active: true,
        })
      }
    } else {
      // no active lease — create one for top holder
      log?.info(`new lease: ${dt.domain} → ${topHolder.slice(0, 8)}...`)
      updated.push({
        domain: dt.domain,
        mint: dt.mint,
        lessee: topHolder,
        startedAt: now,
        expiresAt: now + DEFAULT_LEASE_DURATION_MS,
        active: true,
      })
    }
  }

  return updated
}
