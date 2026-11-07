import type { Env } from "../types";
import { detectBreakoutSignals, type BreakoutSignal } from "@radar/shared";

const id = () => crypto.randomUUID();

export class BreakoutEngine {
  /**
   * Scan tracked tokens to identify breakout signals
   */
  static async scanForBreakouts(db: D1Database): Promise<BreakoutSignal[]> {
    const tokens = await db
      .prepare(
        `SELECT t.mint, t.symbol, t.name,
           s.price_usd, s.liquidity_usd, s.volume_1h_usd, s.momentum_score,
           (SELECT volume_1h_usd FROM token_snapshots p WHERE p.mint = t.mint ORDER BY observed_at DESC LIMIT 1 OFFSET 1) prev_volume_1h,
           (SELECT price_usd FROM token_snapshots p WHERE p.mint = t.mint ORDER BY observed_at DESC LIMIT 1 OFFSET 1) prev_price_usd,
           (SELECT COUNT(*) FROM narrative_signals ns JOIN token_narratives tn ON tn.narrative_id = ns.narrative_id WHERE tn.mint = t.mint AND julianday(ns.captured_at) >= julianday('now','-1 hour')) mentions_1h
         FROM tokens t
         JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = t.mint ORDER BY observed_at DESC LIMIT 1)
         ORDER BY s.volume_1h_usd DESC LIMIT 50`
      )
      .all<any>();

    const generatedSignals: BreakoutSignal[] = [];

    for (const row of tokens.results || []) {
      const price = Number(row.price_usd) || 0;
      const prevPrice = Number(row.prev_price_usd) || price;
      const priceChange1h = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
      const vol = Number(row.volume_1h_usd) || 0;
      const prevVol = Number(row.prev_volume_1h) || (vol * 0.5);

      const signals = detectBreakoutSignals({
        mint: row.mint,
        momentumScore: Number(row.momentum_score) || 50,
        priceChange1h,
        volume1h: vol,
        liquidityUsd: Number(row.liquidity_usd) || 0,
        previousVolume1h: prevVol,
        socialMentions1h: Number(row.mentions_1h) || 0,
      });

      for (const sig of signals) {
        generatedSignals.push(sig);
        await db
          .prepare(
            `INSERT INTO breakout_signals (id, mint, signal_type, confidence, momentum_score, volume_acceleration_pct, liquidity_growth_pct, evidence_json, detected_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
          )
          .bind(
            id(),
            sig.mint,
            sig.signalType,
            sig.confidence,
            sig.momentumScore,
            sig.volumeAccelerationPct || null,
            sig.liquidityGrowthPct || null,
            JSON.stringify({ ...sig.evidence, symbol: row.symbol, name: row.name }),
            sig.detectedAt
          )
          .run();
      }
    }

    return generatedSignals;
  }

  /**
   * Fetch active breakout signals
   */
  static async getActiveSignals(db: D1Database, limit = 50): Promise<any[]> {
    const rows = await db
      .prepare(
        `SELECT bs.*, t.symbol, t.name, s.price_usd, s.liquidity_usd, s.volume_1h_usd
         FROM breakout_signals bs
         JOIN tokens t ON t.mint = bs.mint
         LEFT JOIN token_snapshots s ON s.id = (SELECT id FROM token_snapshots x WHERE x.mint = bs.mint ORDER BY observed_at DESC LIMIT 1)
         WHERE bs.status = 'active'
         ORDER BY bs.detected_at DESC LIMIT ?`
      )
      .bind(limit)
      .all<any>();

    return (rows.results || []).map(r => {
      let ev: any = {};
      try {
        ev = JSON.parse(r.evidence_json);
      } catch {
        ev = {};
      }
      return {
        ...r,
        evidence: ev,
      };
    });
  }
}
