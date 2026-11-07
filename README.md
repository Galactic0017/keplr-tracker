# Keplr / Web3Auth Incident Tracker

Live tracker for the Nov 6–7, 2026 Keplr / Web3Auth incident.

## What it tracks

- **Totals** — $4.5M+ taken, 41,500+ wallets drained, 3 chains (Cosmos Hub, Osmosis, Injective), $0 cashed out. These are tracker-reported figures from a community tracker; Keplr/Web3Auth have not confirmed a final total in their official statements.
- **Cause** — security issue at Web3Auth (the social-login provider). Attacker identity unknown; no verified attacker addresses published yet.
- **Money flow map** — victims → attacker wallets → cash-out, with live status.
- **Wallet watch** — live balances + recent in/out transactions for any Cosmos / Osmosis / Injective address, via public LCD APIs, auto-refreshing every 60s. Anyone can add an address on the page (saved in their own browser).
- **Timeline, official links, safety checklist.**

## How to update the numbers

Edit `data.json`:
- `incident.totals` — takenUsd, walletsDrained, chains, cashedOutUsd.
- `incident.timeline` — add events as they happen.
- `attackerWallets` — add verified attacker addresses here when one is confirmed (address + note). They then show in the Attacker Wallets section.
- `watchlist` — default watched addresses.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Static site — no build step. Import the repo into Vercel and deploy with defaults.
