# Torch Domain Auction

Domains become tokens. Tokens become collateral. Top holder controls the domain.

A domain lending protocol built on [Torch Market](https://torch.market). Domains are launched as tokens via bonding curves, permanently linked after migration, and backed by built-in lending markets. The top token holder controls the domain. Holders can borrow SOL against their tokens -- but get liquidated and you lose the domain.

## How It Works

1. **Launch** -- a domain is launched as a Torch Market token (bonding curve)
2. **Migrate** -- after bonding completes, the domain is permanently linked to the token
3. **Lend** -- holders lock tokens as collateral and borrow SOL (up to 50% LTV, 2% weekly interest)
4. **Liquidate** -- if LTV crosses 65%, a keeper liquidates the position through a vault and collects a 10% bonus
5. **Rotate** -- collateral changes hands, top holder changes, domain lease rotates

## Structure

| Path | Description |
|------|-------------|
| `packages/kit` | Domain lending kit -- bot (lending monitor, liquidation keeper, lease manager) + scraper (domain discovery, evaluation, ticker generation) |
| `clawhub/` | ClawHub submission -- agent.json, SKILL.md, design.md, audit.md, bundled SDK + compiled kit |

## Quick Start

```bash
# install
pnpm install

# build
pnpm --filter torch-domain-auction-bot build

# run (requires vault setup first -- see clawhub/SKILL.md)
VAULT_CREATOR=<pubkey> SOLANA_RPC_URL=<rpc> npx torch-domain-bot monitor
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | Yes | -- | Solana RPC endpoint. Fallback: `BOT_RPC_URL` |
| `VAULT_CREATOR` | Yes | -- | Vault creator pubkey |
| `SOLANA_PRIVATE_KEY` | No | -- | Agent keypair (base58 or JSON). Omit to generate fresh on startup |
| `BOT_SCAN_INTERVAL_MS` | No | `60000` | Scan cycle interval (min 5000) |
| `BOT_RISK_THRESHOLD` | No | `60` | Min risk score to liquidate (0-100) |
| `BOT_LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |

## Vault Safety

All operations route through a Torch Vault. The agent keypair is disposable -- generated in-process, holds nothing of value. The vault holds all SOL and collateral. The human principal retains full control: withdraw SOL, withdraw tokens, unlink the agent at any time.

## Testing

Requires [Surfpool](https://github.com/nicholasgasior/surfpool) running a mainnet fork:

```bash
surfpool start --network mainnet --no-tui
cd packages/kit && pnpm test:bot
cd packages/kit && pnpm test:scraper
```

## Dependencies

All pinned to exact versions. No `^` or `~` ranges.

- `@solana/web3.js` 1.98.4
- `torchsdk` 3.7.23
- `@coral-xyz/anchor` 0.32.1
- `@solana/spl-token` 0.4.14

## Links

- [Torch Market](https://torch.market)
- [Torch SDK](https://www.npmjs.com/package/torchsdk)
- [ClawHub Skill](clawhub/SKILL.md)
- [Design Doc](clawhub/design.md)
- [Security Audit](clawhub/audit.md)
- Program ID: `8hbUkonssSEEtkqzwM7ZcZrD9evacM92TcWSooVF4BeT`

## License

MIT
