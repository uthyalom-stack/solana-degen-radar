# Provider integration plan

Provider-specific ingestion is implemented in the Worker. Keep each source explicitly enabled/disabled; do not imply coverage when credentials or access are missing.

| Provider | Initial role | Access caveat |
|---|---|---|
| DEX Screener | Latest Solana token profiles, latest/top boosts, and pair snapshots | Implemented in the Worker; respect rate limits and API changes |
| Pump.fun Developer API | Approved, read-only social data such as public profiles, posts, and feeds | Requires organisation approval and a server-only bearer key; it is not a market/price feed. Its terms impose strict caching and data-use limits, so no adapter is enabled until retention/compliance is designed |
| PumpPortal WebSocket | New Pump.fun token and migration events | Optional Durable Object adapter implemented; requires a provider API key and long-lived outbound WebSocket. Only free creation/migration subscriptions are enabled; metered token/account trade streams are not subscribed |
| Solana RPC / Helius | Mint initialization, mint authority, and freeze authority checks | Implemented for the ten highest-liquidity candidates per scan; public RPC is rate-limited, Helius is optional |
| Helius | Enhanced Solana data | Optional API key and quota |
| X | Public crypto discussion | API access and pricing may restrict search |
| Reddit | Public subreddit discussions | Use approved API access and follow terms |
| TikTok | Trend discovery | Research/Discovery access is restricted; do not scrape around access controls |
| Telegram | Public channel signals | Only ingest channels and data the operator is permitted to access |
| RSS/news | Public trend signals | HTTPS RSS/Atom polling is implemented; respect publisher terms and attribution |

Unavailable providers must report `disabled` or `unavailable`; the system must not fabricate observations.


## Current connection state
- DEX Screener: implemented for discovery and snapshots. The profile/boost discovery endpoints are limited to 60 requests/minute; batch token pair lookup accepts up to 30 mints and is limited to 300 requests/minute.
- PumpPortal: optional Durable Object stream for new token and migration events; enable only after provider key and Cloudflare usage review.
- RSS/Atom: implemented when `SOCIAL_RSS_FEEDS` is configured.
- Social webhook: implemented at `/api/social/ingest`; set `SOCIAL_INGEST_SECRET` before exposing it.
- Telegram: outgoing alerts and test-message delivery are implemented when bot credentials are configured; channel-post ingestion is implemented when a bot webhook secret is configured.
- Solana RPC: mint initialization and authority checks are implemented for a limited top-liquidity sample. Helius enhanced holder/transaction enrichment is not connected.
- Pump.fun official Developer API, X API, Reddit API, and TikTok API: not connected. Reddit RSS feeds are supported through the generic RSS adapter.

PumpPortal real-time feed documentation: https://pumpportal.fun/data-api/real-time/. Official Pump.fun developer docs: https://docs.pump.fun/ and API terms: https://docs.pump.fun/terms/. The API is approved-organisation-only and read-only; it does not provide token market/price data. Review current terms before enabling any integration.
