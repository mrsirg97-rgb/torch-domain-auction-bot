#!/usr/bin/env node

import { loadConfig } from './config'
import { scanDomains } from './scanner'
import { expiredDomainsProvider } from './providers/expired-domains'
import { availabilityProvider } from './providers/availability'
import { Logger } from '../logger'

export { scanDomains } from './scanner'
export { evaluateDomain } from './evaluator'
export { generateTicker } from './ticker'
export { Logger } from '../logger'
export type { DomainListing, DomainProvider, ScoredDomain, ScraperConfig } from './types'
export type { LogLevel } from '../types'

const main = async () => {
  const config = loadConfig([expiredDomainsProvider, availabilityProvider])
  const log = new Logger('scraper', config.logLevel)

  log.info('torch domain scraper starting')
  log.info(`config: maxPrice=$${config.maxPriceUsd}, minScore=${config.minScore}`)

  const results = await scanDomains(config)

  if (results.length === 0) {
    log.info('no domains found matching criteria')
    return
  }

  log.info(`found ${results.length} candidate domains:\n`)
  for (const d of results) {
    console.log(
      `  [${d.score}] ${d.listing.name}.${d.listing.tld} — $${d.listing.price} — ticker: ${d.ticker} — ${d.reasoning}`,
    )
  }
}

// only run CLI when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
}
