import {
  alertFingerprint,
  assessTokenRisk,
  clamp,
  detectAttentionSpike,
  extractSocialEntities,
  scoreMomentum,
  scoreNarrative,
  type AlertSeverity,
  type ProviderHealth,
} from "@radar/shared";
import { RedditAdapter } from "./adapters/reddit";
import { RssNewsAdapter } from "./adapters/rss";
import { TelegramAdapter } from "./adapters/telegram";
import { TikTokAdapter } from "./adapters/tiktok";
import { XAdapter } from "./adapters/x";
import { DexScreenerClient } from "./discovery/dexscreener";
import { PumpFunDiscovery } from "./discovery/pumpfun";
import { SolanaRpcClient } from "./discovery/solana-rpc";
import { PaperTradingEngine } from "./paper-trading";
import { WalletIntelligenceEngine } from "./intelligence/wallet-intel";
import { BreakoutEngine } from "./intelligence/breakout";
import { BacktestService } from "./intelligence/backtest-service";
import { LiveSwapService } from "./trading/live-swap-service";
import type { Env, Pair, SocialAdapter } from "./types";

export { PumpPortalStream } from "./pumpportal";

class ApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function parseJson<T = any>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Registered social adapters
function getSocialAdapters(): SocialAdapter[] {
  return [new RedditAdapter(), new RssNewsAdapter(), new TelegramAdapter(), new XAdapter(), new TikTokAdapter()];
}

async function createAlert(
  db: D1Database,
  env: Env | undefined,
  kind: string,
  subject: string,
  severity: AlertSeverity,
  payload: Record<string, unknown>
) {
  const fingerprint = alertFingerprint(kind, subject, new Date().toISOString().slice(0, 13));
  const res = await db
    .prepare(
      "INSERT OR IGNORE INTO alerts (id,fingerprint,kind,subject_id,severity,payload_json,created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(id(), fingerprint, kind, subject, severity, JSON.stringify(payload), now())
    .run();

  if (res.meta.changes && env && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const title = String(payload.symbol || payload.title || payload.name || subject);
    const detail =
      payload.narrativeScore != null
        ? `Narrative Score: ${payload.narrativeScore}`
        : `Momentum: ${payload.momentumScore ?? "—"} · Risk: ${payload.riskScore ?? "unknown"}`;
    const text = `🚨 DEGEN RADAR · ${severity.toUpperCase()}\n${title}\n${detail}\n${payload.url || payload.pairUrl || subject}\nMode: Simulation/Radar`;

    try {
      const sent = await TelegramAdapter.sendAlert(env, text);
      if (sent) {
        await db.prepare("UPDATE alerts SET delivered_at=? WHERE fingerprint=?").bind(now(), fingerprint).run();
      }
    } catch {
      // Retain alert locally even if Telegram fails
    }
  }
}

async function dispatchPendingAlerts(env: Env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { attempted: 0, delivered: 0 };
  const pending = await env.DB.prepare(
    "SELECT id,kind,subject_id,severity,payload_json FROM alerts WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT 20"
  ).all<any>();

  let delivered = 0;
  for (const alert of pending.results || []) {
    let payload: any = {};
    try {
      payload = JSON.parse(alert.payload_json || "{}");
    } catch {
      payload = {};
    }
    const label = payload.symbol || payload.name || payload.title || alert.subject_id;
    const detail =
      payload.narrativeScore != null
        ? `Narrative: ${payload.narrativeScore}`
        : `Momentum: ${payload.momentumScore ?? "—"} · Risk: ${payload.riskScore ?? "—"}`;
    const msg = `🚨 DEGEN RADAR · ${String(alert.severity).toUpperCase()}\n${label}\n${detail}\nMode: Radar`;

    try {
      const ok = await TelegramAdapter.sendAlert(env, msg);
      if (ok) {
        await env.DB.prepare("UPDATE alerts SET delivered_at=? WHERE id=?").bind(now(), alert.id).run();
        delivered++;
      }
    } catch {
      break;
    }
  }
  return { attempted: pending.results?.length ?? 0, delivered };
}

// Market scan implementation
async function runMarketScan(env: Env) {
  const started = now();
  let saved = 0;
  const errors: string[] = [];

  try {
    const dexClient = new DexScreenerClient(env);
    const rpcClient = new SolanaRpcClient(env);

    const [profileMints, boostMints, launchMints] = await Promise.all([
      dexClient.getLatestProfiles().catch(e => {
        errors.push(`Profiles error: ${e}`);
        return [];
      }),
      dexClient.getBoostedTokens().catch(e => {
        errors.push(`Boosts error: ${e}`);
        return [];
      }),
      PumpFunDiscovery.getRecentPumpPortalLaunches(env.DB, 20).catch(() => []),
    ]);

    const candidates = Array.from(new Set([...profileMints.slice(0, 15), ...boostMints.slice(0, 15), ...launchMints.slice(0, 10)])).slice(0, 30);

    if (candidates.length > 0) {
      const pairs = await dexClient.getPairsForMints(candidates);
      const bestPairs = new Map<string, Pair>();

      for (const pair of pairs) {
        const mint = pair.baseToken?.address;
        if (!mint) continue;
        const existing = bestPairs.get(mint);
        if (!existing || (num(pair.liquidity?.usd) ?? 0) > (num(existing.liquidity?.usd) ?? 0)) {
          bestPairs.set(mint, pair);
        }
      }

      const sortedPairs = Array.from(bestPairs.values()).sort(
        (a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0)
      );

      for (const [idx, pair] of sortedPairs.entries()) {
        const mint = pair.baseToken?.address;
        if (!mint) continue;

        const token = pair.baseToken!;
        const observed = now();
        const launchpad = PumpFunDiscovery.identifyLaunchpad(pair);

        // Fetch on-chain security metrics for top candidates
        let mintSecurity: { mintAuthority: boolean | null; freezeAuthority: boolean | null; initialized: boolean | null; tokenProgram?: string; transferFeePercent?: number | null; hasTransferHook?: boolean } | null = null;
        let holderInfo: { top10HolderPercent: number | null; holderCount: number | null; accounts?: Array<{ address: string; amount: string; uiAmount: number }>; totalSupply?: number } = { top10HolderPercent: null, holderCount: null };
        let lpBurnedPercent: number | null = null;
        let sellability: { isSellable: boolean; status: "verified_sellable" | "honeypot" | "unverified" } = { isSellable: false, status: "unverified" };

        // Creator and holder intelligence recording
        let creatorAddress: string | undefined = undefined;
        let creatorProfile: any = null;

        if (idx < 10) {
          try {
            const [sec, holders, sellCheck] = await Promise.all([
              rpcClient.getMintSecurity(mint),
              rpcClient.getHolderConcentration(mint),
              rpcClient.testSellability(mint),
            ]);
            mintSecurity = sec;
            holderInfo = holders;
            sellability = sellCheck;

            if (pair.pairAddress) {
              lpBurnedPercent = await rpcClient.verifyLpBurn(pair.pairAddress);
            }

            // Resolve actual wallet owners for token accounts
            if (holders.accounts && holders.accounts.length > 0 && holders.totalSupply) {
              const accountAddrs = holders.accounts.map(a => a.address);
              const ownerMap = await rpcClient.resolveTokenAccountOwners(accountAddrs);

              const resolvedHolders = holders.accounts.map(a => ({
                address: ownerMap.get(a.address) || a.address,
                amount: a.amount,
                uiAmount: a.uiAmount,
              }));

              // Extract actual creator if token has deployer info in pair or first holder
              creatorAddress = resolvedHolders[0]?.address;

              if (creatorAddress) {
                creatorProfile = await WalletIntelligenceEngine.recordCreatorLaunch(
                  env.DB,
                  creatorAddress,
                  mint,
                  num(pair.liquidity?.usd) || 0,
                  num(pair.marketCap) || 0
                );
              }

              await WalletIntelligenceEngine.recordHolderSnapshot(
                env.DB,
                mint,
                resolvedHolders,
                holders.totalSupply,
                creatorAddress
              );

              // Ingest parsed on-chain transfer history for top holders to populate wallet_activities
              for (const holder of resolvedHolders.slice(0, 3)) {
                try {
                  const sigs = await rpcClient.getRecentSignaturesForAddress(holder.address, 2);
                  for (const s of sigs) {
                    const parsedTx = await rpcClient.getParsedTransaction(s.signature);
                    const fundingTransfer = parsedTx?.transfers.find(t => t.to === holder.address);
                    await env.DB.prepare(
                      `INSERT OR IGNORE INTO wallet_activities (id, wallet_address, mint, activity_type, signature, observed_at)
                       VALUES (?, ?, ?, ?, ?, ?)`
                    ).bind(
                      id(),
                      holder.address,
                      mint,
                      fundingTransfer ? `funded_by:${fundingTransfer.from}` : 'transfer',
                      s.signature,
                      s.blockTime ? new Date(s.blockTime * 1000).toISOString() : observed
                    ).run();
                  }
                } catch {
                  // RPC error handling
                }
              }
            }
          } catch {
            // gracefully fallback
          }
        }

        const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 3600000 : null;
        const risk = assessTokenRisk(
          mint,
          {
            liquidityUsd: num(pair.liquidity?.usd),
            fdvUsd: num(pair.fdv ?? pair.marketCap),
            pairAgeHours: ageHours,
            volume1hUsd: num(pair.volume?.h1),
            buys1h: num(pair.txns?.h1?.buys),
            sells1h: num(pair.txns?.h1?.sells),
            mintAuthority: mintSecurity?.mintAuthority,
            freezeAuthority: mintSecurity?.freezeAuthority,
            initialized: mintSecurity?.initialized,
            tokenProgram: mintSecurity?.tokenProgram,
            transferFeePercent: mintSecurity?.transferFeePercent,
            hasTransferHook: mintSecurity?.hasTransferHook,
            lpBurnedPercent,
            top10HolderPercent: holderInfo.top10HolderPercent,
            isSellable: sellability.isSellable,
            sellabilityStatus: sellability.status,
            creatorAddress,
            creatorRugRatePct: creatorProfile ? (creatorProfile.rugCount / Math.max(1, creatorProfile.totalTokensCreated)) * 100 : null,
          },
          observed
        );

        const momentum = scoreMomentum({
          priceChange1h: num(pair.priceChange?.h1),
          volume1h: num(pair.volume?.h1),
          liquidity: num(pair.liquidity?.usd),
          buys1h: num(pair.txns?.h1?.buys),
          sells1h: num(pair.txns?.h1?.sells),
        });

        // Insert or update token record
        await env.DB.prepare(
          `INSERT INTO tokens (mint, name, symbol, first_seen_at, source, launchpad, holder_count, top10_holder_percent, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(mint) DO UPDATE SET
             name = COALESCE(excluded.name, tokens.name),
             symbol = COALESCE(excluded.symbol, tokens.symbol),
             launchpad = COALESCE(excluded.launchpad, tokens.launchpad),
             holder_count = COALESCE(excluded.holder_count, tokens.holder_count),
             top10_holder_percent = COALESCE(excluded.top10_holder_percent, tokens.top10_holder_percent),
             metadata_json = excluded.metadata_json`
        )
          .bind(
            mint,
            token.name || null,
            token.symbol || null,
            observed,
            "dexscreener",
            launchpad,
            holderInfo.holderCount,
            holderInfo.top10HolderPercent,
            JSON.stringify({ dexId: pair.dexId, url: pair.url, pairAddress: pair.pairAddress })
          )
          .run();

        // Save token price snapshot
        await env.DB.prepare(
          `INSERT OR IGNORE INTO token_snapshots (
             id, mint, pair_address, observed_at, price_usd, liquidity_usd, volume_5m_usd, volume_1h_usd, market_cap_usd, fdv_usd, momentum_score, txns_5m_json, raw_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id(),
            mint,
            pair.pairAddress || "unknown",
            observed,
            num(pair.priceUsd),
            num(pair.liquidity?.usd),
            num(pair.volume?.m5),
            num(pair.volume?.h1),
            num(pair.marketCap),
            num(pair.fdv),
            momentum,
            JSON.stringify(pair.txns?.m5 || {}),
            JSON.stringify(pair)
          )
          .run();

        // Save risk assessment
        await env.DB.prepare(
          `INSERT INTO risk_assessments (id, mint, assessed_at, risk_score, status, flags_json, unknowns_json, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            id(),
            mint,
            observed,
            risk.score,
            risk.status,
            JSON.stringify(risk.flags),
            JSON.stringify(risk.unknowns),
            JSON.stringify(risk.evidence)
          )
          .run();

        saved++;

        // Trigger alert if high momentum or extreme risk
        if (momentum >= 75 && risk.score >= 75) {
          await createAlert(env.DB, env, "high-momentum-high-risk", mint, "warning", {
            mint,
            symbol: token.symbol,
            name: token.name,
            momentumScore: momentum,
            riskScore: risk.score,
            flags: risk.flags,
            pairUrl: pair.url,
          });
        }
      }
    }

    const status = errors.length ? (saved > 0 ? "partial" : "error") : "success";
    await env.DB.prepare(
      "INSERT INTO scanner_runs (job_name, status, started_at, finished_at, details_json) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        "market-discovery-solana",
        status,
        started,
        now(),
        JSON.stringify({ candidateCount: candidates.length, saved, errors })
      )
      .run();

    return { status, candidateCount: candidates.length, saved, errors };
  } catch (err) {
    errors.push(String(err));
    await env.DB.prepare(
      "INSERT INTO scanner_runs (job_name, status, started_at, finished_at, details_json) VALUES (?, ?, ?, ?, ?)"
    )
      .bind("market-discovery-solana", "error", started, now(), JSON.stringify({ errors }))
      .run();
    return { status: "error", saved: 0, errors };
  }
}

// Ingest social observations and calculate narrative clusters
const DYNAMIC_THEMES: Record<string, string[]> = {
  ai_agents: ["ai agent", "ai agents", "autonomous", "agentic", "swarm", "virtual", "terminal", "eliza"],
  dogs: ["dog", "shiba", "wif", "bonk", "puppy", "doge", "woof", "canine"],
  cats: ["cat", "kitten", "popcat", "mew", "feline", "meow", "purr"],
  frogs: ["pepe", "frog", "ribbit", "pond", "toad"],
  surreal_memes: ["chill", "guy", "cult", "based", "retardio", "moodeng", "degen", "meme"],
  defi_utility: ["yield", "staking", "bridge", "amm", "liquidity", "perps", "dex", "depin"],
  political: ["trump", "kamala", "election", "president", "patriot", "fed", "tariff"],
};

async function ingestSocialObservations(
  db: D1Database,
  observations: Array<{
    source: string;
    sourceId: string;
    text: string;
    url?: string;
    observedAt?: string;
    metrics?: Record<string, number>;
  }>,
  env?: Env
) {
  let inserted = 0;
  let matches = 0;

  for (const obs of observations) {
    if (!obs.source || !obs.sourceId || !obs.text) continue;
    const observed = obs.observedAt && !Number.isNaN(Date.parse(obs.observedAt)) ? new Date(obs.observedAt).toISOString() : now();

    const insertRes = await db
      .prepare(
        "INSERT OR IGNORE INTO social_events (id, source, source_id, observed_at, url, text_content, metrics_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        id(),
        obs.source.slice(0, 40),
        obs.sourceId.slice(0, 300),
        observed,
        obs.url || null,
        obs.text.slice(0, 5000),
        JSON.stringify(obs.metrics || {})
      )
      .run();

    if (!insertRes.meta.changes) continue;
    inserted++;

    const lower = obs.text.toLowerCase();
    const { mints, tickers } = extractSocialEntities(obs.text);

    for (const [themeKey, keywords] of Object.entries(DYNAMIC_THEMES)) {
      const hits = keywords.filter(k => lower.includes(k));
      if (!hits.length) continue;

      matches++;
      const title = themeKey.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const narrativeId = `narrative-${themeKey}`;

      await db
        .prepare(
          `INSERT INTO narratives (id, title, normalized_key, keywords_json, narrative_score, status, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, 0, 'watch', ?, ?)
           ON CONFLICT(normalized_key) DO UPDATE SET last_seen_at = excluded.last_seen_at`
        )
        .bind(narrativeId, title, themeKey, JSON.stringify(keywords), observed, observed)
        .run();

      await db
        .prepare(
          "INSERT INTO narrative_signals (id, narrative_id, captured_at, source, mention_count, independent_source_count, engagement_total, score) VALUES (?, ?, ?, ?, 1, 1, ?, 0)"
        )
        .bind(id(), narrativeId, observed, obs.source, num(obs.metrics?.engagement) || 1)
        .run();

      // Associate explicit mint matches
      for (const mint of mints) {
        const known = await db.prepare("SELECT mint FROM tokens WHERE mint = ?").bind(mint).first<any>();
        if (known) {
          await db
            .prepare(
              `INSERT INTO token_narratives (mint, narrative_id, match_score, evidence_json)
               VALUES (?, ?, 100, ?)
               ON CONFLICT(mint, narrative_id) DO UPDATE SET
                 match_score = MAX(match_score, excluded.match_score),
                 evidence_json = excluded.evidence_json`
            )
            .bind(
              mint,
              narrativeId,
              JSON.stringify({ type: "explicit-mint-address", source: obs.source, observedAt: observed })
            )
            .run();
        }
      }
    }
  }

  // Recalculate narrative scores & attention velocity
  const activeNarratives = await db
    .prepare(
      `SELECT n.id, n.title, n.first_seen_at,
         SUM(CASE WHEN julianday(s.captured_at) >= julianday('now','-24 hours') THEN 1 ELSE 0 END) mentions_24h,
         SUM(CASE WHEN julianday(s.captured_at) >= julianday('now','-1 hour') THEN 1 ELSE 0 END) mentions_1h,
         COUNT(DISTINCT CASE WHEN julianday(s.captured_at) >= julianday('now','-24 hours') THEN s.source END) sources_24h,
         COUNT(DISTINCT CASE WHEN julianday(s.captured_at) >= julianday('now','-24 hours') THEN
           CASE WHEN instr(s.source, ':') > 0 THEN substr(s.source, 1, instr(s.source, ':') - 1) ELSE s.source END
         END) platforms_24h,
         COUNT(DISTINCT date(s.captured_at)) active_days,
         COALESCE(SUM(CASE WHEN julianday(s.captured_at) >= julianday('now','-24 hours') THEN s.engagement_total ELSE 0 END), 0) engagement_24h
       FROM narratives n
       LEFT JOIN narrative_signals s ON s.narrative_id = n.id AND julianday(s.captured_at) >= julianday('now','-7 days')
       GROUP BY n.id`
    )
    .all<any>();

  for (const n of activeNarratives.results || []) {
    const mentions24h = Number(n.mentions_24h) || 0;
    const mentions1h = Number(n.mentions_1h) || 0;
    const sources24h = Number(n.sources_24h) || 0;
    const platforms24h = Number(n.platforms_24h) || 0;
    const ageHours = Math.max(0, (Date.now() - Date.parse(n.first_seen_at)) / 3600000);
    const engagement = Math.max(0, Number(n.engagement_24h) || 0);

    const score = scoreNarrative({
      mentionGrowth: Math.min(100, mentions24h * 8),
      sourceCoverage: Math.min(100, sources24h * 25),
      engagementAcceleration: Math.min(100, Math.log10(1 + engagement) * 25),
      novelty: ageHours <= 24 ? 100 : ageHours <= 72 ? 50 : 0,
      crossPlatformSpread: Math.min(100, platforms24h * 35),
      persistence: Math.min(100, ((Number(n.active_days) || 0) / 7) * 100),
    });

    const status = score >= 70 ? "trending" : score >= 35 ? "watch" : "early";
    await db.prepare("UPDATE narratives SET narrative_score = ?, status = ? WHERE id = ?").bind(score, status, n.id).run();

    // Check for sudden attention spikes (surge in 1h mentions vs 24h average)
    const hourlyAverage = mentions24h / 24;
    if (detectAttentionSpike(mentions1h, hourlyAverage, 2.5)) {
      await createAlert(db, env, "attention-spike", n.id, "info", {
        title: n.title,
        narrativeScore: score,
        mentions1h,
        mentions24h,
        sources: sources24h,
      });
    }
  }

  return { inserted, matches };
}

async function runSocialScan(env: Env) {
  const started = now();
  const adapters = getSocialAdapters();
  let totalObservations = 0;
  const errors: string[] = [];

  const allObservations: any[] = [];
  for (const adapter of adapters) {
    try {
      const items = await adapter.fetchObservations(env);
      allObservations.push(...items);
    } catch (err) {
      errors.push(`${adapter.id}: ${String(err)}`);
    }
  }

  totalObservations = allObservations.length;
  const ingestResult = await ingestSocialObservations(env.DB, allObservations, env);

  const status = errors.length ? (ingestResult.inserted > 0 ? "partial" : "error") : "success";
  await env.DB.prepare(
    "INSERT INTO scanner_runs (job_name, status, started_at, finished_at, details_json) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      "social-intelligence-scan",
      status,
      started,
      now(),
      JSON.stringify({ totalObservations, inserted: ingestResult.inserted, matches: ingestResult.matches, errors })
    )
    .run();

  return { status, totalObservations, ...ingestResult, errors };
}

// System overview / Status endpoint
async function getSystemOverview(db: D1Database, env: Env) {
  const [tokensCount, narrativesCount, alertsCount, portfolio, latestTokens, recentRuns, pumpPortal] =
    await Promise.all([
      db.prepare("SELECT COUNT(*) count FROM tokens").first<any>(),
      db.prepare("SELECT COUNT(*) count FROM narratives").first<any>(),
      db.prepare("SELECT COUNT(*) count FROM alerts WHERE created_at >= date('now')").first<any>(),
      PaperTradingEngine.getPortfolio(db, env),
      db
        .prepare(
          `SELECT t.mint, t.name, t.symbol, t.launchpad, t.top10_holder_percent,
             s.price_usd, s.liquidity_usd, s.volume_1h_usd, s.volume_5m_usd, s.market_cap_usd, s.momentum_score, s.observed_at,
             r.risk_score, r.status risk_status, r.flags_json,
             (SELECT GROUP_CONCAT(n.title, ', ') FROM token_narratives tn JOIN narratives n ON n.id = tn.narrative_id WHERE tn.mint = t.mint) matched_narratives
           FROM tokens t
           LEFT JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = t.mint ORDER BY observed_at DESC LIMIT 1)
           LEFT JOIN risk_assessments r ON r.id = (SELECT id FROM risk_assessments y WHERE y.mint = t.mint ORDER BY assessed_at DESC LIMIT 1)
           ORDER BY s.volume_1h_usd DESC LIMIT 20`
        )
        .all<any>(),
      db.prepare("SELECT * FROM scanner_runs ORDER BY id DESC LIMIT 6").all<any>(),
      PumpFunDiscovery.checkPumpPortalHealth(env),
    ]);

  return {
    mode: "simulation",
    supportsLiveTrading: true,
    walletSupported: "Phantom",
    counts: {
      tokens: tokensCount?.count ?? 0,
      narratives: narrativesCount?.count ?? 0,
      alertsToday: alertsCount?.count ?? 0,
      openPositions: portfolio.positions?.filter(p => p.status === "open").length ?? 0,
    },
    portfolio,
    tokens: latestTokens.results || [],
    recentRuns: recentRuns.results || [],
    providers: {
      dexscreener: "healthy",
      solanaRpc: env.HELIUS_API_KEY ? "helius" : "public-rpc",
      pumpPortal: pumpPortal.status,
      reddit: "public-json-active",
      rss: "feeds-configured",
      telegramAlerts: env.TELEGRAM_BOT_TOKEN ? "configured" : "disabled",
      jupiterSwapApi: "available",
    },
  };
}

// Request Routing
async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    const origin = getSafeAllowedOrigin(request, env);
    return new Response(null, {
      status: 204,
      headers: {
        ...(origin ? { "access-control-allow-origin": origin } : {}),
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-radar-secret,x-idempotency-key,x-telegram-bot-api-secret-token",
        "access-control-allow-credentials": "true",
      },
    });
  }

  const isStateChanging = method === "POST" || method === "PUT" || method === "DELETE";

  // Persistent D1 Rate limiting check (fail-closed on mutations if D1 unavailable)
  const isAllowed = await checkD1RateLimit(env.DB, request, isStateChanging);
  if (!isAllowed) {
    return json({ error: "Rate limit exceeded or rate service unavailable" }, 429);
  }

  if (path === "/health") {
    return json({ ok: true, name: "solana-degen-radar-worker", timestamp: now() });
  }

  // Check authentication & authorization for state-changing endpoints
  if (isStateChanging && !path.startsWith("/api/telegram/")) {
    if (!authenticateRequest(request, env)) {
      return json({ error: "Unauthorized: Missing or invalid radar credentials" }, 401);
    }
  }

  // Persistent D1-backed Idempotency check for critical mutation endpoints
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (idempotencyKey && isStateChanging) {
    const cached = await getIdempotencyResponse(env.DB, idempotencyKey);
    if (cached) {
      return new Response(cached.responseBody, {
        status: cached.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-idempotency-replayed": "true",
        },
      });
    }
  }

  try {
    // 1. System status
    if (path === "/api/status" && method === "GET") {
      return json(await getSystemOverview(env.DB, env));
    }

    // 2. Tokens list with rich filtering
    if (path === "/api/tokens" && method === "GET") {
      const q = url.searchParams.get("q")?.toLowerCase();
      const launchpad = url.searchParams.get("launchpad");
      const minLiquidity = num(url.searchParams.get("minLiquidity")) ?? 0;
      const maxRisk = num(url.searchParams.get("maxRisk")) ?? 100;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));

      const rows = await env.DB.prepare(
        `SELECT t.*, s.price_usd, s.liquidity_usd, s.volume_5m_usd, s.volume_1h_usd, s.market_cap_usd, s.fdv_usd, s.momentum_score, s.observed_at,
           r.risk_score, r.status risk_status, r.flags_json, r.unknowns_json, r.evidence_json,
           (SELECT GROUP_CONCAT(n.title, ', ') FROM token_narratives tn JOIN narratives n ON n.id = tn.narrative_id WHERE tn.mint = t.mint) matched_narratives
         FROM tokens t
         LEFT JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = t.mint ORDER BY observed_at DESC LIMIT 1)
         LEFT JOIN risk_assessments r ON r.id = (SELECT id FROM risk_assessments y WHERE y.mint = t.mint ORDER BY assessed_at DESC LIMIT 1)
         WHERE (s.liquidity_usd >= ? OR s.liquidity_usd IS NULL)
           AND (r.risk_score <= ? OR r.risk_score IS NULL)
           AND (? IS NULL OR t.launchpad = ?)
           AND (? IS NULL OR lower(t.name) LIKE '%' || ? || '%' OR lower(t.symbol) LIKE '%' || ? || '%' OR lower(t.mint) LIKE '%' || ? || '%')
         ORDER BY s.volume_1h_usd DESC LIMIT ?`
      )
        .bind(
          minLiquidity,
          maxRisk,
          launchpad || null,
          launchpad || null,
          q || null,
          q || null,
          q || null,
          q || null,
          limit
        )
        .all<any>();

      return json(rows.results || []);
    }

    // 3. Single token deep-dive
    if (path.startsWith("/api/tokens/") && method === "GET") {
      const mint = path.split("/")[3]?.trim();
      if (!mint) throw new ApiError("Mint address required");

      const [token, snapshots, risk, narratives] = await Promise.all([
        env.DB.prepare("SELECT * FROM tokens WHERE mint = ?").bind(mint).first<any>(),
        env.DB.prepare("SELECT * FROM token_snapshots WHERE mint = ? ORDER BY observed_at DESC LIMIT 50").bind(mint).all<any>(),
        env.DB.prepare("SELECT * FROM risk_assessments WHERE mint = ? ORDER BY assessed_at DESC LIMIT 1").bind(mint).first<any>(),
        env.DB.prepare("SELECT n.*, tn.match_score FROM token_narratives tn JOIN narratives n ON n.id = tn.narrative_id WHERE tn.mint = ?").bind(mint).all<any>(),
      ]);

      if (!token) throw new ApiError("Token not found", 404);

      return json({
        token,
        latestSnapshot: snapshots.results?.[0] || null,
        history: (snapshots.results || []).reverse(),
        risk: risk
          ? {
              ...risk,
              flags: JSON.parse(risk.flags_json || "[]"),
              unknowns: JSON.parse(risk.unknowns_json || "[]"),
              evidence: JSON.parse(risk.evidence_json || "{}"),
            }
          : null,
        narratives: narratives.results || [],
      });
    }

    // 4. Narratives
    if (path === "/api/narratives" && method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT n.*,
           (SELECT COUNT(*) FROM narrative_signals s WHERE s.narrative_id = n.id AND julianday(s.captured_at) >= julianday('now','-24 hours')) mentions_24h,
           (SELECT COUNT(DISTINCT s.source) FROM narrative_signals s WHERE s.narrative_id = n.id AND julianday(s.captured_at) >= julianday('now','-24 hours')) sources_24h
         FROM narratives n ORDER BY n.narrative_score DESC, n.last_seen_at DESC LIMIT 100`
      ).all<any>();

      return json(rows.results || []);
    }

    // 5. Alerts
    if (path === "/api/alerts" && method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100").all<any>();
      return json(rows.results || []);
    }

    // 6. Social Feed
    if (path === "/api/social/feed" && method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
      const rows = await env.DB.prepare(
        "SELECT * FROM social_events ORDER BY observed_at DESC LIMIT ?"
      ).bind(limit).all<any>();
      return json(rows.results || []);
    }

    // 7. Portfolio management (Paper-trading with multi-session support)
    if (path === "/api/portfolio" && method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "default";
      return json(await PaperTradingEngine.getPortfolio(env.DB, env, sessionId));
    }

    if (path === "/api/portfolio/reset" && method === "POST") {
      const body: any = await parseJson(request).catch(() => ({}));
      const sessionId = body.sessionId || "default";
      return json(await PaperTradingEngine.resetPortfolio(env.DB, env, num(body.startingBalance) ?? undefined, sessionId));
    }

    if (path === "/api/paper/buy" && method === "POST") {
      const body: any = await parseJson(request);
      const sessionId = body.sessionId || "default";
      const buyResult = await PaperTradingEngine.buy(
        env.DB,
        env,
        String(body.mint || "").trim(),
        Number(body.usd),
        num(body.slippageBps) ?? 50,
        sessionId,
        body.triggerSignal
      );
      if (idempotencyKey) {
        await saveIdempotencyResponse(env.DB, idempotencyKey, path, JSON.stringify(buyResult), 201);
      }
      return json(buyResult, 201);
    }

    if (path === "/api/paper/sell" && method === "POST") {
      const body: any = await parseJson(request);
      const sessionId = body.sessionId || "default";
      const sellResult = await PaperTradingEngine.sell(
        env.DB,
        env,
        String(body.positionId || "").trim(),
        num(body.slippageBps) ?? 50,
        sessionId,
        num(body.portion) ?? 1.0
      );
      if (idempotencyKey) {
        await saveIdempotencyResponse(env.DB, idempotencyKey, path, JSON.stringify(sellResult), 200);
      }
      return json(sellResult);
    }

    // 8. Trigger Scans
    if (path === "/api/scan" && method === "POST") {
      return json(await runMarketScan(env));
    }

    if (path === "/api/social/scan" && method === "POST") {
      return json(await runSocialScan(env));
    }

    // 9. Protected social ingest
    if (path === "/api/social/ingest" && method === "POST") {
      if (!env.SOCIAL_INGEST_SECRET || request.headers.get("x-radar-secret") !== env.SOCIAL_INGEST_SECRET) {
        return json({ error: "Unauthorized" }, 401);
      }
      const body: any = await parseJson(request);
      const events = Array.isArray(body.events) ? body.events : [];
      return json(await ingestSocialObservations(env.DB, events, env), 201);
    }

    // 10. Provider health matrix
    if (path === "/api/providers" && method === "GET") {
      const dexClient = new DexScreenerClient(env);
      const rpcClient = new SolanaRpcClient(env);
      const adapters = getSocialAdapters();

      const [dexHealth, rpcHealth, pumpHealth, ...socialHealth] = await Promise.all([
        dexClient.checkHealth(),
        rpcClient.checkHealth(),
        PumpFunDiscovery.checkPumpPortalHealth(env),
        ...adapters.map(a => a.checkHealth(env)),
      ]);

      const providers: ProviderHealth[] = [dexHealth, rpcHealth, pumpHealth, ...socialHealth];
      return json(providers);
    }

    // 11. Wallet & Creator Intelligence
    if (path.startsWith("/api/creators/") && method === "GET") {
      const address = path.split("/")[3]?.trim();
      if (!address) throw new ApiError("Creator address required");
      const profile = await WalletIntelligenceEngine.getCreatorProfile(env.DB, address);
      if (!profile) throw new ApiError("Creator not found in radar records", 404);
      return json(profile);
    }

    if (path.startsWith("/api/wallets/") && method === "GET") {
      const address = path.split("/")[3]?.trim();
      if (!address) throw new ApiError("Wallet address required");
      return json(await WalletIntelligenceEngine.getWalletCrossTokenHistory(env.DB, address));
    }

    if (path.startsWith("/api/tokens/") && path.endsWith("/holders") && method === "GET") {
      const parts = path.split("/");
      const mint = parts[3]?.trim();
      if (!mint) throw new ApiError("Mint address required");
      const row = await env.DB.prepare(
        "SELECT * FROM holder_snapshots WHERE mint = ? ORDER BY observed_at DESC LIMIT 1"
      ).bind(mint).first<any>();
      return json(row ? { ...row, topHolders: JSON.parse(row.top_holders_json || "[]") } : { top10_percent: 0, topHolders: [] });
    }

    if (path.startsWith("/api/tokens/") && path.endsWith("/clusters") && method === "GET") {
      const parts = path.split("/");
      const mint = parts[3]?.trim();
      if (!mint) throw new ApiError("Mint address required");
      return json(await WalletIntelligenceEngine.detectWalletClusters(env.DB, mint));
    }

    // 12. Breakout Signals
    if (path === "/api/breakouts" && method === "GET") {
      return json(await BreakoutEngine.getActiveSignals(env.DB));
    }

    if (path === "/api/breakouts/scan" && method === "POST") {
      return json(await BreakoutEngine.scanForBreakouts(env.DB));
    }

    // 13. Backtesting Engine
    if (path === "/api/backtest/run" && method === "POST") {
      const body: any = await parseJson(request);
      const config = {
        name: String(body.name || "Custom Strategy"),
        minMomentum: Number(body.minMomentum) || 70,
        maxRiskScore: Number(body.maxRiskScore) || 50,
        takeProfitPct: Number(body.takeProfitPct) || 50,
        stopLossPct: Number(body.stopLossPct) || -20,
        maxHoldingHours: Number(body.maxHoldingHours) || 24,
        tradeSizeUsd: Number(body.tradeSizeUsd) || 100,
        initialCapitalUsd: Number(body.initialCapitalUsd) || 1000,
        slippageBps: Number(body.slippageBps) || 50,
        feeBps: Number(body.feeBps) || 10,
      };
      return json(await BacktestService.executeBacktest(env.DB, config));
    }

    if (path === "/api/backtest/runs" && method === "GET") {
      return json(await BacktestService.getRecentRuns(env.DB));
    }

    // 14. Direct Jupiter Swap Lifecycle (Phantom Live Trading)
    if (path === "/api/swap/quote" && method === "GET") {
      const inputMint = url.searchParams.get("inputMint") || "So11111111111111111111111111111111111111112"; // SOL
      const outputMint = url.searchParams.get("outputMint");
      const amount = url.searchParams.get("amount"); // in lamports
      const slippageBps = Number(url.searchParams.get("slippageBps")) || 50;

      if (!outputMint || !amount) {
        throw new ApiError("outputMint and amount parameters are required");
      }

      return json(await LiveSwapService.getQuote(inputMint, outputMint, amount, slippageBps));
    }

    if (path === "/api/wallet/spl" && method === "GET") {
      const wallet = url.searchParams.get("wallet");
      if (!wallet) throw new ApiError("wallet address required");
      return json(await LiveSwapService.getWalletSplBalances(env, wallet));
    }

    if (path.startsWith("/api/tokens/") && path.endsWith("/decimals") && method === "GET") {
      const mint = path.split("/")[3]?.trim();
      if (!mint) throw new ApiError("mint address required");
      const decimals = await LiveSwapService.getMintDecimals(env, mint);
      return json({ mint, decimals });
    }

    if (path === "/api/swap/transaction" && method === "POST") {
      const body: any = await parseJson(request);
      const { quoteResponse, userPublicKey, prioritizationFeeLamports } = body;
      if (!quoteResponse || !userPublicKey) {
        throw new ApiError("quoteResponse and userPublicKey are required");
      }
      return json(await LiveSwapService.buildSwapTransaction(quoteResponse, userPublicKey, prioritizationFeeLamports));
    }

    if (path === "/api/swap/track" && method === "POST") {
      const body: any = await parseJson(request);
      await LiveSwapService.recordSubmittedTransaction(env.DB, body);
      return json({ ok: true, signature: body.signature });
    }

    if (path.startsWith("/api/swap/status/") && method === "GET") {
      const signature = path.split("/")[4]?.trim();
      if (!signature) throw new ApiError("Transaction signature required");
      return json(await LiveSwapService.checkTransactionStatus(env.DB, env, signature));
    }

    if (path === "/api/swap/history" && method === "GET") {
      const wallet = url.searchParams.get("wallet") || undefined;
      return json(await LiveSwapService.getTransactionHistory(env.DB, wallet));
    }

    // 12. Telegram Webhook & Test
    if (path === "/api/telegram/webhook" && method === "POST") {
      if (
        !env.TELEGRAM_WEBHOOK_SECRET ||
        request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET
      ) {
        return json({ error: "Unauthorized Telegram webhook" }, 401);
      }
      const update: any = await parseJson(request);
      const post = update.channel_post || update.edited_channel_post;
      if (!post) return json({ ok: true, ignored: true });

      const chatId = String(post.chat?.id || "");
      const allowed = (env.TELEGRAM_ALLOWED_CHANNELS || "").split(",").map(x => x.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(chatId)) {
        return json({ ok: true, ignored: true, reason: "channel-not-allowlisted" });
      }

      const text = String(post.text || post.caption || "").trim();
      if (!text) return json({ ok: true, ignored: true });

      const username = post.chat?.username;
      const link = username ? `https://t.me/${username}/${post.message_id}` : undefined;
      const res = await ingestSocialObservations(
        env.DB,
        [
          {
            source: `telegram:${chatId}`,
            sourceId: String(post.message_id),
            text,
            url: link,
            observedAt: post.date ? new Date(post.date * 1000).toISOString() : now(),
          },
        ],
        env
      );

      return json({ ok: true, ...res });
    }

    if (path === "/api/telegram/test" && method === "POST") {
      if (!env.SOCIAL_INGEST_SECRET || request.headers.get("x-radar-secret") !== env.SOCIAL_INGEST_SECRET) {
        return json({ error: "Unauthorized" }, 401);
      }
      const ok = await TelegramAdapter.sendAlert(env, "Solana Degen Radar: Connection test successful! 🚀");
      return json({ ok });
    }

    // 13. PumpPortal DO control
    if (path === "/api/pumpportal/status" && method === "GET") {
      return json(await PumpFunDiscovery.checkPumpPortalHealth(env));
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("Worker API failure:", error);
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 400);
  }
}

// Persistent Cloudflare-compatible rate limiting using D1 system_logs
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 60;

async function checkD1RateLimit(db: D1Database, request: Request, isMutation = false): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();

  try {
    // Opportunistic cleanup of expired logs (older than 10 minutes)
    if (Math.random() < 0.05) {
      const cleanupThreshold = new Date(nowMs - 600 * 1000).toISOString();
      await db.prepare("DELETE FROM system_logs WHERE source LIKE 'ratelimit:%' AND created_at < ?").bind(cleanupThreshold).run().catch(() => {});
      await db.prepare("DELETE FROM idempotency_keys WHERE expires_at < ?").bind(nowMs).run().catch(() => {});
    }

    const row = await db
      .prepare(
        "SELECT COUNT(*) as count FROM system_logs WHERE source = ? AND created_at >= ?"
      )
      .bind(`ratelimit:${ip}`, windowStart)
      .first<any>();

    const count = Number(row?.count) || 0;
    if (count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    // Record request timestamp
    await db
      .prepare(
        "INSERT INTO system_logs (id, level, source, message, created_at) VALUES (?, 'info', ?, 'request', ?)"
      )
      .bind(crypto.randomUUID(), `ratelimit:${ip}`, new Date().toISOString())
      .run();

    return true;
  } catch (err) {
    // Fail closed on mutation routes if rate-limiting table is unavailable
    if (isMutation) {
      return false;
    }
    return true;
  }
}

// Persistent D1-backed Idempotency
async function getIdempotencyResponse(db: D1Database, key: string): Promise<{ responseBody: string; status: number } | null> {
  try {
    const row = await db.prepare("SELECT response_body, response_status, expires_at FROM idempotency_keys WHERE key = ?").bind(key).first<any>();
    if (!row) return null;
    if (Date.now() > Number(row.expires_at)) return null;
    return { responseBody: row.response_body, status: row.response_status };
  } catch {
    return null;
  }
}

async function saveIdempotencyResponse(db: D1Database, key: string, endpoint: string, body: string, status: number) {
  try {
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes cache
    await db.prepare(
      "INSERT OR REPLACE INTO idempotency_keys (key, endpoint, response_status, response_body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(key, endpoint, status, body, new Date().toISOString(), expiresAt).run();
  } catch {
    // DB error fallback
  }
}

function getSafeAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const allowedOrigins = [
    env.DASHBOARD_ORIGIN,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
  ].filter(Boolean) as string[];

  if (allowedOrigins.includes(origin)) {
    return origin;
  }
  return null;
}

function authenticateRequest(request: Request, env: Env): boolean {
  // Strict credentials validation: Origin headers are strictly for CORS, NOT authentication
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const radarSecret = request.headers.get("x-radar-secret");

  const expectedSecret = env.SOCIAL_INGEST_SECRET || (env as any).ADMIN_SECRET;

  if (expectedSecret) {
    if (radarSecret && radarSecret === expectedSecret) return true;
    if (token && token === expectedSecret) return true;
    return false;
  }

  // If no secret configured in environment, require explicit local development header
  return radarSecret === "radar-local-dev-secret" || token === "radar-local-dev-secret";
}

function applyCors(response: Response, request: Request, env: Env): Response {
  const allowedOrigin = getSafeAllowedOrigin(request, env);
  const headers = new Headers(response.headers);
  if (allowedOrigin) {
    headers.set("access-control-allow-origin", allowedOrigin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
    headers.set("access-control-allow-headers", "content-type,x-radar-secret,x-idempotency-key,x-telegram-bot-api-secret-token");
    headers.append("vary", "Origin");
  } else {
    headers.delete("access-control-allow-origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return applyCors(await routeRequest(request, env), request, env);
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      Promise.all([
        runMarketScan(env),
        runSocialScan(env),
        dispatchPendingAlerts(env),
      ])
    );
  },
};
