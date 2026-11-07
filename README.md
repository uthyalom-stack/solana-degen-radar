# Solana Degen Radar

A complete Solana meme-coin discovery, social viral intelligence, on-chain token risk analysis, wallet intelligence, breakout detection, backtesting, paper-trading simulation, and non-custodial live-trading terminal.

---

## Core Features

### 1. Token Discovery Engine
- **Multi-Source Discovery**: Continuously discovers fresh and trending tokens from DEX Screener (latest token profiles, latest boosts, top boosts), Pump.fun / PumpPortal launch streams, and Raydium/Meteora pool creations.
- **On-Chain & Market Tracking**: Captures mint address, pair address, token name, symbol, creation timestamp, creator/deployer address, liquidity, market cap, FDV, volume (5m, 1h, 24h), buy/sell transaction flow, and price changes.
- **Deduplication & History**: Deduplicates candidates using Solana mint addresses and retains price snapshots to track token development over time.

### 2. Social & Viral Intelligence Engine
- **Replaceable Provider Adapters**:
  - **Reddit Communities**: Ingests public discussions from `r/solana`, `r/CryptoMoonShots`, `r/memecoins`, and `r/SolanaMemeCoins` via documented public JSON endpoints.
  - **Crypto News (RSS/Atom)**: Ingests news from CoinDesk, Decrypt, CoinTelegraph, and custom feeds.
  - **Telegram**: Channel webhook ingestion and instant Telegram bot alert notifications.
  - **X (Twitter)**: Documented v2 search integration with graceful status reporting.
  - **TikTok**: Documented trend discovery adapter interface with capability status tracking.
- **Entity & Narrative Extraction**: Automatically extracts Solana base58 mints and cashtags (`$TICKER`), clusters conversations into emerging meme themes (AI agents, dogs, cats, frogs, surreal memes, DeFi utility, political), and calculates mention velocity, novelty, and cross-platform spread.
- **Attention Spike Detection**: Detects sudden mention surges (e.g. >2.5x normal volume) and triggers priority alerts.

### 3. Advanced Wallet Intelligence Engine
- **Creator & Deployer Profiling**:
  - Resolves deployer public addresses and aggregates historical launches.
  - Calculates creator reputation score (0–100) based on launch survival rates, past rug pulls, and token longevity.
  - Answers: *"This creator made token X. What other tokens did they create and what happened to them?"*
- **Large-Holder Tracking & Concentration**:
  - Tracks top 10 and top 20 holders using `getTokenLargestAccounts`.
  - Excludes known burn addresses (`11111111111111111111111111111111`) and DEX AMM authority vaults (`5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`) to reflect true beneficial owner centralization.
- **Wallet Clustering & Relationship Analysis**:
  - Detects shared funding sources, repeated transfer patterns, and coordinated buying/exiting behavior.
  - Retains underlying transaction evidence and calculates confidence scores (0–100).
- **Cross-Token Wallet History**:
  - Answers: *"This wallet is buying token X. What other tokens has it participated in, and did those tokens collapse?"*

### 4. Evidence-Based Rug-Pull & Manipulation Detection
- **Contract Security Checks**:
  - Mint authority disabled/renounced verification.
  - Freeze authority disabled/renounced verification.
  - Token mint account initialization verification.
  - LP burn/lock verification (detects burned LP to `11111111111111111111111111111111`).
- **Manipulation & Wash-Trading Signals**:
  - Identifies abnormally high volume turnover vs liquidity (e.g. 1h volume >10x pool liquidity).
  - Detects heavy sell-side dumping (>75% sells in 1h window).
  - Identifies honeypot risk patterns and deployer dump signatures.
- **Explainable Risk Scoring (0–100)**: Transparent scorecard of observed red flags, passing safety checks, and unverified unknowns.

### 5. Breakout Signals Engine
- Scans price, volume acceleration, liquidity growth, and social attention.
- Emits categorized signals:
  - `confirmed_breakout`: Momentum >= 75, price +25%+, volume expansion >= 50%, liquidity >= $15k.
  - `early_attention`: Sudden surge in social mentions before price takes off.
  - `momentum_surge`: Volume acceleration > 100% with high momentum.
  - `overextended`: Extreme short-term runup (>150% in 1h) alerting to imminent pullback.
  - `distribution_warning`: High volume with declining price and whale exits.

### 6. Historical Backtesting Engine
- **Deterministic Backtesting**: Evaluates user-defined trading strategies against historical snapshot records stored in Cloudflare D1 without look-ahead bias.
- **Configurable Parameters**: Entry momentum threshold, maximum risk score, take-profit %, stop-loss %, maximum holding period, trade size, bankroll, fee rate, and slippage.
- **Performance Analytics**: Win rate %, net return %, profit factor, maximum drawdown %, and trade-by-trade audit logs with mark-to-market dataset exit handling.

### 7. Dual-Mode Trading Terminal
- **Simulation Mode (Default)**:
  - Configurable virtual bankroll ($10 to $10,000, or custom).
  - Session-based paper trading support with atomic buy and sell execution.
  - Models realistic 50 bps slippage and 0.1% transaction fee.
  - Real-time P&L analytics: cash balance, total equity, open positions, realized P&L, and win-rate percentage.
- **Non-Custodial Live Mode (Restored Direct In-Dashboard Trading)**:
  - Phantom wallet integration: 1-click connection via `window.phantom.solana`, address display, and live SOL balance.
  - **Full In-Dashboard Swap Lifecycle**:
    1. Jupiter v6 quote retrieval (`/api/swap/quote`).
    2. VersionedTransaction serialization (`/api/swap/transaction`).
    3. User approval and signing via Phantom browser wallet.
    4. On-chain transaction broadcast and confirmation tracking.
    5. Swap reconciliation recorded in D1 (`live_transactions`).
  - 1-click external swap fallbacks: Jupiter Swap, Raydium, DEX Screener, Photon, and BullX.

### 8. Mobile-First Responsive Terminal UI (15 Navigation Views)
- **Overview**: Terminal summary, market counts, active signals, top tokens.
- **Launches**: Fresh launchpad streams with filterable launchpads (Pump.fun, Raydium, Meteora).
- **Trending**: Tokens sorted by 1h volume, price momentum, and market cap.
- **Wallets**: Wallet & Creator Intelligence Investigator (cross-token history and reputation).
- **Narratives**: Emerging meme themes, novelty, persistence, and cross-platform spread.
- **Risk**: Contract audit scorecard, honeypot detection, LP burns, and whale concentration.
- **Breakouts**: Real-time breakout scanner and active signal feed.
- **Paper**: Simulated trading terminal, order placement, and position manager.
- **Live Swaps**: Non-custodial Phantom + Jupiter direct trading interface.
- **Portfolio**: Realized PnL, equity curve, and closed trade audit logs.
- **Alerts**: Real-time security and momentum alerts center.
- **Backtesting**: Strategy builder, historical simulation runner, and performance history.
- **Providers**: Live health and latency matrix across all 8 integrated services.
- **Settings**: RPC endpoint configuration, slippage tolerance, and terminal preferences.

---

## Monorepo Architecture

- `apps/web`: Next.js 15 / React 19 mobile-first trading terminal with `@solana/web3.js` integration.
- `apps/worker`: Cloudflare Worker API, scheduled scanner cron (`*/5 * * * *`), and Durable Objects.
- `packages/shared`: Domain types, narrative scoring, momentum calculation, evidence-based risk assessment, breakout detection, backtesting runner, and entity extraction.
- `migrations`: Cloudflare D1 SQL schema:
  - `0001_initial.sql`: Core tokens, snapshots, narratives, alerts, paper tables.
  - `0002_atomic_paper_trades.sql`: Atomic positions and portfolios.
  - `0003_enhanced_radar.sql`: Launchpads, LP burns, holders, provider health.
  - `0004_wallet_intelligence_and_backtesting.sql`: Creators, wallets, relationships, breakout signals, backtest runs, backtest trades, live transactions.

---

## Local Development & Testing

Requires Node.js 20+ and npm.

```bash
# 1. Install dependencies across monorepo
npm install

# 2. Run automated test suites (18 tests passing across shared and worker)
npm test

# 3. Typecheck all workspaces (shared, web, worker)
npm run typecheck

# 4. Production build (Next.js 15 + Worker bundle)
npm run build

# 5. Apply local D1 database migrations
cd apps/worker && npx wrangler d1 migrations apply solana-degen-radar --local

# 6. Start local Worker API (port 8787)
npm run dev:worker

# 7. In a separate terminal, start Next.js Dashboard (port 3000)
npm run dev
```

---

## API Endpoints Reference

### Discovery & Intelligence
- `GET /health` — Health check
- `GET /api/status` — Comprehensive system overview
- `GET /api/tokens` — Discovered tokens list with filters (`q`, `launchpad`, `minLiquidity`, `maxRisk`)
- `GET /api/tokens/:mint` — Detailed token inspection (snapshots, security scorecard, matched narratives)
- `GET /api/tokens/:mint/holders` — Top beneficial holders snapshot
- `GET /api/tokens/:mint/clusters` — Wallet relationship clusters for a token
- `GET /api/creators/:address` — Creator profile, past launches, and reputation score
- `GET /api/wallets/:address` — Cross-token wallet involvement history and relationships
- `GET /api/narratives` — Trending meme narratives and scores
- `GET /api/alerts` — Real-time alerts feed
- `GET /api/social/feed` — Multi-platform social observation stream
- `POST /api/scan` — Trigger live market discovery scan
- `POST /api/social/scan` — Trigger social intelligence scan

### Breakouts & Backtesting
- `GET /api/breakouts` — Active breakout signals
- `POST /api/breakouts/scan` — Scan tokens for breakout patterns
- `POST /api/backtest/run` — Execute deterministic backtest strategy simulation
- `GET /api/backtest/runs` — History of backtest runs and performance summaries

### Paper Trading & Simulation
- `GET /api/portfolio` — Paper-trading portfolio and performance statistics
- `POST /api/portfolio/reset` — Reset virtual bankroll
- `POST /api/paper/buy` — Execute simulated buy
- `POST /api/paper/sell` — Execute simulated sell

### Live Swaps (Phantom + Jupiter v6)
- `GET /api/swap/quote` — Jupiter v6 aggregator swap quote
- `POST /api/swap/transaction` — Build serialized VersionedTransaction for Phantom signing
- `POST /api/swap/track` — Record live swap execution in database
- `GET /api/swap/history` — Query live swap transaction history
- `GET /api/swap/confirm/:signature` — On-chain RPC transaction confirmation status

### Infrastructure
- `GET /api/providers` — Real-time provider health matrix (DEX Screener, Solana RPC, PumpPortal, Reddit, RSS, Telegram, X, TikTok)
