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
    lpBurnedPercent?: number | null;
    top10HolderPercent?: number | null;
    transferFeePercent?: number | null;
    creatorAddress?: string | null;
    creatorTokensLaunched?: number | null;
    creatorRugRatePct?: number | null;
    washTradingEvidence?: {
        isWashTradingSuspected: boolean;
        reason?: string;
    } | null;
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
export type WalletReputationCategory = "unknown" | "insufficient" | "established" | "suspicious";
export interface CreatorProfile {
    address: string;
    firstSeenAt: string;
    totalTokensCreated: number;
    rugCount: number;
    successfulTokens: number;
    reputationStatus: WalletReputationCategory;
    reputationScore: number;
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
    relationshipType: "shared_funder" | "frequent_transfers" | "coordinated_buy" | "coordinated_exit";
    confidenceScore: number;
    evidence: {
        sharedFundingSource?: string;
        commonTxsCount?: number;
        description: string;
    };
}
export type BreakoutSignalType = "early_attention" | "momentum_surge" | "confirmed_breakout" | "overextended" | "distribution_warning";
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
export interface BacktestConfig {
    name: string;
    minMomentum: number;
    maxRiskScore: number;
    takeProfitPct: number;
    stopLossPct: number;
    maxHoldingHours: number;
    tradeSizeUsd: number;
    initialCapitalUsd: number;
    slippageBps: number;
    feeBps: number;
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
export declare function clamp(value: number, min?: number, max?: number): number;
export declare function shortenAddress(address: string, chars?: number): string;
export declare function formatUsd(val?: number | null): string;
export declare function formatCompact(val?: number | null): string;
/** Deterministic heuristic scoring for narratives (0–100) */
export declare function scoreNarrative(input: {
    mentionGrowth: number;
    sourceCoverage: number;
    engagementAcceleration: number;
    novelty: number;
    crossPlatformSpread: number;
    persistence: number;
}): number;
/** Momentum score (0–100) based on 1h price change, turnover, and buy/sell flow */
export declare function scoreMomentum(input: {
    priceChange1h?: number | null;
    volume1h?: number | null;
    liquidity?: number | null;
    buys1h?: number | null;
    sells1h?: number | null;
}): number;
/** Evidence-based risk assessment (0–100, where higher indicates higher risk) */
export declare function assessTokenRisk(mint: string, evidence: SecurityEvidence, assessedAt?: string): RiskAssessment;
/** Check if mention velocity or volume spike warrants an alert */
export declare function detectAttentionSpike(currentMentions: number, previousAverage: number, thresholdMultiplier?: number): boolean;
/** Detect breakout conditions across volume, price, momentum and social attention */
export declare function detectBreakoutSignals(input: {
    mint: string;
    momentumScore: number;
    priceChange1h?: number | null;
    volume1h?: number | null;
    liquidityUsd?: number | null;
    previousVolume1h?: number | null;
    socialMentions1h?: number;
}): BreakoutSignal[];
/** Execute a deterministic historical backtest simulation */
export declare function runBacktestSimulation(snapshots: Array<{
    mint: string;
    symbol?: string;
    observedAt: string;
    priceUsd: number;
    momentumScore?: number;
    riskScore?: number;
}>, config: BacktestConfig): BacktestResult;
/** Extract Solana mint addresses and ticker symbols from untrusted social text */
export declare function extractSocialEntities(text: string): {
    mints: string[];
    tickers: string[];
};
export declare function alertFingerprint(kind: string, mintOrNarrativeId: string, window: string): string;
