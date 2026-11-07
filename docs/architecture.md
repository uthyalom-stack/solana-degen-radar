# Architecture and implementation boundaries

## Runtime topology
- Next.js provides the human-facing terminal.
- Cloudflare Worker exposes typed HTTP endpoints and scheduled task entry points.
- D1 stores normalized observations, candidates, assessments, alerts, and paper trades.
- An optional Durable Object maintains one PumpPortal WebSocket for new-token and migration events; it is inactive unless an API key is configured.
- Worker-local provider functions handle DEX Screener, optional PumpPortal, Solana RPC, RSS/Atom, and Telegram webhooks. Pump.fun official social API, X, Reddit API, and TikTok remain disabled until access is available.

## Data flow
1. Adapters fetch public/provider-authorized source data (DEX Screener polling, optional PumpPortal stream, RSS/Atom, and Telegram webhooks).
2. Ingestion normalizes it and stores immutable source observations.
3. Narrative detection groups observations into candidate narratives.
4. Token discovery independently indexes Solana mint addresses and markets.
5. Matching links a token to a narrative only when the exact Solana mint address appears in an ingested social event; ticker-only matching is disabled.
6. Risk assessment records known indicators and unknown fields separately.
7. Alerts are deduplicated by deterministic fingerprint.
8. Paper execution uses timestamped quotes and explicit cost assumptions.

## Initial polling defaults
These are conservative defaults, not guarantees of provider availability:
- market discovery: every 5 minutes
- RSS social ingestion: every 5 minutes when feeds are configured
- risk refresh: on candidate creation and every 5 minutes for watched tokens
- alert dispatch: immediate after durable alert creation

## Trust model
External content is untrusted input. Never execute content from posts, token metadata, or web pages. LLM outputs may classify or summarize evidence, but code owns arithmetic, scoring, state transitions, and trade simulation.

## Phase gates
No live deployment until local tests pass, secrets are configured, D1 migrations are verified, provider terms are checked, and alert delivery is tested. No real trading in this release.
