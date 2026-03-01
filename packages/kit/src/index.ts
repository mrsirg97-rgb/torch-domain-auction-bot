#!/usr/bin/env node

import { Connection } from '@solana/web3.js'
import { loadConfig, loadKeypair } from './config'
import { Logger } from './logger'
import { runMonitor } from './monitor'
import { launchDomainToken } from './launcher'
import { getToken, getVault, getVaultForWallet } from 'torchsdk'
import { sol, withTimeout } from './utils'

// bot exports
export { scanForLendingMarkets } from './scanner'
export { WalletProfiler } from './wallet-profiler'
export { scoreLoan } from './risk-scorer'
export { Liquidator } from './liquidator'
export { Logger } from './logger'
export { launchDomainToken } from './launcher'
export { checkTopHolder, updateLeases } from './domain-manager'
export { generateTicker } from './ticker'
export type {
  BotConfig,
  MonitoredToken,
  WalletProfile,
  ScoredLoan,
  LiquidationResult,
  DomainToken,
  DomainLease,
  LaunchResult,
  LogLevel,
} from './types'

// scraper exports
export { scanDomains } from './scraper/scanner'
export { evaluateDomain } from './scraper/evaluator'
export { generateTicker as generateScraperTicker } from './scraper/ticker'
export type { DomainListing, DomainProvider, ScoredDomain, ScraperConfig } from './scraper/types'

const printUsage = () => {
  console.log(`torch-domain-bot — domain auction bot for torch.market

Usage:
  torch-domain-bot monitor    Start the lending monitor and auto-liquidator
  torch-domain-bot launch     Launch a domain token (interactive)
  torch-domain-bot info       Show token info for a mint
  torch-domain-bot help       Show this help message
`)
}

const main = async () => {
  const args = process.argv.slice(2)
  const command = args[0] ?? 'help'

  if (command === 'help' || command === '--help') {
    printUsage()
    return
  }

  const config = loadConfig()
  const log = new Logger('bot', config.logLevel)
  const connection = new Connection(config.rpcUrl, 'confirmed')

  // startup banner
  console.log('=== torch domain auction bot ===')
  console.log(`agent wallet: ${config.walletKeypair.publicKey.toBase58()}`)
  console.log(`vault creator: ${config.vaultCreator}`)
  console.log(`scan interval: ${config.scanIntervalMs}ms`)
  console.log()

  // verify vault exists
  const vault = await withTimeout(getVault(connection, config.vaultCreator), 30_000, 'getVault')
  if (!vault) {
    throw new Error(`vault not found for creator ${config.vaultCreator}`)
  }
  log.info(`vault found — authority=${vault.authority}`)

  // verify agent wallet is linked to vault
  const link = await withTimeout(getVaultForWallet(connection, config.walletKeypair.publicKey.toBase58()), 30_000, 'getVaultForWallet')
  if (!link) {
    console.log()
    console.log('--- ACTION REQUIRED ---')
    console.log('agent wallet is NOT linked to the vault.')
    console.log('link it by running (from your authority wallet):')
    console.log()
    console.log(`  buildLinkWalletTransaction(connection, {`)
    console.log(`    authority: "<your-authority-pubkey>",`)
    console.log(`    vault_creator: "${config.vaultCreator}",`)
    console.log(`    wallet_to_link: "${config.walletKeypair.publicKey.toBase58()}"`)
    console.log(`  })`)
    console.log()
    console.log('then restart the bot.')
    console.log('-----------------------')
    process.exit(1)
  }

  log.info('agent wallet linked to vault — starting')
  log.info(`treasury: ${sol(vault.sol_balance ?? 0)} SOL`)

  if (command === 'monitor') {
    await runMonitor(config)
  } else if (command === 'launch') {
    const domain = args[1]
    if (!domain) {
      console.error('Usage: torch-domain-bot launch <domain>')
      process.exit(1)
    }
    const result = await launchDomainToken(connection, config.walletKeypair, domain, undefined, log)
    console.log(`launched: mint=${result.mint}, ticker=${result.ticker}`)
  } else if (command === 'info') {
    const mint = args[1]
    if (!mint) {
      console.error('Usage: torch-domain-bot info <mint>')
      process.exit(1)
    }
    const detail = await getToken(connection, mint)
    console.log(JSON.stringify(detail, null, 2))
  } else {
    console.error(`unknown command: ${command}`)
    printUsage()
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
}
