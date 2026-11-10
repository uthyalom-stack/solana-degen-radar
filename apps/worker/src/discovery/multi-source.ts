import type { Env } from "../types";
import { SolanaRpcClient } from "./solana-rpc";

const isoNow = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();
const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const asObject = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(v => v.toString(16).padStart(2, "0")).join("");
}

export type DiscoveryConfidence = "confirmed" | "strong" | "weak" | "unknown";

/** Persist source-attributed evidence without converting missing data into a positive signal. */
export async function recordDiscoveryEvidence(
  db: D1Database,
  mint: string,
  sourceType: string,
  sourceId: string,
  evidenceType: string,
  confidence: DiscoveryConfidence,
  payload: Record<string, unknown>,
  observedAt = isoNow(),
): Promise<void> {
  if (!mint || mint.length < 32 || mint.length > 64) return;
  const serialized = JSON.stringify(payload);
  const evidenceHash = await digest(serialized);
  await db.prepare(
    `INSERT INTO discovery_candidates (mint, first_discovered_at, last_discovered_at, discovery_score, source_count, source_summary_json)
     SELECT ?, ?, ?, 0, 0, '[]'
     WHERE EXISTS (SELECT 1 FROM tokens WHERE mint = ?)
     ON CONFLICT(mint) DO UPDATE SET last_discovered_at = excluded.last_discovered_at`
  ).bind(mint, observedAt, observedAt, mint).run();

  await db.prepare(
    `INSERT OR IGNORE INTO discovery_evidence
      (id,mint,source_type,source_id,evidence_type,confidence,observed_at,evidence_json,evidence_hash)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(makeId(), mint, sourceType, sourceId, evidenceType, confidence, observedAt, serialized, evidenceHash).run();

  const aggregate = await db.prepare(
    `SELECT COUNT(DISTINCT source_type) AS source_count,
      COUNT(*) AS evidence_count,
      SUM(CASE confidence WHEN 'confirmed' THEN 4 WHEN 'strong' THEN 3 WHEN 'weak' THEN 1 ELSE 0 END) AS score
     FROM discovery_evidence WHERE mint = ?`
  ).bind(mint).first<{source_count:number;evidence_count:number;score:number}>();
  const sources = await db.prepare(
    "SELECT DISTINCT source_type FROM discovery_evidence WHERE mint = ? ORDER BY source_type"
  ).bind(mint).all<{source_type:string}>();
  await db.prepare(
    "UPDATE discovery_candidates SET source_count=?, discovery_score=?, source_summary_json=? WHERE mint=?"
  ).bind(aggregate?.source_count || 0, aggregate?.score || 0, JSON.stringify((sources.results || []).map(x => x.source_type)), mint).run();
}

async function sourceStatus(
  db: D1Database, source: string, status: string, itemsSeen: number, error?: string, details: Record<string, unknown> = {},
) {
  const stamp = isoNow();
  await db.prepare(
    `INSERT INTO discovery_source_status (source_type,status,last_attempt_at,last_success_at,items_seen,error_message,details_json)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(source_type) DO UPDATE SET status=excluded.status,last_attempt_at=excluded.last_attempt_at,
       last_success_at=CASE WHEN excluded.status='healthy' THEN excluded.last_success_at ELSE discovery_source_status.last_success_at END,
       items_seen=excluded.items_seen,error_message=excluded.error_message,details_json=excluded.details_json`
  ).bind(source, status, stamp, status === "healthy" ? stamp : null, itemsSeen, error || null, JSON.stringify(details)).run();
}

function extractUrls(value: unknown): string[] {
  if (typeof value === "string") return value.match(/https?:\/\/[^\s"'<>]+/g) || [];
  if (Array.isArray(value)) return value.flatMap(extractUrls);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(extractUrls);
  return [];
}

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

/**
 * Supplemental discovery: links already-collected on-chain, market, wallet and social evidence.
 * Provider-dependent pipelines remain explicitly disabled until a real provider is configured.
 */
export async function runMultiSourceDiscovery(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const summary: Record<string, number | string> = {};
  const tokens = await db.prepare(
    `SELECT t.mint,t.name,t.symbol,t.source,t.launchpad,t.creator_address,t.metadata_json,t.decimals,
       s.price_usd,s.liquidity_usd,s.volume_5m_usd,s.volume_1h_usd,s.observed_at
     FROM tokens t LEFT JOIN token_snapshots s ON s.id = (
       SELECT s2.id FROM token_snapshots s2 WHERE s2.mint=t.mint ORDER BY s2.observed_at DESC LIMIT 1
     )
     ORDER BY COALESCE(s.observed_at,t.first_seen_at) DESC LIMIT 30`
  ).all<any>();
  const rows = tokens.results || [];
  let evidenceCount = 0;
  let routeChecks = 0;

  // (1) Raw RPC discovery is performed by SolanaRpcClient and inserted before this pass.
  summary.raw_rpc_candidates = await db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE source='solana_rpc'").first<any>().then(x => Number(x?.n || 0));

  // (2) Wallet relationships: retain graph evidence; a shared funder or co-buy is not proof of common ownership.
  for (const token of rows) {
    const relations = await db.prepare(
      `SELECT wr.relationship_type,wr.confidence_score,wr.evidence_json,wr.wallet_a,wr.wallet_b
       FROM wallet_relationships wr
       JOIN wallet_activities wa ON (wa.wallet_address=wr.wallet_a OR wa.wallet_address=wr.wallet_b)
       WHERE wa.mint=? LIMIT 30`
    ).bind(token.mint).all<any>();
    for (const rel of relations.results || []) {
      await recordDiscoveryEvidence(db, token.mint, "wallet_graph", `${rel.wallet_a}:${rel.wallet_b}:${rel.relationship_type}`,
        "wallet_relationship", Number(rel.confidence_score) >= 85 ? "strong" : "weak",
        { relationshipType: rel.relationship_type, confidenceScore: rel.confidence_score, walletA: rel.wallet_a, walletB: rel.wallet_b, evidence: rel.evidence_json });
      evidenceCount++;
    }
  }

  // (3) Liquidity history: compare actual persisted snapshots; do not infer buyer uniqueness from pool transaction counts.
  for (const token of rows) {
    const history = await db.prepare(
      "SELECT pair_address,observed_at,liquidity_usd,volume_5m_usd,volume_1h_usd,txns_5m_json FROM token_snapshots WHERE mint=? ORDER BY observed_at DESC LIMIT 2"
    ).bind(token.mint).all<any>();
    const latest = history.results?.[0];
    if (!latest) continue;
    let previous = history.results?.[1];
    await db.prepare(
      `INSERT INTO liquidity_observations (id,mint,pair_address,observed_at,liquidity_usd,volume_5m_usd,volume_1h_usd,raw_json)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(makeId(), token.mint, latest.pair_address, latest.observed_at, latest.liquidity_usd, latest.volume_5m_usd, latest.volume_1h_usd,
      JSON.stringify({ previous: previous || null, source: "token_snapshots" })).run();
    const oldLiquidity = Number(previous?.liquidity_usd);
    const currentLiquidity = Number(latest.liquidity_usd);
    if (Number.isFinite(oldLiquidity) && oldLiquidity > 0 && Number.isFinite(currentLiquidity)) {
      const growthPct = ((currentLiquidity - oldLiquidity) / oldLiquidity) * 100;
      await recordDiscoveryEvidence(db, token.mint, "liquidity", latest.pair_address || "unknown-pool",
        "liquidity_change", "weak", { previousLiquidityUsd: oldLiquidity, currentLiquidityUsd: currentLiquidity, growthPct, observedAt: latest.observed_at }, latest.observed_at);
      evidenceCount++;
    }
  }

  // (4) Narrative-before-token matching: match token aliases against previously captured public social events.
  for (const token of rows) {
    const terms = [asText(token.symbol), asText(token.name)].filter(x => x.length >= 4).slice(0, 2);
    for (const term of terms) {
      const mentions = await db.prepare(
        "SELECT source,source_id,observed_at,url,text_content,metrics_json FROM social_events WHERE lower(text_content) LIKE ? ORDER BY observed_at DESC LIMIT 8"
      ).bind(`%${term.toLowerCase()}%`).all<any>();
      for (const mention of mentions.results || []) {
        await recordDiscoveryEvidence(db, token.mint, "social_narrative", `${mention.source}:${mention.source_id}`,
          "token_alias_mention", "weak", { matchedTerm: term, source: mention.source, url: mention.url, text: String(mention.text_content || "").slice(0, 500), metrics: mention.metrics_json }, mention.observed_at);
        evidenceCount++;
      }
    }
  }

  // (5) Launchpad and graduation observations from actual PumpPortal events and persisted token attribution.
  for (const token of rows) {
    const events = await db.prepare(
      "SELECT event_type,observed_at,raw_json FROM pumpportal_events WHERE mint=? ORDER BY observed_at DESC LIMIT 10"
    ).bind(token.mint).all<any>();
    for (const event of events.results || []) {
      await db.prepare(
        `INSERT OR IGNORE INTO launchpad_observations (id,mint,launchpad,event_type,observed_at,evidence_json)
         VALUES (?,?,?,?,?,?)`
      ).bind(makeId(), token.mint, token.launchpad || "pumpfun", event.event_type, event.observed_at, event.raw_json || "{}").run();
      await recordDiscoveryEvidence(db, token.mint, "launchpad", `pumpportal:${event.event_type}:${event.observed_at}`,
        "launchpad_event", "confirmed", { launchpad: token.launchpad || "pumpfun", eventType: event.event_type, raw: event.raw_json }, event.observed_at);
      evidenceCount++;
    }
    if (token.launchpad) {
      await recordDiscoveryEvidence(db, token.mint, "launchpad", token.launchpad, "launchpad_attribution", "weak",
        { launchpad: token.launchpad, migrationTarget: null, attributionSource: token.source });
    }
  }

  // (6) Jito: detect configured tip-account transfers linked to tracked wallets.
  // A tip is only a weak bundle indicator; it does not prove bundle membership or malicious coordination.
  const tipAccounts = (env.JITO_TIP_ACCOUNTS || "").split(",").map(x => x.trim()).filter(Boolean);
  const rpc = new SolanaRpcClient(env);
  const monitoredPrograms = (env.SOLANA_DISCOVERY_PROGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  let programActivityCount = 0;
  if (monitoredPrograms.length) {
    const programTransactions = await rpc.getRecentProgramTransactions(monitoredPrograms, 5);
    for (const activity of programTransactions) {
      const involved = rows.filter(token => activity.accountKeys.includes(token.mint));
      for (const token of involved) {
        await recordDiscoveryEvidence(db,token.mint,"solana_program",`${activity.programId}:${activity.signature}`,
          "launchpad_or_pool_program_interaction","weak",{
            programId:activity.programId,signature:activity.signature,slot:activity.slot,
            blockTime:activity.blockTime,caveat:"Program interaction is a discovery clue, not proof of pool initialization."
          },activity.blockTime ? new Date(activity.blockTime*1000).toISOString() : isoNow());
        programActivityCount++;
      }
    }
  }
  await sourceStatus(db,"solana_program_activity",monitoredPrograms.length ? "partial" : "disabled",programActivityCount,
    monitoredPrograms.length ? undefined : "Set SOLANA_DISCOVERY_PROGRAM_IDS to monitor selected launchpad and AMM program accounts.",
    {programsConfigured:monitoredPrograms.length});
  let jitoIndicators = 0;
  let bridgeIndicators = 0;
  const activityRows = await db.prepare(
    "SELECT wallet_address,mint,tx_signature,observed_at FROM wallet_activities WHERE tx_signature IS NOT NULL ORDER BY observed_at DESC LIMIT 100"
  ).all<any>();
  const seenSignatures = new Set<string>();
  for (const activity of activityRows.results || []) {
    const signature = String(activity.tx_signature || "");
    if (!signature || seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    const transaction = await rpc.getParsedTransaction(signature);
    if (!transaction) continue;

    if (tipAccounts.length) {
      const tip = transaction.transfers.find(transfer => tipAccounts.includes(transfer.to));
      if (tip) {
        await db.prepare(
          `INSERT OR IGNORE INTO bundle_observations (id,mint,signature,slot,bundle_provider,tip_lamports,wallet_addresses_json,observed_at,evidence_json)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).bind(makeId(),activity.mint,signature,transaction.slot,"jito_tip_transfer_indicator",tip.lamports,
          JSON.stringify([activity.wallet_address]),activity.observed_at,JSON.stringify({tipAccount:tip.to,from:tip.from,classification:"tip_transfer_not_bundle_proof"})).run();
        await recordDiscoveryEvidence(db,activity.mint,"jito","tip:"+signature,"jito_tip_transfer","weak",{
          wallet:activity.wallet_address,signature,tipAccount:tip.to,tipLamports:tip.lamports,
          caveat:"A tip transfer alone does not prove Jito bundle membership."
        },activity.observed_at);
        jitoIndicators++;
      }
    }

    const bridgePrograms = (env.BRIDGE_PROGRAM_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
    const matchedBridgeProgram = transaction.programIds.find(programId => bridgePrograms.includes(programId));
    if (matchedBridgeProgram) {
      await db.prepare(
        `INSERT OR IGNORE INTO bridge_flow_observations (id,wallet_address,source_chain,destination_chain,tx_hash,observed_at,provider,evidence_json)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(makeId(),activity.wallet_address,"unknown","solana",signature,activity.observed_at,"solana_rpc_bridge_program",
        JSON.stringify({programId:matchedBridgeProgram,slot:transaction.slot,classification:"bridge_program_interaction_only"})).run();
      await recordDiscoveryEvidence(db,activity.mint,"cross_chain","bridge:"+signature,"bridge_program_interaction","weak",{
        wallet:activity.wallet_address,signature,programId:matchedBridgeProgram,
        sourceChain:"unknown",amountUsd:null,caveat:"Program interaction does not identify bridge direction or transferred value."
      },activity.observed_at);
      bridgeIndicators++;
    }
  }
  await sourceStatus(db,"jito_bundle",tipAccounts.length ? "partial" : "disabled",jitoIndicators,
    tipAccounts.length ? undefined : "Set JITO_TIP_ACCOUNTS to monitor known tip destinations; tip transfers remain weak evidence, not confirmed bundles.",
    {tipAccountCount:tipAccounts.length,transactionsChecked:seenSignatures.size});
  await sourceStatus(db,"cross_chain_flows",env.BRIDGE_PROGRAM_IDS ? "partial" : "disabled",bridgeIndicators,
    env.BRIDGE_PROGRAM_IDS ? undefined : "Set BRIDGE_PROGRAM_IDS to monitor bridge program interactions; full transfer attribution needs Wormhole/deBridge message decoding.",
    {transactionsChecked:seenSignatures.size});

  // (8) Route discovery: test small, bounded set of actual mint->SOL quotes; quote availability is not proof of execution.
  for (const token of rows.slice(0, 8)) {
    try {
      let decimals = Number(token.decimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
        const security = await rpc.getMintSecurity(token.mint);
        decimals = security.decimals ?? -1;
      }
      if (decimals < 0 || decimals > 18) continue;
      const rawAmount = String(Math.max(1, Math.floor(10 ** Math.min(decimals, 9))));
      const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${encodeURIComponent(token.mint)}&outputMint=So11111111111111111111111111111111111111112&amount=${rawAmount}&slippageBps=300`;
      const response = await fetch(quoteUrl, { headers: { Accept: "application/json" } });
      const body = await response.text();
      let parsed: any = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
      const routeAvailable = response.ok && Boolean(parsed?.outAmount && Number(parsed.outAmount) > 0);
      await db.prepare(
        `INSERT INTO route_observations (id,mint,provider,observed_at,route_available,input_amount_raw,output_amount_raw,price_impact_pct,route_plan_json,error_code)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(makeId(), token.mint, "jupiter", isoNow(), routeAvailable ? 1 : 0, rawAmount,
        parsed?.outAmount || null, Number.isFinite(Number(parsed?.priceImpactPct)) ? Number(parsed.priceImpactPct) : null,
        parsed?.routePlan ? JSON.stringify(parsed.routePlan) : null, response.ok ? null : `HTTP_${response.status}`).run();
      await recordDiscoveryEvidence(db, token.mint, "trading_route", "jupiter", "quote_route",
        routeAvailable ? "strong" : "unknown", { routeAvailable, httpStatus: response.status, error: parsed?.error || null });
      routeChecks++;
    } catch {
      // A provider/network failure is unknown, not a honeypot result.
    }
  }

  // (9) Exact metadata URL reuse is a weak duplicate-artwork clue, not perceptual image recognition.
  // A true pHash/embedding provider is deliberately not claimed until one is implemented.
  for (const token of rows) {
    let metadata: Record<string, any> = {};
    try { metadata = asObject(JSON.parse(token.metadata_json || "{}")); } catch { metadata = {}; }
    const imageUrl = asText(metadata.image || metadata.image_uri || metadata.logoURI || metadata.logo_uri);
    if (imageUrl.startsWith("https://") || imageUrl.startsWith("http://")) {
      const normalized = imageUrl.split("?")[0].toLowerCase();
      const urlHash = await digest(normalized);
      await db.prepare(
        `INSERT OR IGNORE INTO token_media_fingerprints (id,mint,media_url,normalized_url_hash,method,observed_at)
         VALUES (?,?,?,?,?,?)`
      ).bind(makeId(), token.mint, imageUrl, urlHash, "normalized_url_exact_match", isoNow()).run();
      const duplicates = await db.prepare(
        "SELECT mint FROM token_media_fingerprints WHERE normalized_url_hash=? AND mint<>? LIMIT 20"
      ).bind(urlHash, token.mint).all<any>();
      if (duplicates.results?.length) {
        await recordDiscoveryEvidence(db, token.mint, "media_similarity", urlHash, "reused_image_url", "weak",
          { matchingMints: duplicates.results.map(x => x.mint), method: "exact_normalized_url_only" });
      }
    }
  }
  await sourceStatus(db, "image_similarity", "partial", 0, "Exact metadata image URL reuse is tracked. Perceptual hashing and visual embeddings are not yet implemented.");

  // (10) Developer/domain/community signals extracted from token metadata and known creator attribution.
  for (const token of rows) {
    let metadata: Record<string, any> = {};
    try { metadata = asObject(JSON.parse(token.metadata_json || "{}")); } catch { metadata = {}; }
    const urls = [...new Set(extractUrls(metadata))].slice(0, 20);
    for (const url of urls) {
      const domain = domainOf(url);
      const signalType = /github\.com/i.test(url) ? "github" : /t\.me|telegram\.me/i.test(url) ? "telegram" : /x\.com|twitter\.com/i.test(url) ? "social" : "website";
      await db.prepare(
        `INSERT OR IGNORE INTO developer_signals (id,mint,signal_type,signal_value,domain,observed_at,confidence,evidence_json)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(makeId(), token.mint, signalType, url, domain, isoNow(), "weak", JSON.stringify({ extractedFrom: "token_metadata" })).run();
      await recordDiscoveryEvidence(db, token.mint, "developer_community", url, "metadata_link", "weak", { signalType, url, domain });
    }
    if (token.creator_address) {
      await recordDiscoveryEvidence(db, token.mint, "developer_community", token.creator_address,
        "creator_attribution", "weak", { creatorAddress: token.creator_address, attributionSource: "tokens.creator_address" });
    }
  }

  // (4b) Narrative-before-token: extract recurring hashtags/cashtags from public social observations
  // even when no token mint currently matches the term.
  const socialRows = await db.prepare(
    "SELECT source,source_id,observed_at,text_content,metrics_json,url FROM social_events WHERE julianday(observed_at)>=julianday('now','-24 hours') ORDER BY observed_at DESC LIMIT 1000"
  ).all<any>();
  const emerging = new Map<string,{display:string;type:string;count:number;sources:Set<string>;engagement:number;evidence:any[]}>();
  for (const post of socialRows.results || []) {
    const body = String(post.text_content || "");
    const matches = [
      ...(body.match(/#[\p{L}\p{N}_]{3,}/gu) || []).map((v:string)=>({term:v.slice(1),type:"hashtag"})),
      ...(body.match(/\$[A-Z][A-Z0-9]{2,}/g) || []).map((v:string)=>({term:v.slice(1),type:"cashtag"})),
    ];
    let metrics:any = {};
    try { metrics = JSON.parse(post.metrics_json || "{}"); } catch { metrics = {}; }
    const engagement = ["likes","reposts","comments","views","score"].reduce((sum,key)=>sum+(Number(metrics[key])||0),0);
    for (const match of matches) {
      const normalized = match.term.toLowerCase().replace(/[^\p{L}\p{N}_]/gu,"").slice(0,64);
      if (normalized.length < 3) continue;
      const current = emerging.get(normalized) || {display:match.term,type:match.type,count:0,sources:new Set<string>(),engagement:0,evidence:[]};
      current.count++;
      current.sources.add(String(post.source || "unknown"));
      current.engagement += engagement;
      if (current.evidence.length < 5) current.evidence.push({source:post.source,url:post.url,sourceId:post.source_id,observedAt:post.observed_at});
      emerging.set(normalized,current);
    }
  }
  let emergingCount = 0;
  for (const [term,value] of emerging) {
    if (value.count < 2 && value.sources.size < 2) continue;
    // Do not call an existing ticker a pre-token narrative.
    const existing = await db.prepare("SELECT 1 AS found FROM tokens WHERE lower(symbol)=? LIMIT 1").bind(term).first<any>();
    if (existing) continue;
    await db.prepare(
      `INSERT INTO emerging_narratives (normalized_term,display_term,term_type,first_seen_at,last_seen_at,mention_count,independent_source_count,engagement_total,evidence_json)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(normalized_term) DO UPDATE SET display_term=excluded.display_term,last_seen_at=excluded.last_seen_at,
         mention_count=excluded.mention_count,independent_source_count=excluded.independent_source_count,
         engagement_total=excluded.engagement_total,evidence_json=excluded.evidence_json`
    ).bind(term,value.display,value.type,isoNow(),isoNow(),value.count,value.sources.size,value.engagement,JSON.stringify(value.evidence)).run();
    emergingCount++;
  }
  await sourceStatus(db,"narrative_before_token","partial",emergingCount,undefined,{windowHours:24,minimumMentions:2,note:"Signals are based on ingested public posts; coverage depends on connected social sources."});

  summary.tokens_examined = rows.length;
  summary.evidence_written = evidenceCount;
  summary.jupiter_route_checks = routeChecks;
  await sourceStatus(db, "raw_rpc", "partial", Number(summary.raw_rpc_candidates || 0), undefined, { pipeline: "bounded recent Tokenkeg and Token-2022 mint-initialization polling; a streaming/indexer feed is needed for complete coverage" });
  await sourceStatus(db, "wallet_graph", "partial", evidenceCount, undefined, { pipeline: "persisted wallet relationship evidence; upstream wallet history completeness remains dependent on RPC ingestion" });
  await sourceStatus(db, "liquidity", "partial", rows.length, undefined, { pipeline: "historical token snapshots; independent buyer counts not inferred" });
  await sourceStatus(db, "social_narrative", "partial", evidenceCount, undefined, { pipeline: "links known token aliases to social events and separately tracks emerging hashtags/cashtags before token matching" });
  await sourceStatus(db, "launchpad", "partial", rows.length, undefined, { pipeline: "PumpPortal events and persisted launchpad attribution" });
  await sourceStatus(db, "trading_route", "healthy", routeChecks, undefined, { provider: "Jupiter quote API", note: "quote availability is not execution proof" });
  await sourceStatus(db, "developer_community", "partial", rows.length, undefined, { pipeline: "extracts project website/social/GitHub URLs from token metadata; no domain-age or repository-activity provider yet" });
  return summary;
}
