import type { DomainListing, ScoredDomain } from './types'
import { generateTicker } from './ticker'

const TLD_SCORES: Record<string, number> = {
  com: 30,
  io: 22,
  ai: 25,
  dev: 18,
  net: 15,
  org: 12,
  xyz: 10,
  co: 16,
  app: 14,
}

const VALUABLE_KEYWORDS = ['ai', 'crypto', 'defi', 'nft', 'sol', 'web3', 'chain', 'swap', 'pay']

const scoreDomainLength = (name: string): number => {
  if (name.length <= 3) return 25
  if (name.length <= 5) return 20
  if (name.length <= 8) return 15
  if (name.length <= 12) return 8
  return 3
}

const scoreTld = (tld: string): number => TLD_SCORES[tld.toLowerCase()] ?? 5

const scoreKeywords = (name: string): number => {
  const lower = name.toLowerCase()
  const matches = VALUABLE_KEYWORDS.filter((kw) => lower.includes(kw))
  return Math.min(matches.length * 8, 20)
}

const scoreCleanName = (name: string): number => {
  const hasHyphens = name.includes('-')
  const hasNumbers = /\d/.test(name)
  if (!hasHyphens && !hasNumbers) return 15
  if (!hasHyphens) return 8
  return 3
}

const scorePriceValue = (price: number): number => {
  if (price <= 5) return 10
  if (price <= 15) return 7
  if (price <= 30) return 4
  return 1
}

export const evaluateDomain = (listing: DomainListing): ScoredDomain => {
  const lengthScore = scoreDomainLength(listing.name)
  const tldScore = scoreTld(listing.tld)
  const kwScore = scoreKeywords(listing.name)
  const cleanScore = scoreCleanName(listing.name)
  const priceScore = scorePriceValue(listing.price)

  const score = Math.min(lengthScore + tldScore + kwScore + cleanScore + priceScore, 100)

  const reasons: string[] = []
  if (lengthScore >= 20) reasons.push('short name')
  if (tldScore >= 20) reasons.push(`premium TLD (.${listing.tld})`)
  if (kwScore > 0) reasons.push('valuable keywords')
  if (cleanScore >= 15) reasons.push('clean (no hyphens/numbers)')
  if (priceScore >= 7) reasons.push('low price')

  return {
    listing,
    score,
    ticker: generateTicker(`${listing.name}.${listing.tld}`),
    reasoning: reasons.length > 0 ? reasons.join(', ') : 'average domain',
  }
}
