"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_RADAR_API_URL?.replace(/\/$/, "") || "";
async function request<T = any>(path: string): Promise<T> {
  if (!API) throw new Error("Radar API is not configured.");
  const secret = typeof window !== "undefined" ? window.localStorage.getItem("radar_auth_secret") || "" : "";
  const response = await fetch(API + path, {
    headers: { ...(secret ? { "x-radar-secret": secret } : {}) },
    credentials: "include",
    cache: "no-store",
  });
  const raw = await response.text();
  let data: any;
  try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error("Radar API returned invalid JSON."); }
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

const compact = (value: any) => Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value)) : "—";
const date = (value?: string) => value ? new Date(value).toLocaleString() : "—";

export default function XDiscoveryWorkspace() {
  const [feed, setFeed] = useState<any[]>([]);
  const [callers, setCallers] = useState<any[]>([]);
  const [selectedMint, setSelectedMint] = useState("");
  const [mintData, setMintData] = useState<any>(null);
  const [mintInput, setMintInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const [signals, callerData] = await Promise.all([
        request<any>("/api/social/x/early-signals"),
        request<any>("/api/social/x/callers"),
      ]);
      setFeed(signals.candidates || []);
      setCallers(callerData.callers || []);
      setLoaded(true);
    } catch (e: any) { setError(e?.message || "Unable to load X discovery evidence."); }
    finally { setLoading(false); }
  }

  async function inspectMint(value = mintInput) {
    const mint = value.trim();
    if (!mint) return;
    setLoading(true); setError(""); setMintData(null);
    try {
      const data = await request<any>(`/api/social/x/early-signals?mint=${encodeURIComponent(mint)}`);
      setSelectedMint(mint); setMintInput(mint); setMintData(data);
    } catch (e: any) { setError(e?.message || "Unable to load first-caller history."); }
    finally { setLoading(false); }
  }

  return <div className="workspace-stack">
    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2>X Early Discovery</h2>
          <p className="muted small">Find early contract mentions, first callers observed by the radar, and independent-account convergence. Requires official X API access.</p>
        </div>
        <button className="button primary" disabled={loading} onClick={load}>{loading ? "Loading…" : "Refresh X intelligence"}</button>
      </div>
      {error && <p className="risk high" role="alert">{error}</p>}
      <div className="grid overview-metrics" style={{ marginTop: 16 }}>
        <div className="metric-card"><span>Mint candidates · 24h</span><strong>{feed.length}</strong><small>With at least one captured mint mention</small></div>
        <div className="metric-card"><span>Observed X accounts</span><strong>{callers.length}</strong><small>Accounts seen by this radar</small></div>
        <div className="metric-card"><span>Highest convergence</span><strong>{feed[0]?.unique_callers ?? "—"}</strong><small>Distinct observed authors for one mint</small></div>
        <div className="metric-card"><span>Selected mint mentions</span><strong>{mintData?.summary?.mentions ?? "—"}</strong><small>Captured exact-contract mentions</small></div>
      </div>
      {!loaded && <p className="muted small" style={{ marginTop: 12 }}>Refresh to load X discovery evidence. If X is not configured or migration 0009 has not been applied, this workspace cannot return records.</p>}
    </section>

    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <h3>1 · Emerging contract mentions</h3>
      <p className="muted small">Ranked by distinct observed authors, then earliest captured mention. Convergence is not proof of organic interest or coordinated activity.</p>
      <div className="table-wrap"><table><thead><tr><th>Mint</th><th>Unique callers</th><th>Mentions</th><th>Engagement</th><th>First observed</th><th></th></tr></thead>
        <tbody>{feed.map(row => <tr key={row.mint}>
          <td className="font-mono">{row.mint}</td><td>{row.unique_callers}</td><td>{row.mentions}</td><td>{compact(row.engagement)}</td><td>{date(row.first_observed_at)}</td>
          <td><button className="button outline" onClick={() => void inspectMint(row.mint)}>Inspect callers</button></td>
        </tr>)}</tbody></table>{loaded && !feed.length && <div className="empty">No exact mint mentions captured in the last 24 hours. Check X provider access and run a social scan.</div>}</div>
    </section>

    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <h3>2 · First observed callers for a mint</h3>
      <p className="muted small">Enter a contract address or select one from the candidate table. “First” means first captured by this radar, not necessarily the first post published on X.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input aria-label="Solana mint address" placeholder="Paste Solana mint address" value={mintInput} onChange={e => setMintInput(e.target.value)} style={{ flex: "1 1 320px" }}/>
        <button className="button primary" disabled={loading || !mintInput.trim()} onClick={() => void inspectMint()}>Find first callers</button>
      </div>
      {mintData && <><p className="muted small" style={{ marginTop: 12 }}>{selectedMint} · {mintData.summary?.unique_callers ?? 0} unique callers · {mintData.summary?.mentions ?? 0} captured mentions</p>
        <div className="table-wrap"><table><thead><tr><th>Observed at</th><th>Account</th><th>Followers</th><th>Engagement</th><th>Account created</th><th>Post</th></tr></thead>
          <tbody>{(mintData.firstCallers || []).map((row: any) => <tr key={row.tweet_id + row.mint}>
            <td>{date(row.observed_at)}</td><td>{row.username ? "@" + row.username : row.author_id || "Unknown"}</td><td>{compact(row.followers)}</td><td>{compact(row.engagement)}</td><td>{date(row.account_created_at)}</td><td>{row.url ? <a href={row.url} target="_blank" rel="noreferrer">Open post ↗</a> : "—"}</td>
          </tr>)}</tbody></table>{!mintData.firstCallers?.length && <div className="empty">No captured X posts mention this mint.</div>}</div>
      </>}
    </section>

    <section className="panel" style={{ padding: 20 }}>
      <h3>3 · Observed caller activity</h3>
      <p className="muted small">Account age, followers and number of mint mentions are descriptive context only. This is not a caller win-rate or reputation ranking.</p>
      <div className="table-wrap"><table><thead><tr><th>Account</th><th>Followers</th><th>Observed mint mentions</th><th>Distinct mints</th><th>First observed</th><th>Last observed</th></tr></thead>
        <tbody>{callers.slice(0, 100).map(row => <tr key={row.author_id}>
          <td>{row.username ? "@" + row.username : row.author_id}{row.verified ? " · verified" : ""}</td><td>{compact(row.followers)}</td><td>{row.mint_mentions}</td><td>{row.distinct_mints}</td><td>{date(row.first_seen_at)}</td><td>{date(row.last_seen_at)}</td>
        </tr>)}</tbody></table>{loaded && !callers.length && <div className="empty">No X account observations have been captured yet.</div>}</div>
    </section>
  </div>;
}
