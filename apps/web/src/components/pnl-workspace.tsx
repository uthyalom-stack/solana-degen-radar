"use client";

import { useCallback, useEffect, useState } from "react";

type PaperPosition = {
  id: string; mint: string; symbol?: string; name?: string; status: "open" | "closed";
  quantity: number; entry_price_usd: number; entry_value_usd: number; fees_usd?: number;
  opened_at?: string; closed_at?: string; exit_price_usd?: number; realized_pnl_usd?: number;
};
type Portfolio = { positions?: PaperPosition[] };
type LiveTransaction = {
  signature: string; walletAddress: string; inputMint: string; outputMint: string;
  inputAmount: number; outputAmount: number; status: "submitted" | "confirming" | "confirmed" | "failed" | "expired";
  submittedAt: string; confirmedAt?: string; errorMessage?: string;
};
type GeneratedCard = {
  cardId: string; tradeType: "PAPER" | "LIVE"; symbol?: string; mint?: string;
  investedUsd: number; realizedPnlUsd: number; roiPct: number; createdAt: string;
  txSignature?: string; verificationUrl?: string;
};

const API = process.env.NEXT_PUBLIC_RADAR_API_URL?.replace(/\/$/, "") || "";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const money = (value?: number) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "—";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API) throw new Error("Radar API is not configured.");
  const secret = typeof window !== "undefined" ? localStorage.getItem("radar_auth_secret") || "" : "";
  const response = await fetch(`${API}${path}`, {
    ...init, credentials: "include", cache: "no-store",
    headers: { "content-type": "application/json", ...(secret ? { "x-radar-secret": secret } : {}), ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

export default function PnlWorkspace({ walletAddress }: { walletAddress?: string | null }) {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [liveTransactions, setLiveTransactions] = useState<LiveTransaction[]>([]);
  const [mode, setMode] = useState<"PAPER" | "LIVE">("PAPER");
  const [selectedId, setSelectedId] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [generated, setGenerated] = useState<GeneratedCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const portfolio = await request<Portfolio>("/api/portfolio");
      setPositions((portfolio.positions || []).filter(position => position.status === "closed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load paper trades.");
    }
    if (walletAddress) {
      try {
        const history = await request<LiveTransaction[]>(`/api/swap/history?wallet=${encodeURIComponent(walletAddress)}`);
        setLiveTransactions(history);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load live wallet transactions.");
      }
    } else {
      setLiveTransactions([]);
    }
  }, [walletAddress]);

  useEffect(() => { void load(); }, [load]);

  const liveBuys = liveTransactions.filter(tx =>
    tx.status === "confirmed" && tx.inputMint === SOL_MINT && tx.outputMint !== SOL_MINT
  );
  const selectedPaper = positions.find(position => position.id === selectedId) || null;
  const selectedLive = liveBuys.find(tx => tx.signature === selectedId) || null;

  async function generate() {
    if (mode === "PAPER" && !selectedPaper) return;
    if (mode === "LIVE" && !selectedLive) return;
    setBusy(true); setError(""); setNotice(""); setGenerated(null);
    try {
      const payload = mode === "PAPER"
        ? { cardType: "trade", tradeType: "PAPER", positionId: selectedPaper!.id, isPublic }
        : { cardType: "trade", tradeType: "LIVE", txSignature: selectedLive!.signature, isPublic };
      const card = await request<GeneratedCard>("/api/pnl/generate", { method: "POST", body: JSON.stringify(payload) });
      setGenerated(card);
      setNotice(`${mode === "PAPER" ? "Paper" : "Live"} PnL card generated from recorded trade data.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the PnL card.");
    } finally { setBusy(false); }
  }

  async function copyShareLink() {
    if (!generated?.cardId || !API) return;
    try {
      await navigator.clipboard.writeText(`${API}/api/pnl/card/${generated.cardId}`);
      setNotice("Verification link copied.");
    } catch { setError("Clipboard access was blocked. Copy the link shown below."); }
  }

  const paperPnl = Number(selectedPaper?.realized_pnl_usd || 0);
  const paperRoi = selectedPaper && Number(selectedPaper.entry_value_usd) > 0
    ? paperPnl / Number(selectedPaper.entry_value_usd) * 100 : 0;

  return (
    <section className="pnl-workspace">
      <div className="workspace-heading" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div><div className="muted small">TRADE RECORDS / SHAREABLE RESULTS</div><h2 style={{margin:"6px 0"}}>PnL Card Generator</h2>
          <p className="muted small">Generate verifiable result cards from your paper positions or confirmed wallet trades.</p></div>
        <button className="button outline" onClick={() => void load()} disabled={busy}>Refresh trades</button>
      </div>
      {error && <div className="alert-row" role="alert">{error}</div>}
      {notice && <div className="alert-row" style={{color:"#86efac"}} role="status">{notice}</div>}

      <div style={{display:"flex",gap:8,marginTop:16}}>
        <button className={mode === "PAPER" ? "button primary" : "button outline"} onClick={() => {setMode("PAPER");setSelectedId("");setGenerated(null);}}>Paper Trading</button>
        <button className={mode === "LIVE" ? "button primary" : "button outline"} onClick={() => {setMode("LIVE");setSelectedId("");setGenerated(null);}}>Live Trading</button>
      </div>

      <div className="panel" style={{marginTop:12}}>
        {mode === "PAPER" ? <>
          <label htmlFor="pnl-trade-select" className="muted small">SELECT A COMPLETED PAPER TRADE</label>
          <select id="pnl-trade-select" value={selectedId} onChange={event => {setSelectedId(event.target.value);setGenerated(null);}} style={{display:"block",width:"100%",marginTop:8,padding:12,borderRadius:10,background:"var(--panel, #111827)",color:"inherit",border:"1px solid var(--border, #334155)"}}>
            <option value=""> {positions.length ? "Choose a completed paper trade" : "No completed paper trades yet"} </option>
            {positions.map(position => <option key={position.id} value={position.id}>{position.symbol || position.mint.slice(0,8)} · {new Date(position.closed_at || position.opened_at || "").toLocaleString()} · {money(position.realized_pnl_usd)}</option>)}
          </select>
          {selectedPaper && <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginTop:16}}>
            <div><div className="muted tiny">TOKEN</div><strong>{selectedPaper.symbol || selectedPaper.mint.slice(0,8)}</strong><div className="muted tiny">{selectedPaper.mint.slice(0,18)}…</div></div>
            <div><div className="muted tiny">INVESTED</div><strong>{money(selectedPaper.entry_value_usd)}</strong></div>
            <div><div className="muted tiny">REALIZED PNL</div><strong style={{color:paperPnl >= 0 ? "#4ade80" : "#f87171"}}>{paperPnl >= 0 ? "+" : ""}{money(paperPnl)}</strong></div>
            <div><div className="muted tiny">ROI</div><strong style={{color:paperRoi >= 0 ? "#4ade80" : "#f87171"}}>{paperRoi >= 0 ? "+" : ""}{paperRoi.toFixed(2)}%</strong></div>
          </div>}
          <div style={{marginTop:18}}><h3>Completed paper trades ({positions.length})</h3>
            {positions.length === 0 ? <div className="muted small">Closed paper positions will appear here. Open positions are not counted as realized PnL.</div> :
              <div className="table-wrap"><table><thead><tr><th>Token</th><th>Closed</th><th>Invested</th><th>Realized PnL</th><th>Action</th></tr></thead><tbody>
                {positions.map(position => <tr key={position.id}><td><strong>{position.symbol || position.mint.slice(0,8)}</strong><div className="muted tiny">{position.mint.slice(0,14)}…</div></td><td>{position.closed_at ? new Date(position.closed_at).toLocaleString() : "—"}</td><td>{money(position.entry_value_usd)}</td><td style={{color:Number(position.realized_pnl_usd || 0) >= 0 ? "#4ade80" : "#f87171"}}>{money(position.realized_pnl_usd)}</td><td><button className="button outline" style={{padding:"6px 10px",fontSize:11}} onClick={() => {setSelectedId(position.id);window.scrollTo({top:0,behavior:"smooth"});}}>Select trade</button></td></tr>)}
              </tbody></table></div>}
          </div>
        </> : <>
          <div className="muted small">CONNECTED PHANTOM WALLET</div>
          <strong style={{wordBreak:"break-all"}}>{walletAddress || "Connect Phantom in Live Trading to view its transactions."}</strong>
          {walletAddress && <div className="muted tiny" style={{marginTop:6}}>Only confirmed swaps recorded for this connected wallet are listed. A buy alone is not a realized profit or loss.</div>}
          <label htmlFor="pnl-live-select" className="muted small" style={{display:"block",marginTop:16}}>SELECT A CONFIRMED LIVE BUY</label>
          <select id="pnl-live-select" value={selectedId} onChange={event => {setSelectedId(event.target.value);setGenerated(null);}} style={{display:"block",width:"100%",marginTop:8,padding:12,borderRadius:10,background:"var(--panel, #111827)",color:"inherit",border:"1px solid var(--border, #334155)"}}>
            <option value="">{liveBuys.length ? "Choose a confirmed live buy" : "No confirmed live buys recorded for this wallet"}</option>
            {liveBuys.map(tx => <option key={tx.signature} value={tx.signature}>{tx.outputMint.slice(0,8)}… · {new Date(tx.confirmedAt || tx.submittedAt).toLocaleString()} · {tx.signature.slice(0,10)}</option>)}
          </select>
          {selectedLive && <div className="muted small" style={{marginTop:14,display:"grid",gap:6}}>
            <div>Token mint: <strong>{selectedLive.outputMint}</strong></div>
            <div>Recorded input: <strong>{selectedLive.inputAmount} SOL</strong></div>
            <div>Transaction: <a href={`https://solscan.io/tx/${selectedLive.signature}`} target="_blank" rel="noreferrer">View on Solscan</a></div>
            <div>Generation checks for a matching confirmed sell. If there is no recorded sell, no realized PnL card should be issued.</div>
          </div>}
          <div style={{marginTop:18}}><h3>Confirmed live transactions ({liveTransactions.filter(tx => tx.status === "confirmed").length})</h3>
            {!walletAddress ? <div className="muted small">Connect Phantom to load wallet history.</div> :
              liveTransactions.length === 0 ? <div className="muted small">No recorded swaps found for this wallet.</div> :
              <div className="table-wrap"><table><thead><tr><th>Direction</th><th>Token</th><th>Status</th><th>Time</th><th>Signature</th></tr></thead><tbody>
                {liveTransactions.map(tx => <tr key={tx.signature}><td>{tx.inputMint === SOL_MINT ? "Buy" : tx.outputMint === SOL_MINT ? "Sell" : "Swap"}</td><td>{tx.inputMint === SOL_MINT ? tx.outputMint.slice(0,8) : tx.inputMint.slice(0,8)}</td><td>{tx.status}</td><td>{new Date(tx.confirmedAt || tx.submittedAt).toLocaleString()}</td><td><a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noreferrer">{tx.signature.slice(0,10)}…</a></td></tr>)}
              </tbody></table></div>}
          </div>
        </>}
        <label style={{display:"flex",alignItems:"center",gap:9,marginTop:18,fontSize:13}}>
          <input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} /> Make the generated card publicly verifiable (anyone with the link can view its record)
        </label>
        <button className="button primary" style={{marginTop:16}} disabled={busy || (mode === "PAPER" ? !selectedPaper : !selectedLive)} onClick={() => void generate()}>{busy ? "Generating…" : "Generate PnL card"}</button>
      </div>

      {generated && <div className="panel" style={{marginTop:18,maxWidth:560,border:"1px solid rgba(34,197,94,.35)"}}>
        <div className="muted tiny">SOLANA DEGEN RADAR · {generated.cardId}</div>
        <h3 style={{margin:"10px 0 4px"}}>{generated.symbol || "Trade"} result</h3>
        <div style={{fontSize:34,fontWeight:800,letterSpacing:"-1px",color:generated.realizedPnlUsd >= 0 ? "#4ade80" : "#f87171"}}>{generated.realizedPnlUsd >= 0 ? "+" : ""}{money(generated.realizedPnlUsd)}</div>
        <div className="muted small">{generated.roiPct >= 0 ? "+" : ""}{Number(generated.roiPct).toFixed(2)}% ROI · {generated.tradeType} TRADE</div>
        <div className="muted tiny" style={{marginTop:14}}>Invested {money(generated.investedUsd)} · Generated {new Date(generated.createdAt).toLocaleString()}</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}><button className="button outline" onClick={() => void copyShareLink()} disabled={!isPublic}>Copy verification link</button>{!isPublic && <span className="muted tiny" style={{alignSelf:"center"}}>Private card · link sharing disabled</span>}</div>
        {isPublic && <p className="muted tiny" style={{marginTop:10,wordBreak:"break-all"}}>{API}/api/pnl/card/{generated.cardId}</p>}
      </div>}
    </section>
  );
}
