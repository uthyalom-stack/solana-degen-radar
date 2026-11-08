export type DataStatus = "available" | "unknown" | "unavailable" | "disabled" | "partial";
export type LaunchpadType = "pumpfun" | "raydium" | "meteora" | "orca" | "moonshot" | "unknown";
export type TradingMode = "simulation" | "live";
export type AlertSeverity = "info" | "warning" | "critical";

export interface SourceObservation {
  source: string;
  sourceId: string;
  observedAt: string;
  url?: string;
  text: string;
  metrics?: Record<string, number>;
  author?: string;
  platform?: string;
}

export interface NarrativeCandidate {
  id: string;
  title: string;
  keywords: string[];
  sourceCount: number;
  independentSourceCount: number;
  mentionVelocity: number;
  engagementVelocity: number;
  novelty: number;
  persistence: number;
  score?: number;
  status?: "early" | "watch" | "trending";
}

export interface TokenCandidate {
  mint: string;
  name?: string;
  symbol?: string;
  chain: "solana";
  pairAddress?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  volume5mUsd?: number;
  volume1hUsd?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  creatorAddress?: string;
  launchpad?: LaunchpadType;
  holderCount?: number;
  isMigrated?: boolean;
  migrationTarget?: string;
  lpBurnedPercent?: number;
  top10HolderPercent?: number;
  observedAt: string;
}

export interface SecurityEvidence {
  liquidityUsd?: number | null;
  fdvUsd?: number | null;
  pairAgeHours?: number | null;
  volume1hUsd?: number | null;
  buys1h?: number | null;
  sells1h?: number | null;
  mintAuthority?: boolean | null;
  freezeAuthority?: boolean | null;
  initialized?: boolean | null;
  tokenProgram?: string | null; // Tokenkeg vs Token-2022
  transferFeePercent?: number | null;
  hasTransferHook?: boolean | null;
  lpBurnedPercent?: number | null;
  top10HolderPercent?: number | null;
  isSellable?: boolean | null; // Verified via quote/swap simulation
  sellabilityStatus?: "verified_sellable" | "honeypot" | "unverified";
  creatorAddress?: string | null;
  creatorTokensLaunched?: number | null;
  creatorRugRatePct?: number | null;
  washTradingEvidence?: { isWashTradingSuspected: boolean; reason?: string } | null;
}

export interface RiskAssessment {
  mint: string;
  score: number;
  status: DataStatus;
  level: "low" | "medium" | "high";
  flags: string[];
  passes: string[];
  unknowns: string[];
  evidence: SecurityEvidence;
  assessedAt: string;
}

export interface AlertItem {
  id: string;
  fingerprint: string;
  kind: string;
  subject_id: string;
  severity: AlertSeverity;
  payload_json: string;
  created_at: string;
  delivered_at?: string | null;
}

export interface PaperPosition {
  id: string;
  portfolio_id: string;
  mint: string;
  symbol?: string;
  name?: string;
  status: "open" | "closed";
  quantity: number;
  entry_price_usd: number;
  entry_value_usd: number;
  fees_usd: number;
  opened_at: string;
  closed_at?: string | null;
  exit_price_usd?: number | null;
  realized_pnl_usd?: number | null;
  current_price_usd?: number;
  unrealized_pnl_usd?: number;
  unrealized_pnl_pct?: number;
}

export interface PaperTrade {
  id: string;
  portfolio_id: string;
  position_id?: string;
  mint: string;
  symbol?: string;
  side: "buy" | "sell";
  executed_at: string;
  reference_price_usd: number;
  simulated_price_usd: number;
  quantity: number;
  notional_usd: number;
  fees_usd: number;
  slippage_bps: number;
}

export interface PaperPortfolio {
  id: string;
  name: string;
  quote_currency: string;
  starting_balance: number;
  cash_balance: number;
  total_equity_usd: number;
  unrealized_pnl_usd: number;
  realized_pnl_usd: number;
  win_rate_pct: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  created_at: string;
  positions?: PaperPosition[];
  trades?: PaperTrade[];
}

export interface ProviderHealth {
  providerId: string;
  name: string;
  category: "market" | "social" | "rpc" | "trade";
  status: "healthy" | "degraded" | "unavailable" | "disabled" | "configured";
  latencyMs?: number;
  lastCheckedAt: string;
  details?: Record<string, unknown>;
}

// ==========================================
// 1. WALLET INTELLIGENCE & CREATOR MODELS
// ==========================================

export type WalletReputationCategory = "unknown" | "insufficient" | "established" | "suspicious";

export interface CreatorProfile {
  address: string;
  firstSeenAt: string;
  totalTokensCreated: number;
  rugCount: number;
  successfulTokens: number;
  reputationStatus: WalletReputationCategory;
  reputationScore: number; // 0-100 (100 = sterling, 0 = repeat scammer)
  evidence: {
    historyNotes?: string[];
    previousMints?: string[];
    avgLifetimeHours?: number;
  };
}

export interface WalletHolderRecord {
  address: string;
  pct: number;
  amount: number;
  isPoolOrVault: boolean;
  isCreator: boolean;
}

export interface WalletRelationship {
  walletA: string;
  walletB: string;
  relationshipType: "shared_funder" | "shared_funding" | "frequent_transfers" | "coordinated_buy" | "coordinated_exit";
  confidenceScore: number; // 0-100
  evidence: {
    sharedFundingSource?: string;
    commonTxsCount?: number;
    confirmedSharedFunding?: boolean;
    description: string;
  };
}

// ==========================================
// 2. BREAKOUT SIGNALS
// ==========================================

export type BreakoutSignalType =
  | "early_attention"
  | "momentum_surge"
  | "confirmed_breakout"
  | "overextended"
  | "distribution_warning";

export interface BreakoutSignal {
  id: string;
  mint: string;
  signalType: BreakoutSignalType;
  confidence: number;
  momentumScore: number;
  volumeAccelerationPct?: number;
  liquidityGrowthPct?: number;
  evidence: Record<string, unknown>;
  detectedAt: string;
}

// ==========================================
// 3. BACKTESTING STRATEGY & RESULTS
// ==========================================

export interface BacktestConfig {
  name: string;
  minMomentum: number;
  maxRiskScore: number;
  takeProfitPct: number; // e.g. 50%
  stopLossPct: number; // e.g. -20%
  maxHoldingHours: number; // e.g. 24h
  tradeSizeUsd: number; // e.g. $100
  initialCapitalUsd: number; // e.g. $1,000
  slippageBps: number; // e.g. 50 bps
  feeBps: number; // e.g. 10 bps (0.1%)
}

export interface BacktestTradeResult {
  id: string;
  mint: string;
  symbol: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  holdingHours: number;
  exitReason: "take_profit" | "stop_loss" | "time_expired" | "signal_exit" | "dataset_end";
  signalType: string;
}

export interface BacktestResult {
  id: string;
  name: string;
  config: BacktestConfig;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  initialCapitalUsd: number;
  endingCapitalUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  trades: BacktestTradeResult[];
  summary: {
    avgProfitPct: number;
    avgLossPct: number;
    bestTradePct: number;
    worstTradePct: number;
    avgHoldingHours: number;
  };
}

// ==========================================
// 4. LIVE SWAP & PHANTOM TRANSACTIONS
// ==========================================

export interface LiveTransactionRecord {
  signature: string;
  walletAddress: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  slippageBps: number;
  priceImpactPct?: number;
  status: "submitted" | "confirming" | "confirmed" | "failed" | "expired";
  errorMessage?: string;
  submittedAt: string;
  confirmedAt?: string;
  routePlan?: unknown;
}

// ==========================================
// 5. DETERMINISTIC SCORING & HEURISTICS
// ==========================================

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length <= chars * 2 + 2) return address || "";
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatUsd(val?: number | null): string {
  if (val == null || !Number.isFinite(val)) return "—";
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 10_000) return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (val >= 1) return `$${val.toFixed(2)}`;
  if (val >= 0.0001) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(8)}`;
}

export function formatCompact(val?: number | null): string {
  if (val == null || !Number.isFinite(val)) return "—";
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Deterministic heuristic scoring for narratives (0–100) */
export function scoreNarrative(input: {
  mentionGrowth: number;
  sourceCoverage: number;
  engagementAcceleration: number;
  novelty: number;
  crossPlatformSpread: number;
  persistence: number;
}): number {
  const normalized = {
    mentionGrowth: clamp(input.mentionGrowth),
    sourceCoverage: clamp(input.sourceCoverage),
    engagementAcceleration: clamp(input.engagementAcceleration),
    novelty: clamp(input.novelty),
    crossPlatformSpread: clamp(input.crossPlatformSpread),
    persistence: clamp(input.persistence),
  };
  return Math.round(
    normalized.mentionGrowth * 0.30 +
    normalized.sourceCoverage * 0.20 +
    normalized.engagementAcceleration * 0.15 +
    normalized.novelty * 0.10 +
    normalized.crossPlatformSpread * 0.15 +
    normalized.persistence * 0.10
  );
}

/** Momentum score (0–100) based on 1h price change, turnover, and buy/sell flow */
export function scoreMomentum(input: {
  priceChange1h?: number | null;
  volume1h?: number | null;
  liquidity?: number | null;
  buys1h?: number | null;
  sells1h?: number | null;
}): number {
  const change = input.priceChange1h ?? 0;
  const vol = input.volume1h ?? 0;
  const liq = input.liquidity ?? 0;
  const buys = input.buys1h ?? 0;
  const sells = input.sells1h ?? 0;

  const turnover = liq > 0 ? clamp((vol / liq) * 25) : 0;
  const totalTx = buys + sells;
  const buyRatio = totalTx > 0 ? clamp((buys / totalTx) * 100) : 50;

  return Math.round(
    clamp(35 + clamp(change, -50, 100) * 0.35 + turnover * 0.25 + (buyRatio - 50) * 0.20)
  );
}

/** Evidence-based risk assessment (0–100, where higher indicates higher risk) */
export function assessTokenRisk(
  mint: string,
  evidence: SecurityEvidence,
  assessedAt: string = new Date().toISOString()
): RiskAssessment {
  const flags: string[] = [];
  const passes: string[] = [];
  const unknowns: string[] = [];

  let score = 50;

  // 1. Liquidity evaluation
  const liq = evidence.liquidityUsd;
  if (liq == null) {
    unknowns.push("Liquidity unavailable");
  } else if (liq < 5_000) {
    score += 26;
    flags.push("Very low liquidity (<$5k)");
  } else if (liq < 20_000) {
    score += 14;
    flags.push("Low liquidity (<$20k)");
  } else if (liq >= 100_000) {
    score -= 12;
    passes.push("Deep liquidity (>$100k)");
  } else {
    passes.push("Moderate liquidity ($20k-$100k)");
  }

  // 2. FDV-to-Liquidity evaluation
  const fdv = evidence.fdvUsd;
  if (fdv == null) {
    unknowns.push("FDV/Market cap unavailable");
  } else if (liq != null && liq > 0) {
    const ratio = fdv / liq;
    if (ratio > 100) {
      score += 18;
      flags.push(`Extreme FDV-to-liquidity ratio (${ratio.toFixed(0)}x)`);
    } else if (ratio > 30) {
      score += 10;
      flags.push(`High FDV-to-liquidity ratio (${ratio.toFixed(1)}x)`);
    } else {
      passes.push(`Healthy FDV/Liq ratio (${ratio.toFixed(1)}x)`);
    }
  }

  // 3. Pair age evaluation
  const age = evidence.pairAgeHours;
  if (age == null) {
    unknowns.push("Pair age unavailable");
  } else if (age < 1) {
    score += 14;
    flags.push("Pair younger than 1 hour (extreme volatility window)");
  } else if (age < 24) {
    score += 6;
    flags.push("Pair younger than 24 hours");
  } else {
    passes.push("Established pair (>24h)");
  }

  // 4. Volume turnover & wash trading
  const vol = evidence.volume1hUsd;
  if (vol == null) {
    unknowns.push("1h volume unavailable");
  } else if (liq != null && liq > 0 && vol > liq * 10) {
    score += 8;
    flags.push("Unusually high volume turnover vs liquidity");
  }

  if (evidence.washTradingEvidence?.isWashTradingSuspected) {
    score += 15;
    flags.push(`Wash trading suspected: ${evidence.washTradingEvidence.reason || "High volume with abnormally low unique wallets"}`);
  }

  // 5. Sell pressure
  const buys = evidence.buys1h;
  const sells = evidence.sells1h;
  if (buys != null && sells != null && buys + sells >= 10) {
    const sellRatio = sells / (buys + sells);
    if (sellRatio > 0.75) {
      score += 12;
      flags.push(`Heavy sell-side pressure (${Math.round(sellRatio * 100)}% sells in 1h)`);
    } else if (sellRatio < 0.35) {
      passes.push(`Strong buy demand (${Math.round((1 - sellRatio) * 100)}% buys in 1h)`);
    }
  }

  // 6. Mint & Freeze Authorities & Token Program Extensions
  if (evidence.mintAuthority === null || evidence.mintAuthority === undefined) {
    unknowns.push("Mint authority not verified");
  } else if (evidence.mintAuthority) {
    score += 18;
    flags.push("Mint authority enabled (deployer can mint more tokens)");
  } else {
    score -= 8;
    passes.push("Mint authority renounced / disabled");
  }

  if (evidence.freezeAuthority === null || evidence.freezeAuthority === undefined) {
    unknowns.push("Freeze authority not verified");
  } else if (evidence.freezeAuthority) {
    score += 18;
    flags.push("Freeze authority enabled (deployer can freeze holder wallets)");
  } else {
    score -= 8;
    passes.push("Freeze authority renounced / disabled");
  }

  if (evidence.initialized === false) {
    score += 30;
    flags.push("Token mint account not initialized");
  }

  // Token-2022 Transfer Fees and Hooks
  if (evidence.transferFeePercent != null && evidence.transferFeePercent > 0) {
    score += Math.min(30, Math.round(evidence.transferFeePercent * 3));
    flags.push(`Transfer fee detected: ${evidence.transferFeePercent}% fee on transfers`);
  }
  if (evidence.hasTransferHook) {
    score += 25;
    flags.push("Token-2022 transfer hook extension detected (can restrict transfers or freeze tokens)");
  }

  // Honeypot & Sellability Verification
  if (evidence.sellabilityStatus === "honeypot" || evidence.isSellable === false) {
    score = 99; // Honeypot override
    flags.push("CRITICAL HONEYPOT: Swap simulation/quote confirms token cannot be sold");
  } else if (evidence.sellabilityStatus === "verified_sellable") {
    score -= 10;
    passes.push("Verified sellable via Jupiter quote/swap simulation");
  } else {
    unknowns.push("Sellability not verified via swap simulation");
  }

  // 7. Top 10 Holder Concentration (excluding known pools/burns)
  const top10 = evidence.top10HolderPercent;
  if (top10 != null) {
    if (top10 > 60) {
      score += 20;
      flags.push(`High whale concentration: top 10 hold ${top10.toFixed(1)}%`);
    } else if (top10 > 35) {
      score += 10;
      flags.push(`Moderate concentration: top 10 hold ${top10.toFixed(1)}%`);
    } else {
      passes.push(`Well-distributed: top 10 hold only ${top10.toFixed(1)}%`);
    }
  }

  // 8. LP Burn / Lock
  const lpBurn = evidence.lpBurnedPercent;
  if (lpBurn != null) {
    if (lpBurn >= 99) {
      score -= 10;
      passes.push("LP tokens verified burned (>99%)");
    } else if (lpBurn < 50) {
      score += 12;
      flags.push(`Low LP burn: only ${lpBurn.toFixed(1)}% verified burned/locked`);
    }
  }

  // 9. Creator history & past rug rate
  if (evidence.creatorRugRatePct != null && evidence.creatorRugRatePct > 50) {
    score += 25;
    flags.push(`Creator history warning: ${evidence.creatorRugRatePct}% of past tokens collapsed`);
  } else if (evidence.creatorTokensLaunched != null && evidence.creatorTokensLaunched > 10) {
    score += 10;
    flags.push(`Serial deployer: creator has launched ${evidence.creatorTokensLaunched} tokens`);
  }

  // Penalty for uncertainty
  if (unknowns.length > 0) {
    score += Math.min(18, unknowns.length * 3);
  }

  const finalScore = Math.round(clamp(score));
  const level: "low" | "medium" | "high" =
    finalScore >= 70 ? "high" : finalScore >= 40 ? "medium" : "low";
  const status: DataStatus = unknowns.length > 0 ? "partial" : "available";

  return {
    mint,
    score: finalScore,
    status,
    level,
    flags,
    passes,
    unknowns,
    evidence,
    assessedAt,
  };
}

/** Check if mention velocity or volume spike warrants an alert */
export function detectAttentionSpike(
  currentMentions: number,
  previousAverage: number,
  thresholdMultiplier = 3.0
): boolean {
  if (currentMentions < 5) return false;
  if (previousAverage <= 0) return currentMentions >= 8;
  return currentMentions >= previousAverage * thresholdMultiplier;
}

/** Detect breakout conditions across volume, price, momentum and social attention */
export function detectBreakoutSignals(input: {
  mint: string;
  momentumScore: number;
  priceChange1h?: number | null;
  volume1h?: number | null;
  liquidityUsd?: number | null;
  previousVolume1h?: number | null;
  socialMentions1h?: number;
}): BreakoutSignal[] {
  const signals: BreakoutSignal[] = [];
  const nowStr = new Date().toISOString();
  const momentum = input.momentumScore;
  const pChange = input.priceChange1h ?? 0;
  const vol = input.volume1h ?? 0;
  const prevVol = input.previousVolume1h ?? (vol > 0 ? vol * 0.5 : 0);
  const volAcc = prevVol > 0 ? ((vol - prevVol) / prevVol) * 100 : 0;

  // 1. Confirmed Breakout: Momentum >= 75, price +25%+, volume expansion
  if (momentum >= 75 && pChange >= 25 && volAcc >= 50 && (input.liquidityUsd ?? 0) >= 15000) {
    signals.push({
      id: `breakout-${input.mint}-${Date.now()}`,
      mint: input.mint,
      signalType: "confirmed_breakout",
      confidence: 85,
      momentumScore: momentum,
      volumeAccelerationPct: Number(volAcc.toFixed(1)),
      evidence: { priceChange1h: pChange, volume1h: vol, volumeAccelerationPct: volAcc },
      detectedAt: nowStr,
    });
  }

  // 2. Early Attention: sudden surge in social mentions before price takes off
  if ((input.socialMentions1h ?? 0) >= 8 && pChange < 15 && momentum >= 50) {
    signals.push({
      id: `early-${input.mint}-${Date.now()}`,
      mint: input.mint,
      signalType: "early_attention",
      confidence: 70,
      momentumScore: momentum,
      evidence: { mentions1h: input.socialMentions1h, priceChange1h: pChange },
      detectedAt: nowStr,
    });
  }

  // 3. Overextended: price change >150% in 1h
  if (pChange > 150) {
    signals.push({
      id: `overextended-${input.mint}-${Date.now()}`,
      mint: input.mint,
      signalType: "overextended",
      confidence: 80,
      momentumScore: momentum,
      evidence: { priceChange1h: pChange, warning: "Extreme short-term runup" },
      detectedAt: nowStr,
    });
  }

  // 4. Momentum Surge: volume acceleration > 100%
  if (volAcc > 100 && vol > 20000 && momentum >= 60) {
    signals.push({
      id: `surge-${input.mint}-${Date.now()}`,
      mint: input.mint,
      signalType: "momentum_surge",
      confidence: 75,
      momentumScore: momentum,
      volumeAccelerationPct: Number(volAcc.toFixed(1)),
      evidence: { volumeAccelerationPct: volAcc, currentVol1h: vol },
      detectedAt: nowStr,
    });
  }

  return signals;
}

/** Execute a deterministic historical backtest simulation */
export function runBacktestSimulation(
  snapshots: Array<{
    mint: string;
    symbol?: string;
    observedAt: string;
    priceUsd: number;
    momentumScore?: number;
    riskScore?: number;
  }>,
  config: BacktestConfig
): BacktestResult {
  const runId = `bt-${Date.now()}`;
  let cash = config.initialCapitalUsd;
  let peakCapital = cash;
  let maxDrawdown = 0;

  const trades: BacktestTradeResult[] = [];

  // Group snapshots by token mint and sort chronologically
  const mintMap = new Map<string, Array<{ observedAt: string; priceUsd: number; momentumScore?: number; riskScore?: number }>>();
  for (const s of snapshots) {
    if (!s.priceUsd || s.priceUsd <= 0) continue;
    const list = mintMap.get(s.mint) || [];
    list.push(s);
    mintMap.set(s.mint, list);
  }

  for (const [mint, list] of mintMap.entries()) {
    list.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

    let inPosition = false;
    let entryPrice = 0;
    let entryTime = "";
    let allocatedCapital = 0;
    let positionQty = 0;

    for (let i = 0; i < list.length; i++) {
      const snap = list[i];
      const p = snap.priceUsd;
      const momentum = snap.momentumScore ?? 50;
      const risk = snap.riskScore ?? 50;

      if (!inPosition) {
        // Entry rule: momentum above threshold and risk score below maximum
        if (momentum >= config.minMomentum && risk <= config.maxRiskScore && cash >= config.tradeSizeUsd) {
          const effectiveSlippage = config.slippageBps / 10000;
          const feeRate = config.feeBps / 10000;
          entryPrice = p * (1 + effectiveSlippage);
          allocatedCapital = config.tradeSizeUsd;
          const netUsd = allocatedCapital * (1 - feeRate);
          positionQty = netUsd / entryPrice;
          entryTime = snap.observedAt;
          cash -= allocatedCapital;
          inPosition = true;
        }
      } else {
        // Evaluate exit rules
        const holdingHours = (Date.parse(snap.observedAt) - Date.parse(entryTime)) / 3600000;
        const priceReturnPct = ((p - entryPrice) / entryPrice) * 100;

        let shouldExit = false;
        let exitReason: "take_profit" | "stop_loss" | "time_expired" | "signal_exit" = "time_expired";

        if (priceReturnPct >= config.takeProfitPct) {
          shouldExit = true;
          exitReason = "take_profit";
        } else if (priceReturnPct <= config.stopLossPct) {
          shouldExit = true;
          exitReason = "stop_loss";
        } else if (holdingHours >= config.maxHoldingHours) {
          shouldExit = true;
          exitReason = "time_expired";
        } else if (i === list.length - 1) {
          shouldExit = true;
          exitReason = "signal_exit";
        }

        if (shouldExit) {
          const effectiveSlippage = config.slippageBps / 10000;
          const feeRate = config.feeBps / 10000;
          const fillPrice = p * (1 - effectiveSlippage);
          const grossProceeds = positionQty * fillPrice;
          const netProceeds = grossProceeds * (1 - feeRate);
          const pnlUsd = netProceeds - allocatedCapital;
          const pnlPct = (pnlUsd / allocatedCapital) * 100;

          cash += netProceeds;
          trades.push({
            id: `trade-${mint}-${trades.length}`,
            mint,
            symbol: mint.slice(0, 6).toUpperCase(),
            entryTime,
            exitTime: snap.observedAt,
            entryPrice,
            exitPrice: fillPrice,
            pnlUsd: Number(pnlUsd.toFixed(2)),
            pnlPct: Number(pnlPct.toFixed(2)),
            holdingHours: Number(holdingHours.toFixed(1)),
            exitReason,
            signalType: "momentum_breakout",
          });

          if (cash > peakCapital) peakCapital = cash;
          const drawdown = ((peakCapital - cash) / peakCapital) * 100;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;

          inPosition = false;
        }
      }
    }

    // If still in position at the end of available snapshots, mark to market and close
    if (inPosition && list.length > 0) {
      const lastSnap = list[list.length - 1];
      const p = lastSnap.priceUsd;
      const holdingHours = Math.max(0.1, (Date.parse(lastSnap.observedAt) - Date.parse(entryTime)) / 3600000);
      const effectiveSlippage = config.slippageBps / 10000;
      const feeRate = config.feeBps / 10000;
      const fillPrice = p * (1 - effectiveSlippage);
      const grossProceeds = positionQty * fillPrice;
      const netProceeds = grossProceeds * (1 - feeRate);
      const pnlUsd = netProceeds - allocatedCapital;
      const pnlPct = (pnlUsd / allocatedCapital) * 100;

      cash += netProceeds;
      trades.push({
        id: `trade-${mint}-${trades.length}`,
        mint,
        symbol: mint.slice(0, 6).toUpperCase(),
        entryTime,
        exitTime: lastSnap.observedAt,
        entryPrice,
        exitPrice: fillPrice,
        pnlUsd: Number(pnlUsd.toFixed(2)),
        pnlPct: Number(pnlPct.toFixed(2)),
        holdingHours: Number(holdingHours.toFixed(1)),
        exitReason: "dataset_end",
        signalType: "momentum_breakout",
      });

      if (cash > peakCapital) peakCapital = cash;
      const drawdown = ((peakCapital - cash) / peakCapital) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      inPosition = false;
    }
  }

  const winningTrades = trades.filter(t => t.pnlUsd > 0);
  const losingTrades = trades.filter(t => t.pnlUsd < 0);
  const grossProfit = winningTrades.reduce((acc, curr) => acc + curr.pnlUsd, 0);
  const grossLoss = Math.abs(losingTrades.reduce((acc, curr) => acc + curr.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99 : 1;

  const totalReturnPct = Number((((cash - config.initialCapitalUsd) / config.initialCapitalUsd) * 100).toFixed(2));
  const winRatePct = trades.length > 0 ? Number(((winningTrades.length / trades.length) * 100).toFixed(1)) : 0;

  return {
    id: runId,
    name: config.name,
    config,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRatePct,
    initialCapitalUsd: config.initialCapitalUsd,
    endingCapitalUsd: Number(cash.toFixed(2)),
    totalReturnPct,
    maxDrawdownPct: Number(maxDrawdown.toFixed(1)),
    profitFactor,
    trades,
    summary: {
      avgProfitPct: winningTrades.length > 0 ? Number((winningTrades.reduce((a, b) => a + b.pnlPct, 0) / winningTrades.length).toFixed(1)) : 0,
      avgLossPct: losingTrades.length > 0 ? Number((losingTrades.reduce((a, b) => a + b.pnlPct, 0) / losingTrades.length).toFixed(1)) : 0,
      bestTradePct: trades.length > 0 ? Math.max(...trades.map(t => t.pnlPct)) : 0,
      worstTradePct: trades.length > 0 ? Math.min(...trades.map(t => t.pnlPct)) : 0,
      avgHoldingHours: trades.length > 0 ? Number((trades.reduce((a, b) => a + b.holdingHours, 0) / trades.length).toFixed(1)) : 0,
    },
  };
}

/** Extract Solana mint addresses and ticker symbols from untrusted social text */
export function extractSocialEntities(text: string): {
  mints: string[];
  tickers: string[];
} {
  if (!text || typeof text !== "string") return { mints: [], tickers: [] };

  const mintMatches = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
  const validMints = mintMatches.filter(m => m.length >= 32 && m.length <= 44 && !m.includes("/") && !m.includes("."));

  const tickerMatches = text.match(/\$([A-Za-z0-9_]{2,12})\b/g) || [];
  const tickers = tickerMatches.map(t => t.slice(1).toUpperCase());

  return {
    mints: Array.from(new Set(validMints)),
    tickers: Array.from(new Set(tickers)),
  };
}

export function alertFingerprint(kind: string, mintOrNarrativeId: string, window: string): string {
  return `${kind}:${mintOrNarrativeId.trim().toLowerCase()}:${window}`;
}
