# Multi-source meme-coin discovery

The discovery system stores source-attributed evidence in D1. A candidate's source count and discovery score are derived from persisted evidence; they are not a prediction of profitability.

## Pipelines and current coverage

| Method | Current implementation | Coverage / limitation |
|---|---|---|
| Raw Solana RPC | Bounded recent Tokenkeg and Token-2022 mint-initialization polling | Best-effort polling, not complete historical or real-time coverage. A streaming/indexer feed is needed for reliable early discovery. |
| Wallet relationships | Holder snapshots, wallet-cluster comparisons, shared-funder/co-holding evidence | Depends on wallet ingestion completeness. Co-holding is an inference, not proof of common control. |
| Liquidity and pools | DEX pair observations, persisted liquidity snapshots, configured AMM/launchpad program activity | Unique buyers and organic volume require transaction-level swap decoding; pool transaction counts are not unique buyers. |
| Social narrative before token | Repeated hashtags/cashtags from ingested social posts, plus token-alias matching | Coverage is limited to configured/ingested social sources; a viral term is not proof that a token will be created. |
| Launchpads and graduation | PumpPortal launch events and Pump.fun-to-Raydium/Meteora pool matching | Graduation is inferred from matching launch and downstream-pool evidence; retain the evidence chain. |
| Jito/bundle analysis | Optional configured Jito tip-account transfer indicators | Tip transfers are weak clues only. They do not prove bundle membership, coordinated ownership, or malicious activity. |
| Cross-chain capital | Optional configured bridge-program interaction monitoring | Program interaction alone does not decode bridge direction, source chain, asset, or USD value. Wormhole/deBridge message decoding/indexer data is still required. |
| Trading-route discovery | Bounded Jupiter mint-to-SOL quote checks | A quote is not a successful execution or a guaranteed sell. Provider errors and no-route responses remain unknown. |
| Image similarity | Exact normalized metadata image-URL reuse detection | Experimental. This is not perceptual hashing or visual embedding similarity. |
| X first-caller and convergence | Multi-lane official X recent search, account metadata, exact-mint mention history, earliest observed callers and distinct-author convergence | Requires X_BEARER_TOKEN and recent-search API access. Recent search is window-limited; earliest post in the captured sample is not guaranteed to be the first post on X. No caller win-rate is claimed. |
| Developer/domain/community | Website, social, Telegram and GitHub URLs extracted from token metadata; creator attribution evidence | Does not yet validate domain age, repository history, developer identity, or community authenticity. |

## D1 migration

Apply migrations/0007_multi_source_discovery.sql and migrations/0009_x_early_intelligence.sql before deploying a Worker build that uses the corresponding discovery features.

## Worker configuration

Optional Worker configuration:

- X_SEARCH_QUERIES: optional newline-separated official X API v2 recent-search queries (maximum 4 custom lanes).
- X_TRACKED_ACCOUNTS: optional comma-separated X usernames to monitor with from: searches (maximum 8 usernames; queried together in one lane).
- SOLANA_DISCOVERY_PROGRAM_IDS: verified launchpad/AMM program IDs to poll for recent activity.
- JITO_TIP_ACCOUNTS: verified Jito tip destination accounts. Tip activity is not bundle proof.
- BRIDGE_PROGRAM_IDS: verified Solana bridge program IDs. Full cross-chain attribution requires bridge-specific message decoding.

These values are intentionally empty by default. Do not populate them with guessed addresses.

## Read APIs

- GET /api/discovery/candidates
- GET /api/discovery/evidence?mint=<mint>
- GET /api/discovery/sources
- GET /api/discovery/narratives
- GET /api/social/x/early-signals (optional ?mint=<mint>)
- GET /api/social/x/callers

## Safety and interpretation

- Unknown data must remain unknown, never be treated as safe.
- Every evidence record retains source, timestamp, evidence type, confidence and payload.
- Do not infer unique beneficial ownership from a shared funder, shared bundle, or co-holding alone.
- Do not use discovery score as a buy signal. Risk and trade viability remain separate assessments.