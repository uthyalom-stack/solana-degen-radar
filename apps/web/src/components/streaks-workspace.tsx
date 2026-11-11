"use client";
import {useEffect,useState} from "react";
const API=process.env.NEXT_PUBLIC_RADAR_API_URL?.replace(/\/$/,"")||"";
async function getPerformance(){
 if(!API) throw new Error("Radar API is not configured");
 const secret=typeof window!=="undefined"?window.localStorage.getItem("radar_auth_secret")||"":"";
 const r=await fetch(API+"/api/performance",{cache:"no-store",credentials:"include",headers:secret?{"x-radar-secret":secret}:{}});
 const raw=await r.text();let data:any;try{data=JSON.parse(raw)}catch{throw new Error("Performance API returned a non-JSON response")}
 if(!r.ok)throw new Error(data?.error||"Unable to load streaks");return data;
}
const fmt=(v:any)=>Number(v||0).toLocaleString();
export default function StreaksWorkspace(){
 const [data,setData]=useState<any>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 async function load(){setLoading(true);setError("");try{setData(await getPerformance())}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{load()},[]);
 const trade=data?.tradeStreak||{},activity=data?.activityStreak||{},positions=data?.recentPositions||[];
 const current=trade.currentType==="win"?"Winning":trade.currentType==="loss"?"Losing":"No active outcome";
 return <div className="workspace-stack">
  <section className="panel" style={{padding:20}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}><div><h2>Your streaks</h2><p className="muted small">Daily consistency and completed paper-trade outcomes. Live trades are not mixed into these session statistics.</p></div><button className="button primary" onClick={load} disabled={loading}>{loading?"Refreshing…":"Refresh streaks"}</button></div>
   {error&&<p className="risk high" role="alert">{error}</p>}
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14,marginTop:18}}>
    <article className="metric-card" style={{border:"1px solid rgba(56,189,248,.42)",background:"linear-gradient(145deg,rgba(14,165,233,.13),rgba(15,23,42,.35))"}}><div style={{fontSize:24}}>🔵</div><span>Login / showing-up streak</span><strong>{fmt(activity.current)} days</strong><small>Longest: {fmt(activity.longest)} days · {fmt(activity.activeDays)} active days</small><p className="muted small">A day counts when you open the app and the daily visit is recorded.</p></article>
    <article className="metric-card" style={{border:"1px solid rgba(34,197,94,.45)",background:"linear-gradient(145deg,rgba(34,197,94,.13),rgba(15,23,42,.35))"}}><div style={{fontSize:24}}>🟢</div><span>Winning streak</span><strong style={{color:"#4ade80"}}>{fmt(trade.currentType==="win"?trade.current:0)} wins</strong><small>Longest winning streak: {fmt(trade.longestWinning)}</small><p className="muted small">Only closed paper positions with positive realised PnL count.</p></article>
    <article className="metric-card" style={{border:"1px solid rgba(248,113,113,.45)",background:"linear-gradient(145deg,rgba(239,68,68,.13),rgba(15,23,42,.35))"}}><div style={{fontSize:24}}>🔴</div><span>Losing streak</span><strong style={{color:"#f87171"}}>{fmt(trade.currentType==="loss"?trade.current:0)} losses</strong><small>Longest losing streak: {fmt(trade.longestLosing)}</small><p className="muted small">Only closed paper positions with negative realised PnL count.</p></article>
   </div>
   <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}><span className="badge">Current trade run: {current}</span><span className="badge">Closed: {fmt(data?.tradeStats?.total)}</span><span className="badge" style={{color:"#4ade80"}}>Wins: {fmt(data?.tradeStats?.wins)}</span><span className="badge" style={{color:"#f87171"}}>Losses: {fmt(data?.tradeStats?.losses)}</span></div>
  </section>
  <section className="panel" style={{padding:20}}>
   <h3>Showing-up calendar</h3><p className="muted small">Recent days with a recorded app visit or research activity.</p>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(42px,1fr))",gap:7,marginTop:12}}>{(activity.activityDays||[]).map((d:string)=><div key={d} title={d} style={{padding:"9px 4px",borderRadius:8,textAlign:"center",background:"rgba(56,189,248,.16)",border:"1px solid rgba(56,189,248,.4)",fontSize:11}}>{new Date(d+"T12:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short"})}</div>)}{!activity.activityDays?.length&&<p className="muted small">No recorded days yet. Your first visit will start the streak.</p>}</div>
  </section>
  <section className="panel" style={{padding:20}}>
   <h3>Recent completed trades</h3><p className="muted small">A win or loss is counted when a position is fully closed. Break-even positions do not extend either streak.</p>
   <div className="table-wrap"><table><thead><tr><th>Outcome</th><th>Mint</th><th>Realised PnL</th><th>Closed</th></tr></thead><tbody>{positions.map((p:any)=><tr key={p.id}><td><span style={{color:p.outcome==="win"?"#4ade80":p.outcome==="loss"?"#f87171":"#94a3b8",fontWeight:700}}>{p.outcome==="win"?"WIN":p.outcome==="loss"?"LOSS":"BREAK EVEN"}</span></td><td className="font-mono">{p.mint}</td><td style={{color:p.outcome==="win"?"#4ade80":p.outcome==="loss"?"#f87171":"inherit"}}>{Number(p.realized_pnl_usd||0).toFixed(4)} USD</td><td>{p.closed_at?new Date(p.closed_at).toLocaleString():"—"}</td></tr>)}</tbody></table>{!positions.length&&<div className="empty">No completed paper trades yet.</div>}</div>
  </section>
 </div>;
}
