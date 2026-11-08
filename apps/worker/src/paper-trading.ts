import type { Env } from "./types";
import type { PaperPortfolio, PaperPosition, PaperTrade } from "@radar/shared";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export class PaperTradingEngine {
  static async getPortfolio(db: D1Database, env: Env, sessionId = "default"): Promise<PaperPortfolio> {
    const portfolioId = sessionId === "default" ? "paper-default" : `paper-${sessionId}`;
    let row = await db.prepare("SELECT * FROM paper_portfolios WHERE id = ?").bind(portfolioId).first<any>();

    if (!row) {
      const starting = Math.max(1, Number(env.PAPER_STARTING_BALANCE) || 100);
      await db
        .prepare(
          "INSERT OR IGNORE INTO paper_portfolios (id,name,quote_currency,starting_balance,cash_balance,created_at,config_json) VALUES (?,?,?,?,?,?,?)"
        )
        .bind(
          portfolioId,
          sessionId === "default" ? "Simulation Portfolio" : `Session ${sessionId.toUpperCase()}`,
          "USD",
          starting,
          starting,
          now(),
          JSON.stringify({ defaultBankroll: starting, sessionId, slippageBps: 50, feeBps: 10 })
        )
        .run();

      row = await db.prepare("SELECT * FROM paper_portfolios WHERE id = ?").bind(portfolioId).first<any>();
    }

    const [positionsResult, tradesResult] = await Promise.all([
      db
        .prepare(
          `SELECT p.*, t.symbol, t.name, s.price_usd
           FROM paper_positions p
           JOIN tokens t ON t.mint = p.mint
           LEFT JOIN token_snapshots s ON s.id = (
             SELECT id FROM token_snapshots x WHERE x.mint = p.mint ORDER BY observed_at DESC LIMIT 1
           )
           WHERE p.portfolio_id = ?
           ORDER BY p.opened_at DESC`
        )
        .bind(portfolioId)
        .all<any>(),
      db
        .prepare(
          `SELECT pt.*, t.symbol
           FROM paper_trades pt
           LEFT JOIN tokens t ON t.mint = pt.mint
           WHERE pt.portfolio_id = ?
           ORDER BY pt.executed_at DESC LIMIT 100`
        )
        .bind(portfolioId)
        .all<any>(),
    ]);

    const positions: PaperPosition[] = [];
    let unrealizedPnlUsd = 0;
    let openPositionsValue = 0;

    for (const p of positionsResult.results || []) {
      const currentPrice = Number(p.price_usd) || p.entry_price_usd;
      const currentValue = p.status === "open" ? p.quantity * currentPrice : 0;
      const unrealizedPnl = p.status === "open" ? currentValue - p.entry_value_usd : 0;
      const unrealizedPnlPct = p.status === "open" && p.entry_value_usd > 0
        ? (unrealizedPnl / p.entry_value_usd) * 100
        : 0;

      if (p.status === "open") {
        openPositionsValue += currentValue;
        unrealizedPnlUsd += unrealizedPnl;
      }

      positions.push({
        id: p.id,
        portfolio_id: p.portfolio_id,
        mint: p.mint,
        symbol: p.symbol || "UNKNOWN",
        name: p.name || "Unknown Token",
        status: p.status,
        quantity: p.quantity,
        entry_price_usd: p.entry_price_usd,
        entry_value_usd: p.entry_value_usd,
        fees_usd: p.fees_usd || 0,
        opened_at: p.opened_at,
        closed_at: p.closed_at,
        exit_price_usd: p.exit_price_usd,
        realized_pnl_usd: p.realized_pnl_usd,
        current_price_usd: currentPrice,
        unrealized_pnl_usd: unrealizedPnl,
        unrealized_pnl_pct: Number(unrealizedPnlPct.toFixed(2)),
      });
    }

    const trades: PaperTrade[] = (tradesResult.results || []).map((t: any) => ({
      id: t.id,
      portfolio_id: t.portfolio_id,
      position_id: t.position_id,
      mint: t.mint,
      symbol: t.symbol,
      side: t.side,
      executed_at: t.executed_at,
      reference_price_usd: t.reference_price_usd,
      simulated_price_usd: t.simulated_price_usd,
      quantity: t.quantity,
      notional_usd: t.notional_usd,
      fees_usd: t.fees_usd,
      slippage_bps: t.slippage_bps,
    }));

    const closedPositions = positions.filter(p => p.status === "closed");
    const winningTrades = closedPositions.filter(p => (p.realized_pnl_usd || 0) > 0).length;
    const losingTrades = closedPositions.filter(p => (p.realized_pnl_usd || 0) < 0).length;
    const realizedPnlUsd = closedPositions.reduce((acc, curr) => acc + (curr.realized_pnl_usd || 0), 0);
    const winRatePct = closedPositions.length > 0
      ? Number(((winningTrades / closedPositions.length) * 100).toFixed(1))
      : 0;

    const totalEquityUsd = Number((row.cash_balance + openPositionsValue).toFixed(4));

    return {
      id: row.id,
      name: row.name,
      quote_currency: row.quote_currency || "USD",
      starting_balance: row.starting_balance,
      cash_balance: row.cash_balance,
      total_equity_usd: totalEquityUsd,
      unrealized_pnl_usd: Number(unrealizedPnlUsd.toFixed(4)),
      realized_pnl_usd: Number(realizedPnlUsd.toFixed(4)),
      win_rate_pct: winRatePct,
      total_trades: trades.length,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      created_at: row.created_at,
      positions,
      trades,
    };
  }

  static async resetPortfolio(db: D1Database, env: Env, bankroll?: number, sessionId = "default"): Promise<PaperPortfolio> {
    const start = Math.max(1, Math.min(100000, Number(bankroll) || Number(env.PAPER_STARTING_BALANCE) || 100));
    const portfolio = await this.getPortfolio(db, env, sessionId);

    await db.batch([
      db.prepare("DELETE FROM paper_trades WHERE portfolio_id = ?").bind(portfolio.id),
      db.prepare("DELETE FROM paper_positions WHERE portfolio_id = ?").bind(portfolio.id),
      db.prepare(
        "UPDATE paper_portfolios SET starting_balance = ?, cash_balance = ?, last_operation_id = ?, config_json = ? WHERE id = ?"
      ).bind(start, start, id(), JSON.stringify({ defaultBankroll: start, sessionId, resetAt: now() }), portfolio.id),
    ]);

    return await this.getPortfolio(db, env, sessionId);
  }

  static async buy(
    db: D1Database,
    env: Env,
    mint: string,
    usdAmount: number,
    slippageBps = 50,
    sessionId = "default",
    triggerSignal?: string
  ): Promise<{
    positionId: string;
    mint: string;
    quantity: number;
    referencePrice: number;
    simulatedFill: number;
    notionalUsd: number;
    feeUsd: number;
    slippageBps: number;
  }> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      throw new Error("Valid Solana mint address required");
    }
    if (!Number.isFinite(usdAmount) || usdAmount < 0.01) {
      throw new Error("USD amount must be at least $0.01");
    }

    const portfolio = await this.getPortfolio(db, env, sessionId);
    if (portfolio.cash_balance < usdAmount) {
      throw new Error(`Insufficient virtual cash: available $${portfolio.cash_balance.toFixed(2)}, required $${usdAmount.toFixed(2)}`);
    }

    const token = await db.prepare("SELECT mint, symbol, name FROM tokens WHERE mint = ?").bind(mint).first<any>();
    if (!token) {
      throw new Error("Token not tracked in Radar yet; discover it first");
    }

    const snap = await db
      .prepare("SELECT price_usd FROM token_snapshots WHERE mint = ? ORDER BY observed_at DESC LIMIT 1")
      .bind(mint)
      .first<any>();

    const price = Number(snap?.price_usd);
    if (!price || price <= 0) {
      throw new Error("No recent market price available for simulation");
    }

    const feeRate = 0.001; // 0.1% fee
    const feeUsd = usdAmount * feeRate;
    const effectiveSlippage = Math.max(10, Math.min(500, slippageBps));
    const simulatedFill = price * (1 + effectiveSlippage / 10000);
    const quantity = (usdAmount - feeUsd) / simulatedFill;

    const positionId = id();
    const operationId = id();
    const tradeTime = now();

    const results = await db.batch([
      db.prepare(
        "UPDATE paper_portfolios SET cash_balance = cash_balance - ?, last_operation_id = ? WHERE id = ? AND cash_balance >= ?"
      ).bind(usdAmount, operationId, portfolio.id, usdAmount),
      db.prepare(
        `INSERT INTO paper_positions (id, portfolio_id, mint, status, quantity, entry_price_usd, entry_value_usd, fees_usd, opened_at)
         SELECT ?, ?, ?, 'open', ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM paper_portfolios WHERE id = ? AND last_operation_id = ?)`
      ).bind(positionId, portfolio.id, mint, quantity, simulatedFill, usdAmount, feeUsd, tradeTime, portfolio.id, operationId),
      db.prepare(
        `INSERT INTO paper_trades (id, portfolio_id, position_id, mint, side, executed_at, reference_price_usd, simulated_price_usd, quantity, notional_usd, fees_usd, slippage_bps)
         SELECT ?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM paper_portfolios WHERE id = ? AND last_operation_id = ?)`
      ).bind(id(), portfolio.id, positionId, mint, tradeTime, price, simulatedFill, quantity, usdAmount, feeUsd, effectiveSlippage, portfolio.id, operationId),
    ]);

    if (!results[0]?.meta.changes) {
      throw new Error("Atomic cash deduction failed (concurrent trade or balance change)");
    }

    return {
      positionId,
      mint,
      quantity,
      referencePrice: price,
      simulatedFill,
      notionalUsd: usdAmount,
      feeUsd,
      slippageBps: effectiveSlippage,
    };
  }

  static async sell(
    db: D1Database,
    env: Env,
    positionId: string,
    slippageBps = 50,
    sessionId = "default",
    portion = 1.0 // 1.0 = full sell, 0.5 = 50% partial exit, 0.25 = 25% partial exit
  ): Promise<{
    positionId: string;
    mint: string;
    proceedsUsd: number;
    realizedPnlUsd: number;
    simulatedFill: number;
    remainingQuantity: number;
  }> {
    const portfolio = await this.getPortfolio(db, env, sessionId);
    const position = await db
      .prepare("SELECT * FROM paper_positions WHERE id = ? AND portfolio_id = ? AND status = 'open'")
      .bind(positionId, portfolio.id)
      .first<any>();

    if (!position) {
      throw new Error("Open paper position not found or already closed");
    }

    const snap = await db
      .prepare("SELECT price_usd FROM token_snapshots WHERE mint = ? ORDER BY observed_at DESC LIMIT 1")
      .bind(position.mint)
      .first<any>();

    const price = Number(snap?.price_usd);
    if (!price || price <= 0) {
      throw new Error("No recent market price available to simulate sell fill");
    }

    const effectiveSlippage = Math.max(10, Math.min(500, slippageBps));
    const simulatedFill = price * (1 - effectiveSlippage / 10000);
    const grossProceeds = position.quantity * simulatedFill;
    const feeUsd = grossProceeds * 0.001;
    const netProceeds = grossProceeds - feeUsd;
    const realizedPnl = netProceeds - position.entry_value_usd;

    const operationId = id();
    const tradeTime = now();

    const results = await db.batch([
      db.prepare(
        "UPDATE paper_positions SET status = 'closed', closed_at = ?, exit_price_usd = ?, realized_pnl_usd = ?, close_operation_id = ? WHERE id = ? AND portfolio_id = ? AND status = 'open'"
      ).bind(tradeTime, simulatedFill, realizedPnl, operationId, positionId, portfolio.id),
      db.prepare(
        `UPDATE paper_portfolios SET cash_balance = cash_balance + ?, last_operation_id = ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM paper_positions WHERE id = ? AND status = 'closed' AND close_operation_id = ?)`
      ).bind(netProceeds, operationId, portfolio.id, positionId, operationId),
      db.prepare(
        `INSERT INTO paper_trades (id, portfolio_id, position_id, mint, side, executed_at, reference_price_usd, simulated_price_usd, quantity, notional_usd, fees_usd, slippage_bps)
         SELECT ?, ?, ?, ?, 'sell', ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM paper_positions WHERE id = ? AND status = 'closed' AND close_operation_id = ?)`
      ).bind(id(), portfolio.id, positionId, position.mint, tradeTime, price, simulatedFill, position.quantity, grossProceeds, feeUsd, effectiveSlippage, positionId, operationId),
    ]);

    if (!results[0]?.meta.changes) {
      throw new Error("Position closing failed (it may have been closed concurrently)");
    }

    return {
      positionId,
      mint: position.mint,
      proceedsUsd: netProceeds,
      realizedPnlUsd: realizedPnl,
      simulatedFill,
      remainingQuantity: 0,
    };
  }
}
