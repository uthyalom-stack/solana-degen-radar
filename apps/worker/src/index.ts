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
import { recordDiscoveryEvidence, runMultiSourceDiscovery } from "./discovery/multi-source";
import { PaperTradingEngine } from "./paper-trading";
import { WalletIntelligenceEngine } from "./intelligence/wallet-intel";
import { BreakoutEngine } from "./intelligence/breakout";
import { BacktestService } from "./intelligence/backtest-service";
import { PerformanceService } from "./intelligence/performance-service";
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

    // Discover mint initialization directly from Tokenkeg and Token-2022 program history.
    const rawRpcMints = await rpcClient.discoverRecentMintInitializations(6).catch(() => []);
    for (const item of rawRpcMints) {
      const observedAt = item.blockTime ? new Date(item.blockTime * 1000).toISOString() : now();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO tokens (mint,name,symbol,decimals,first_seen_at,source,metadata_json)
         VALUES (?,NULL,NULL,?,?,?,?)`
      ).bind(item.mint,item.decimals,observedAt,"solana_rpc",JSON.stringify({
        signature:item.signature,slot:item.slot,tokenProgram:item.tokenProgram,mintAuthority:item.mintAuthority,
        discoveryMethod:"raw_rpc_mint_initialization"
      })).run();
      await recordDiscoveryEvidence(env.DB,item.mint,"raw_rpc",item.signature,"mint_initialization","confirmed",{
        signature:item.signature,slot:item.slot,tokenProgram:item.tokenProgram,decimals:item.decimals,mintAuthority:item.mintAuthority
      },observedAt);
    }

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

    const candidates = Array.from(new Set([
      ...rawRpcMints.map(item => item.mint),
      ...profileMints.slice(0, 15),
      ...boostMints.slice(0, 15),
      ...launchMints.slice(0, 10),
    ])).slice(0, 40);

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

              // Evidence-based creator attribution: Inspect pair metadata, deployer info, or creation history.
              // Never treat the first resolved holder as the creator. If creator cannot be proven, mark as unknown (undefined).
              const pairAny = pair as any;
              const provableCreator =
                pairAny.creatorAddress ||
                pairAny.deployer ||
                pairAny.baseToken?.creator;

              if (provableCreator && typeof provableCreator === "string" && provableCreator.length >= 32) {
                creatorAddress = provableCreator;
                creatorProfile = await WalletIntelligenceEngine.recordCreatorLaunch(
                  env.DB,
                  creatorAddress,
                  mint,
                  num(pair.liquidity?.usd) || 0,
                  num(pair.marketCap) || 0
                );
              } else {
                creatorAddress = undefined;
              }

              await WalletIntelligenceEngine.recordHolderSnapshot(
                env.DB,
                mint,
                resolvedHolders,
                holders.totalSupply,
                creatorAddress
              );

              // Compare this mint's largest holders with prior token holder snapshots.
              // Co-holding remains an inference; the engine retains the supporting evidence.
              await WalletIntelligenceEngine.detectWalletClusters(env.DB, mint);

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
            JSON.stringify({ dexId: pair.dexId, url: pair.url, pairAddress: pair.pairAddress, info: pair.info || null, baseToken: token, quoteToken: pair.quoteToken || null })
          )
          .run();

        // Detect Pump.fun graduation once the same mint appears in a downstream DEX pool.
        const dexLabel = String(pair.dexId || "").toLowerCase();
        const downstreamDex = dexLabel.includes("raydium") ? "raydium" : dexLabel.includes("meteora") ? "meteora" : null;
        if (downstreamDex) {
          const pumpLaunch = await env.DB.prepare(
            "SELECT 1 AS found FROM pumpportal_events WHERE mint=? AND lower(event_type) LIKE '%create%' LIMIT 1"
          ).bind(mint).first<any>();
          if (pumpLaunch) {
            await env.DB.prepare("UPDATE tokens SET is_migrated=1,migration_target=? WHERE mint=?")
              .bind(downstreamDex,mint).run();
            await env.DB.prepare(
              `INSERT OR IGNORE INTO launchpad_observations (id,mint,launchpad,event_type,observed_at,migration_target,signature,evidence_json)
               VALUES (?,?,?,?,?,?,?,?)`
            ).bind(id(),mint,"pumpfun","graduated_migration",observed,downstreamDex,pair.pairAddress || null,
              JSON.stringify({downstreamDex,pairAddress:pair.pairAddress,dexId:pair.dexId,source:"DEX Screener pool plus PumpPortal create event"})).run();
            await recordDiscoveryEvidence(env.DB,mint,"launchpad_migration",pair.pairAddress || downstreamDex,
              "pumpfun_graduation","strong",{from:"pumpfun",to:downstreamDex,pairAddress:pair.pairAddress,dexId:pair.dexId},observed);
          }
        }

        // Preserve independent discovery evidence for DEX profile/boost and newly observed pool liquidity.
        if ((profileMints as string[]).includes(mint)) {
          await recordDiscoveryEvidence(env.DB,mint,"dexscreener","latest_token_profile","token_profile","confirmed",{source:"DEX Screener latest token profile"},observed);
        }
        if ((boostMints as string[]).includes(mint)) {
          await recordDiscoveryEvidence(env.DB,mint,"dexscreener","token_boost","token_boost","confirmed",{source:"DEX Screener token boosts"},observed);
        }
        await recordDiscoveryEvidence(env.DB,mint,"liquidity_pool",pair.pairAddress || pair.dexId || "unknown-pool",
          "pool_market_pair","strong",{dexId:pair.dexId,pairAddress:pair.pairAddress,liquidityUsd:num(pair.liquidity?.usd),volume5mUsd:num(pair.volume?.m5),volume1hUsd:num(pair.volume?.h1),buys5m:num(pair.txns?.m5?.buys),sells5m:num(pair.txns?.m5?.sells)},observed);

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

  // Route-specific credential separation:
  if (path === "/api/social/ingest") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!authenticateSocialIngestRequest(request, env)) {
      return json({ error: "Unauthorized: Invalid social ingest credentials" }, 401);
    }
  } else if (path === "/api/telegram/webhook") {
    if (method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (
      !env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return json({ error: "Unauthorized Telegram webhook" }, 401);
    }
  } else if (path === "/api/scan" || path === "/api/social/scan" || path === "/api/breakouts/scan") {
    if (!authenticateInternalRequest(request, env) && !authenticateAdminRequest(request, env)) {
      return json({ error: "Unauthorized: Internal or admin authorization required for scanner triggers" }, 401);
    }
  } else if (path === "/api/telegram/test") {
    if (!authenticateAdminRequest(request, env)) {
      return json({ error: "Unauthorized: Admin authorization required" }, 401);
    }
  } else if (isStateChanging) {
    if (!authenticateAdminRequest(request, env)) {
      return json({ error: "Unauthorized: Missing or invalid radar credentials" }, 401);
    }
  }

  // Concurrency-safe D1 Idempotency Reservation for critical mutations
  const idempotencyKey = request.headers.get("x-idempotency-key");
  let idempotencyPayloadHash = "";
  if (idempotencyKey && isStateChanging) {
    const cloned = request.clone();
    const rawBody = await cloned.text().catch(() => "");
    idempotencyPayloadHash = await computePayloadHash(rawBody);

    const callerIdentity = extractBearerOrSecret(request) || request.headers.get("cf-connecting-ip") || "anonymous";
    const reservation = await reserveIdempotencyKey(
      env.DB,
      idempotencyKey,
      callerIdentity,
      path,
      idempotencyPayloadHash
    );

    if (reservation.state === "completed") {
      return new Response(reservation.responseBody, {
        status: reservation.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-idempotency-replayed": "true",
        },
      });
    }

    if (reservation.state === "conflict") {
      return json({ error: reservation.message }, 409);
    }

    if (reservation.state === "in_progress") {
      return json({ error: "Concurrent request in progress for this idempotency key" }, 409);
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

    // Emerging social terms surfaced before a matching token is known.
    if (path === "/api/discovery/narratives" && method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT normalized_term,display_term,term_type,first_seen_at,last_seen_at,mention_count,independent_source_count,engagement_total,evidence_json FROM emerging_narratives ORDER BY independent_source_count DESC,mention_count DESC,last_seen_at DESC LIMIT 100"
      ).all<any>();
      return json(rows.results || []);
    }

    // Multi-source discovery registry and transparent source health.
    if (path === "/api/discovery/candidates" && method === "GET") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
      const rows = await env.DB.prepare(
        `SELECT dc.mint,dc.first_discovered_at,dc.last_discovered_at,dc.discovery_score,dc.source_count,
          dc.source_summary_json,t.name,t.symbol,t.launchpad,t.creator_address,
          (SELECT price_usd FROM token_snapshots ts WHERE ts.mint=dc.mint ORDER BY observed_at DESC LIMIT 1) AS price_usd,
          (SELECT liquidity_usd FROM token_snapshots ts WHERE ts.mint=dc.mint ORDER BY observed_at DESC LIMIT 1) AS liquidity_usd,
          (SELECT risk_score FROM risk_assessments ra WHERE ra.mint=dc.mint ORDER BY assessed_at DESC LIMIT 1) AS risk_score
         FROM discovery_candidates dc JOIN tokens t ON t.mint=dc.mint
         ORDER BY dc.discovery_score DESC,dc.last_discovered_at DESC LIMIT ?`
      ).bind(limit).all<any>();
      return json(rows.results || []);
    }

    if (path === "/api/discovery/sources" && method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT source_type,status,last_attempt_at,last_success_at,items_seen,error_message,details_json FROM discovery_source_status ORDER BY source_type"
      ).all<any>();
      return json(rows.results || []);
    }

    if (path === "/api/discovery/evidence" && method === "GET") {
      const mint = String(url.searchParams.get("mint") || "").trim();
      if (!mint) throw new ApiError("mint query parameter is required", 400);
      const rows = await env.DB.prepare(
        "SELECT source_type,source_id,evidence_type,confidence,observed_at,evidence_json FROM discovery_evidence WHERE mint=? ORDER BY observed_at DESC LIMIT 200"
      ).bind(mint).all<any>();
      return json(rows.results || []);
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
      try {
        const riskCheck = await PerformanceService.checkPaperBuyRisk(env.DB, String(sessionId), Number(body.usd));
        if (!riskCheck.allowed) throw new ApiError((riskCheck.violations || []).join("; "), 429);
        const buyResult = await PaperTradingEngine.buy(
          env.DB,
          env,
          String(body.mint || "").trim(),
          Number(body.usd),
          num(body.slippageBps) ?? 50,
          sessionId,
          body.triggerSignal
        );
        await PerformanceService.recordActivity(env.DB, String(sessionId), "paper_trade", buyResult.positionId);
        if (idempotencyKey) {
          await completeIdempotencyReservation(env.DB, idempotencyKey, JSON.stringify(buyResult), 201);
        }
        return json(buyResult, 201);
      } catch (err) {
        if (idempotencyKey) {
          await markIdempotencyFailed(env.DB, idempotencyKey);
        }
        throw err;
      }
    }

    if (path === "/api/paper/sell" && method === "POST") {
      const body: any = await parseJson(request);
      const sessionId = body.sessionId || "default";
      try {
        const sellResult = await PaperTradingEngine.sell(
          env.DB,
          env,
          String(body.positionId || "").trim(),
          num(body.slippageBps) ?? 50,
          sessionId,
          num(body.portion) ?? 1.0
        );
        await PerformanceService.recordActivity(env.DB, String(sessionId), "paper_trade", String(body.positionId));
        if (idempotencyKey) {
          await completeIdempotencyReservation(env.DB, idempotencyKey, JSON.stringify(sellResult), 200);
        }
        return json(sellResult);
      } catch (err) {
        if (idempotencyKey) {
          await markIdempotencyFailed(env.DB, idempotencyKey);
        }
        throw err;
      }
    }

    // 8. Trigger Scans
    if (path === "/api/scan" && method === "POST") {
      const market = await runMarketScan(env);
      const advanced = await runMultiSourceDiscovery(env).catch(error => ({ error: String(error) }));
      await PerformanceService.recordActivity(env.DB, "default", "market_scan");
      return json({ ...market, advancedDiscovery: advanced });
    }

    if (path === "/api/social/scan" && method === "POST") {
      return json(await runSocialScan(env));
    }

    // 9. Protected social ingest
    if (path === "/api/social/ingest" && method === "POST") {
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

    // 13A. Performance, journaling, streaks, replay, strategy library and risk controls.
    if (path === "/api/performance" && method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "default";
      return json(await PerformanceService.getPerformance(env.DB, sessionId));
    }
    if (path === "/api/activity/record" && method === "POST") {
      const body:any = await parseJson(request);
      return json(await PerformanceService.recordActivity(env.DB, String(body.sessionId || "default"), String(body.activityType || "review"), body.referenceId));
    }
    if (path === "/api/journal" && method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "default";
      return json(await PerformanceService.listJournal(env.DB, sessionId));
    }
    if (path === "/api/journal" && method === "POST") {
      const body:any = await parseJson(request);
      return json(await PerformanceService.saveJournal(env.DB, String(body.sessionId || "default"), body), 201);
    }
    if (path === "/api/risk-controls" && method === "GET") {
      const sessionId = url.searchParams.get("sessionId") || "default";
      return json(await PerformanceService.getRiskSettings(env.DB, sessionId));
    }
    if (path === "/api/risk-controls" && method === "POST") {
      const body:any = await parseJson(request);
      return json(await PerformanceService.saveRiskSettings(env.DB, String(body.sessionId || "default"), body));
    }
    if (path === "/api/wallet-leaderboard" && method === "GET") {
      return json(await PerformanceService.getWalletLeaderboard(env.DB, Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50))));
    }
    if (path === "/api/signals/replay" && method === "GET") {
      const mint = url.searchParams.get("mint") || undefined;
      return json(await PerformanceService.replaySignals(env.DB, mint, Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200))));
    }
    if (path === "/api/execution/simulate" && method === "POST") {
      const body:any = await parseJson(request);
      return json(PerformanceService.simulateExecution({
        side: body.side === "sell" ? "sell" : "buy",
        amountUsd: Number(body.amountUsd),
        priceUsd: Number(body.priceUsd),
        liquidityUsd: Number(body.liquidityUsd),
        slippageBps: Math.max(0, Math.min(5000, Number(body.slippageBps) || 50)),
        feeBps: Math.max(0, Math.min(500, Number(body.feeBps) || 10)),
      }));
    }
    if (path === "/api/strategies" && method === "GET") {
      return json(await PerformanceService.listStrategies(env.DB, url.searchParams.get("sessionId") || "default"));
    }
    if (path === "/api/strategies" && method === "POST") {
      const body:any = await parseJson(request);
      return json(await PerformanceService.saveStrategy(env.DB, String(body.sessionId || "default"), body), 201);
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

    // 15. Authentic PnL Generator & Public Verification Cards
    if (path === "/api/pnl/generate" && method === "POST") {
      const body: any = await parseJson(request);
      const cardType = body.cardType === "portfolio" ? "portfolio" : "trade";
      const tradeType = body.tradeType === "LIVE" ? "LIVE" : "PAPER";
      const cardId = `pnl-${id().slice(0, 8)}`;
      const createdAt = now();

      if (cardType === "trade") {
        let buyPrice = Number(body.buyPriceUsd) || 0;
        let sellPrice = Number(body.sellPriceUsd) || 0;
        let invested = Number(body.investedUsd) || 0;
        let quantity = Number(body.quantity) || 0;
        let realizedPnl = Number(body.realizedPnlUsd) || 0;
        let unrealizedPnl = Number(body.unrealizedPnlUsd) || 0;
        let roiPct = Number(body.roiPct) || 0;
        let symbol = String(body.symbol || "").toUpperCase();
        let name = String(body.name || symbol);
        let mint = String(body.mint || "");
        let txSignature = body.txSignature ? String(body.txSignature) : null;

        // Verify authenticity against D1 records - never trust client metrics
        if (tradeType === "PAPER") {
          if (!body.positionId) {
            throw new ApiError("Valid positionId required to generate authentic paper PnL card", 400);
          }
          const pos = await env.DB.prepare("SELECT * FROM paper_positions WHERE id = ?").bind(body.positionId).first<any>();
          if (!pos) {
            throw new ApiError("Paper position record not found in database", 404);
          }
          mint = pos.mint;
          quantity = pos.quantity;
          buyPrice = pos.entry_price_usd;
          invested = pos.entry_value_usd;
          realizedPnl = pos.realized_pnl_usd || 0;
          sellPrice = pos.exit_price_usd || buyPrice;
          roiPct = invested > 0 ? (realizedPnl / invested) * 100 : 0;
        } else if (tradeType === "LIVE") {
          if (!txSignature) {
            throw new ApiError("Confirmed transaction signature required for live PnL card", 400);
          }
          const liveTx = await env.DB.prepare("SELECT * FROM live_transactions WHERE signature = ?").bind(txSignature).first<any>();
          if (!liveTx) {
            throw new ApiError("Verified on-chain transaction record not found", 404);
          }
          if (liveTx.status !== "confirmed") {
            throw new ApiError("Cannot generate realized live PnL card for unconfirmed transaction", 400);
          }
          mint = liveTx.output_mint;
          invested = Number(liveTx.input_amount) || 0;
          quantity = Number(liveTx.output_amount) || 0;
          buyPrice = invested > 0 && quantity > 0 ? invested / quantity : 0;

          // A buy is not a realized PnL event. Match a later, confirmed sell
          // from the same wallet, swapping this exact token back to the original quote mint.
          const exitTx = await env.DB.prepare(
            `SELECT * FROM live_transactions
             WHERE wallet_address = ? AND input_mint = ? AND output_mint = ?
               AND status = 'confirmed' AND submitted_at > ?
             ORDER BY submitted_at ASC LIMIT 1`
          ).bind(liveTx.wallet_address, liveTx.output_mint, liveTx.input_mint, liveTx.submitted_at).first<any>();

          if (!exitTx) {
            throw new ApiError("No matching confirmed sell transaction is recorded for this live buy yet. A buy alone has no realized PnL.", 409);
          }

          const boughtQuantity = Number(liveTx.output_amount) || 0;
          const soldQuantity = Number(exitTx.input_amount) || 0;
          const proceeds = Number(exitTx.output_amount) || 0;
          if (boughtQuantity <= 0 || soldQuantity <= 0 || proceeds <= 0 || soldQuantity > boughtQuantity * 1.0001) {
            throw new ApiError("Live swap amounts do not form a valid single-buy/sell pair; refusing to generate an unverified PnL card.", 409);
          }

          // Attribute cost basis proportionally for a partial exit. Stored amounts must
          // be normalized UI amounts (not raw token base units) by the swap tracker.
          const matchedQuantity = soldQuantity;
          invested = (Number(liveTx.input_amount) || 0) * (matchedQuantity / boughtQuantity);
          quantity = matchedQuantity;
          buyPrice = invested / matchedQuantity;
          sellPrice = proceeds / matchedQuantity;
          realizedPnl = proceeds - invested;
          roiPct = invested > 0 ? (realizedPnl / invested) * 100 : 0;
          txSignature = liveTx.signature;
        }

        const tokenMeta = mint
          ? await env.DB.prepare("SELECT symbol,name FROM tokens WHERE mint=?").bind(mint).first<any>()
          : null;
        symbol = String(tokenMeta?.symbol || symbol || "").toUpperCase();
        name = String(tokenMeta?.name || name || symbol);

        const isPublic = body.isPublic === 1 || body.isPublic === true ? 1 : 0;

        await env.DB.prepare(
          `INSERT INTO pnl_cards (
             id, card_type, trade_type, mint, symbol, name, buy_price_usd, sell_price_usd,
             invested_usd, quantity, realized_pnl_usd, unrealized_pnl_usd, roi_pct, duration_seconds,
             tx_signature, is_public, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          cardId,
          cardType,
          tradeType,
          mint,
          symbol,
          name,
          buyPrice,
          sellPrice,
          invested,
          quantity,
          realizedPnl,
          unrealizedPnl,
          Number(roiPct.toFixed(2)),
          Number(body.durationSeconds) || 0,
          txSignature,
          isPublic,
          createdAt
        ).run();

        return json({
          cardId,
          cardType,
          tradeType,
          mint,
          symbol,
          name,
          buyPriceUsd: buyPrice,
          sellPriceUsd: sellPrice,
          investedUsd: invested,
          realizedPnlUsd: realizedPnl,
          unrealizedPnlUsd: unrealizedPnl,
          roiPct: Number(roiPct.toFixed(2)),
          txSignature,
          createdAt,
          verificationUrl: `/verify/${cardId}`,
        }, 201);
      } else {
        const summary = body.portfolioSummary || {};
        const roiPct = summary.startingBalanceUsd > 0
          ? ((summary.totalEquityUsd - summary.startingBalanceUsd) / summary.startingBalanceUsd) * 100
          : 0;

        await env.DB.prepare(
          `INSERT INTO pnl_cards (
             id, card_type, trade_type, roi_pct, portfolio_summary_json, is_public, created_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?)`
        ).bind(
          cardId,
          cardType,
          tradeType,
          Number(roiPct.toFixed(2)),
          JSON.stringify(summary),
          createdAt
        ).run();

        return json({
          cardId,
          cardType,
          tradeType,
          roiPct: Number(roiPct.toFixed(2)),
          portfolioSummary: summary,
          createdAt,
          verificationUrl: `/verify/${cardId}`,
        }, 201);
      }
    }

    if (path.startsWith("/api/pnl/card/") && method === "GET") {
      const cardId = path.split("/")[4]?.trim();
      if (!cardId) throw new ApiError("Card ID required");
      const card = await env.DB.prepare("SELECT * FROM pnl_cards WHERE id = ?").bind(cardId).first<any>();
      if (!card) throw new ApiError("PnL Card not found", 404);

      // Private cards must not be accessible through public endpoints
      if (!card.is_public && !authenticateAdminRequest(request, env)) {
        throw new ApiError("PnL Card is private and restricted to the authorized owner", 403);
      }

      return json({
        ...card,
        portfolioSummary: card.portfolio_summary_json ? JSON.parse(card.portfolio_summary_json) : null,
      });
    }

    if (path === "/api/pnl/history" && method === "GET") {
      // History is restricted to the authenticated owner
      if (!authenticateAdminRequest(request, env)) {
        throw new ApiError("Unauthorized to view card history", 401);
      }
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      const cards = await env.DB.prepare("SELECT * FROM pnl_cards ORDER BY created_at DESC LIMIT ?").bind(limit).all<any>();
      return json((cards.results || []).map(c => ({
        ...c,
        portfolioSummary: c.portfolio_summary_json ? JSON.parse(c.portfolio_summary_json) : null,
      })));
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
      const ok = await TelegramAdapter.sendAlert(env, "Solana Degen Radar: Connection test successful! 🚀");
      return json({ ok });
    }

    // 16. Secure Environment & Integration Status Diagnostic Endpoint
    if (path === "/api/admin/env-status" && method === "GET") {
      const isConfigured = (v?: string) => Boolean(v && v.trim().length > 0);

      const statusMatrix = {
        core: {
          appEnv: env.APP_ENV || "production",
          dashboardOrigin: env.DASHBOARD_ORIGIN || "Not set",
          workerActive: true,
          timestamp: now(),
        },
        cloudflare: {
          d1Database: { name: "DB", configured: Boolean(env.DB), status: "available" },
          durableObjects: { name: "PUMPPORTAL_STREAM", configured: Boolean(env.PUMPPORTAL_STREAM), status: env.PUMPPORTAL_STREAM ? "available" : "missing" },
          cronTriggers: { schedule: "*/5 * * * *", configured: true, status: "active" },
        },
        solanaRpc: {
          endpointType: env.HELIUS_API_KEY ? "Helius Dedicated RPC" : "Solana Public RPC",
          isCustomEndpoint: isConfigured(env.SOLANA_RPC_URL),
          hasHeliusKey: isConfigured(env.HELIUS_API_KEY),
          status: "connected",
        },
        marketProviders: {
          dexscreener: { configured: true, status: "available", baseUrl: env.DEXSCREENER_BASE_URL || "https://api.dexscreener.com" },
          pumpPortal: { configured: isConfigured(env.PUMPPORTAL_API_KEY), status: isConfigured(env.PUMPPORTAL_API_KEY) ? "verified" : "public_stream_only" },
          jupiterSwap: { configured: true, status: "available", endpoint: "https://api.jup.ag/swap/v1" },
        },
        socialProviders: {
          reddit: { configured: isConfigured(env.REDDIT_USER_AGENT), status: "public_json_active" },
          rss: { configured: isConfigured(env.SOCIAL_RSS_FEEDS), status: isConfigured(env.SOCIAL_RSS_FEEDS) ? "custom_feeds" : "default_crypto_news" },
          telegram: { configured: isConfigured(env.TELEGRAM_BOT_TOKEN) && isConfigured(env.TELEGRAM_CHAT_ID), status: isConfigured(env.TELEGRAM_BOT_TOKEN) ? "configured" : "disabled" },
          xTwitter: { configured: isConfigured(env.X_BEARER_TOKEN), status: isConfigured(env.X_BEARER_TOKEN) ? "bearer_configured" : "mock_or_unconfigured" },
          tikTok: { configured: false, status: "disabled_unauthorized_api" },
        },
        securityCredentials: {
          hasAdminSecret: isConfigured(env.ADMIN_SECRET),
          hasSocialIngestSecret: isConfigured(env.SOCIAL_INGEST_SECRET),
          hasTelegramWebhookSecret: isConfigured(env.TELEGRAM_WEBHOOK_SECRET),
          hasInternalWorkerSecret: isConfigured(env.INTERNAL_WORKER_SECRET),
        },
        tradingConfiguration: {
          paperStartingBalance: Number(env.PAPER_STARTING_BALANCE) || 100,
          liveTradingEnabled: false, // Strict default safeguard
          phantomSupported: true,
        },
      };

      return json(statusMatrix);
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

// Concurrency-Safe D1-backed Rate Limiter
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_MUTATION_MAX = 20;

async function checkD1RateLimit(
  db: D1Database,
  request: Request,
  isMutation = false,
  identity = "anonymous"
): Promise<boolean> {
  // Rely on Cloudflare cf-connecting-ip header
  const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const nowMs = Date.now();
  const windowBucket = Math.floor(nowMs / RATE_LIMIT_WINDOW_MS);
  const endpoint = new URL(request.url).pathname;

  const limitKey = `${identity}:${ip}:${isMutation ? "mut:" + endpoint : "all"}:${windowBucket}`;
  const maxLimit = isMutation ? RATE_LIMIT_MUTATION_MAX : RATE_LIMIT_MAX_REQUESTS;
  const expiresAt = (windowBucket + 2) * RATE_LIMIT_WINDOW_MS;

  try {
    // Opportunistic cleanup of expired limits
    if (Math.random() < 0.05) {
      await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(nowMs).run().catch(() => {});
      await db.prepare("DELETE FROM idempotency_reservations WHERE expires_at < ?").bind(nowMs).run().catch(() => {});
    }

    // Atomic increment or insert in rate_limits
    const result = await db
      .prepare(
        `INSERT INTO rate_limits (limit_key, request_count, window_start, expires_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(limit_key) DO UPDATE SET request_count = rate_limits.request_count + 1
         RETURNING request_count`
      )
      .bind(limitKey, windowBucket * RATE_LIMIT_WINDOW_MS, expiresAt)
      .first<{ request_count: number }>();

    const currentCount = result?.request_count ?? 1;
    return currentCount <= maxLimit;
  } catch {
    // Fail-closed for state-changing mutations if database or rate limiting table is unavailable
    if (isMutation) {
      return false;
    }
    return true;
  }
}

// Concurrency-Safe D1-Backed Idempotency Engine
async function computePayloadHash(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(payload || "");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export type IdempotencyReservationResult =
  | { state: "reserved" }
  | { state: "completed"; responseBody: string; status: number }
  | { state: "conflict"; message: string }
  | { state: "in_progress" };

async function reserveIdempotencyKey(
  db: D1Database,
  key: string,
  identity: string,
  endpoint: string,
  payloadHash: string
): Promise<IdempotencyReservationResult> {
  const nowMs = Date.now();
  const ttlMs = 15 * 60 * 1000; // 15 minutes TTL
  const expiresAt = nowMs + ttlMs;
  const createdAt = new Date().toISOString();

  try {
    // 1. Attempt atomic insert of reservation with status 'pending'
    const insertRes = await db
      .prepare(
        `INSERT INTO idempotency_reservations (key, identity, endpoint, payload_hash, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(key) DO NOTHING`
      )
      .bind(key, identity, endpoint, payloadHash, createdAt, expiresAt)
      .run();

    if (insertRes.meta.changes > 0) {
      return { state: "reserved" };
    }

    // 2. Existing key: check status, payload matching, and expiration
    const existing = await db
      .prepare("SELECT * FROM idempotency_reservations WHERE key = ?")
      .bind(key)
      .first<any>();

    if (!existing) {
      return { state: "reserved" };
    }

    // Check payload and endpoint binding
    if (existing.endpoint !== endpoint || existing.payload_hash !== payloadHash) {
      return {
        state: "conflict",
        message: "Idempotency key reused with different endpoint or request payload",
      };
    }

    // Check if previous request completed
    if (existing.status === "completed" && existing.response_body) {
      return {
        state: "completed",
        responseBody: existing.response_body,
        status: existing.response_status || 200,
      };
    }

    // If reservation is abandoned or timed out (> 60s in 'pending'), recover reservation
    const reservationAgeMs = nowMs - Date.parse(existing.created_at);
    if (existing.status === "pending" && reservationAgeMs > 60 * 1000) {
      const recovered = await db
        .prepare(
          `UPDATE idempotency_reservations
           SET created_at = ?, expires_at = ?, identity = ?
           WHERE key = ? AND status = 'pending'`
        )
        .bind(createdAt, expiresAt, identity, key)
        .run();

      if (recovered.meta.changes > 0) {
        return { state: "reserved" };
      }
    }

    return { state: "in_progress" };
  } catch {
    // Fallback on schema unavailability
    return { state: "reserved" };
  }
}

async function completeIdempotencyReservation(
  db: D1Database,
  key: string,
  responseBody: string,
  status: number
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE idempotency_reservations
         SET status = 'completed', response_body = ?, response_status = ?
         WHERE key = ?`
      )
      .bind(responseBody, status, key)
      .run();
  } catch {
    // Non-fatal
  }
}

async function markIdempotencyFailed(db: D1Database, key: string): Promise<void> {
  try {
    await db.prepare("UPDATE idempotency_reservations SET status = 'failed' WHERE key = ?").bind(key).run();
  } catch {
    // Non-fatal
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

function extractBearerOrSecret(request: Request): string | null {
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const radarSecret = request.headers.get("x-radar-secret");
  if (radarSecret && radarSecret.trim()) return radarSecret.trim();
  return null;
}

function authenticateAdminRequest(request: Request, env: Env): boolean {
  // Production and local environments fail-closed if ADMIN_SECRET is not configured
  const expectedSecret = env.ADMIN_SECRET;
  if (!expectedSecret || expectedSecret.trim() === "") {
    return false;
  }
  const provided = extractBearerOrSecret(request);
  return Boolean(provided && provided === expectedSecret);
}

function authenticateInternalRequest(request: Request, env: Env): boolean {
  // Strict separation: INTERNAL_WORKER_SECRET must be configured independently and never fall back to ADMIN_SECRET
  const expectedSecret = env.INTERNAL_WORKER_SECRET;
  if (!expectedSecret || expectedSecret.trim() === "") {
    return false; // Fail closed if internal credential is not configured
  }
  const provided = extractBearerOrSecret(request);
  return Boolean(provided && provided === expectedSecret);
}

function authenticateSocialIngestRequest(request: Request, env: Env): boolean {
  const expectedSecret = env.SOCIAL_INGEST_SECRET;
  if (!expectedSecret || expectedSecret.trim() === "") {
    return false;
  }
  const provided = extractBearerOrSecret(request);
  return Boolean(provided && provided === expectedSecret);
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
        runMultiSourceDiscovery(env),
        dispatchPendingAlerts(env),
      ])
    );
  },
};
