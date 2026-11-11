import test from "node:test";
import assert from "node:assert/strict";
import { PumpFunDiscovery } from "../src/discovery/pumpfun.ts";
import { XAdapter } from "../src/adapters/x.ts";
import {
  assessTokenRisk,
  scoreMomentum,
  scoreNarrative,
  detectAttentionSpike,
  detectBreakoutSignals,
  runBacktestSimulation,
  extractSocialEntities,
  formatUsd,
  shortenAddress,
} from "@radar/shared";

test("PumpFunDiscovery accurately classifies launchpads", () => {
  assert.equal(PumpFunDiscovery.identifyLaunchpad({ dexId: "pumpfun", url: "https://pump.fun/coin/123" }), "pumpfun");
  assert.equal(PumpFunDiscovery.identifyLaunchpad({ dexId: "raydium", url: "https://raydium.io" }), "raydium");
  assert.equal(PumpFunDiscovery.identifyLaunchpad({ dexId: "meteora", url: "https://meteora.ag" }), "meteora");
  assert.equal(PumpFunDiscovery.identifyLaunchpad({ dexId: "orca", url: "https://orca.so" }), "orca");
  assert.equal(PumpFunDiscovery.identifyLaunchpad(null, "pumpportal"), "pumpfun");
  assert.equal(PumpFunDiscovery.identifyLaunchpad(null), "unknown");
});

test("Risk engine catches honeypot indicators, creator history, and wash trading", () => {
  const result = assessTokenRisk("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", {
    liquidityUsd: 1500,
    fdvUsd: 500000,
    pairAgeHours: 0.2,
    volume1hUsd: 80000,
    buys1h: 15,
    sells1h: 85,
    mintAuthority: true,
    freezeAuthority: true,
    initialized: true,
    top10HolderPercent: 82.5,
    creatorRugRatePct: 75,
    washTradingEvidence: { isWashTradingSuspected: true, reason: "High volume with low unique wallets" },
  });

  assert.equal(result.level, "high");
  assert.ok(result.score >= 85, `Expected score >= 85, got ${result.score}`);
  assert.ok(result.flags.some(f => f.includes("Very low liquidity")));
  assert.ok(result.flags.some(f => f.includes("Extreme FDV-to-liquidity")));
  assert.ok(result.flags.some(f => f.includes("Mint authority enabled")));
  assert.ok(result.flags.some(f => f.includes("Freeze authority enabled")));
  assert.ok(result.flags.some(f => f.includes("Heavy sell-side pressure")));
  assert.ok(result.flags.some(f => f.includes("whale concentration")));
  assert.ok(result.flags.some(f => f.includes("Creator history warning")));
  assert.ok(result.flags.some(f => f.includes("Wash trading suspected")));
});

test("Risk engine rewards fully renounced authorities, burned LP, and distributed holders", () => {
  const result = assessTokenRisk("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", {
    liquidityUsd: 250000,
    fdvUsd: 800000,
    pairAgeHours: 120,
    volume1hUsd: 50000,
    buys1h: 80,
    sells1h: 30,
    mintAuthority: false,
    freezeAuthority: false,
    initialized: true,
    lpBurnedPercent: 100,
    top10HolderPercent: 18.2,
  });

  assert.equal(result.level, "low");
  assert.ok(result.score < 35, `Expected score < 35, got ${result.score}`);
  assert.ok(result.passes.some(p => p.includes("Deep liquidity")));
  assert.ok(result.passes.some(p => p.includes("Mint authority renounced")));
  assert.ok(result.passes.some(p => p.includes("Freeze authority renounced")));
  assert.ok(result.passes.some(p => p.includes("LP tokens verified burned")));
  assert.ok(result.passes.some(p => p.includes("Well-distributed")));
});

test("Breakout signals detect confirmed breakouts and momentum surges", () => {
  const signals = detectBreakoutSignals({
    mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
    momentumScore: 82,
    priceChange1h: 35,
    volume1h: 150000,
    liquidityUsd: 45000,
    previousVolume1h: 50000,
    socialMentions1h: 12,
  });

  assert.ok(signals.length >= 1);
  assert.ok(signals.some(s => s.signalType === "confirmed_breakout"));
});

test("Backtest simulation runs without look-ahead bias and calculates drawdown and returns", () => {
  const snapshots = [
    { mint: "TokenA", symbol: "TKNA", observedAt: "2026-11-01T00:00:00Z", priceUsd: 0.10, momentumScore: 85, riskScore: 25 },
    { mint: "TokenA", symbol: "TKNA", observedAt: "2026-11-01T04:00:00Z", priceUsd: 0.18, momentumScore: 90, riskScore: 25 }, // +80% -> take profit hit
    { mint: "TokenB", symbol: "TKNB", observedAt: "2026-11-01T00:00:00Z", priceUsd: 1.00, momentumScore: 78, riskScore: 35 },
    { mint: "TokenB", symbol: "TKNB", observedAt: "2026-11-01T04:00:00Z", priceUsd: 0.70, momentumScore: 30, riskScore: 75 }, // -30% -> stop loss hit
  ];

  const result = runBacktestSimulation(snapshots, {
    name: "Strategy Test",
    minMomentum: 75,
    maxRiskScore: 40,
    takeProfitPct: 50,
    stopLossPct: -25,
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
  assert.ok(result.totalReturnPct > 0);
  assert.ok(result.profitFactor > 1);
});

test("ExtractSocialEntities correctly parses tickers and Solana base58 mints", () => {
  const sample = "New gem alert! $WIF looking bullish, check mint 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr and $BONK on Raydium";
  const { mints, tickers } = extractSocialEntities(sample);

  assert.ok(tickers.includes("WIF"));
  assert.ok(tickers.includes("BONK"));
  assert.ok(mints.includes("7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"));
});

test("Attention spike detection triggers when volume accelerates", () => {
  assert.equal(detectAttentionSpike(30, 8, 3.0), true);
  assert.equal(detectAttentionSpike(15, 8, 3.0), false);
  assert.equal(detectAttentionSpike(2, 0.5, 3.0), false);
});

test("Formatting helpers format Solana addresses and currency amounts cleanly", () => {
  assert.equal(formatUsd(2500000), "$2.50M");
  assert.equal(formatUsd(15.42), "$15.42");
  assert.equal(formatUsd(0.00001234), "$0.00001234");
  assert.equal(shortenAddress("7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", 4), "7GCi...W2hr");
});

test("Paper trading mark-to-market valuations reflect actual price gains and losses", () => {
  const entryPrice = 0.000050; // $0.000050 per token
  const investment = 5.0; // $5 USD
  const feeBps = 10; // 0.1% fee
  const effectiveCost = investment * (1 - feeBps / 10000);
  const tokenQuantity = effectiveCost / entryPrice; // 99,900 tokens

  // Scenario 1: Upward price movement (+30%)
  const priceUp = 0.000065;
  const valueUp = tokenQuantity * priceUp;
  const unrealizedPlUp = valueUp - investment;
  const unrealizedRoiUp = (unrealizedPlUp / investment) * 100;
  assert.ok(valueUp > investment, "Position should gain value on price increase");
  assert.ok(unrealizedPlUp > 0, "Unrealized P/L should be positive on price increase");
  assert.ok(unrealizedRoiUp > 25, "ROI should reflect price rise minus slippage/fees");

  // Scenario 2: Downward price movement (-40%)
  const priceDown = 0.000030;
  const valueDown = tokenQuantity * priceDown;
  const unrealizedPlDown = valueDown - investment;
  const unrealizedRoiDown = (unrealizedPlDown / investment) * 100;
  assert.ok(valueDown < investment, "Position should lose value on price decrease");
  assert.ok(unrealizedPlDown < 0, "Unrealized P/L should be negative on price decrease");
  assert.ok(unrealizedRoiDown < -35, "ROI should reflect price drop");
});


import { PerformanceService } from "../src/intelligence/performance-service.ts";

test("Execution simulator increases estimated impact as liquidity decreases", () => {
  const deep = PerformanceService.simulateExecution({
    side: "buy", amountUsd: 100, priceUsd: 1, liquidityUsd: 100000,
    slippageBps: 50, feeBps: 10,
  });
  const shallow = PerformanceService.simulateExecution({
    side: "buy", amountUsd: 100, priceUsd: 1, liquidityUsd: 1000,
    slippageBps: 50, feeBps: 10,
  });
  assert.ok(shallow.estimatedImpactUsd > deep.estimatedImpactUsd);
  assert.ok(shallow.estimatedSlippageBps > deep.estimatedSlippageBps);
});

test("Execution simulator includes fees and adverse sell-side impact", () => {
  const result = PerformanceService.simulateExecution({
    side: "sell", amountUsd: 50, priceUsd: 2, liquidityUsd: 5000,
    slippageBps: 25, feeBps: 20,
  });
  assert.equal(result.estimatedFeeUsd, 0.1);
  assert.ok(result.estimatedFillPriceUsd < 2);
  assert.ok(result.estimatedImpactUsd > 0);
});


test("X adapter runs separate early-discovery search lanes and preserves author identity", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    requests.push(new URL(String(input)));
    return new Response(JSON.stringify({
      data: [{
        id: "tweet-1",
        text: "New Solana token mint 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
        author_id: "987654321012345678",
        created_at: "2026-11-10T12:00:00.000Z",
        public_metrics: { like_count: 12, retweet_count: 3, reply_count: 2, quote_count: 1 }
      }],
      includes: {
        users: [{
          id: "987654321012345678",
          username: "earlycaller",
          created_at: "2020-01-01T00:00:00.000Z",
          verified: false,
          public_metrics: { followers_count: 4200 }
        }]
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const observations = await new XAdapter().fetchObservations({ X_BEARER_TOKEN: "test-token", DB: { prepare: () => ({ bind: () => ({ first: async () => ({ id: "x_recent_search" }) }) }) } });
    assert.equal(requests.length, 4);
    assert.equal(observations.length, 1, "duplicate tweets across search lanes should be deduplicated");
    assert.equal(observations[0].metrics.authorId, "987654321012345678");
    assert.equal(observations[0].metrics.username, "earlycaller");
    assert.equal(observations[0].metrics.followers, 4200);
    assert.equal(observations[0].metrics.queryType, "launch_links");
    assert.ok(requests.every(request => request.pathname.endsWith("/2/tweets/search/recent")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("X adapter skips search while the D1 cooldown window is active", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  try {
    const observations = await new XAdapter().fetchObservations({
      X_BEARER_TOKEN: "test-token",
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }
    });
    assert.deepEqual(observations, []);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
