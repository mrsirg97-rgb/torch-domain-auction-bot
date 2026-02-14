import { LogLevel } from '../types'

export type { LogLevel } from '../types'

export interface DomainListing {
  name: string
  tld: string
  price: number
  currency: string
  provider: string
  expiry?: Date
}

export interface DomainProvider {
  name: string
  scan: (opts: { maxPrice: number; limit: number }) => Promise<DomainListing[]>
}

export interface ScoredDomain {
  listing: DomainListing
  score: number
  ticker: string
  reasoning: string
}

export interface ScraperConfig {
  maxPriceUsd: number
  minScore: number
  scanIntervalMs: number
  providers: DomainProvider[]
  logLevel: LogLevel
}
