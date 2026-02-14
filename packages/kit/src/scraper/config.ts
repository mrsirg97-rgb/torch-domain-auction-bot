import type { ScraperConfig, LogLevel } from './types'

const envOrDefault = (key: string, fallback: string): string => process.env[key] ?? fallback

export const loadConfig = (providers: ScraperConfig['providers'] = []): ScraperConfig => ({
  maxPriceUsd: Number(envOrDefault('SCRAPER_MAX_PRICE_USD', '50')),
  minScore: Number(envOrDefault('SCRAPER_MIN_SCORE', '40')),
  scanIntervalMs: Number(envOrDefault('SCRAPER_SCAN_INTERVAL_MS', '300000')),
  providers,
  logLevel: envOrDefault('SCRAPER_LOG_LEVEL', 'info') as LogLevel,
})
