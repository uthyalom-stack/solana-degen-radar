"use client";

import { useCallback, useEffect, useState } from "react";

type PaperPosition = {
  id: string;
  mint: string;
  symbol?: string;
  name?: string;
  status: "open" | "closed";
  quantity: number;
  entry_price_usd: number;
  entry_value_usd: number;
  fees_usd?: number;
  opened_at?: string;
  closed_at?: string;
  exit_price_usd?: number;
  realized_pnl_usd?: number;
  unrealized_pnl_usd?: number;
};

type Portfolio = { positions?: PaperPosition[] };
type GeneratedCard = {
  cardId: string;
  symbol?: string;
  mint?: string;
  investedUsd: number;
  realizedPnlUsd: number;
  roiPct: number;
  createdAt: string;
};

const API = process.env.NEXT_PUBLIC_RADAR_API_URL?.replace(/\/$/, "") || "";
const money = (value?: number) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "—";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API) throw new Error("Radar API is not configured.");
  const secret = typeof window !== "undefined" ? localStorage.getItem("radar_auth_secret") || "" : "";
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-radar-secret": secret } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

export default function PnlWorkspace() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
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
      const closed = (portfolio.positions || []).filter(position => position.status === "closed");
      setPositions(closed);
      setSelectedId(current => closed.some(position => position.id === current) ? current : closed[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load paper trades.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = positions.find(position => position.id === selectedId) || null;

  async function generate() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    setGenerated(null);
    try {
      const card = await request<GeneratedCard>("/api/pnl/generate", {
        method: "POST",
        body: JSON.stringify({
          cardType: "trade",
          tradeType: "PAPER",
          positionId: selected.id,
          isPublic,
        }),
      });
      setGenerated(card);
      setNotice("PnL card generated from the recorded paper position.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the PnL card.");
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink() {
    if (!generated?.cardId || !API) return;
    const url = `${API}/api/pnl/card/${generated.cardId}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Verification link copied.");
    } catch {
      setError("Clipboard access was blocked. Copy the link shown below.");
    }
  }

  const pnl = Number(selected?.realized_pnl_usd || 0);
  const roi = selected && Number(selected.entry_value_usd) > 0
    ? pnl / Number(selected.entry_value_usd) * 100
    : 0;

  return (
    <section className="pnl-workspace">
      <div className="workspace-heading" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div>
          <div className="muted small">TRADE RECORDS / SHAREABLE RESULTS</div>
          <h2 style={{margin:"6px 0"}}>PnL Card Generator</h2>
          <p className="muted small">Choose a completed paper trade and generate a card using its stored trade record.</p>
        </div>
        <button className="button outline" onClick={() => void load()} disabled={busy}>Refresh trades</button>
      </div>

      {error && <div className="alert-row" role="alert">{error}</div>}
      {notice && <div className="alert-row" style={{color:"#86efac"}} role="status">{notice}</div>}

      <div className="panel" style={{marginTop:16}}>
        <label htmlFor="pnl-trade-select" className="muted small">SELECT A COMPLETED PAPER TRADE</label>
        <select id="pnl-trade-select" value={selectedId} onChange={event => {setSelectedId(event.target.value);setGenerated(null);}} style={{display:"block",width:"100%",marginTop:8,padding:12,borderRadius:10,background:"var(--panel, #111827)",color:"inherit",border:"1px solid var(--border, #334155)"}}>
          {positions.length === 0 && <option value="">No completed paper trades yet</option>}
          {positions.map(position => (
            <option key={position.id} value={position.id}>
              {(position.symbol || position.mint.slice(0,8))} · {new Date(position.closed_at || position.opened_at || "").toLocaleString()} · {money(position.realized_pnl_usd)}
            </option>
          ))}
        </select>

        {selected && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginTop:16}}>
            <div><div className="muted tiny">TOKEN</div><strong>{selected.symbol || selected.mint.slice(0,8)}</strong><div className="muted tiny">{selected.mint.slice(0,18)}…</div></div>
            <div><div className="muted tiny">INVESTED</div><strong>{money(selected.entry_value_usd)}</strong></div>
            <div><div className="muted tiny">REALIZED PNL</div><strong style={{color:pnl >= 0 ? "#4ade80" : "#f87171"}}>{pnl >= 0 ? "+" : ""}{money(pnl)}</strong></div>
            <div><div className="muted tiny">ROI</div><strong style={{color:roi >= 0 ? "#4ade80" : "#f87171"}}>{roi >= 0 ? "+" : ""}{roi.toFixed(2)}%</strong></div>
          </div>
        )}

        <label style={{display:"flex",alignItems:"center",gap:9,marginTop:18,fontSize:13}}>
          <input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} />
          Make the generated card publicly verifiable (anyone with the link can view its record)
        </label>
        <button className="button primary" style={{marginTop:16}} disabled={!selected || busy} onClick={() => void generate()}>
          {busy ? "Generating…" : "Generate PnL card"}
        </button>
      </div>

      {generated && selected && (
        <div className="panel" style={{marginTop:18,maxWidth:560,border:"1px solid rgba(34,197,94,.35)"}}>
          <div className="muted tiny">SOLANA DEGEN RADAR · {generated.cardId}</div>
          <h3 style={{margin:"10px 0 4px"}}>{selected.symbol || "Paper trade"} result</h3>
          <div style={{fontSize:34,fontWeight:800,letterSpacing:"-1px",color:generated.realizedPnlUsd >= 0 ? "#4ade80" : "#f87171"}}>
            {generated.realizedPnlUsd >= 0 ? "+" : ""}{money(generated.realizedPnlUsd)}
          </div>
          <div className="muted small">{generated.roiPct >= 0 ? "+" : ""}{Number(generated.roiPct).toFixed(2)}% ROI · PAPER TRADE</div>
          <div className="muted tiny" style={{marginTop:14}}>Invested {money(generated.investedUsd)} · Generated {new Date(generated.createdAt).toLocaleString()}</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:16}}>
            <button className="button outline" onClick={() => void copyShareLink()} disabled={!isPublic}>Copy verification link</button>
            {!isPublic && <span className="muted tiny" style={{alignSelf:"center"}}>Private card · link sharing disabled</span>}
          </div>
          {isPublic && <p className="muted tiny" style={{marginTop:10,wordBreak:"break-all"}}>{API}/api/pnl/card/{generated.cardId}</p>}
        </div>
      )}

      <div style={{marginTop:24}}>
        <h3>Completed paper trades ({positions.length})</h3>
        {positions.length === 0 ? (
          <div className="panel muted small">Completed paper positions will appear here. Open positions are not presented as realized PnL.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Token</th><th>Closed</th><th>Invested</th><th>Realized PnL</th><th>Action</th></tr></thead>
              <tbody>
                {positions.map(position => (
                  <tr key={position.id}>
                    <td><strong>{position.symbol || position.mint.slice(0,8)}</strong><div className="muted tiny">{position.mint.slice(0,14)}…</div></td>
                    <td>{position.closed_at ? new Date(position.closed_at).toLocaleString() : "—"}</td>
                    <td>{money(position.entry_value_usd)}</td>
                    <td style={{color:Number(position.realized_pnl_usd || 0) >= 0 ? "#4ade80" : "#f87171"}}>{money(position.realized_pnl_usd)}</td>
                    <td><button className="button outline" style={{padding:"6px 10px",fontSize:11}} onClick={() => {setSelectedId(position.id);setGenerated(null);window.scrollTo({top:0,behavior:"smooth"});}}>Select trade</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
