# Design: Domain Reseller Bot

## Overview

A two-package monorepo that scans for undervalued domains, launches torch.market tokens for each acquired domain, and lends domains to top token holders.

## Architecture

```
┌─────────────┐       scored domains        ┌──────────────┐
│   scraper    │ ──────────────────────────→ │     bot      │
│  (read-only) │                             │  (on-chain)  │
└─────────────┘                             └──────────────┘
      │                                           │
      ├─ providers (expired, availability)        ├─ launcher (torchsdk)
      ├─ evaluator (score 0-100)                  ├─ domain-manager (leases)
      └─ ticker (generate symbols)                ├─ scanner (lending markets)
                                                  ├─ wallet-profiler (SAID)
                                                  ├─ risk-scorer (4-factor)
                                                  └─ liquidator (auto-liq)
```

## Data Flow

1. **Scan**: Scraper polls domain providers for cheap listings
2. **Score**: Evaluator scores each domain by resale potential (0-100)
3. **Launch**: Bot creates a torch.market token per domain (name=domain, ticker=generated, metadata_uri=domain URL)
4. **Monitor**: Bot tracks token holders via `getHolders()`
5. **Lease**: Top holder gets to borrow the domain for a configurable duration
6. **Lending**: Bot monitors lending positions on domain tokens
7. **Liquidate**: Unhealthy lending positions are auto-liquidated for profit

## Interface Contracts

### Scraper Types

```typescript
interface DomainListing {
  name: string
  tld: string
  price: number
  currency: string
  provider: string
  expiry?: Date
}

interface DomainProvider {
  name: string
  scan: (opts: { maxPrice: number; limit: number }) => Promise<DomainListing[]>
}

interface ScoredDomain {
  listing: DomainListing
  score: number       // 0-100
  ticker: string      // generated 3-6 char symbol
  reasoning: string
}
```

### Bot Types

Test-required interfaces (matching liquidation bot reference):
- `MonitoredToken` — token state with lending info and price history
- `BotConfig` — runtime configuration
- `WalletProfile` — SAID verification + trade stats
- `ScoredLoan` — risk-scored lending position
- `LiquidationResult` — execution result

Domain-specific interfaces:
- `DomainToken` — launched domain token state
- `DomainLease` — active lease to top holder
- `LaunchResult` — token creation result

### Module Exports

| Module | Export | Type |
|--------|--------|------|
| scanner | `scanForLendingMarkets` | arrow function |
| wallet-profiler | `WalletProfiler` | class (stateful cache) |
| risk-scorer | `scoreLoan` | arrow function |
| liquidator | `Liquidator` | class (stateful config) |
| logger | `Logger` | class (stateful level) |

## Key Decisions

- **v1 scraper is read-only**: No domain purchasing yet
- **v1 leases are off-chain**: Tracked in bot memory, DNS stubbed
- **Packages are independent**: Shared logic (ticker gen) is duplicated, not linked
- **Arrow functions default**: Classes only where state/caching is needed
