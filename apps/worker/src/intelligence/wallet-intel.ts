import type { Env } from "../types";
import type { CreatorProfile, WalletHolderRecord, WalletRelationship, WalletReputationCategory } from "@radar/shared";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export class WalletIntelligenceEngine {
  /**
   * Record or update creator profile based on on-chain launch observation
   */
  static async recordCreatorLaunch(
    db: D1Database,
    creatorAddress: string,
    mint: string,
    launchLiquidityUsd = 0,
    peakMarketCapUsd = 0
  ): Promise<CreatorProfile> {
    const existing = await db
      .prepare("SELECT * FROM creators WHERE address = ?")
      .bind(creatorAddress)
      .first<any>();

    const firstSeen = existing?.first_seen_at || now();
    const totalCreated = (existing?.total_tokens_created || 0) + (existing ? 0 : 1);
    const rugCount = existing?.rug_count || 0;
    const successful = existing?.successful_tokens || 0;

    // Reputation heuristic:
    // 100 base, -25 per rug, +10 per successful token
    let repScore = 50;
    let repStatus: WalletReputationCategory = "unknown";

    if (totalCreated >= 2) {
      repScore = Math.max(0, Math.min(100, 50 - rugCount * 30 + successful * 15));
      repStatus = rugCount > 0 ? "suspicious" : successful >= 2 ? "established" : "insufficient";
    }

    const evidence = {
      historyNotes: [
        `Launched mint ${mint.slice(0, 8)}... at ${now()}`,
        ...(existing ? [`Total historical tokens created: ${totalCreated}`] : []),
      ],
      previousMints: [mint],
    };

    await db
      .prepare(
        `INSERT INTO creators (address, first_seen_at, total_tokens_created, rug_count, successful_tokens, reputation_status, reputation_score, evidence_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET
           total_tokens_created = creators.total_tokens_created + 1,
           reputation_status = excluded.reputation_status,
           reputation_score = excluded.reputation_score,
           evidence_json = excluded.evidence_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        creatorAddress,
        firstSeen,
        totalCreated,
        rugCount,
        successful,
        repStatus,
        repScore,
        JSON.stringify(evidence),
        now()
      )
      .run();

    await db
      .prepare(
        `INSERT OR IGNORE INTO creator_tokens (creator_address, mint, created_at, launch_liquidity_usd, peak_market_cap_usd, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .bind(creatorAddress, mint, now(), launchLiquidityUsd, peakMarketCapUsd)
      .run();

    return {
      address: creatorAddress,
      firstSeenAt: firstSeen,
      totalTokensCreated: totalCreated,
      rugCount,
      successfulTokens: successful,
      reputationStatus: repStatus,
      reputationScore: repScore,
      evidence,
    };
  }

  /**
   * Retrieve full Creator Profile including historical launches & track record
   */
  static async getCreatorProfile(db: D1Database, creatorAddress: string): Promise<CreatorProfile | null> {
    const creator = await db
      .prepare("SELECT * FROM creators WHERE address = ?")
      .bind(creatorAddress)
      .first<any>();

    if (!creator) return null;

    const tokens = await db
      .prepare(
        `SELECT ct.*, t.symbol, t.name, s.price_usd, s.liquidity_usd, r.risk_score
         FROM creator_tokens ct
         JOIN tokens t ON t.mint = ct.mint
         LEFT JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = ct.mint ORDER BY observed_at DESC LIMIT 1)
         LEFT JOIN risk_assessments r ON r.id = (SELECT id FROM risk_assessments y WHERE y.mint = ct.mint ORDER BY assessed_at DESC LIMIT 1)
         WHERE ct.creator_address = ?`
      )
      .bind(creatorAddress)
      .all<any>();

    let evidence: any = {};
    try {
      evidence = JSON.parse(creator.evidence_json || "{}");
    } catch {
      evidence = {};
    }

    return {
      address: creator.address,
      firstSeenAt: creator.first_seen_at,
      totalTokensCreated: creator.total_tokens_created,
      rugCount: creator.rug_count,
      successfulTokens: creator.successful_tokens,
      reputationStatus: creator.reputation_status,
      reputationScore: creator.reputation_score,
      evidence: {
        ...evidence,
        tokens: tokens.results || [],
      },
    };
  }

  /**
   * Save top holder snapshot and track concentration over time
   */
  static async recordHolderSnapshot(
    db: D1Database,
    mint: string,
    holders: Array<{ address: string; amount: string; uiAmount: number }>,
    totalSupply: number,
    creatorAddress?: string
  ): Promise<{
    top10Percent: number;
    top20Percent: number;
    holderList: WalletHolderRecord[];
  }> {
    if (!holders.length || totalSupply <= 0) {
      return { top10Percent: 0, top20Percent: 0, holderList: [] };
    }

    // Filter and classify known pool and burn addresses
    const KNOWN_POOLS_AND_BURNS = new Set([
      "11111111111111111111111111111111", // Burn address
      "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium Authority V4
      "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token Program
      "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX", // OpenBook
    ]);

    const holderList: WalletHolderRecord[] = holders.map(h => {
      const amt = Number(h.amount) || 0;
      const pct = Math.min(100, Math.max(0, (amt / totalSupply) * 100));
      const isPoolOrVault = KNOWN_POOLS_AND_BURNS.has(h.address);
      const isCreator = Boolean(creatorAddress && h.address === creatorAddress);

      return {
        address: h.address,
        pct: Number(pct.toFixed(2)),
        amount: amt,
        isPoolOrVault,
        isCreator,
      };
    });

    // Calculate Top 10 excluding known LP pools/burn addresses for real whale concentration
    const beneficialHolders = holderList.filter(h => !h.isPoolOrVault);
    const top10Sum = beneficialHolders.slice(0, 10).reduce((acc, curr) => acc + curr.pct, 0);
    const top20Sum = beneficialHolders.slice(0, 20).reduce((acc, curr) => acc + curr.pct, 0);

    const snapshotId = id();
    const observed = now();

    await db
      .prepare(
        `INSERT INTO holder_snapshots (id, mint, observed_at, total_holders, top10_percent, top20_percent, top_holders_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        snapshotId,
        mint,
        observed,
        holders.length,
        Number(top10Sum.toFixed(2)),
        Number(top20Sum.toFixed(2)),
        JSON.stringify(holderList.slice(0, 20))
      )
      .run();

    // Upsert individual wallets in wallets table
    for (const h of holderList.slice(0, 10)) {
      await db
        .prepare(
          `INSERT INTO wallets (address, first_seen_at, last_active_at, reputation_category, reputation_score)
           VALUES (?, ?, ?, 'unknown', 50)
           ON CONFLICT(address) DO UPDATE SET last_active_at = excluded.last_active_at`
        )
        .bind(h.address, observed, observed)
        .run();
    }

    return {
      top10Percent: Number(top10Sum.toFixed(2)),
      top20Percent: Number(top20Sum.toFixed(2)),
      holderList,
    };
  }

  /**
   * Cross-token wallet query:
   * "This wallet is holding or buying this token. What other tokens has it been involved in, and what happened to those tokens?"
   */
  static async getWalletCrossTokenHistory(db: D1Database, walletAddress: string): Promise<{
    wallet: any;
    tokensInvolved: Array<{
      mint: string;
      symbol: string;
      name: string;
      activityType: string;
      observedAt: string;
      currentPriceUsd?: number;
      liquidityUsd?: number;
      riskScore?: number;
      isRuggedOrCollapsed: boolean;
    }>;
    relationships: WalletRelationship[];
  }> {
    const wallet = await db.prepare("SELECT * FROM wallets WHERE address = ?").bind(walletAddress).first<any>();

    // Query all token snapshots or activity mentioning this wallet
    const activities = await db
      .prepare(
        `SELECT wa.*, t.symbol, t.name, s.price_usd, s.liquidity_usd, r.risk_score
         FROM wallet_activities wa
         JOIN tokens t ON t.mint = wa.mint
         LEFT JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = wa.mint ORDER BY observed_at DESC LIMIT 1)
         LEFT JOIN risk_assessments r ON r.id = (SELECT id FROM risk_assessments y WHERE y.mint = wa.mint ORDER BY assessed_at DESC LIMIT 1)
         WHERE wa.wallet_address = ?
         ORDER BY wa.observed_at DESC LIMIT 50`
      )
      .bind(walletAddress)
      .all<any>();

    // Also check holder snapshots where wallet is in top 20
    const snapshotRows = await db
      .prepare(
        `SELECT hs.mint, hs.observed_at, t.symbol, t.name, s.price_usd, s.liquidity_usd, r.risk_score
         FROM holder_snapshots hs
         JOIN tokens t ON t.mint = hs.mint
         LEFT JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = hs.mint ORDER BY observed_at DESC LIMIT 1)
         LEFT JOIN risk_assessments r ON r.id = (SELECT id FROM risk_assessments y WHERE y.mint = hs.mint ORDER BY assessed_at DESC LIMIT 1)
         WHERE hs.top_holders_json LIKE '%' || ? || '%'
         LIMIT 20`
      )
      .bind(walletAddress)
      .all<any>();

    const tokensInvolved = [
      ...(activities.results || []).map(a => ({
        mint: a.mint,
        symbol: a.symbol || "UNKNOWN",
        name: a.name || "Unknown",
        activityType: a.activity_type,
        observedAt: a.observed_at,
        currentPriceUsd: a.price_usd,
        liquidityUsd: a.liquidity_usd,
        riskScore: a.risk_score,
        isRuggedOrCollapsed: Boolean(a.liquidity_usd != null && a.liquidity_usd < 2000),
      })),
      ...(snapshotRows.results || []).map(s => ({
        mint: s.mint,
        symbol: s.symbol || "UNKNOWN",
        name: s.name || "Unknown",
        activityType: "large_holder",
        observedAt: s.observed_at,
        currentPriceUsd: s.price_usd,
        liquidityUsd: s.liquidity_usd,
        riskScore: s.risk_score,
        isRuggedOrCollapsed: Boolean(s.liquidity_usd != null && s.liquidity_usd < 2000),
      })),
    ];

    // Deduplicate by mint
    const uniqueTokens = Array.from(
      new Map(tokensInvolved.map(item => [item.mint, item])).values()
    );

    // Relationships
    const relRows = await db
      .prepare(
        `SELECT * FROM wallet_relationships
         WHERE wallet_a = ? OR wallet_b = ?
         ORDER BY confidence_score DESC LIMIT 20`
      )
      .bind(walletAddress, walletAddress)
      .all<any>();

    const relationships: WalletRelationship[] = (relRows.results || []).map(r => {
      let ev: any = {};
      try {
        ev = JSON.parse(r.evidence_json);
      } catch {
        ev = {};
      }
      return {
        walletA: r.wallet_a,
        walletB: r.wallet_b,
        relationshipType: r.relationship_type,
        confidenceScore: r.confidence_score,
        evidence: ev,
      };
    });

    return {
      wallet: wallet || { address: walletAddress, reputation_category: "unknown", reputation_score: 50 },
      tokensInvolved: uniqueTokens,
      relationships,
    };
  }

  /**
   * Identify wallet clusters based on shared funding or co-investing in multiple tokens
   */
  static async detectWalletClusters(db: D1Database, mint: string): Promise<WalletRelationship[]> {
    const holders = await db
      .prepare("SELECT top_holders_json FROM holder_snapshots WHERE mint = ? ORDER BY observed_at DESC LIMIT 1")
      .bind(mint)
      .first<any>();

    if (!holders) return [];

    let list: WalletHolderRecord[] = [];
    try {
      list = JSON.parse(holders.top_holders_json || "[]");
    } catch {
      list = [];
    }

    const clusters: WalletRelationship[] = [];
    const nonPoolHolders = list.filter(h => !h.isPoolOrVault).slice(0, 8);

    for (let i = 0; i < nonPoolHolders.length; i++) {
      for (let j = i + 1; j < nonPoolHolders.length; j++) {
        const wA = nonPoolHolders[i].address;
        const wB = nonPoolHolders[j].address;

        // Check if both wallets appear in snapshots of other tokens
        const sharedTokens = await db
          .prepare(
            `SELECT COUNT(DISTINCT mint) as count FROM holder_snapshots
             WHERE top_holders_json LIKE '%' || ? || '%' AND top_holders_json LIKE '%' || ? || '%'`
          )
          .bind(wA, wB)
          .first<any>();

        const count = Number(sharedTokens?.count) || 0;
        if (count >= 2) {
          const confidence = Math.min(95, 40 + count * 20);
          const rel: WalletRelationship = {
            walletA: wA,
            walletB: wB,
            relationshipType: "coordinated_buy",
            confidenceScore: confidence,
            evidence: {
              commonTxsCount: count,
              description: `Wallets co-hold top positions in ${count} distinct Solana tokens`,
            },
          };
          clusters.push(rel);

          await db
            .prepare(
              `INSERT OR REPLACE INTO wallet_relationships (id, wallet_a, wallet_b, relationship_type, confidence_score, evidence_json)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(id(), wA, wB, rel.relationshipType, rel.confidenceScore, JSON.stringify(rel.evidence))
            .run();
        }
      }
    }

    return clusters;
  }
}
