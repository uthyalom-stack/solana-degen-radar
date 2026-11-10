"use client";

import { useCallback, useEffect, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import SpotifyPlayer from "../components/spotify-player";

type Token = {
  mint: string;
  name?: string;
  symbol?: string;
  launchpad?: string;
  creator_address?: string;
  holder_count?: number;
  is_migrated?: number;
  migration_target?: string;
  lp_burned_percent?: number;
  price_usd?: number;
  liquidity_usd?: number;
  volume_1h_usd?: number;
  volume_5m_usd?: number;
  market_cap_usd?: number;
  fdv_usd?: number;
  momentum_score?: number;
  risk_score?: number;
  risk_status?: string;
  flags_json?: string;
  unknowns_json?: string;
  evidence_json?: string;
  matched_narratives?: string;
  top10_holder_percent?: number;
  observed_at?: string;
};

type Alert = {
  id: string;
  kind: string;
  subject_id: string;
  severity: "info" | "warning" | "critical";
  payload_json: string;
  created_at: string;
  delivered_at?: string | null;
};

type Narrative = {
  id: string;
  title: string;
  narrative_score: number;
  status: string;
  mentions_24h: number;
  sources_24h: number;
  last_seen_at: string;
};

type SocialEvent = {
  id: string;
  source: string;
  source_id: string;
  observed_at: string;
  url?: string;
  text_content: string;
  metrics_json?: string;
};

type Position = {
  id: string;
  mint: string;
  symbol?: string;
  name?: string;
  status: "open" | "closed";
  quantity: number;
  entry_value_usd: number;
  entry_price_usd: number;
  current_price_usd?: number;
  unrealized_pnl_usd?: number;
  unrealized_pnl_pct?: number;
  realized_pnl_usd?: number;
};

type Portfolio = {
  id: string;
  name: string;
  cash_balance: number;
  starting_balance: number;
  total_equity_usd: number;
  unrealized_pnl_usd: number;
  realized_pnl_usd: number;
  win_rate_pct: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  positions: Position[];
  trades: Array<{
    id: string;
    side: string;
    mint: string;
    symbol?: string;
    executed_at: string;
    simulated_price_usd: number;
    notional_usd: number;
    fees_usd: number;
  }>;
};

type ProviderHealth = {
  providerId: string;
  name: string;
  category: string;
  status: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
};

type BreakoutSignal = {
  id: string;
  mint: string;
  symbol?: string;
  name?: string;
  signal_type: string;
  confidence: number;
  momentum_score: number;
  volume_acceleration_pct?: number;
  liquidity_growth_pct?: number;
  evidence: Record<string, unknown>;
  detected_at: string;
  price_usd?: number;
};

type BacktestRun = {
  id: string;
  name: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate_pct: number;
  initial_capital_usd: number;
  ending_capital_usd: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  profit_factor: number;
  summary: Record<string, number>;
};

type Overview = {
  mode: string;
  supportsLiveTrading: boolean;
  walletSupported: string;
  counts: {
    tokens: number;
    narratives: number;
    alertsToday: number;
    openPositions: number;
  };
  portfolio: {
    cash_balance: number;
    starting_balance: number;
    total_equity_usd: number;
  };
  tokens: Token[];
  recentRuns: Array<{ id: number; job_name: string; status: string; started_at: string; finished_at?: string }>;
  providers: Record<string, string>;
};

const API = process.env.NEXT_PUBLIC_RADAR_API_URL?.replace(/\/$/, "") || "";

const money = (n?: number | null) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `$${num.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.0001) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(8)}`;
};

const compact = (n?: number | null) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toString();
};

const parseList = (value?: string) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : [];
  } catch {
    return [];
  }
};

// Client-side authentication token support (configured via localStorage or environment)
function getStoredAuthSecret(): string {
  if (typeof window !== "undefined") {
    // Privileged credentials must never be compiled into the public browser bundle.
    return localStorage.getItem("radar_auth_secret") || "";
  }
  return "";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API) {
    throw new Error("Radar API is not configured. Set NEXT_PUBLIC_RADAR_API_URL to the deployed Cloudflare Worker API URL, then rebuild the web app.");
  }
  const url = `${API}${path}`;
  const secret = getStoredAuthSecret();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(secret ? { "x-radar-secret": secret } : {}),
    ...(init?.headers as Record<string, string> || {}),
  };

  // Attach idempotency key for non-idempotent state mutations
  if (init?.method && ["POST", "PUT", "DELETE"].includes(init.method.toUpperCase()) && !headers["x-idempotency-key"]) {
    headers["x-idempotency-key"] = `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  const response = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const responseText = await response.text();
  let data: any;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    const preview = responseText.replace(/\\s+/g, " ").slice(0, 180);
    if (contentType.includes("text/html") || /^<!doctype html|^<html/i.test(responseText.trim())) {
      throw new Error(`Radar API returned an HTML page instead of JSON (HTTP ${response.status}). Check NEXT_PUBLIC_RADAR_API_URL and the Cloudflare Worker route. Response: ${preview}`);
    }
    throw new Error(`Radar API returned invalid JSON (HTTP ${response.status}). Response: ${preview}`);
  }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

export default function Home() {
  const [tradingMode, setTradingMode] = useState<"simulation" | "live">("simulation");
  const [tab, setTab] = useState<
    | "overview"
    | "discovery"
    | "launches"
    | "trending"
    | "wallets"
    | "narratives"
    | "risk"
    | "breakouts"
    | "paper"
    | "live_swap"
    | "portfolio"
    | "alerts"
    | "backtesting"
    | "providers"
    | "settings"
  >("overview");

  // State collections
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [narratives, setNarratives] = useState<Narrative[]>([]);
  const [socialEvents, setSocialEvents] = useState<SocialEvent[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [providersHealth, setProvidersHealth] = useState<ProviderHealth[]>([]);
  const [breakoutSignals, setBreakoutSignals] = useState<BreakoutSignal[]>([]);
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([]);
  const [discoveryCandidates, setDiscoveryCandidates] = useState<any[]>([]);
  const [discoverySources, setDiscoverySources] = useState<any[]>([]);
  const [emergingNarratives, setEmergingNarratives] = useState<any[]>([]);

  // Filtering & Search
  const [search, setSearch] = useState("");
  const [launchpadFilter, setLaunchpadFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Token Inspector Modal
  const [inspectedToken, setInspectedToken] = useState<Token | null>(null);
  const [tokenDetail, setTokenDetail] = useState<{
    history?: Array<{ observed_at: string; price_usd: number }>;
    risk?: { flags: string[]; unknowns: string[]; evidence: Record<string, unknown> };
    narratives?: Array<{ title: string; match_score: number }>;
  } | null>(null);
  const [tokenHolders, setTokenHolders] = useState<any[]>([]);

  // Wallet Intelligence View State
  const [targetWallet, setTargetWallet] = useState("");
  const [walletHistoryData, setWalletHistoryData] = useState<{
    wallet?: any;
    tokensInvolved?: any[];
    relationships?: any[];
  } | null>(null);
  const [walletSearchBusy, setWalletSearchBusy] = useState(false);

  // Paper Trade Form
  const [buyMint, setBuyMint] = useState("");
  const [buyUsd, setBuyUsd] = useState("10");
  const [resetAmount, setResetAmount] = useState("100");
  const [showResetModal, setShowResetModal] = useState(false);

  // Live Phantom & Jupiter Swap State
  const [phantomAddress, setPhantomAddress] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [liveSwapMint, setLiveSwapMint] = useState("");
  const [liveSwapAmount, setLiveSwapAmount] = useState("0.1"); // SOL
  const [liveQuote, setLiveQuote] = useState<any>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [swapExecuting, setSwapExecuting] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Backtest Strategy Form
  const [btName, setBtName] = useState("Momentum Surge Strategy");
  const [btMinMom, setBtMinMom] = useState(70);
  const [btMaxRisk, setBtMaxRisk] = useState(50);
  const [btTakeProfit, setBtTakeProfit] = useState(50);
  const [btStopLoss, setBtStopLoss] = useState(-20);
  const [btHoldingHours, setBtHoldingHours] = useState(24);
  const [btTradeSize, setBtTradeSize] = useState(100);
  const [btCapital, setBtCapital] = useState(1000);
  const [btBusy, setBtBusy] = useState(false);

  // Settings & Responsive Sidebar State
  const [customRpcUrl, setCustomRpcUrl] = useState("https://api.mainnet-beta.solana.com");
  const [slippageToleranceBps, setSlippageToleranceBps] = useState(50);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [spotifyClientId, setSpotifyClientId] = useState(process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "");
  const [envStatusData, setEnvStatusData] = useState<any>(null);

  const refresh = useCallback(async () => {
    if (!API) {
      setError("Radar API is not connected. The Vercel frontend needs NEXT_PUBLIC_RADAR_API_URL pointing to the deployed Cloudflare Worker API. No scan or live data requests can work until it is configured.");
      return;
    }
    try {
      const [o, t, a, n, p, f, pr, bks, bts, dc, ds, en] = await Promise.all([
        apiRequest<Overview>("/api/status").catch(() => null),
        apiRequest<Token[]>("/api/tokens").catch(() => []),
        apiRequest<Alert[]>("/api/alerts").catch(() => []),
        apiRequest<Narrative[]>("/api/narratives").catch(() => []),
        apiRequest<Portfolio>("/api/portfolio").catch(() => null),
        apiRequest<SocialEvent[]>("/api/social/feed").catch(() => []),
        apiRequest<ProviderHealth[]>("/api/providers").catch(() => []),
        apiRequest<BreakoutSignal[]>("/api/breakouts").catch(() => []),
        apiRequest<BacktestRun[]>("/api/backtest/runs").catch(() => []),
        apiRequest<any[]>("/api/discovery/candidates").catch(() => []),
        apiRequest<any[]>("/api/discovery/sources").catch(() => []),
        apiRequest<any[]>("/api/discovery/narratives").catch(() => []),
      ]);
      if (o) setOverview(o);
      setTokens(t);
      setAlerts(a);
      setNarratives(n);
      if (p) setPortfolio(p);
      setSocialEvents(f);
      setProvidersHealth(pr);
      setBreakoutSignals(bks);
      setBacktestRuns(bts);
      setDiscoveryCandidates(dc);
      setDiscoverySources(ds);
      setEmergingNarratives(en);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reach Radar API");
    }
  }, []);

  useEffect(() => {
    const savedSpotifyClientId = window.localStorage.getItem("radar_spotify_client_id");
    const configuredSpotifyClientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "";
    setSpotifyClientId(savedSpotifyClientId || configuredSpotifyClientId);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Connect Phantom Wallet
  async function connectPhantom() {
    try {
      const provider = (window as any).phantom?.solana || (window as any).solana;
      if (!provider || !provider.isPhantom) {
        window.open("https://phantom.app/", "_blank");
        setError("Phantom wallet extension not detected. Please install Phantom from phantom.app");
        return;
      }

      const resp = await provider.connect();
      const addr = resp.publicKey.toString();
      setPhantomAddress(addr);

      // Listen for account changes
      provider.on("accountChanged", (publicKey: any) => {
        setLiveQuote(null);
        setTxStatus(null);
        if (publicKey) {
          setPhantomAddress(publicKey.toString());
          void fetchSolBalance(publicKey.toString());
        } else {
          setPhantomAddress(null);
          setSolBalance(null);
        }
      });

      await fetchSolBalance(addr);
      setMessage(`Connected Phantom: ${addr.slice(0, 4)}...${addr.slice(-4)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect Phantom wallet");
    }
  }

  async function fetchSolBalance(addr: string) {
    try {
      const rpcRes = await fetch(customRpcUrl || "https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [addr, { commitment: "confirmed" }],
        }),
      });
      const rpcData: any = await rpcRes.json();
      const lamports = rpcData?.result?.value;
      if (lamports != null) setSolBalance(lamports / 1_000_000_000);
    } catch {
      setSolBalance(null);
    }
  }

  function disconnectPhantom() {
    try {
      const provider = (window as any).phantom?.solana || (window as any).solana;
      if (provider) provider.disconnect();
    } catch {}
    setPhantomAddress(null);
    setSolBalance(null);
    setMessage("Phantom wallet disconnected");
  }

  async function action(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      setMessage(label);
      await refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function scanMarket() {
    const r: any = await action("Market discovery scan finished", () =>
      apiRequest("/api/scan", { method: "POST", body: "{}" })
    );
    if (r?.saved != null) setMessage(`Market scan complete: ${r.saved} token snapshots saved`);
  }

  async function scanSocials() {
    const r: any = await action("Social intelligence scan finished", () =>
      apiRequest("/api/social/scan", { method: "POST", body: "{}" })
    );
    if (r?.totalObservations != null) {
      setMessage(`Social scan complete: ${r.totalObservations} events analyzed, ${r.matches || 0} narrative hits`);
    }
  }

  async function scanBreakouts() {
    const r: any = await action("Breakout signal detection scan finished", () =>
      apiRequest("/api/breakouts/scan", { method: "POST", body: "{}" })
    );
    if (Array.isArray(r)) setMessage(`Breakout scan complete: ${r.length} active breakout signals detected`);
  }

  async function paperBuy() {
    await action("Paper buy order executed", () =>
      apiRequest("/api/paper/buy", {
        method: "POST",
        body: JSON.stringify({ mint: buyMint.trim(), usd: Number(buyUsd), slippageBps: slippageToleranceBps }),
      })
    );
  }

  async function paperSell(positionId: string) {
    await action("Paper sell order executed", () =>
      apiRequest("/api/paper/sell", {
        method: "POST",
        body: JSON.stringify({ positionId, slippageBps: slippageToleranceBps }),
      })
    );
  }

  async function resetBankroll() {
    await action(`Portfolio reset to $${resetAmount}`, () =>
      apiRequest("/api/portfolio/reset", {
        method: "POST",
        body: JSON.stringify({ startingBalance: Number(resetAmount) }),
      })
    );
    setShowResetModal(false);
  }

  async function inspectToken(t: Token) {
    setInspectedToken(t);
    setTokenDetail(null);
    setTokenHolders([]);
    try {
      const [detail, holdersRes] = await Promise.all([
        apiRequest<any>(`/api/tokens/${t.mint}`),
        apiRequest<any>(`/api/tokens/${t.mint}/holders`).catch(() => ({ topHolders: [] })),
      ]);
      setTokenDetail(detail);
      setTokenHolders(holdersRes.topHolders || []);
    } catch {
      setTokenDetail({
        risk: {
          flags: parseList(t.flags_json),
          unknowns: parseList(t.unknowns_json),
          evidence: {},
        },
      });
    }
  }

  async function searchWalletHistory() {
    if (!targetWallet.trim()) return;
    setWalletSearchBusy(true);
    try {
      const data = await apiRequest<any>(`/api/wallets/${targetWallet.trim()}`);
      setWalletHistoryData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch wallet intelligence");
    } finally {
      setWalletSearchBusy(false);
    }
  }

  // Get Jupiter Swap Quote
  async function fetchJupiterQuote(outputMint: string, solAmount: number) {
    setQuoteBusy(true);
    setLiveQuote(null);
    setError("");
    try {
      const lamports = Math.floor(solAmount * 1_000_000_000);
      let decimals = 6;
      try {
        const decData = await apiRequest<any>(`/api/tokens/${outputMint}/decimals`);
        if (decData && Number.isFinite(decData.decimals)) {
          decimals = Number(decData.decimals);
        }
      } catch {
        decimals = 6;
      }
      const quote = await apiRequest<any>(
        `/api/swap/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${outputMint}&amount=${lamports}&slippageBps=${slippageToleranceBps}`
      );
      setLiveQuote({ ...quote, decimals });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch Jupiter swap quote");
      setLiveQuote(null);
    } finally {
      setQuoteBusy(false);
    }
  }

  // Execute Direct in-dashboard Swap with Phantom
  async function executeDirectSwap() {
    if (!phantomAddress || !liveQuote || !liveSwapMint) return;
    setSwapExecuting(true);
    setError("");
    setMessage("Preparing swap transaction...");
    try {
      // 1. Obtain serialized VersionedTransaction from Jupiter v6
      const { swapTransaction } = await apiRequest<{ swapTransaction: string }>(
        "/api/swap/transaction",
        {
          method: "POST",
          body: JSON.stringify({
            quoteResponse: liveQuote,
            userPublicKey: phantomAddress,
            prioritizationFeeLamports: "auto",
          }),
        }
      );

      // 2. Deserialize VersionedTransaction in browser
      const swapTransactionBuf = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      // 3. User explicitly approves signing and broadcasting in Phantom
      const provider = (window as any).phantom?.solana || (window as any).solana;
      setMessage("Please approve the swap transaction in your Phantom wallet...");
      const { signature } = await provider.signAndSendTransaction(transaction);

      setTxSignature(signature);
      setTxStatus("confirming");
      setMessage(`Transaction broadcast! Signature: ${signature.slice(0, 8)}... Tracking on-chain confirmation...`);

      // 4. Record transaction in database
      await apiRequest("/api/swap/track", {
        method: "POST",
        body: JSON.stringify({
          signature,
          walletAddress: phantomAddress,
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: liveSwapMint,
          inputAmount: Number(liveSwapAmount),
          outputAmount: Number(liveQuote.outAmount) / (10 ** (liveQuote.decimals || 6)),
          slippageBps: slippageToleranceBps,
          priceImpactPct: liveQuote.priceImpactPct,
          routePlan: liveQuote.routePlan,
        }),
      });

      // 5. Poll for confirmation
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await apiRequest<any>(`/api/swap/status/${signature}`);
        if (statusRes.status === "confirmed") {
          setTxStatus("confirmed");
          setMessage(`✅ Swap Confirmed on-chain! View on Solscan: https://solscan.io/tx/${signature}`);
          await fetchSolBalance(phantomAddress);
          break;
        }
        if (statusRes.status === "failed") {
          setTxStatus("failed");
          setError(`❌ Swap transaction failed on-chain: ${JSON.stringify(statusRes.err)}`);
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap transaction failed");
      setTxStatus("failed");
    } finally {
      setSwapExecuting(false);
    }
  }

  // Run Backtest
  async function runBacktest() {
    setBtBusy(true);
    setError("");
    try {
      const result = await apiRequest<any>("/api/backtest/run", {
        method: "POST",
        body: JSON.stringify({
          name: btName,
          minMomentum: btMinMom,
          maxRiskScore: btMaxRisk,
          takeProfitPct: btTakeProfit,
          stopLossPct: btStopLoss,
          maxHoldingHours: btHoldingHours,
          tradeSizeUsd: btTradeSize,
          initialCapitalUsd: btCapital,
          slippageBps: slippageToleranceBps,
        }),
      });
      setMessage(`Backtest "${result.name}" complete: ${result.winRatePct}% win rate, ${result.totalReturnPct}% ROI across ${result.totalTrades} historical trades!`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run backtest");
    } finally {
      setBtBusy(false);
    }
  }

  // Filtered tokens: each discovery view has its own meaningful sort order.
  const filteredTokens = tokens.filter(t => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = t.name?.toLowerCase().includes(q);
      const matchSymbol = t.symbol?.toLowerCase().includes(q);
      const matchMint = t.mint.toLowerCase().includes(q);
      if (!matchName && !matchSymbol && !matchMint) return false;
    }
    if (launchpadFilter !== "all" && t.launchpad !== launchpadFilter) return false;
    if (riskFilter !== "all" && t.risk_score == null) return false;
    if (riskFilter === "low" && Number(t.risk_score) >= 40) return false;
    if (riskFilter === "medium" && (Number(t.risk_score) < 40 || Number(t.risk_score) >= 70)) return false;
    if (riskFilter === "high" && Number(t.risk_score) < 70) return false;
    return true;
  }).sort((a, b) => {
    if (tab === "launches") return new Date(b.observed_at || 0).getTime() - new Date(a.observed_at || 0).getTime();
    if (tab === "trending") return Number(b.momentum_score ?? -1) - Number(a.momentum_score ?? -1);
    return Number(b.volume_1h_usd ?? 0) - Number(a.volume_1h_usd ?? 0);
  });

  const cash = portfolio?.cash_balance ?? overview?.portfolio?.cash_balance ?? 100;
  const equity = portfolio?.total_equity_usd ?? overview?.portfolio?.total_equity_usd ?? cash;

  const workspaceMeta: Record<string, { eyebrow: string; title: string; description: string; metrics: Array<{ label: string; value: string; detail: string }> }> = {
    overview: { eyebrow: "COMMAND CENTRE", title: "Market discovery", description: "A consolidated view of newly observed Solana assets, market momentum and risk signals.", metrics: [
      { label: "Tracked assets", value: String(tokens.length), detail: "Observed token mints" },
      { label: "Active narratives", value: String(narratives.length), detail: "Tracked social themes" },
      { label: "Open signals", value: String(breakoutSignals.length), detail: "Breakout detections" },
      { label: "Portfolio equity", value: money(equity), detail: "Current selected mode" },
    ] },
    discovery: { eyebrow: "DISCOVERY / MULTI-SOURCE INTELLIGENCE", title: "Unconventional discovery", description: "Find early candidates through raw chain activity, wallet relationships, liquidity changes, social narratives, launchpad migration and trading-route evidence.", metrics: [
      { label: "Evidence-backed candidates", value: String(discoveryCandidates.length), detail: "Stored in the discovery registry" },
      { label: "Emerging narratives", value: String(emergingNarratives.length), detail: "Terms seen before token matching" },
      { label: "Reporting sources", value: String(discoverySources.length), detail: "Includes disabled and partial sources" },
    ] },
    launches: { eyebrow: "DISCOVERY / NEW PAIRS", title: "New launch monitor", description: "Review newly discovered mints, liquidity, venue and early risk evidence before considering an entry.", metrics: [
      { label: "Observed launches", value: String(tokens.filter(t => t.launchpad).length), detail: "With venue attribution" },
      { label: "High risk", value: String(tokens.filter(t => Number(t.risk_score) >= 70).length), detail: "Risk score ≥ 70" },
      { label: "Unknown risk", value: String(tokens.filter(t => t.risk_status === "partial" || t.risk_score == null).length), detail: "Incomplete evidence" },
    ] },
    trending: { eyebrow: "DISCOVERY / MOMENTUM", title: "Trending token monitor", description: "Sort the observed market by momentum and inspect whether activity is supported by liquidity and risk evidence.", metrics: [
      { label: "Tracked assets", value: String(tokens.length), detail: "Current token set" },
      { label: "Strong momentum", value: String(tokens.filter(t => Number(t.momentum_score) >= 70).length), detail: "Momentum score ≥ 70" },
      { label: "High risk", value: String(tokens.filter(t => Number(t.risk_score) >= 70).length), detail: "Keep risk in view" },
    ] },
    breakouts: { eyebrow: "INTELLIGENCE / BREAKOUTS", title: "Breakout signal desk", description: "Inspect detected acceleration signals alongside their confidence, momentum and supporting evidence.", metrics: [
      { label: "Active signals", value: String(breakoutSignals.length), detail: "Returned by Radar API" },
      { label: "High confidence", value: String(breakoutSignals.filter(s => Number(s.confidence) >= 70).length), detail: "Confidence ≥ 70" },
      { label: "Tracked assets", value: String(tokens.length), detail: "Market context" },
    ] },
    narratives: { eyebrow: "INTELLIGENCE / SOCIAL", title: "Narrative intelligence", description: "Follow social observations and narrative momentum. Source coverage depends on configured integrations.", metrics: [
      { label: "Narratives", value: String(narratives.length), detail: "Known narrative records" },
      { label: "Social observations", value: String(socialEvents.length), detail: "Events returned by API" },
      { label: "Sources represented", value: String(new Set(socialEvents.map(e => e.source)).size), detail: "Distinct source labels" },
    ] },
    wallets: { eyebrow: "INTELLIGENCE / WALLET GRAPH", title: "Wallet investigation desk", description: "Investigate public addresses and inspect historical token involvement. Shared activity is an indicator, not proof of coordination.", metrics: [
      { label: "Wallet queried", value: walletHistoryData?.wallet ? "Loaded" : "—", detail: "Current investigation" },
      { label: "Tokens involved", value: String(walletHistoryData?.tokensInvolved?.length || 0), detail: "Returned history" },
      { label: "Relationships", value: String(walletHistoryData?.relationships?.length || 0), detail: "Returned links" },
    ] },
    risk: { eyebrow: "INTELLIGENCE / SECURITY", title: "Token risk review", description: "Prioritise verified evidence, explicit unknowns and sellability limitations. A missing check is not a clean bill of health.", metrics: [
      { label: "High risk", value: String(tokens.filter(t => Number(t.risk_score) >= 70).length), detail: "Risk score ≥ 70" },
      { label: "Partial assessments", value: String(tokens.filter(t => t.risk_status === "partial").length), detail: "Evidence incomplete" },
      { label: "Tokens reviewed", value: String(tokens.length), detail: "Current token set" },
    ] },
    paper: { eyebrow: "EXECUTION / SIMULATION", title: "Paper trading terminal", description: "Practice with virtual funds and observed market prices. Simulation results are not live trading performance.", metrics: [
      { label: "Virtual equity", value: money(equity), detail: "Current simulation value" },
      { label: "Open positions", value: String(portfolio?.positions?.filter(p => p.status === "open").length || 0), detail: "Current paper positions" },
      { label: "Recorded trades", value: String(portfolio?.total_trades || 0), detail: "Current portfolio history" },
    ] },
    live_swap: { eyebrow: "EXECUTION / PHANTOM", title: "Non-custodial swap terminal", description: "Review quotes and transaction details before signing in Phantom. Nothing is sent until you approve it in your wallet.", metrics: [
      { label: "Wallet", value: phantomAddress ? "Connected" : "Not connected", detail: "Phantom session" },
      { label: "SOL balance", value: solBalance == null ? "—" : solBalance.toFixed(4), detail: "Confirmed wallet balance" },
      { label: "Quote", value: liveQuote ? "Available" : "Not requested", detail: "Current quote state" },
    ] },
    portfolio: { eyebrow: "ANALYTICS / PERFORMANCE", title: "Portfolio analytics", description: "Review portfolio equity, realised and unrealised performance, positions and execution history.", metrics: [
      { label: "Equity", value: money(equity), detail: "Current portfolio value" },
      { label: "Realised PnL", value: money(portfolio?.realized_pnl_usd), detail: "Closed trade result" },
      { label: "Win rate", value: portfolio ? `${Number(portfolio.win_rate_pct).toFixed(1)}%` : "—", detail: "Recorded outcomes" },
    ] },
    alerts: { eyebrow: "INTELLIGENCE / ALERTS", title: "Security alert centre", description: "Review risk and system alerts with severity, timestamps and delivery status.", metrics: [
      { label: "Total alerts", value: String(alerts.length), detail: "Returned alert records" },
      { label: "Critical", value: String(alerts.filter(a => a.severity === "critical").length), detail: "Highest severity" },
      { label: "Warnings", value: String(alerts.filter(a => a.severity === "warning").length), detail: "Require review" },
    ] },
    backtesting: { eyebrow: "ANALYTICS / VALIDATION", title: "Strategy research lab", description: "Evaluate strategies against recorded historical snapshots. Results depend on data coverage and must not be treated as a forecast.", metrics: [
      { label: "Backtest runs", value: String(backtestRuns.length), detail: "Stored strategy runs" },
      { label: "Historical trades", value: String(backtestRuns.reduce((n, r) => n + Number(r.total_trades || 0), 0)), detail: "Across returned runs" },
      { label: "Data coverage", value: backtestRuns.length ? "Available" : "Not yet run", detail: "Historical result set" },
    ] },
    providers: { eyebrow: "SYSTEM / CONNECTIVITY", title: "Provider operations", description: "Check configured data providers and their reported health. Unconfigured or unknown providers are not considered healthy.", metrics: [
      { label: "Providers", value: String(providersHealth.length), detail: "Returned provider records" },
      { label: "Healthy", value: String(providersHealth.filter(p => p.status === "healthy").length), detail: "Reported healthy" },
      { label: "Degraded / down", value: String(providersHealth.filter(p => p.status !== "healthy").length), detail: "Needs attention" },
    ] },
    settings: { eyebrow: "SYSTEM / CONFIGURATION", title: "Terminal administration", description: "Review runtime configuration and integration diagnostics. Secret values must never be displayed in the browser.", metrics: [
      { label: "API endpoint", value: API ? "Configured" : "Missing", detail: "Frontend build setting" },
      { label: "Diagnostics", value: envStatusData ? "Loaded" : "Not checked", detail: "Worker environment status" },
      { label: "Spotify", value: spotifyClientId ? "Client ID set" : "Not configured", detail: "Browser playback setup" },
    ] },
  };
  const activeWorkspace = workspaceMeta[tab] || workspaceMeta.overview;
  const tokenRiskFlags = tokenDetail?.risk?.flags || [];
  const tokenRiskUnknowns = tokenDetail?.risk?.unknowns || [];
  const mintAuthorityActive = tokenRiskFlags.some(flag => /mint authority/i.test(flag));
  const mintAuthorityUnknown = tokenRiskUnknowns.some(item => /mint authority/i.test(item));
  const freezeAuthorityActive = tokenRiskFlags.some(flag => /freeze authority/i.test(flag));
  const freezeAuthorityUnknown = tokenRiskUnknowns.some(item => /freeze authority/i.test(item));
  const whaleConcentrationKnown = inspectedToken?.top10_holder_percent != null;
  const whaleConcentrationHigh = whaleConcentrationKnown && Number(inspectedToken?.top10_holder_percent) > 40;

  const navSections = [
    {
      title: "Discovery & Radar",
      items: [
        { id: "overview", label: "Overview Feed", icon: "🛰️" },
        { id: "discovery", label: "Unconventional Discovery", icon: "🧭" },
        { id: "launches", label: "New Launches", icon: "🚀" },
        { id: "trending", label: "Trending Tokens", icon: "🔥" },
      ],
    },
    {
      title: "Market Intelligence",
      items: [
        { id: "breakouts", label: "Breakout Radar", icon: "⚡", count: breakoutSignals.length },
        { id: "narratives", label: "Social & Narratives", icon: "🧠" },
        { id: "wallets", label: "Wallet Investigator", icon: "👥" },
        { id: "risk", label: "Risk & Honeypots", icon: "🛡️" },
        { id: "alerts", label: "Security Alerts", icon: "🚨", count: alerts.length },
      ],
    },
    {
      title: "Execution Terminals",
      items: [
        { id: "paper", label: "Paper Simulation", icon: "🧪" },
        { id: "live_swap", label: "Phantom Live Swaps", icon: "⚡" },
        { id: "portfolio", label: "Trade Analytics", icon: "💼" },
      ],
    },
    {
      title: "Analytics & System",
      items: [
        { id: "backtesting", label: "Strategy Backtesting", icon: "📊" },
        { id: "providers", label: "Provider Health", icon: "⚙️" },
        { id: "settings", label: "Terminal Settings", icon: "🔧" },
      ],
    },
  ];

  return (
    <div className="app-layout">
      {/* Desktop / Tablet Sidebar with mobile-open support */}
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-header">
          {!sidebarCollapsed && (
            <div className="brand">
              <span className="radar-dot" />
              DEGEN RADAR
              <span className="brand-sub">PRO</span>
            </div>
          )}
          <button
            className="collapse-btn"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? "▶" : "◀"}
          </button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((group, gIdx) => (
            <div key={gIdx}>
              {!sidebarCollapsed && <div className="nav-group-title">{group.title}</div>}
              {group.items.map(item => (
                <button
                  key={item.id}
                  className={`nav-item ${tab === item.id ? "active" : ""}`}
                  title={item.label}
                  onClick={() => { setTab(item.id as any); setMobileOpen(false); }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {!sidebarCollapsed && <span>{item.label}</span>}
                  {!sidebarCollapsed && item.count != null && (
                    <span className={`nav-badge ${item.count > 0 ? "accent" : ""}`}>{item.count}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {!sidebarCollapsed && (
          <div className="sidebar-footer">
            <div className="status-indicator">
              <span className="radar-dot" />
              <span>{API ? "Radar API: configured" : "Radar API: offline"}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="main-wrapper">
        <header className="top-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="button outline mobile-menu-toggle"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              style={{ padding: "6px 10px", fontSize: 13 }}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              ☰
            </button>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em" }}>
                {navSections.flatMap(s => s.items).find(i => i.id === tab)?.label || "Solana Terminal"}
              </div>
              <div className="muted tiny">
                Real-Time Discovery & Trading Terminal
              </div>
            </div>
          </div>

          <div className="header-actions">
            {/* Mode Switcher */}
            <div className="mode-toggle">
              <button
                className={tradingMode === "simulation" ? "active sim" : ""}
                onClick={() => setTradingMode("simulation")}
              >
                🧪 Simulation
              </button>
              <button
                className={tradingMode === "live" ? "active live" : ""}
                onClick={() => setTradingMode("live")}
              >
                ⚡ Live Mode
              </button>
            </div>

            {/* Wallet / Bankroll Indicator */}
            {tradingMode === "simulation" ? (
              <span className="pill">BANKROLL: {money(cash)}</span>
            ) : phantomAddress ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="pill live">
                  {solBalance != null ? `${solBalance.toFixed(3)} SOL` : "Phantom"} · {phantomAddress.slice(0, 4)}...{phantomAddress.slice(-4)}
                </span>
                <button className="button outline" style={{ padding: "4px 8px", fontSize: 11 }} onClick={disconnectPhantom}>
                  Disconnect
                </button>
              </div>
            ) : (
              <button className="button warning" style={{ padding: "6px 12px", fontSize: 12 }} onClick={connectPhantom}>
                Connect Phantom
              </button>
            )}

            <button className="button primary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={scanMarket} disabled={busy}>
              {busy ? "Scanning…" : "Scan Market"}
            </button>
            <button className="button outline" style={{ padding: "6px 12px", fontSize: 12 }} onClick={scanSocials} disabled={busy}>
              Scan Socials
            </button>
          </div>
        </header>

        <main className="content-body">
          <section className={`page-intro ${tab === "overview" ? "overview-hero" : "workspace-hero"}`}>
            <div className="page-intro-copy">
              <div className="page-eyebrow"><span className="radar-dot" /> {tab === "overview" ? "DEGEN RADAR / COMMAND CENTRE" : "MARKET INTELLIGENCE / WORKSPACE"}</div>
              <h1>{tab === "overview" ? <>See the signal.<br/><span>Move before the crowd.</span></> : navSections.flatMap(group => group.items).find(item => item.id === tab)?.label || "Solana Terminal"}</h1>
              <p>{tab === "overview" ? "A live intelligence workspace for discovering early launches, measuring momentum, tracing wallet behaviour and managing risk across Solana." : `Focused workspace for ${navSections.flatMap(group => group.items).find(item => item.id === tab)?.label?.toLowerCase() || "market intelligence"}. Review evidence, inspect signals and take action with clear risk context.`}</p>
              <div className="hero-capabilities"><span>ON-CHAIN SIGNALS</span><i/><span>WALLET INTELLIGENCE</span><i/><span>RISK-FIRST EXECUTION</span></div>
            </div>
            <div className="hero-radar-visual" aria-hidden="true"><div className="radar-ring ring-one"/><div className="radar-ring ring-two"/><div className="radar-ring ring-three"/><div className="radar-crosshair"/><div className="radar-sweep"/><span className="radar-center-dot"/><span className="radar-point point-a"/><span className="radar-point point-b"/><span className="radar-point point-c"/><div className="radar-readout"><b>{API ? "API CONFIGURED" : "LOCAL / OFFLINE"}</b><small>RADAR CORE · SOLANA</small></div></div>
            <div className="page-intro-status">
              <span className="status-pulse" />
              <div><strong>{API ? "API endpoint configured" : "API connection required"}</strong><small>{API ? "Waiting for live service response" : "Connect the Cloudflare Worker to load live data"}</small></div>
            </div>
          </section>
          {/* Notices */}
          {error && (
            <div className="notice error">
              <strong>Alert:</strong> {error}
            </div>
          )}
          {message && <div className="notice success">{message}</div>}

          {/* Overview command metrics */}
          {tab === "overview" && <section className="grid overview-metrics">
            <article className="panel">
              <div className="muted small">Tracked Solana Tokens</div>
              <div className="metric">{overview?.counts.tokens ?? tokens.length}</div><div className="metric-sparkline" aria-hidden="true"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div>
              <div className="muted small">Deduplicated on-chain mints</div>
            </article>

            <article className="panel">
              <div className="muted small">Active Meme Narratives</div>
              <div className="metric">{overview?.counts.narratives ?? narratives.length}</div><div className="metric-caption">Narrative velocity <b>TRACKING</b></div>
              <div className="muted small">Multi-platform viral tracking</div>
            </article>

            <article className="panel">
              <div className="muted small">Breakouts & Alerts Today</div>
              <div className="metric">{breakoutSignals.length + alerts.length}</div><div className="metric-caption">Signal feed <b>LIVE MONITOR</b></div>
              <div className="muted small">{breakoutSignals.length} breakouts · {alerts.length} risk alerts</div>
            </article>

            <article className="panel">
              <div className="muted small">
                {tradingMode === "simulation" ? "Virtual Portfolio Equity" : "Phantom Wallet SOL"}
              </div>
              <div className="metric">
                {tradingMode === "simulation"
                  ? money(equity)
                  : solBalance != null
                  ? `${solBalance.toFixed(3)} SOL`
                  : "Not Connected"}
              </div>
              <div className="muted small">
                {tradingMode === "simulation"
                  ? `Win Rate: ${portfolio?.win_rate_pct ?? 0}% · Realized: ${money(portfolio?.realized_pnl_usd || 0)}`
                  : "Mainnet-Beta Non-Custodial"}
              </div>
            </article>
          </section>}

          {/* Main Terminal Workspace */}
          <section className={`panel section terminal-workspace tab-${tab}`}>
        <div className="workspace-topline"><div><span className="workspace-kicker">{activeWorkspace.eyebrow}</span><h2>{activeWorkspace.title}</h2><p className="workspace-description">{activeWorkspace.description}</p></div><div className="workspace-meta"><span className="workspace-live-dot"/>{API ? "API CONFIGURED" : "API OFFLINE"}</div></div>
        {tab !== "overview" && <div className="workspace-metrics">{activeWorkspace.metrics.map((metric, index) => <article className="workspace-metric-card" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small><i className={`metric-accent metric-accent-${index % 3}`}/></article>)}</div>}

        {tab === "discovery" && (
          <div className="discovery-intelligence-view">
            <div className="discovery-view-intro">
              <div><span className="workspace-kicker">MULTI-SOURCE CANDIDATE REGISTRY</span><h3>Early discovery evidence</h3><p className="muted small">A discovery score measures accumulated evidence, not expected returns or a buy recommendation.</p></div>
              <span className="discovery-result-count">{discoveryCandidates.length} CANDIDATES</span>
            </div>
            <div className="workspace-metrics">
              {discoverySources.map(source => (
                <article className="workspace-metric-card" key={source.source_type}>
                  <span>{String(source.source_type).replaceAll("_"," ")}</span>
                  <strong>{String(source.status || "unknown").toUpperCase()}</strong>
                  <small>{source.items_seen || 0} observations · {source.last_success_at ? "last successful run recorded" : "no successful run recorded"}</small>
                </article>
              ))}
            </div>
            <div className="table-wrap discovery-table-wrap">
              <table>
                <thead><tr><th>Token</th><th>Discovery score</th><th>Sources</th><th>Liquidity</th><th>Risk</th><th>Last observed</th></tr></thead>
                <tbody>
                  {discoveryCandidates.map(candidate => (
                    <tr key={candidate.mint}>
                      <td><strong>{candidate.symbol || "UNKNOWN"}</strong><div className="muted small">{candidate.name || candidate.mint}</div><div className="muted tiny">{candidate.mint}</div></td>
                      <td>{candidate.discovery_score ?? 0}</td>
                      <td>{candidate.source_count ?? 0}<div className="muted tiny">{(JSON.parse(candidate.source_summary_json || "[]") as string[]).join(" · ")}</div></td>
                      <td>{candidate.liquidity_usd == null ? "—" : money(candidate.liquidity_usd)}</td>
                      <td>{candidate.risk_score == null ? "UNKNOWN" : String(candidate.risk_score) + "/100"}</td>
                      <td>{candidate.last_discovered_at ? new Date(candidate.last_discovered_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                  {!discoveryCandidates.length && <tr><td colSpan={6} className="muted">No evidence-backed candidates yet. Run a market scan and check that the Worker migration is applied.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="discovery-view-intro"><div><span className="workspace-kicker">NARRATIVE BEFORE TOKEN</span><h3>Emerging meme terms</h3></div><span className="discovery-result-count">{emergingNarratives.length} TERMS</span></div>
            <div className="table-wrap discovery-table-wrap">
              <table>
                <thead><tr><th>Term</th><th>Type</th><th>Mentions</th><th>Independent sources</th><th>Engagement</th><th>Last seen</th></tr></thead>
                <tbody>
                  {emergingNarratives.map(item => <tr key={item.normalized_term}><td><strong>{item.display_term}</strong></td><td>{item.term_type}</td><td>{item.mention_count}</td><td>{item.independent_source_count}</td><td>{Number(item.engagement_total || 0).toLocaleString()}</td><td>{item.last_seen_at ? new Date(item.last_seen_at).toLocaleString() : "—"}</td></tr>)}
                  {!emergingNarratives.length && <tr><td colSpan={6} className="muted">No emerging terms meet the current minimum-mention threshold.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SECTION 1: RADAR OVERVIEW FEED */}
        {(tab === "overview" || tab === "launches" || tab === "trending") && (
          <div>
            <div className="discovery-view-intro"><div><span className="workspace-kicker">{tab === "launches" ? "LATEST OBSERVATIONS" : tab === "trending" ? "MOMENTUM RANKING" : "LIVE TOKEN UNIVERSE"}</span><h3>{tab === "launches" ? "Recently observed launches" : tab === "trending" ? "Tokens ranked by momentum" : "Tracked Solana assets"}</h3></div><span className="discovery-result-count">{filteredTokens.length} MATCHING ASSETS</span></div>\n            <div className="filter-bar discovery-filter-bar">
              <input
                placeholder="Search symbol, name, or mint address…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="muted small">Venue:</span>
                {["all", "pumpfun", "raydium", "meteora"].map(lp => (
                  <button
                    key={lp}
                    className={`filter-pill ${launchpadFilter === lp ? "active" : ""}`}
                    onClick={() => setLaunchpadFilter(lp)}
                  >
                    {lp === "all" ? "All" : lp === "pumpfun" ? "Pump.fun" : lp.charAt(0).toUpperCase() + lp.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
                <span className="muted small">Risk Tier:</span>
                {["all", "low", "medium", "high"].map(r => (
                  <button
                    key={r}
                    className={`filter-pill ${riskFilter === r ? "active" : ""}`}
                    onClick={() => setRiskFilter(r)}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-wrap discovery-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Price</th>
                    <th>Liquidity</th>
                    <th>1h Vol / 5m</th>
                    <th>{tab === "launches" ? "Launch Momentum" : "Momentum Score"}</th>
                    <th>Risk Assessment</th>
                    <th>Whale %</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTokens.map(t => {
                    const flags = parseList(t.flags_json);
                    const unknowns = parseList(t.unknowns_json);
                    return (
                      <tr key={t.mint}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong>{t.symbol || "UNKNOWN"}</strong>
                            {t.launchpad && <span className={`badge ${t.launchpad}`}>{t.launchpad}</span>}
                          </div>
                          <div className="muted small">{t.name || "Unnamed"}</div>
                          {t.matched_narratives && (
                            <div className="muted tiny" style={{ color: "#6ee7b7" }}>
                              🏷️ {t.matched_narratives}
                            </div>
                          )}
                        </td>
                        <td>{money(t.price_usd)}</td>
                        <td>{money(t.liquidity_usd)}</td>
                        <td>
                          <div>{money(t.volume_1h_usd)}</div>
                          <div className="muted tiny">5m: {money(t.volume_5m_usd)}</div>
                        </td>
                        <td>
                          <span
                            className={`risk ${
                              Number(t.momentum_score) >= 70
                                ? "low"
                                : Number(t.momentum_score) >= 40
                                ? "mid"
                                : "high"
                            }`}
                          >
                            {t.momentum_score == null ? "UNKNOWN" : t.momentum_score}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`risk ${
                              Number(t.risk_score) >= 70
                                ? "high"
                                : Number(t.risk_score) >= 40
                                ? "mid"
                                : "low"
                            }`}
                          >
                            {t.risk_score == null ? "UNKNOWN" : `${t.risk_score}/100`} {t.risk_status === "partial" ? "· partial" : ""}
                          </span>
                          <div className="muted tiny" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {[...flags, ...unknowns].slice(0, 2).join(" · ") || (t.risk_score == null ? "Assessment unavailable" : "No recorded flags") }
                          </div>
                        </td>
                        <td>{t.top10_holder_percent != null ? `${t.top10_holder_percent.toFixed(1)}%` : "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button className="button outline" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => inspectToken(t)}>
                              🔍 Inspect
                            </button>
                            <button
                              className="button primary"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={() => {
                                if (tradingMode === "simulation") {
                                  setBuyMint(t.mint);
                                  setTab("paper");
                                } else {
                                  setLiveSwapMint(t.mint);
                                  setTab("live_swap");
                                  void fetchJupiterQuote(t.mint, Number(liveSwapAmount));
                                }
                              }}
                            >
                              ⚡ Trade
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredTokens.length === 0 && (
                <div className="empty">
                  No matching tokens discovered. Click &quot;Scan Market&quot; to discover live Solana meme tokens.
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 4: WALLET INTELLIGENCE */}
        {tab === "wallets" && (
          <div>
            <h3>Advanced Wallet Intelligence & Cross-Token History</h3>
            <p className="muted small">
              Answer the critical question: &quot;This wallet is holding or buying this token. What other tokens has it been involved in, and what happened to those tokens?&quot;
            </p>

            <div className="trade-form">
              <label>
                Wallet or Deployer Public Address
                <input
                  placeholder="Paste Solana wallet or creator address..."
                  value={targetWallet}
                  onChange={e => setTargetWallet(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={walletSearchBusy || !targetWallet.trim()} onClick={searchWalletHistory}>
                {walletSearchBusy ? "Investigating..." : "Investigate Wallet"}
              </button>
            </div>

            {walletHistoryData && (
              <div>
                <div className="portfolio-stats">
                  <div>
                    <span className="muted small">Reputation Category</span>
                    <strong style={{ textTransform: "capitalize" }}>
                      {walletHistoryData.wallet?.reputation_category || "Unknown"}
                    </strong>
                  </div>
                  <div>
                    <span className="muted small">Reputation Score</span>
                    <strong>{walletHistoryData.wallet?.reputation_score ?? "—"}{walletHistoryData.wallet?.reputation_score != null ? "/100" : ""}</strong>
                  </div>
                  <div>
                    <span className="muted small">Cross-Tokens Traded / Held</span>
                    <strong>{walletHistoryData.tokensInvolved?.length || 0} tokens</strong>
                  </div>
                </div>

                <h4>Involved Tokens & Historical Outcomes</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Activity Role</th>
                        <th>Observation Date</th>
                        <th>Current Liquidity</th>
                        <th>Risk Score</th>
                        <th>Outcome Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(walletHistoryData.tokensInvolved || []).map((t, idx) => (
                        <tr key={idx}>
                          <td>
                            <strong>{t.symbol}</strong>
                            <div className="muted tiny">{t.name}</div>
                            <div className="muted tiny font-mono">{t.mint}</div>
                          </td>
                          <td>
                            <span className="tag">{t.activityType}</span>
                          </td>
                          <td>{new Date(t.observedAt).toLocaleString()}</td>
                          <td>{money(t.liquidityUsd)}</td>
                          <td>
                            <span className={`risk ${Number(t.riskScore) >= 70 ? "high" : Number(t.riskScore) >= 40 ? "mid" : "low"}`}>
                              {t.riskScore ?? "—"}
                            </span>
                          </td>
                          <td>
                            {t.isRuggedOrCollapsed ? (
                              <span className="risk high">⚠️ Collapsed / Rugged (&lt;$2k liq)</span>
                            ) : (
                              <span className="risk low">Active / Liquid</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(!walletHistoryData.tokensInvolved || walletHistoryData.tokensInvolved.length === 0) && (
                    <div className="empty">No historical token launches or holdings recorded for this address yet.</div>
                  )}
                </div>

                {walletHistoryData.relationships && walletHistoryData.relationships.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <h4>Detected Wallet Clusters & Co-Trading Evidence</h4>
                    {(walletHistoryData.relationships || []).map((rel, i) => (
                      <div className="row" key={i}>
                        <div>
                          <strong>{rel.relationshipType.replace(/_/g, " ").toUpperCase()}</strong>
                          <div className="muted small">
                            Target: {rel.walletA === targetWallet ? rel.walletB : rel.walletA}
                          </div>
                          <div className="muted tiny">{rel.evidence?.description || "Shared coordinated wallet behavior"}</div>
                        </div>
                        <span className="risk mid">Confidence: {rel.confidenceScore}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SECTION 5: NARRATIVE INTELLIGENCE */}
        {tab === "narratives" && (
          <div>
            <h3>Emerging Meme Narratives & Clusters</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginBottom: 20 }}>
              {narratives.map(n => (
                <div className="panel" key={n.id} style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <strong>{n.title}</strong>
                    <span className={`risk ${n.narrative_score >= 70 ? "low" : n.narrative_score >= 35 ? "mid" : "high"}`}>
                      Score {n.narrative_score} · {n.status}
                    </span>
                  </div>
                  <div className="muted small" style={{ marginTop: 8 }}>
                    📈 {n.mentions_24h} mentions in 24h across {n.sources_24h} distinct sources
                  </div>
                  <div className="muted tiny" style={{ marginTop: 4 }}>
                    Last seen: {new Date(n.last_seen_at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>

            <h3>Multi-Platform Social Stream & Shilling Detection</h3>
            <div>
              {socialEvents.map(s => (
                <div className="row" key={s.id} style={{ alignItems: "flex-start", padding: "10px 0" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span className="tag">{s.source}</span>
                      <span className="muted tiny">{new Date(s.observed_at).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.4, color: "#dbeafe" }}>{s.text_content}</div>
                  </div>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-button" style={{ fontSize: 11 }}>
                      View Post ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 6: RISK ANALYSIS & HONEYPOT DETECTION */}
        {tab === "risk" && (
          <div>
            <h3>Advanced Rug-Pull & Honeypot Detection</h3>
            <p className="muted small">
              Deep contract verification: mint authorities, freeze authorities, whale concentration, Token-2022 transfer fee extensions, and verified LP burn status.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Risk Score</th>
                    <th>Mint Renounced</th>
                    <th>Freeze Renounced</th>
                    <th>LP Burn Status</th>
                    <th>Top 10 Whale %</th>
                    <th>Warning Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map(t => {
                    const flags = parseList(t.flags_json);
                    const isMintRenounced = !flags.some(f => f.includes("Mint authority enabled"));
                    const isFreezeRenounced = !flags.some(f => f.includes("Freeze authority enabled"));
                    return (
                      <tr key={t.mint}>
                        <td>
                          <strong>{t.symbol || "UNKNOWN"}</strong>
                          <div className="muted tiny font-mono">{t.mint}</div>
                        </td>
                        <td>
                          <span className={`risk ${Number(t.risk_score) >= 70 ? "high" : Number(t.risk_score) >= 40 ? "mid" : "low"}`}>
                            {t.risk_score ?? "—"}/100
                          </span>
                        </td>
                        <td>{isMintRenounced ? "✅ Renounced" : "❌ Enabled"}</td>
                        <td>{isFreezeRenounced ? "✅ Renounced" : "❌ Enabled"}</td>
                        <td>{t.lp_burned_percent != null && t.lp_burned_percent > 95 ? "🔥 Verified Burned" : "⚠️ Unverified / Unlocked"}</td>
                        <td>{t.top10_holder_percent != null ? `${t.top10_holder_percent.toFixed(1)}%` : "—"}</td>
                        <td>
                          <div className="muted tiny" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {flags.join(" · ") || "Standard checks passed"}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SECTION 7: BREAKOUT RADAR */}
        {tab === "breakouts" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <h3>Breakout & Early Attention Signals</h3>
                <p className="muted small">
                  Identifies volume acceleration surges, liquidity expansions, confirmed breakouts, and overextended distribution warnings.
                </p>
              </div>
              <button className="button primary" disabled={busy} onClick={scanBreakouts}>
                Scan Breakouts Now
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Signal Type</th>
                    <th>Confidence</th>
                    <th>Momentum</th>
                    <th>Vol Acceleration</th>
                    <th>Detected Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {breakoutSignals.map(sig => (
                    <tr key={sig.id}>
                      <td>
                        <strong>{sig.symbol || sig.mint.slice(0, 6)}</strong>
                        <div className="muted tiny font-mono">{sig.mint}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            sig.signal_type === "confirmed_breakout"
                              ? "pumpfun"
                              : sig.signal_type === "overextended"
                              ? "meteora"
                              : "raydium"
                          }`}
                        >
                          {sig.signal_type.replace(/_/g, " ").toUpperCase()}
                        </span>
                      </td>
                      <td>{sig.confidence}%</td>
                      <td>
                        <span className="risk low">{sig.momentum_score}</span>
                      </td>
                      <td>{sig.volume_acceleration_pct != null ? `+${sig.volume_acceleration_pct}%` : "—"}</td>
                      <td>{new Date(sig.detected_at).toLocaleTimeString()}</td>
                      <td>
                        <button
                          className="button primary"
                          style={{ padding: "4px 10px", fontSize: 11 }}
                          onClick={() => {
                            setBuyMint(sig.mint);
                            setLiveSwapMint(sig.mint);
                            setTab(tradingMode === "simulation" ? "paper" : "live_swap");
                          }}
                        >
                          Trade ⚡
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {breakoutSignals.length === 0 && (
                <div className="empty">No active breakout signals detected. Click &quot;Scan Breakouts Now&quot;.</div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 8: PAPER TRADING */}
        {tab === "paper" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3>Simulated Paper Trading Terminal</h3>
              <button className="button outline" style={{ fontSize: 11 }} onClick={() => setShowResetModal(true)}>
                ⚙️ Adjust Bankroll ($5, $20, $50, $100, Custom)
              </button>
            </div>

            <div className="portfolio-stats">
              <div>
                <span className="muted small">Total Virtual Equity</span>
                <strong>{money(portfolio?.total_equity_usd)}</strong>
              </div>
              <div>
                <span className="muted small">Available Cash</span>
                <strong>{money(portfolio?.cash_balance)}</strong>
              </div>
              <div>
                <span className="muted small">Realized P&L / Win Rate</span>
                <strong style={{ color: (portfolio?.realized_pnl_usd || 0) >= 0 ? "#86efac" : "#fca5a5" }}>
                  {money(portfolio?.realized_pnl_usd)} ({portfolio?.win_rate_pct || 0}% wins)
                </strong>
              </div>
            </div>

            <div className="trade-form">
              <label>
                Token Mint Address
                <input
                  placeholder="Paste Solana token mint address..."
                  value={buyMint}
                  onChange={e => setBuyMint(e.target.value)}
                />
              </label>
              <label>
                USD Amount to Simulate
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={buyUsd}
                  onChange={e => setBuyUsd(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy || !buyMint.trim()} onClick={paperBuy}>
                Simulate Buy (50 bps slippage)
              </button>
            </div>

            <h4>Open Simulated Positions</h4>
            {(portfolio?.positions || []).filter(p => p.status === "open").map(p => (
              <div className="row" key={p.id}>
                <div>
                  <strong>{p.symbol || p.mint.slice(0, 8)}</strong>
                  <div className="muted small">
                    {p.quantity.toFixed(4)} tokens · Entry: {money(p.entry_value_usd)} · Current: {money(p.quantity * (p.current_price_usd || p.entry_price_usd))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontWeight: 700, color: (p.unrealized_pnl_usd || 0) >= 0 ? "#86efac" : "#fca5a5" }}>
                    {money(p.unrealized_pnl_usd)} ({(p.unrealized_pnl_pct || 0) > 0 ? "+" : ""}{p.unrealized_pnl_pct || 0}%)
                  </span>
                  <button className="button danger" style={{ padding: "5px 12px", fontSize: 11 }} disabled={busy} onClick={() => paperSell(p.id)}>
                    Simulate Sell
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SECTION 9: DIRECT IN-DASHBOARD PHANTOM / JUPITER LIVE SWAPS */}
        {tab === "live_swap" && (
          <div>
            <h3>Direct In-Dashboard Phantom & Jupiter Live Swaps</h3>
            <p className="muted small">
              Non-custodial trading powered by Jupiter v6 Aggregator. Transactions are constructed and signed directly via your Phantom wallet.
            </p>

            {!phantomAddress ? (
              <div className="empty" style={{ background: "#0e1622", borderRadius: 12, padding: 30 }}>
                <h3>Connect Phantom Wallet to Enable Live Non-Custodial Trading</h3>
                <p className="muted small" style={{ maxWidth: 460, margin: "10px auto 20px" }}>
                  Transactions are signed securely and non-custodially directly in your Phantom extension. Degen Radar never touches private keys.
                </p>
                <button className="button warning" onClick={connectPhantom}>
                  Connect Phantom Wallet
                </button>
              </div>
            ) : (
              <div>
                <div className="trade-form">
                  <label>
                    Token Mint to Swap
                    <input
                      placeholder="Paste Solana token mint address..."
                      value={liveSwapMint}
                      onChange={e => setLiveSwapMint(e.target.value)}
                    />
                  </label>
                  <label>
                    SOL Amount (Balance: {solBalance != null ? `${solBalance.toFixed(3)} SOL` : "—"})
                    <input
                      type="number"
                      step="0.05"
                      min="0.01"
                      max={solBalance || 10}
                      value={liveSwapAmount}
                      onChange={e => setLiveSwapAmount(e.target.value)}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={quoteBusy || !liveSwapMint.trim()}
                    onClick={() => fetchJupiterQuote(liveSwapMint.trim(), Number(liveSwapAmount))}
                  >
                    {quoteBusy ? "Quoting…" : "Get Live Jupiter Quote"}
                  </button>
                </div>

                {liveQuote && (
                  <div className="panel" style={{ margin: "16px 0", border: "1px solid #3b82f6" }}>
                    <h4>Jupiter v6 Aggregator Route Review</h4>
                    <div style={{ display: "flex", justifyContent: "space-between", margin: "12px 0" }}>
                      <div>
                        <span className="muted small">Pay:</span>
                        <strong> {liveSwapAmount} SOL</strong>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span className="muted small">Receive:</span>
                        <strong style={{ color: "#86efac" }}>
                          {" "}
                          ~{compact(Number(liveQuote.outAmount) / (10 ** (liveQuote.decimals || 6)))} tokens
                        </strong>
                      </div>
                    </div>
                    <div className="muted tiny">
                      Price Impact: {liveQuote.priceImpactPct || "0"}% · Slippage: {slippageToleranceBps / 100}% · Fee Payer: {phantomAddress.slice(0, 6)}...
                    </div>

                    <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                      <button
                        className="button primary"
                        style={{ flex: 1, padding: "12px 0", fontSize: 14 }}
                        disabled={swapExecuting}
                        onClick={executeDirectSwap}
                      >
                        {swapExecuting ? "Signing & Confirming on Solana..." : "⚡ Approve & Execute Swap in Phantom"}
                      </button>
                    </div>

                    {txSignature && (
                      <div style={{ marginTop: 14 }}>
                        <span className="muted small">Status: </span>
                        <span className={`risk ${txStatus === "confirmed" ? "low" : txStatus === "failed" ? "high" : "mid"}`}>
                          {txStatus?.toUpperCase()}
                        </span>
                        <div style={{ marginTop: 6 }}>
                          <a
                            href={`https://solscan.io/tx/${txSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-button"
                          >
                            View Transaction on Solscan ↗
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="external-links" style={{ marginTop: 20 }}>
                  <span className="muted small" style={{ alignSelf: "center", marginRight: 6 }}>External Swap Interfaces:</span>
                  {liveSwapMint && (
                    <>
                      <a className="external-link" href={`https://jup.ag/swap/SOL-${liveSwapMint}`} target="_blank" rel="noopener noreferrer">
                        Jupiter Swap ↗
                      </a>
                      <a className="external-link" href={`https://raydium.io/swap/?inputMint=sol&outputMint=${liveSwapMint}`} target="_blank" rel="noopener noreferrer">
                        Raydium ↗
                      </a>
                      <a className="external-link" href={`https://dexscreener.com/solana/${liveSwapMint}`} target="_blank" rel="noopener noreferrer">
                        DEX Screener ↗
                      </a>
                      <a className="external-link" href={`https://photon-sol.tinyastro.io/en/r/@degenradar/${liveSwapMint}`} target="_blank" rel="noopener noreferrer">
                        Photon ↗
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 10: PORTFOLIO */}
        {tab === "portfolio" && (
          <div>
            <h3>Consolidated Portfolio & Trade Analytics</h3>
            <div className="portfolio-stats">
              <div>
                <span className="muted small">Simulation Cash</span>
                <strong>{money(portfolio?.cash_balance)}</strong>
              </div>
              <div>
                <span className="muted small">Total Simulation Equity</span>
                <strong>{money(portfolio?.total_equity_usd)}</strong>
              </div>
              <div>
                <span className="muted small">Live Phantom SOL</span>
                <strong>{solBalance != null ? `${solBalance.toFixed(3)} SOL` : "Not connected"}</strong>
              </div>
            </div>

            <h4>Simulation Trade Execution Log</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Token</th>
                    <th>Executed Time</th>
                    <th>Fill Price</th>
                    <th>Notional</th>
                    <th>Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {(portfolio?.trades || []).map(t => (
                    <tr key={t.id}>
                      <td>
                        <span className={`tag ${t.side === "buy" ? "low" : "high"}`}>{t.side.toUpperCase()}</span>
                      </td>
                      <td>
                        <strong>{t.symbol || t.mint.slice(0, 6)}</strong>
                        <div className="muted tiny font-mono">{t.mint}</div>
                      </td>
                      <td>{new Date(t.executed_at).toLocaleString()}</td>
                      <td>{money(t.simulated_price_usd)}</td>
                      <td>{money(t.notional_usd)}</td>
                      <td>{money(t.fees_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SECTION 11: ALERTS CENTER */}
        {tab === "alerts" && (
          <div>
            <h3>Real-Time Alerts ({alerts.length})</h3>
            {alerts.map(a => {
              let payload: any = {};
              try {
                payload = JSON.parse(a.payload_json);
              } catch {}
              return (
                <article className="alert-row" key={a.id}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong>{a.kind.replace(/-/g, " ").toUpperCase()}</strong>
                      <span className={`risk ${a.severity === "critical" ? "high" : a.severity === "warning" ? "mid" : "low"}`}>
                        {a.severity}
                      </span>
                    </div>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      Subject: {a.subject_id} · Triggered: {new Date(a.created_at).toLocaleString()}
                    </div>
                    {a.delivered_at && (
                      <div className="muted tiny" style={{ color: "#6ee7b7" }}>
                        ✓ Dispatched to Telegram at {new Date(a.delivered_at).toLocaleTimeString()}
                      </div>
                    )}
                    <pre style={{ marginTop: 6 }}>{JSON.stringify(payload, null, 2)}</pre>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* SECTION 12: BACKTESTING ENGINE */}
        {tab === "backtesting" && (
          <div>
            <h3>Deterministic Historical Backtesting Engine</h3>
            <p className="muted small">
              Evaluate trading strategies against recorded historical token snapshots without look-ahead bias.
            </p>

            <div className="panel" style={{ padding: 18, marginBottom: 20 }}>
              <h4>Strategy Parameters</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <label style={{ fontSize: 12, color: "#8b99ac" }}>
                  Strategy Name:
                  <input
                    value={btName}
                    onChange={e => setBtName(e.target.value)}
                    style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#8b99ac" }}>
                  Min Momentum Score:
                  <input
                    type="number"
                    value={btMinMom}
                    onChange={e => setBtMinMom(Number(e.target.value))}
                    style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#8b99ac" }}>
                  Max Risk Score:
                  <input
                    type="number"
                    value={btMaxRisk}
                    onChange={e => setBtMaxRisk(Number(e.target.value))}
                    style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#8b99ac" }}>
                  Take Profit (%):
                  <input
                    type="number"
                    value={btTakeProfit}
                    onChange={e => setBtTakeProfit(Number(e.target.value))}
                    style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#8b99ac" }}>
                  Stop Loss (%):
                  <input
                    type="number"
                    value={btStopLoss}
                    onChange={e => setBtStopLoss(Number(e.target.value))}
                    style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: "#8b99ac" }}>
                  Initial Capital ($):
                  <input
                    type="number"
                    value={btCapital}
                    onChange={e => setBtCapital(Number(e.target.value))}
                    style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                  />
                </label>
              </div>
              <button className="button primary" style={{ marginTop: 14 }} disabled={btBusy} onClick={runBacktest}>
                {btBusy ? "Simulating Strategy..." : "Run Historical Backtest"}
              </button>
            </div>

            <h4>Recent Backtest Strategy Runs</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Total Trades</th>
                    <th>Win Rate</th>
                    <th>Total ROI</th>
                    <th>Max Drawdown</th>
                    <th>Profit Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {backtestRuns.map(r => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        <div className="muted tiny font-mono">{r.id}</div>
                      </td>
                      <td>{r.total_trades}</td>
                      <td>
                        <strong style={{ color: r.win_rate_pct >= 50 ? "#86efac" : "#fca5a5" }}>
                          {r.win_rate_pct}%
                        </strong>
                      </td>
                      <td>
                        <strong style={{ color: r.total_return_pct >= 0 ? "#86efac" : "#fca5a5" }}>
                          {r.total_return_pct > 0 ? "+" : ""}{r.total_return_pct}%
                        </strong>
                      </td>
                      <td>{r.max_drawdown_pct}%</td>
                      <td>{r.profit_factor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {backtestRuns.length === 0 && (
                <div className="empty">No backtests executed yet. Configure parameters above and run your first backtest.</div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 13: PROVIDER HEALTH */}
        {tab === "providers" && (
          <div>
            <h3>Data Providers & Adapters Status</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
              {providersHealth.map(p => (
                <div className="panel" key={p.providerId} style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{p.name}</strong>
                    <span className={`risk ${p.status === "healthy" ? "low" : p.status === "degraded" ? "mid" : "high"}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="muted tiny" style={{ marginTop: 6 }}>Category: {p.category.toUpperCase()}</div>
                  {p.latencyMs != null && <div className="muted tiny">Latency: {p.latencyMs} ms</div>}
                  {p.details && (
                    <div className="muted tiny" style={{ marginTop: 4 }}>
                      {JSON.stringify(p.details).slice(0, 100)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 14: SETTINGS & MASSAF-STYLE ENVIRONMENT CONFIGURATION */}
        {tab === "settings" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3>System Administration & Environment Configuration</h3>
              <button
                className="button outline"
                style={{ fontSize: 11 }}
                onClick={async () => {
                  try {
                    const status = await apiRequest<any>("/api/admin/env-status");
                    setEnvStatusData(status);
                    setMessage("Environment diagnostics updated from Cloudflare Worker");
                  } catch (e) {
                    setError("Unable to retrieve environment diagnostics from backend");
                  }
                }}
              >
                🔄 Refresh Diagnostics
              </button>
            </div>

            <p className="muted small" style={{ marginBottom: 18 }}>
              System settings and provider connectivity modeled after the MASSAF administrative experience. Secret credentials remain strictly protected on the backend and are never exposed to browser JavaScript.
            </p>

            {/* Environment Overview Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14, marginBottom: 24 }}>
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Cloudflare Infrastructure</strong>
                  <span className="risk low">Operational</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">D1 Database (SQLite):</span>
                    <strong style={{ color: "#86efac" }}>Available (DB)</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">Durable Objects:</span>
                    <strong style={{ color: "#86efac" }}>Configured (PUMPPORTAL_STREAM)</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">Cron Scanner:</span>
                    <strong style={{ color: "#86efac" }}>Active (*/5 * * * *)</strong>
                  </div>
                </div>
              </div>

              <div className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Solana Infrastructure</strong>
                  <span className="risk low">Connected</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">Network Target:</span>
                    <strong>Solana Mainnet-Beta</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">RPC Provider:</span>
                    <strong>Public / Helius Key Optional</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">DexScreener API:</span>
                    <strong style={{ color: "#86efac" }}>Connected & Verified</strong>
                  </div>
                </div>
              </div>

              <div className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Security & Separation</strong>
                  <span className="risk low">Enforced</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">Admin Authentication:</span>
                    <strong>ADMIN_SECRET (Fail-closed)</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">Social Ingest Token:</span>
                    <strong>SOCIAL_INGEST_SECRET (Isolated)</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span className="muted">Telegram Webhook:</span>
                    <strong>TELEGRAM_WEBHOOK_SECRET</strong>
                  </div>
                </div>
              </div>

              <div className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Spotify Streaming Player</strong>
                  <span className="tag neutral">OAuth / Premium</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 12 }}>
                  <p className="muted tiny" style={{ margin: "0 0 8px 0" }}>
                    Connect your Spotify account to search tracks and control playback from this terminal. Requires an eligible Spotify Premium account and a registered redirect URL. Commercial playback is subject to Spotify's developer approval and terms.
                  </p>
                  <label style={{ fontSize: 11, color: "#8b99ac", display: "block" }}>
                    Spotify Developer Client ID:
                    <input
                      placeholder="Enter Client ID from developer.spotify.com"
                      value={spotifyClientId}
                      onChange={e => {
                        setSpotifyClientId(e.target.value);
                        if (typeof window !== "undefined") localStorage.setItem("radar_spotify_client_id", e.target.value);
                      }}
                      style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 6, borderRadius: 4, marginTop: 4, fontSize: 11 }}
                    />
                  </label>
                </div>
              </div>
            </div>

            <h4>Terminal Execution & RPC Parameters</h4>
            <div className="panel" style={{ padding: 18 }}>
              <label style={{ fontSize: 13, color: "#8b99ac", display: "block", marginBottom: 12 }}>
                Solana RPC Endpoint Override:
                <input
                  value={customRpcUrl}
                  onChange={e => setCustomRpcUrl(e.target.value)}
                  style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                />
              </label>

              <label style={{ fontSize: 13, color: "#8b99ac", display: "block", marginBottom: 12 }}>
                Default Slippage Tolerance (Basis Points):
                <input
                  type="number"
                  value={slippageToleranceBps}
                  onChange={e => setSlippageToleranceBps(Number(e.target.value))}
                  style={{ width: "100%", background: "#111924", border: "1px solid #283749", color: "#fff", padding: 8, borderRadius: 6, marginTop: 4 }}
                />
                <span className="muted tiny">50 bps = 0.5% · 100 bps = 1.0%</span>
              </label>

              <div className="notice info" style={{ marginTop: 14 }}>
                <strong>Trading Principles:</strong> Simulation Mode is always the default. In Live Mode, all transactions are reviewed and signed client-side via Phantom. Your private keys never touch this app.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Token Inspector Modal */}
      {inspectedToken && (
        <div className="modal-overlay" onClick={() => setInspectedToken(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h2 style={{ margin: 0 }}>
                    {inspectedToken.symbol || "UNKNOWN"} · {inspectedToken.name}
                  </h2>
                  {inspectedToken.launchpad && (
                    <span className={`badge ${inspectedToken.launchpad}`}>{inspectedToken.launchpad}</span>
                  )}
                </div>
                <div className="muted tiny font-mono" style={{ marginTop: 4 }}>
                  Mint: {inspectedToken.mint}
                </div>
              </div>
              <button className="modal-close" onClick={() => setInspectedToken(null)}>
                ×
              </button>
            </div>

            {/* Price & Metrics */}
            <div className="portfolio-stats">
              <div>
                <span className="muted small">Price USD</span>
                <strong>{money(inspectedToken.price_usd)}</strong>
              </div>
              <div>
                <span className="muted small">Liquidity</span>
                <strong>{money(inspectedToken.liquidity_usd)}</strong>
              </div>
              <div>
                <span className="muted small">1h Volume / Momentum</span>
                <strong>
                  {money(inspectedToken.volume_1h_usd)} · {inspectedToken.momentum_score ?? "—"}
                </strong>
              </div>
            </div>

            {/* Security Audit Scorecard */}
            <h3>Evidence-Based Security Audit</h3>
            <div className="audit-grid">
              <div
                className={`audit-card ${mintAuthorityActive ? "flag" : mintAuthorityUnknown || !tokenDetail ? "unknown" : "pass"}`}
              >
                <strong>Mint Authority</strong>
                <div>
                  {mintAuthorityActive ? "Active — mint authority risk detected" : mintAuthorityUnknown || !tokenDetail ? "Not verified — evidence unavailable" : "No active mint-authority flag reported"}
                </div>
              </div>

              <div
                className={`audit-card ${freezeAuthorityActive ? "flag" : freezeAuthorityUnknown || !tokenDetail ? "unknown" : "pass"}`}
              >
                <strong>Freeze Authority</strong>
                <div>
                  {freezeAuthorityActive ? "Active — freeze authority risk detected" : freezeAuthorityUnknown || !tokenDetail ? "Not verified — evidence unavailable" : "No active freeze-authority flag reported"}
                </div>
              </div>

              <div className={`audit-card ${!whaleConcentrationKnown ? "unknown" : whaleConcentrationHigh ? "flag" : "pass"}`}>
                <strong>Whale Concentration</strong>
                <div>
                  Top 10 hold: {inspectedToken.top10_holder_percent != null ? `${inspectedToken.top10_holder_percent.toFixed(1)}%` : "Not verified"}
                </div>
              </div>

              <div className={`audit-card ${inspectedToken.risk_score == null ? "unknown" : Number(inspectedToken.risk_score) >= 70 ? "flag" : "pass"}`}>
                <strong>Overall Risk Heuristic</strong>
                <div>
                  Score: {inspectedToken.risk_score ?? "—"}/100 ({inspectedToken.risk_score == null ? "UNKNOWN" : Number(inspectedToken.risk_score) >= 70 ? "HIGH" : Number(inspectedToken.risk_score) >= 40 ? "MEDIUM" : "LOW"})
                </div>
              </div>
            </div>

            {/* Top Holders Breakdown */}
            {tokenHolders.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <h4>Top Beneficial Holders (Excluding LP/Burn Pools)</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Address</th>
                        <th>Share %</th>
                        <th>Classification</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokenHolders.slice(0, 5).map((h, idx) => (
                        <tr key={idx}>
                          <td className="font-mono tiny">{h.address}</td>
                          <td>{h.pct}%</td>
                          <td>
                            <span className={`tag ${h.isPoolOrVault ? "mid" : "low"}`}>
                              {h.isPoolOrVault ? "LP Pool / Vault" : "Beneficial Whale"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* External Links */}
            <div className="external-links" style={{ marginTop: 18 }}>
              <a
                className="external-link"
                href={`https://solscan.io/token/${inspectedToken.mint}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Solscan Explorer ↗
              </a>
              <a
                className="external-link"
                href={`https://dexscreener.com/solana/${inspectedToken.mint}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                DEX Screener ↗
              </a>
              <a
                className="external-link"
                href={`https://jup.ag/swap/SOL-${inspectedToken.mint}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Jupiter Swap ↗
              </a>
              <button
                className="button primary"
                style={{ marginLeft: "auto", padding: "6px 14px", fontSize: 12 }}
                onClick={() => {
                  setBuyMint(inspectedToken.mint);
                  setLiveSwapMint(inspectedToken.mint);
                  setInspectedToken(null);
                  setTab(tradingMode === "simulation" ? "paper" : "live_swap");
                }}
              >
                Trade in Terminal ⚡
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Bankroll Modal */}
      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>Configure Simulation Bankroll</h3>
              <button className="modal-close" onClick={() => setShowResetModal(false)}>
                ×
              </button>
            </div>
            <p className="muted small">
              Reset virtual cash to your preferred testing bankroll. This closes existing simulated positions.
            </p>
            <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
              {["5", "20", "50", "100", "500"].map(amt => (
                <button
                  key={amt}
                  className={`button ${resetAmount === amt ? "primary" : "outline"}`}
                  style={{ flex: 1, padding: "8px 0" }}
                  onClick={() => setResetAmount(amt)}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 12, color: "#8b99ac" }}>
              Custom Amount (USD):
              <input
                type="number"
                min="1"
                max="100000"
                value={resetAmount}
                onChange={e => setResetAmount(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 6,
                  background: "#111924",
                  border: "1px solid #283749",
                  color: "#fff",
                  padding: 8,
                  borderRadius: 6,
                }}
              />
            </label>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button className="button danger" style={{ flex: 1 }} onClick={resetBankroll}>
                Confirm Reset
              </button>
              <button className="button outline" onClick={() => setShowResetModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

          {/* Operational Principles Footer */}
          <footer className="muted small" style={{ marginTop: 24, textAlign: "center" }}>
            Solana Degen Radar · Non-Custodial Meme Token Discovery Terminal
          </footer>
        </main>
      </div>

      <SpotifyPlayer />

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-nav-bar">
        <button
          className={`mobile-nav-btn ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          <span>🛰️</span>
          Radar
        </button>
        <button
          className={`mobile-nav-btn ${tab === "breakouts" ? "active" : ""}`}
          onClick={() => setTab("breakouts")}
        >
          <span>⚡</span>
          Breakouts
        </button>
        <button
          className={`mobile-nav-btn ${tab === "paper" ? "active" : ""}`}
          onClick={() => setTab("paper")}
        >
          <span>🧪</span>
          Paper
        </button>
        <button
          className={`mobile-nav-btn ${tab === "live_swap" ? "active" : ""}`}
          onClick={() => setTab("live_swap")}
        >
          <span>⚡</span>
          Swap
        </button>
        <button
          className={`mobile-nav-btn ${mobileDrawerOpen ? "active" : ""}`}
          onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
        >
          <span>☰</span>
          More
        </button>
      </nav>

      {/* Mobile More Drawer */}
      {mobileDrawerOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileDrawerOpen(false)}>
          <div className="mobile-drawer" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <strong>Terminal Navigation</strong>
              <button className="modal-close" onClick={() => setMobileDrawerOpen(false)}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              {navSections.flatMap(s => s.items).map(item => (
                <button
                  key={item.id}
                  className={`button ${tab === item.id ? "primary" : "outline"}`}
                  style={{ justifyContent: "flex-start", padding: "10px 12px", fontSize: 12 }}
                  onClick={() => {
                    setTab(item.id as any);
                    setMobileDrawerOpen(false);
                  }}
                >
                  <span>{item.icon}</span>
                  <span style={{ marginLeft: 6 }}>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
