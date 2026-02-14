# Torch Domain Auction Bot -- Security Audit

**Audit Date:** February 13, 2026
**Auditor:** Claude Opus 4.6 (Anthropic)
**Bot Version:** 1.0.2
**SDK Version:** torchsdk 3.2.3
**On-Chain Program:** `8hbUkonssSEEtkqzwM7ZcZrD9evacM92TcWSooVF4BeT` (V3.2.0)
**Language:** TypeScript
**Test Result:** 10 passed, 0 failed (Surfpool mainnet fork)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Scope](#scope)
3. [Methodology](#methodology)
4. [Keypair Safety Review](#keypair-safety-review)
5. [Vault Integration Review](#vault-integration-review)
6. [Domain Lease Security](#domain-lease-security)
7. [Risk Scoring Review](#risk-scoring-review)
8. [Scan Loop Security](#scan-loop-security)
9. [Configuration Validation](#configuration-validation)
10. [Dependency Analysis](#dependency-analysis)
11. [Threat Model](#threat-model)
12. [Findings](#findings)
13. [Conclusion](#conclusion)

---

## Executive Summary

This audit covers the Torch Domain Auction Bot v1.0.2, a single-package kit that implements a domain lending protocol on Torch Market. Domains are tokenized, top holders control the domain, holders can borrow SOL against their tokens, and underwater positions are liquidated through a Torch Vault -- causing the domain lease to rotate.

The bot was reviewed for key safety, vault integration correctness, domain lease security, risk scoring integrity, error handling, and dependency surface.

### Overall Assessment

| Category | Rating | Notes |
|----------|--------|-------|
| Key Safety | **PASS** | In-process `Keypair.generate()`, optional `SOLANA_PRIVATE_KEY`, no key logging |
| Vault Integration | **PASS** | `vault` param correctly passed to `buildLiquidateTransaction` |
| Domain Lease Logic | **PASS** | Top holder tracked correctly, leases expire and rotate |
| Risk Scoring | **PASS** | Four-factor weighted scoring, configurable threshold |
| Error Handling | **PASS** | Cycle-level catch, per-token/per-holder try/catch |
| Config Validation | **PASS** | Required env vars checked, scan interval floored at 5000ms |
| Dependencies | **MINIMAL** | 5 runtime deps, all pinned exact. No `^` or `~` ranges. |
| Supply Chain | **LOW RISK** | No post-install hooks, no remote code fetching |

### Finding Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Informational | 5 |

---

## Scope

### Files Reviewed

**Kit Package (`packages/kit/`):**

| File | Lines | Role |
|------|-------|------|
| `src/index.ts` | ~130 | Entry: vault verification, startup banner, CLI, all exports |
| `src/config.ts` | ~80 | Env validation, ephemeral keypair |
| `src/monitor.ts` | ~83 | Scan loop orchestration |
| `src/scanner.ts` | ~107 | Lending market discovery |
| `src/liquidator.ts` | ~89 | Vault-routed liquidation |
| `src/risk-scorer.ts` | ~89 | Four-factor risk scoring |
| `src/wallet-profiler.ts` | ~127 | SAID verification, trade analysis |
| `src/launcher.ts` | ~39 | Domain token creation |
| `src/domain-manager.ts` | ~72 | Lease tracking and rotation |
| `src/ticker.ts` | ~35 | Symbol generation |
| `src/logger.ts` | ~35 | Structured logging (shared across all modules) |
| `src/types.ts` | ~110 | Type definitions |
| `src/utils.ts` | ~34 | Helpers, base58 decoder |
| `src/scraper/index.ts` | ~43 | Scraper CLI entry |
| `src/scraper/scanner.ts` | ~36 | Domain scanning |
| `src/scraper/evaluator.ts` | ~71 | Quality scoring |
| `src/scraper/ticker.ts` | ~48 | Symbol generation |
| `src/scraper/config.ts` | ~11 | Scraper config |
| `src/scraper/types.ts` | ~30 | Scraper types |
| `src/scraper/providers/*.ts` | ~115 | Data sources |
| `tests/test_bot.ts` | ~346 | Bot E2E test suite |
| `tests/test_scraper.ts` | ~198 | Scraper unit tests |
| `package.json` | ~37 | Dependencies |

**Total:** ~1,600 lines in one package.

### SDK Cross-Reference

The bot relies on `torchsdk@3.2.3` for all on-chain interaction. The SDK was independently audited. This audit focuses on the bot's usage of the SDK, not the SDK internals.

---

## Methodology

1. **Line-by-line source review** of all bot source files
2. **Keypair lifecycle analysis** -- generation, usage, exposure surface
3. **Vault integration verification** -- correct params on ALL liquidation calls
4. **Domain lease logic review** -- rotation correctness, edge cases
5. **Risk scoring validation** -- factor computation, weight normalization, bounds
6. **Error handling analysis** -- crash paths, retry behavior, log safety
7. **Dependency audit** -- runtime deps, dev deps, post-install hooks, version pinning
8. **E2E test review** -- coverage, assertions, false positives

---

## Keypair Safety Review

### Generation

The keypair is created via `loadKeypair()` in `config.ts`:

```typescript
export const loadKeypair = (): { keypair: Keypair; generated: boolean } => {
  const privateKey = process.env.SOLANA_PRIVATE_KEY ?? null
  if (privateKey) {
    // try JSON byte array, then base58
    return { keypair: Keypair.fromSecretKey(...), generated: false }
  }
  return { keypair: Keypair.generate(), generated: true }
}
```

Two paths:
1. **Default (recommended):** `Keypair.generate()` -- fresh Ed25519 keypair from system entropy
2. **Optional:** `SOLANA_PRIVATE_KEY` env var -- JSON byte array or base58 via inline `decodeBase58`

The keypair is:
- **Not persisted** to disk (unless user provides `SOLANA_PRIVATE_KEY`)
- **Not exported** -- `keypair` is embedded in `BotConfig`, not in the public API surface
- **Not logged** -- only the public key is printed at startup
- **Not transmitted** -- the secret key never leaves the process

### Usage Points

The keypair is used in exactly three places:
1. **Public key extraction** -- startup logging, vault link check, liquidation/launch params (safe)
2. **Liquidation signing** -- `result.transaction.partialSign(this.config.walletKeypair)` in `liquidator.ts:66`
3. **Token launch signing** -- `result.transaction.partialSign(wallet)` in `launcher.ts:28`

Both signing operations are local only.

### Base58 Decoder

The inline `decodeBase58` in `utils.ts` avoids the ESM-only `bs58` dependency at runtime. It matches the pattern from the liquidation-kit and correctly handles leading zeros.

**Verdict:** Key safety is correct. No key material leaks from the process.

---

## Vault Integration Review

### CRITICAL: Liquidation Transaction

```typescript
// liquidator.ts:60-65
const result = await buildLiquidateTransaction(connection, {
  mint: scored.mint,
  liquidator: this.config.walletKeypair.publicKey.toBase58(),
  borrower: scored.borrower,
  vault: this.config.vaultCreator,
})
```

The `vault` parameter is correctly passed. This was previously missing (the original code at these lines omitted the `vault` param entirely). Per the SDK, when `vault` is provided:
- Vault PDA derived from `vaultCreator` (`["torch_vault", creator]`)
- Wallet link PDA derived from `liquidator` (`["vault_wallet", wallet]`)
- SOL debited from vault, collateral tokens credited to vault ATA

**There is exactly one call to `buildLiquidateTransaction` in the codebase. It correctly includes the `vault` parameter.**

### Startup Verification

```typescript
// index.ts:63-86
const vault = await getVault(connection, config.vaultCreator)
if (!vault) throw new Error(...)

const link = await getVaultForWallet(connection, config.walletKeypair.publicKey.toBase58())
if (!link) { /* print instructions, exit */ }
```

Both checks execute before any command (monitor, launch, info). The bot cannot operate without a valid vault and linked agent.

**Verdict:** Vault integration is correct. All liquidation value routes through the vault PDA. The previous security blocker (missing `vault` param) is resolved.

---

## Domain Lease Security

### Lease Rotation Logic

```typescript
// domain-manager.ts:42-56
if (activeLease.lessee !== topHolder) {
  activeLease.active = false
  updated.push({
    domain: dt.domain,
    mint: dt.mint,
    lessee: topHolder,
    startedAt: now,
    expiresAt: now + DEFAULT_LEASE_DURATION_MS,
    active: true,
  })
}
```

The lease system:
1. Checks top holder via `getHolders(connection, mint, 1)`
2. If top holder changed, expires old lease and creates new one
3. Leases have a 7-day default duration
4. Expired leases are cleaned up at the start of each cycle

### Edge Cases

- **No holders:** `checkTopHolder` returns `null`, no lease created (correct)
- **Same holder:** No rotation, existing lease continues (correct)
- **Liquidation rotation:** After collateral moves to vault ATA, the vault may become top holder. This is by design -- the vault operator controls the domain until they withdraw or sell the tokens.
- **Concurrent purchases:** The lease checks once per scan cycle. Rapid trading may cause temporary lag, but the lease always converges to the current top holder.

**Verdict:** Lease logic is correct. Rotation tracks actual token ownership accurately with acceptable latency.

---

## Risk Scoring Review

### Factor Computation

| Factor | Implementation | Bounds |
|--------|---------------|--------|
| LTV Proximity | `(currentLtv / threshold) * 100` | Clamped 0-100 |
| Price Momentum | `50 - priceChange * 100` | Clamped 0-100 |
| Wallet Risk | SAID + trade stats composite | Clamped 0-100 |
| Interest Burden | `interestRatio * 500` | Clamped 0-100 |

### Weight Normalization

```typescript
const WEIGHTS = {
  ltvProximity: 0.35,
  priceMomentum: 0.25,
  walletRisk: 0.2,
  interestBurden: 0.2,
}
```

Weights sum to 1.0. Final score is clamped to 0-100.

### Safety Checks in Liquidator

The `tryLiquidate` method applies four gates before executing:
1. `position.health === 'healthy'` → skip (line 24)
2. `riskScore < riskThreshold` → skip (line 32)
3. `estimatedProfitLamports < minProfitLamports` → skip (line 40)
4. `position.health !== 'liquidatable'` → skip (line 48)

These are applied in sequence. A position must be `liquidatable`, above the risk threshold, AND profitable to trigger execution.

**Verdict:** Scoring is mathematically sound. All factors bounded. Liquidation has appropriate safety gates.

---

## Scan Loop Security

### Error Isolation

The scan loop has three levels of error isolation:

**Cycle level** (monitor.ts):
```typescript
while (true) {
  try {
    // scan, score, liquidate, rotate
  } catch (err) {
    log.error('monitor tick failed', err)
  }
  await sleep(config.scoreIntervalMs)
}
```

**Token level** (scanner.ts):
```typescript
for (const summary of result.tokens) {
  try { ... } catch (err) {
    log.debug(`skipping ${summary.mint}: ${err}`)
  }
}
```

**Borrower level** (monitor.ts):
```typescript
for (const borrower of token.activeBorrowers) {
  try { ... } catch (err) {
    log.debug(`error scoring ${borrower.slice(0, 8)}...`, err)
  }
}
```

**Liquidation level** (liquidator.ts):
```typescript
try {
  const result = await buildLiquidateTransaction(...)
  // sign, send, confirm
} catch (err) {
  this.log.error(`liquidation failed...`, err)
  return null
}
```

No single failure can crash the bot. Each level catches independently.

**Verdict:** Error handling is robust. The bot degrades gracefully at every level.

---

## Configuration Validation

### Required Variables

| Variable | Validation | Failure Mode |
|----------|-----------|--------------|
| `SOLANA_RPC_URL` | Must be set (fallback: `BOT_RPC_URL`) | Throws on startup |
| `VAULT_CREATOR` | Must be set | Throws on startup |
| `BOT_SCAN_INTERVAL_MS` | Must be >= 5000 | Throws on startup |
| `BOT_LOG_LEVEL` | Must be `debug\|info\|warn\|error` | Throws on startup |

### Security Notes

- `SOLANA_RPC_URL` used only for Solana RPC calls -- never logged or transmitted externally
- `VAULT_CREATOR` is a public key (not sensitive)
- `SOLANA_PRIVATE_KEY` is optional, read once at startup, never logged or transmitted

**Verdict:** Configuration properly validated. Sensitive values handled safely.

---

## Dependency Analysis

### Runtime Dependencies

| Package | Version | Pinning | Post-Install | Risk |
|---------|---------|---------|-------------|------|
| `@solana/web3.js` | 1.98.4 | Exact | None | Low |
| `torchsdk` | 3.2.3 | Exact | None | Low |
| `@coral-xyz/anchor` | 0.32.1 | Exact | None | Low |
| `@solana/spl-token` | 0.4.14 | Exact | None | Low |
| `bs58` | 6.0.0 | Exact | None | Low |

### Supply Chain

- **No `^` or `~` version ranges** -- all dependencies pinned to exact versions
- **No post-install hooks** -- scripts contain only `build`, `clean`, `test`, `format`
- **No remote code fetching** -- no dynamic `import()`, no `eval()`, no fetch-and-execute
- **Lockfile present** -- `pnpm-lock.yaml` pins transitive dependencies

### External Runtime Dependencies

The SDK makes outbound HTTPS requests to three services:

| Service | Purpose | Data Sent | Bot Uses? |
|---------|---------|-----------|-----------|
| **CoinGecko** (`api.coingecko.com`) | SOL/USD price | None (GET only) | Yes via `getTokens()` |
| **Irys Gateway** (`gateway.irys.xyz`) | Token metadata fallback | None (GET only) | Yes via `getTokens()` |
| **SAID Protocol** (`api.saidprotocol.com`) | Wallet reputation | Wallet address (public) | Yes via `verifySaid()` |

No private key material is ever transmitted. All requests are read-only. If any service is unreachable, the SDK degrades gracefully.

**Verdict:** Minimal and locked dependency surface. No supply chain concerns.

---

## Threat Model

### Threat: Compromised Agent Keypair

**Attack:** Attacker obtains the agent's private key from process memory.
**Impact:** Attacker can sign vault-routed transactions.
**Mitigation:** Agent holds ~0.01 SOL. Authority unlinks in one transaction. Cannot call `withdrawVault` or `withdrawTokens`.
**Residual risk:** Attacker could execute vault-routed liquidations until unlinked. Limited by vault SOL balance.

### Threat: Malicious RPC Endpoint

**Attack:** RPC returns fabricated positions to trigger unprofitable liquidations.
**Impact:** Bot liquidates positions that aren't actually underwater.
**Mitigation:** On-chain program validates all liquidation preconditions. Fabricated RPC data produces transactions that fail on-chain.
**Residual risk:** None -- on-chain validation is the security boundary.

### Threat: Domain Lease Manipulation

**Attack:** Attacker rapidly buys/sells tokens to flip domain control.
**Impact:** Domain lease rotates frequently.
**Mitigation:** 7-day lease duration acts as debounce. Lease only rotates when top holder actually changes. Market depth (after migration) makes manipulation expensive.
**Residual risk:** For low-liquidity tokens, lease manipulation is cheaper. This is inherent to the model.

### Threat: Risk Score Gaming

**Attack:** Borrower maintains SAID verification and trade history to lower risk score, avoiding liquidation.
**Impact:** Underwater position liquidated later than optimal.
**Mitigation:** LTV proximity has the highest weight (35%). Risk score is a secondary filter -- the primary gate is `position.health === 'liquidatable'` which is computed on-chain from actual collateral/debt ratios.
**Residual risk:** Delayed liquidation in edge cases. No capital loss -- the position is still liquidatable.

### Threat: Front-Running

**Attack:** MEV bot observes the liquidation transaction and front-runs it.
**Impact:** Bot's transaction fails (`NOT_LIQUIDATABLE`).
**Mitigation:** Error caught, bot moves to next position. No vault SOL lost on failed liquidation.
**Residual risk:** Reduced success rate in competitive MEV environments.

---

## Findings

### L-1: Wallet Profiler Caches May Bias Risk Scores

**Severity:** Low
**File:** `wallet-profiler.ts:23`
**Description:** Wallet profiles are cached for 60 seconds. During volatile markets, a profile cached before a rapid sell-off may understate wallet risk, slightly delaying liquidation.
**Impact:** Marginally delayed liquidation for borrowers who just began suspicious activity.
**Recommendation:** Reduce cache TTL to 30s or clear cache on large price movements.

### L-2: No Timeout on SDK Calls

**Severity:** Low
**Files:** `scanner.ts`, `monitor.ts`, `liquidator.ts`
**Description:** SDK calls have no explicit timeout. A hanging RPC endpoint could block the scan loop indefinitely.
**Impact:** Bot stalls until TCP-level timeout.
**Recommendation:** Wrap SDK calls in `Promise.race` with a 30-second timeout.

### I-1: Holder Discovery Limited to 20

**Severity:** Informational
**File:** `scanner.ts:26`
**Description:** `getHolders(connection, mint, 20)` returns at most 20 holders. Tokens with many borrowers may have liquidatable positions not discovered.
**Impact:** Missed liquidation opportunities for high-holder-count tokens.

### I-2: Lease Duration Not Configurable

**Severity:** Informational
**File:** `domain-manager.ts:6`
**Description:** `DEFAULT_LEASE_DURATION_MS` is hardcoded to 7 days. Different use cases may want shorter or longer lease periods.
**Impact:** Inflexible for operators wanting different rotation speeds.

### I-3: Price Momentum Assumes Linear Price History

**Severity:** Informational
**File:** `risk-scorer.ts:23`
**Description:** Price momentum compares first and last entries in the price history array. This misses intra-period volatility (e.g., a V-shaped recovery looks the same as flat).
**Impact:** Risk scoring may underweight volatile tokens that recovered.

### I-4: Vault May Become Top Holder After Liquidation

**Severity:** Informational
**File:** `domain-manager.ts`
**Description:** After liquidation, collateral tokens move to the vault ATA. If the vault holds more tokens than any other holder, the vault becomes the domain lessee. This is by design but worth noting -- the vault operator effectively controls the domain until tokens are withdrawn or sold.
**Impact:** None -- this is the intended behavior. The vault operator can withdraw tokens to relinquish domain control.

### I-5: No Deduplication of Failed Liquidation Attempts

**Severity:** Informational
**File:** `liquidator.ts`
**Description:** If a liquidation fails (e.g., insufficient vault SOL), the same position will be retried every scan cycle.
**Impact:** Repeated log noise. No financial impact -- failed transactions don't consume vault SOL.

---

## Conclusion

The Torch Domain Auction Bot v1.0.2 is a well-structured single-package kit with correct vault integration, robust error handling, and a sound domain lending model. Key findings:

1. **Key safety is correct** -- in-process `Keypair.generate()`, optional `SOLANA_PRIVATE_KEY`, no key logging or transmission.
2. **Vault integration is correct** -- `vault` param passed to `buildLiquidateTransaction`. This was the critical security blocker and is now resolved.
3. **Domain lease rotation is correct** -- top holder tracked accurately, leases expire and rotate as expected.
4. **Risk scoring is mathematically sound** -- four factors, weights sum to 1.0, all bounded 0-100, configurable threshold.
5. **Error handling is robust** -- four levels of isolation. No single failure crashes the bot.
6. **Dependencies are minimal and pinned** -- 5 runtime deps, all exact versions, no `^` ranges, no post-install hooks.
7. **No critical, high, or medium findings** -- 2 low, 5 informational.

The domain lending model (tokenize → lend → liquidate → rotate control) is a novel composition of Torch Market primitives. The implementation correctly leverages the vault for safety and the lending market for domain dynamics.

The bot is safe for production use as an autonomous domain lending keeper operating through a Torch Vault.

---

## Audit Certification

This audit was performed by Claude Opus 4.6 (Anthropic) on February 13, 2026. All source files were read in full and cross-referenced against the torchsdk v3.2.3 audit. The E2E test suite (10 passed) validates the bot against a Surfpool mainnet fork.

**Auditor:** Claude Opus 4.6
**Date:** 2026-02-13
**Bot Version:** 1.0.2
**SDK Version:** torchsdk 3.2.3
**On-Chain Version:** V3.2.0 (Program ID: `8hbUkonssSEEtkqzwM7ZcZrD9evacM92TcWSooVF4BeT`)
