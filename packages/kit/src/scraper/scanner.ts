import type { ScraperConfig, ScoredDomain, DomainListing } from './types'
import { evaluateDomain } from './evaluator'
import { Logger } from '../logger'

export const scanDomains = async (config: ScraperConfig): Promise<ScoredDomain[]> => {
  const log = new Logger('scanner', config.logLevel)
  const allListings: DomainListing[] = []

  for (const provider of config.providers) {
    log.info(`scanning provider: ${provider.name}`)
    try {
      const listings = await provider.scan({
        maxPrice: config.maxPriceUsd,
        limit: 50,
      })
      log.info(`${provider.name} returned ${listings.length} listings`)
      allListings.push(...listings)
    } catch (err) {
      log.error(`provider ${provider.name} failed`, err)
    }
  }

  log.info(`total listings: ${allListings.length}`)

  // score all listings
  const scored = allListings.map(evaluateDomain)

  // filter by minimum score and sort descending
  const filtered = scored
    .filter((d) => d.score >= config.minScore)
    .sort((a, b) => b.score - a.score)

  log.info(`${filtered.length} domains passed minimum score of ${config.minScore}`)

  return filtered
}
