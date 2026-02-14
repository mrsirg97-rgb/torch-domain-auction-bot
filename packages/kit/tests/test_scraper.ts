/**
 * Scraper Unit Tests
 *
 * Tests ticker generation, domain evaluation, and scanner integration.
 * No network access required — uses mock providers.
 *
 * Run:
 *   npx tsx tests/test_scraper.ts
 */

import { generateTicker } from '../src/scraper/ticker'
import { evaluateDomain } from '../src/scraper/evaluator'
import { scanDomains } from '../src/scraper/scanner'
import type { DomainListing, DomainProvider, ScraperConfig } from '../src/scraper/types'

// ============================================================================
// Test runner
// ============================================================================

let passed = 0
let failed = 0

const ok = (name: string, detail?: string) => {
  passed++
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

const fail = (name: string, err: string) => {
  failed++
  console.log(`  ✗ ${name} — ${err}`)
}

const assert = (name: string, condition: boolean, detail?: string) => {
  if (condition) ok(name, detail)
  else fail(name, detail ?? 'assertion failed')
}

// ============================================================================
// Ticker generation tests
// ============================================================================

console.log('='.repeat(60))
console.log('SCRAPER UNIT TESTS')
console.log('='.repeat(60))

console.log('\n[1] Ticker Generation')

// short single word
assert('short word', generateTicker('abc.com') === 'ABC', `got ${generateTicker('abc.com')}`)

// exact 6 char word
assert(
  '6-char word',
  generateTicker('crypto.io') === 'CRYPTO',
  `got ${generateTicker('crypto.io')}`,
)

// long single word -> prefix
const longTicker = generateTicker('cryptocurrency.com')
assert('long word prefix', longTicker.length >= 3 && longTicker.length <= 6, `got ${longTicker}`)

// multi-word with short first
assert(
  'multi-word short first',
  generateTicker('ai-bot.com') === 'AIX',
  `got ${generateTicker('ai-bot.com')}`,
)

// multi-word with long first -> acronym
assert(
  'multi-word acronym',
  generateTicker('super-crypto-defi.io') === 'SCD',
  `got ${generateTicker('super-crypto-defi.io')}`,
)

// padding for very short
assert('padding short', generateTicker('a.com') === 'AXX', `got ${generateTicker('a.com')}`)

// always uppercase
assert('uppercase', generateTicker('hello.com') === 'HELLO', `got ${generateTicker('hello.com')}`)

// ============================================================================
// Domain evaluation tests
// ============================================================================

console.log('\n[2] Domain Evaluation')

const premiumDomain: DomainListing = {
  name: 'ai',
  tld: 'com',
  price: 5,
  currency: 'USD',
  provider: 'test',
}

const cheapDomain: DomainListing = {
  name: 'my-long-random-domain-name-123',
  tld: 'xyz',
  price: 2,
  currency: 'USD',
  provider: 'test',
}

const midDomain: DomainListing = {
  name: 'solpay',
  tld: 'io',
  price: 15,
  currency: 'USD',
  provider: 'test',
}

const premium = evaluateDomain(premiumDomain)
const cheap = evaluateDomain(cheapDomain)
const mid = evaluateDomain(midDomain)

assert('premium scores high', premium.score > 60, `score=${premium.score}`)
assert('junk scores low', cheap.score < premium.score, `score=${cheap.score}`)
assert('mid scores between', mid.score > cheap.score, `score=${mid.score}`)
assert('ticker generated', premium.ticker.length >= 3, `ticker=${premium.ticker}`)
assert('reasoning present', premium.reasoning.length > 0, `reasoning=${premium.reasoning}`)
assert('scores in range', premium.score >= 0 && premium.score <= 100, `score=${premium.score}`)

// ============================================================================
// Scanner integration (mock providers)
// ============================================================================

console.log('\n[3] Scanner Integration')

const mockProvider: DomainProvider = {
  name: 'mock',
  scan: async (opts) => [
    { name: 'defi', tld: 'ai', price: 10, currency: 'USD', provider: 'mock' },
    { name: 'crypto', tld: 'com', price: 8, currency: 'USD', provider: 'mock' },
    { name: 'xyz-thing-123', tld: 'xyz', price: 2, currency: 'USD', provider: 'mock' },
  ],
}

const emptyProvider: DomainProvider = {
  name: 'empty',
  scan: async () => [],
}

const failingProvider: DomainProvider = {
  name: 'failing',
  scan: async () => {
    throw new Error('provider down')
  },
}

const runScannerTests = async () => {
  // basic scan
  const config: ScraperConfig = {
    maxPriceUsd: 50,
    minScore: 30,
    scanIntervalMs: 60000,
    providers: [mockProvider],
    logLevel: 'error', // suppress logs in tests
  }

  const results = await scanDomains(config)
  assert('scanner returns results', results.length > 0, `count=${results.length}`)
  assert('results sorted by score', results[0].score >= results[results.length - 1].score)

  // high min score filters
  const strictConfig: ScraperConfig = { ...config, minScore: 90 }
  const strict = await scanDomains(strictConfig)
  assert('strict filter works', strict.length <= results.length, `strict=${strict.length}`)

  // empty provider
  const emptyConfig: ScraperConfig = { ...config, providers: [emptyProvider] }
  const empty = await scanDomains(emptyConfig)
  assert('empty provider returns 0', empty.length === 0)

  // failing provider doesn't crash
  const failConfig: ScraperConfig = { ...config, providers: [failingProvider] }
  const failResults = await scanDomains(failConfig)
  assert('failing provider handled', failResults.length === 0)

  // multiple providers
  const multiConfig: ScraperConfig = { ...config, providers: [mockProvider, emptyProvider] }
  const multi = await scanDomains(multiConfig)
  assert('multi-provider works', multi.length > 0, `count=${multi.length}`)

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60))
  console.log(`RESULTS: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))

  if (failed > 0) process.exit(1)
}

runScannerTests().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
