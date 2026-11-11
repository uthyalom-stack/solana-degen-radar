"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_RADAR_API_URL?.replace(/\/$/, "") || "";
async function request<T=any>(path:string, init?:RequestInit):Promise<T> {
  if (!API) throw new Error("Radar API is not configured");
  const secret = typeof window !== "undefined" ? window.localStorage.getItem("radar_auth_secret") || "" : "";
  const response=await fetch(API+path,{...init,headers:{"content-type":"application/json",...(secret?{"x-radar-secret":secret}:{}),...(init?.headers||{})},credentials:"include",cache:"no-store"});
  const raw=await response.text();
  let data:any;
  try { data=raw?JSON.parse(raw):null; } catch { throw new Error("API returned a non-JSON response"); }
  if(!response.ok) throw new Error(data?.error||"Request failed");
  return data as T;
}
const money=(v:any)=>Number.isFinite(Number(v))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:4}).format(Number(v)):"—";

export default function PerformanceWorkspace() {
  const [performance,setPerformance]=useState<any>(null);
  const [journal,setJournal]=useState<any[]>([]);
  const [wallets,setWallets]=useState<any[]>([]);
  const [replay,setReplay]=useState<any[]>([]);
  const [risk,setRisk]=useState<any>({enabled:true,dailyLossLimitUsd:"",maxOpenPositions:"",maxPositionSizeUsd:"",cooldownMinutes:0});
  const [draft,setDraft]=useState<any>({title:"",thesis:"",entryReason:"",exitReason:"",lessons:""});
  const [execution,setExecution]=useState<any>({side:"buy",amountUsd:25,priceUsd:0.00001,liquidityUsd:10000,slippageBps:50,feeBps:10});
  const [estimate,setEstimate]=useState<any>(null);
  const [strategies,setStrategies]=useState<any[]>([]);
  const [strategyConfig,setStrategyConfig]=useState<any>({minMomentum:70,maxRiskScore:50,takeProfitPct:50,stopLossPct:-20,maxHoldingHours:24,tradeSizeUsd:25,initialCapitalUsd:250,slippageBps:50,feeBps:10});
  const [backtestResult,setBacktestResult]=useState<any>(null);
  const [alerts,setAlerts]=useState<any[]>([]);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  async function load() {
    setLoading(true);setError("");
    try {
      const [p,j,w,r,rs,s,a]=await Promise.all([
        request("/api/performance"),request("/api/journal"),request("/api/wallet-leaderboard"),
        request("/api/signals/replay?limit=100"),request("/api/risk-controls"),request("/api/strategies"),request("/api/alerts")
      ]);
      setPerformance(p);setJournal(j);setWallets(w);setReplay(r);setRisk(rs);setStrategies(s);setAlerts(a);setStatus("Workspace refreshed from the Worker API.");
    } catch(e:any) {setError(e.message||"Unable to load workspace");}
    finally {setLoading(false);}
  }
  async function saveJournal() {
    try {await request("/api/journal",{method:"POST",body:JSON.stringify(draft)});setDraft({title:"",thesis:"",entryReason:"",exitReason:"",lessons:""});setJournal(await request("/api/journal"));setStatus("Journal entry saved.");}
    catch(e:any){setError(e.message);}
  }
  async function saveRisk() {
    try {setRisk(await request("/api/risk-controls",{method:"POST",body:JSON.stringify(risk)}));setStatus("Paper risk limits saved and enforced for new paper buys.");}
    catch(e:any){setError(e.message);}
  }
  async function recordActivity() {
    try {await request("/api/activity/record",{method:"POST",body:JSON.stringify({activityType:"research_review"})});setPerformance(await request("/api/performance"));setStatus("Today's research activity recorded.");}
    catch(e:any){setError(e.message);}
  }
  async function simulate() {
    try {setEstimate(await request("/api/execution/simulate",{method:"POST",body:JSON.stringify(execution)}));}
    catch(e:any){setError(e.message);}
  }
  async function saveStrategy() {
    try {await request("/api/strategies",{method:"POST",body:JSON.stringify({name:"My saved strategy",description:"Saved reusable backtest configuration",config:strategyConfig})});setStrategies(await request("/api/strategies"));setStatus("Strategy configuration saved.");}
    catch(e:any){setError(e.message);}
  }
  async function runStrategy() {
    try {setBacktestResult(await request("/api/backtest/run",{method:"POST",body:JSON.stringify({name:"Performance Centre Strategy",...strategyConfig})}));setStatus("Backtest completed using available historical snapshots. Review dataset coverage before drawing conclusions.");}
    catch(e:any){setError(e.message);}
  }

  return <div className="workspace-stack">
    <section className="panel" style={{padding:20,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div><h2>Performance & Risk Centre</h2><p className="muted small">Consistency, trade outcomes, research and portfolio protection. Paper performance is separate from live wallet activity.</p></div>
        <button className="button primary" disabled={loading} onClick={load}>{loading?"Loading…":"Refresh workspace"}</button>
      </div>
      {error&&<p className="risk high" role="alert">{error}</p>}{status&&<p className="muted small" role="status">{status}</p>}
      <div className="grid overview-metrics" style={{marginTop:16}}>
        <div className="metric-card"><span>Showing-up streak</span><strong>{performance?.activityStreak?.current??"—"} days</strong><small>Longest: {performance?.activityStreak?.longest??"—"} days</small></div>
        <div className="metric-card"><span>Trade streak</span><strong>{performance?.tradeStreak?.current??"—"} {performance?.tradeStreak?.currentType==="win"?"wins":performance?.tradeStreak?.currentType==="loss"?"losses":""}</strong><small>Best win: {performance?.tradeStreak?.longestWinning??"—"} · Best loss: {performance?.tradeStreak?.longestLosing??"—"}</small></div>
        <div className="metric-card"><span>Closed paper trades</span><strong>{performance?.tradeStats?.total??"—"}</strong><small>{performance?.tradeStats?.wins??0} wins · {performance?.tradeStats?.losses??0} losses</small></div>
        <div className="metric-card"><span>Realised paper PnL</span><strong>{performance?money(performance.tradeStats.realizedPnlUsd):"—"}</strong><small>Net closed-position results</small></div>
      </div>
      <button className="button outline" style={{marginTop:12}} onClick={recordActivity}>Record today's research session</button>
    </section>

    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h3>1 · Strategy journal</h3><p className="muted small">Capture the thesis, entry and exit reasoning, and lessons learned. Journal notes do not alter trade results.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:10}}>
        <input placeholder="Entry title" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/>
        <textarea placeholder="Trade thesis" value={draft.thesis} onChange={e=>setDraft({...draft,thesis:e.target.value})}/>
        <textarea placeholder="Why enter?" value={draft.entryReason} onChange={e=>setDraft({...draft,entryReason:e.target.value})}/>
        <textarea placeholder="Why exit?" value={draft.exitReason} onChange={e=>setDraft({...draft,exitReason:e.target.value})}/>
        <textarea placeholder="Lessons learned" value={draft.lessons} onChange={e=>setDraft({...draft,lessons:e.target.value})}/>
      </div>
      <button className="button primary" style={{marginTop:10}} onClick={saveJournal}>Save journal entry</button>
      <div className="table-wrap" style={{marginTop:14}}><table><thead><tr><th>Entry</th><th>Thesis</th><th>Lessons</th><th>Updated</th></tr></thead><tbody>{journal.map(x=><tr key={x.id}><td>{x.title}</td><td>{x.thesis||"—"}</td><td>{x.lessons||"—"}</td><td>{x.updated_at?new Date(x.updated_at).toLocaleString():"—"}</td></tr>)}</tbody></table>{!journal.length&&<div className="empty">Refresh to load journal entries.</div>}</div>
    </section>

    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h3>2 · Historical signal replay</h3><p className="muted small">Replays recorded price, momentum and risk snapshots. It does not invent missing historical signals or imply future performance.</p>
      <div className="table-wrap"><table><thead><tr><th>Token</th><th>Observed at</th><th>Price</th><th>Momentum</th><th>Risk</th></tr></thead><tbody>{replay.slice(0,50).map((x,i)=><tr key={x.mint+"-"+x.observed_at+"-"+i}><td>{x.symbol||x.mint?.slice(0,8)}</td><td>{new Date(x.observed_at).toLocaleString()}</td><td>{money(x.price_usd)}</td><td>{x.momentum_score??"—"}</td><td>{x.risk_score??"Unknown"}</td></tr>)}</tbody></table>{!replay.length&&<div className="empty">Refresh to load recorded signals.</div>}</div>
    </section>

    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h3>3 · Wallet activity leaderboard</h3><p className="muted small">Ranked by tracked token and transaction activity only. It is not a profitability ranking or verified smart-money score.</p>
      <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Wallet</th><th>Tokens</th><th>Transactions</th><th>Last observed</th></tr></thead><tbody>{wallets.slice(0,40).map(x=><tr key={x.wallet_address}><td>{x.rank}</td><td className="font-mono">{x.wallet_address}</td><td>{x.tokens_observed}</td><td>{x.observed_transactions}</td><td>{x.last_seen_at?new Date(x.last_seen_at).toLocaleString():"—"}</td></tr>)}</tbody></table>{!wallets.length&&<div className="empty">Refresh to load observed wallet activity.</div>}</div>
    </section>

    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h3>4 · Smart alerts</h3><p className="muted small">Use the Security Alerts workspace for current alerts. Alert delivery depends on configured providers; this panel intentionally does not invent alerts or claim notification delivery.</p>
      <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Alert</th><th>Subject</th><th>Created</th></tr></thead><tbody>{alerts.slice(0,20).map((a:any)=><tr key={a.id}><td>{a.severity}</td><td>{a.kind}</td><td>{a.subject_id}</td><td>{a.created_at?new Date(a.created_at).toLocaleString():"—"}</td></tr>)}</tbody></table>{!alerts.length&&<div className="empty">No alert records loaded. Refresh the workspace to retrieve current alerts.</div>}</div>
    </section>

    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h3>5 · Trade execution simulator</h3><p className="muted small">Liquidity-based impact estimate only. Not a Jupiter quote, route guarantee or executable fill.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
        {(["amountUsd","priceUsd","liquidityUsd","slippageBps","feeBps"] as const).map(k=><label key={k}>{k}<input type="number" value={execution[k]} onChange={e=>setExecution({...execution,[k]:Number(e.target.value)})}/></label>)}
        <label>Side<select value={execution.side} onChange={e=>setExecution({...execution,side:e.target.value})}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
      </div>
      <button className="button primary" style={{marginTop:10}} onClick={simulate}>Estimate impact</button>
      {estimate&&<div className="metric-card" style={{marginTop:12}}><strong>Estimated fill {money(estimate.estimatedFillPriceUsd)}</strong><small>Fee {money(estimate.estimatedFeeUsd)} · impact {money(estimate.estimatedImpactUsd)} · slippage {estimate.estimatedSlippageBps} bps</small><p className="muted small">{estimate.warning}</p></div>}
    </section>

    <section className="panel" style={{padding:20,marginBottom:16}}>
      <h3>6 · Strategy backtesting & saved templates</h3><p className="muted small">The existing Strategy Backtesting page runs tests against stored snapshots. Save a reusable template here; use that page to configure and execute the backtest.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
        {(["minMomentum","maxRiskScore","takeProfitPct","stopLossPct","maxHoldingHours","tradeSizeUsd","initialCapitalUsd","slippageBps","feeBps"] as const).map(k=><label key={k}>{k}<input type="number" value={strategyConfig[k]} onChange={e=>setStrategyConfig({...strategyConfig,[k]:Number(e.target.value)})}/></label>)}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}><button className="button outline" onClick={saveStrategy}>Save configuration</button><button className="button primary" onClick={runStrategy}>Run historical backtest</button></div>
      {backtestResult&&<div className="metric-card" style={{marginTop:12}}><strong>{backtestResult.name}: {backtestResult.totalReturnPct}% return</strong><small>{backtestResult.totalTrades} trades · {backtestResult.winRatePct}% win rate · {backtestResult.maxDrawdownPct}% max drawdown · {backtestResult.profitFactor} profit factor</small></div>}
      <div className="table-wrap" style={{marginTop:12}}><table><thead><tr><th>Strategy</th><th>Description</th><th>Updated</th><th>Load</th></tr></thead><tbody>{strategies.map(x=><tr key={x.id}><td>{x.name}</td><td>{x.description}</td><td>{x.updated_at?new Date(x.updated_at).toLocaleString():"—"}</td><td><button className="button outline" onClick={()=>{try{setStrategyConfig({...strategyConfig,...JSON.parse(x.config_json||"{}")});}catch{setError("Saved strategy configuration could not be read");}}}>Load</button></td></tr>)}</tbody></table></div>
    </section>

    <section className="panel" style={{padding:20}}>
      <h3>7 · Portfolio risk controls</h3><p className="muted small">Enforced for new paper buys. These settings do not block live Phantom transactions or liquidate open positions.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
        <label>Daily realised loss limit ($)<input type="number" value={risk.daily_loss_limit_usd??risk.dailyLossLimitUsd??""} onChange={e=>setRisk({...risk,dailyLossLimitUsd:e.target.value})}/></label>
        <label>Maximum open positions<input type="number" value={risk.max_open_positions??risk.maxOpenPositions??""} onChange={e=>setRisk({...risk,maxOpenPositions:e.target.value})}/></label>
        <label>Maximum position size ($)<input type="number" value={risk.max_position_size_usd??risk.maxPositionSizeUsd??""} onChange={e=>setRisk({...risk,maxPositionSizeUsd:e.target.value})}/></label>
        <label>Cooldown minutes<input type="number" value={risk.cooldown_minutes??risk.cooldownMinutes??0} onChange={e=>setRisk({...risk,cooldownMinutes:Number(e.target.value)})}/></label>
      </div>
      <button className="button primary" style={{marginTop:10}} onClick={saveRisk}>Save paper risk controls</button>
    </section>
  </div>;
}
