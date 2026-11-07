import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  scoreNarrative,
  scoreMomentum,
  assessTokenRisk,
  detectAttentionSpike,
  detectBreakoutSignals,
  runBacktestSimulation,
  extractSocialEntities,
  formatUsd,
  shortenAddress,
  alertFingerprint,
} from "../dist/index.js";

test("clamp bounds values", () => {
  assert.equal(clamp(-5), 0);
  assert.equal(clamp(45), 45);
  assert.equal(clamp(150), 100);
});

test("narrative score is deterministic and bounded", () => {
  const input = { mentionGrowth: 100, sourceCoverage: 100, engagementAcceleration: 100, novelty: 100, crossPlatformSpread: 100, persistence: 100 };
  assert.equal(scoreNarrative(input), 100);
  assert.equal(scoreNarrative({ ...input, mentionGrowth: -20 }), 70);
});

test("alert fingerprints normalize subject identifiers", () => {
  assert.equal(alertFingerprint("momentum", " SoL123 ", "2026-11-04T10"), "momentum:sol123:2026-11-04T10");
});

test("scoreMomentum calculates responsive momentum based on price and turnover", () => {
  const m1 = scoreMomentum({ priceChange1h: 50, volume1h: 100000, liquidity: 50000, buys1h: 80, sells1h: 20 });
  assert.ok(m1 > 70, `Expected high momentum, got ${m1}`);

  const m2 = scoreMomentum({ priceChange1h: -40, volume1h: 1000, liquidity: 50000, buys1h: 10, sells1h: 90 });
  assert.ok(m2 < 35, `Expected low momentum, got ${m2}`);
});

test("assessTokenRisk flags honeypot indicators, creator history, and wash trading", () => {
  const risky = assessTokenRisk("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", {
    liquidityUsd: 2000,
    fdvUsd: 250000,
    pairAgeHours: 0.5,
    mintAuthority: true,
    freezeAuthority: true,
    top10HolderPercent: 75,
    creatorRugRatePct: 80,
    washTradingEvidence: { isWashTradingSuspected: true, reason: "High volume with only 3 unique wallets" },
  });

  assert.equal(risky.level, "high");
  assert.ok(risky.score >= 80);
  assert.ok(risky.flags.some(f => f.includes("Very low liquidity")));
  assert.ok(risky.flags.some(f => f.includes("Mint authority enabled")));
  assert.ok(risky.flags.some(f => f.includes("Creator history warning")));
  assert.ok(risky.flags.some(f => f.includes("Wash trading suspected")));
});

test("detectBreakoutSignals detects confirmed breakouts and overextensions", () => {
  const breakoutSignals = detectBreakoutSignals({
    mint: "Token12345678901234567890123456789012",
    momentumScore: 88,
    priceChange1h: 45,
    volume1h: 120000,
    liquidityUsd: 50000,
    previousVolume1h: 40000,
  });

  assert.ok(breakoutSignals.some(s => s.signalType === "confirmed_breakout"));

  const overextendedSignals = detectBreakoutSignals({
    mint: "Token12345678901234567890123456789012",
    momentumScore: 92,
    priceChange1h: 220,
    volume1h: 500000,
    liquidityUsd: 80000,
  });

  assert.ok(overextendedSignals.some(s => s.signalType === "overextended"));
});

test("runBacktestSimulation executes deterministic strategy without look-ahead bias", () => {
  const snapshots = [
    { mint: "MintA", symbol: "A", observedAt: "2026-11-01T10:00:00Z", priceUsd: 1.0, momentumScore: 80, riskScore: 30 },
    { mint: "MintA", symbol: "A", observedAt: "2026-11-01T11:00:00Z", priceUsd: 1.6, momentumScore: 85, riskScore: 30 }, // +60% -> take profit hit!
    { mint: "MintB", symbol: "B", observedAt: "2026-11-01T10:00:00Z", priceUsd: 2.0, momentumScore: 75, riskScore: 25 },
    { mint: "MintB", symbol: "B", observedAt: "2026-11-01T11:00:00Z", priceUsd: 1.4, momentumScore: 40, riskScore: 70 }, // -30% -> stop loss hit!
  ];

  const result = runBacktestSimulation(snapshots, {
    name: "Momentum Breakout Test",
    minMomentum: 70,
    maxRiskScore: 40,
    takeProfitPct: 50,
    stopLossPct: -20,
    maxHoldingHours: 12,
    tradeSizeUsd: 100,
    initialCapitalUsd: 1000,
    slippageBps: 50,
    feeBps: 10,
  });

  assert.equal(result.totalTrades, 2);
  assert.equal(result.winningTrades, 1);
  assert.equal(result.losingTrades, 1);
  assert.equal(result.winRatePct, 50);
  assert.ok(result.trades.some(t => t.exitReason === "take_profit"));
  assert.ok(result.trades.some(t => t.exitReason === "stop_loss"));
});

test("extractSocialEntities identifies Solana mint addresses and $TICKERs", () => {
  const text = "Check out $BONK and $WIF! Also new launch DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 on Raydium";
  const { mints, tickers } = extractSocialEntities(text);

  assert.ok(tickers.includes("BONK"));
  assert.ok(tickers.includes("WIF"));
  assert.ok(mints.includes("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"));
});

test("detectAttentionSpike identifies sudden surges in mentions", () => {
  assert.equal(detectAttentionSpike(3, 1), false);
  assert.equal(detectAttentionSpike(25, 5), true);
  assert.equal(detectAttentionSpike(10, 8), false);
});

test("formatting helpers display correct currencies and addresses", () => {
  assert.equal(formatUsd(1234567), "$1.23M");
  assert.equal(formatUsd(0.000456), "$0.0005");
  assert.equal(shortenAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", 4), "DezX...B263");
});
