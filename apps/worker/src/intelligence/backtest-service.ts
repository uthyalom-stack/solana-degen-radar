import type { BacktestConfig, BacktestResult } from "@radar/shared";
import { runBacktestSimulation } from "@radar/shared";

const id = () => crypto.randomUUID();

export class BacktestService {
  /**
   * Run backtest against recorded historical token snapshots in D1
   */
  static async executeBacktest(db: D1Database, config: BacktestConfig): Promise<BacktestResult> {
    const snapshots = await db
      .prepare(
        `SELECT s.mint, t.symbol, s.observed_at, s.price_usd, s.momentum_score, r.risk_score
         FROM token_snapshots s
         JOIN tokens t ON t.mint = s.mint
         LEFT JOIN risk_assessments r ON r.mint = s.mint AND r.assessed_at = s.observed_at
         WHERE s.price_usd > 0
         ORDER BY s.observed_at ASC LIMIT 1000`
      )
      .all<any>();

    const rows = (snapshots.results || []).map(r => ({
      mint: r.mint,
      symbol: r.symbol || "UNKNOWN",
      observedAt: r.observed_at,
      priceUsd: Number(r.price_usd),
      momentumScore: Number(r.momentum_score) || 50,
      riskScore: Number(r.risk_score) || 50,
    }));

    const result = runBacktestSimulation(rows, config);

    // Save run in database
    const startRange = rows[0]?.observedAt || new Date().toISOString();
    const endRange = rows[rows.length - 1]?.observedAt || new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO backtest_runs (
           id, name, strategy_config_json, dataset_range_start, dataset_range_end,
           total_trades, winning_trades, losing_trades, win_rate_pct, initial_capital_usd,
           ending_capital_usd, total_return_pct, max_drawdown_pct, profit_factor, summary_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        result.id,
        config.name,
        JSON.stringify(config),
        startRange,
        endRange,
        result.totalTrades,
        result.winningTrades,
        result.losingTrades,
        result.winRatePct,
        result.initialCapitalUsd,
        result.endingCapitalUsd,
        result.totalReturnPct,
        result.maxDrawdownPct,
        result.profitFactor,
        JSON.stringify(result.summary)
      )
      .run();

    // Save trade records
    for (const t of result.trades.slice(0, 50)) {
      await db
        .prepare(
          `INSERT INTO backtest_trades (
             id, run_id, mint, symbol, entry_time, exit_time, entry_price, exit_price,
             pnl_usd, pnl_pct, holding_hours, exit_reason, signal_type
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id(),
          result.id,
          t.mint,
          t.symbol,
          t.entryTime,
          t.exitTime,
          t.entryPrice,
          t.exitPrice,
          t.pnlUsd,
          t.pnlPct,
          t.holdingHours,
          t.exitReason,
          t.signalType
        )
        .run();
    }

    return result;
  }

  /**
   * List recent backtest runs
   */
  static async getRecentRuns(db: D1Database, limit = 10): Promise<any[]> {
    const runs = await db
      .prepare("SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT ?")
      .bind(limit)
      .all<any>();

    return (runs.results || []).map(r => {
      let config: any = {};
      let summary: any = {};
      try {
        config = JSON.parse(r.strategy_config_json);
        summary = JSON.parse(r.summary_json);
      } catch {}
      return {
        ...r,
        config,
        summary,
      };
    });
  }
}
