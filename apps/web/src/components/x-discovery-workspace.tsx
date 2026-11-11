"use client";

import { useMemo, useState } from "react";

type SearchPreset = {
  id: string;
  label: string;
  description: string;
  query: string;
};

const PRESETS: SearchPreset[] = [
  {
    id: "new-launches",
    label: "New launches",
    description: "Publicly indexed posts discussing fresh Solana launches and contract addresses.",
    query: 'site:x.com (solana OR $SOL) ("CA:" OR "contract address" OR "mint")',
  },
  {
    id: "early-calls",
    label: "Early token mentions",
    description: "Find public posts naming a token or sharing a Solana mint.",
    query: 'site:x.com (solana OR sol) ("just launched" OR "new token" OR "new pair")',
  },
  {
    id: "narratives",
    label: "Emerging narratives",
    description: "Explore themes and phrases gaining attention in the Solana community.",
    query: 'site:x.com solana (meme OR narrative OR meta OR "community takeover")',
  },
  {
    id: "promotions",
    label: "Promoter claims",
    description: "Research promotional language. Treat claims as unverified, not as proof of fraud or quality.",
    query: 'site:x.com solana ("100x" OR "send it" OR "next big thing" OR "alpha call")',
  },
  {
    id: "risk",
    label: "Warnings and allegations",
    description: "Find public warnings, scam reports and rug-pull discussions to investigate further.",
    query: 'site:x.com solana (rug OR scam OR honeypot OR "dev sold" OR drain)',
  },
];

const GOOGLE_SEARCH = "https://www.google.com/search?q=";

export default function XDiscoveryWorkspace() {
  const [activePreset, setActivePreset] = useState(PRESETS[0].id);
  const [keywords, setKeywords] = useState("");
  const [mint, setMint] = useState("");
  const [account, setAccount] = useState("");

  const preset = useMemo(
    () => PRESETS.find(item => item.id === activePreset) || PRESETS[0],
    [activePreset],
  );

  const searchUrl = (query: string) => GOOGLE_SEARCH + encodeURIComponent(query);
  const customQuery = useMemo(() => {
    const parts = ["site:x.com"];
    if (keywords.trim()) parts.push(keywords.trim());
    if (mint.trim()) parts.push('"'+mint.trim()+'"');
    if (account.trim()) parts.push('"@'+account.trim().replace(/^@/, '')+'"');
    return parts.join(" ");
  }, [keywords, mint, account]);

  return (
    <div className="workspace-stack">
      <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2>Free Social Discovery</h2>
            <p className="muted small">
              Search publicly indexed X posts through Google. No X API token, paid credits, automated scraping or X login required.
            </p>
          </div>
          <span className="tag low">No X API billing</span>
        </div>
        <div className="notice info" style={{ marginTop: 14 }}>
          <strong>Important limitation:</strong> Google only shows posts it has indexed. Results may be delayed, incomplete or missing. This is a manual research tool, not a live X feed, and it does not measure reliable post velocity or engagement.
        </div>
      </section>

      <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
        <h3>1 · Search X by topic</h3>
        <p className="muted small">Choose a research lane. Each search opens Google results restricted to public X pages.</p>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 14 }}>
          {PRESETS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`panel ${activePreset === item.id ? "selected" : ""}`}
              onClick={() => setActivePreset(item.id)}
              aria-pressed={activePreset === item.id}
              style={{ padding: 14, textAlign: "left", cursor: "pointer", border: activePreset === item.id ? "1px solid var(--accent, #60a5fa)" : undefined }}
            >
              <strong>{item.label}</strong>
              <span className="muted tiny" style={{ display: "block", marginTop: 6 }}>{item.description}</span>
            </button>
          ))}
        </div>
        <div className="panel" style={{ padding: 14, marginTop: 14 }}>
          <span className="muted tiny">SEARCH QUERY</span>
          <p className="font-mono small" style={{ overflowWrap: "anywhere" }}>{preset.query}</p>
          <a className="button primary" href={searchUrl(preset.query)} target="_blank" rel="noreferrer">
            Search Google for X posts ↗
          </a>
        </div>
      </section>

      <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
        <h3>2 · Search for a specific token or account</h3>
        <p className="muted small">Use a mint address, token name, ticker, phrase or public X username. Search results open outside the radar.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 14 }}>
          <label className="small">Keywords / token name
            <input value={keywords} onChange={event => setKeywords(event.target.value)} placeholder="e.g. BONK, pumpfun, new Solana meme" style={{ width: "100%", marginTop: 6 }} />
          </label>
          <label className="small">Contract / mint address
            <input value={mint} onChange={event => setMint(event.target.value)} placeholder="Paste a Solana mint address" style={{ width: "100%", marginTop: 6 }} />
          </label>
          <label className="small">X username (optional)
            <input value={account} onChange={event => setAccount(event.target.value)} placeholder="e.g. username (without @)" style={{ width: "100%", marginTop: 6 }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <a
            className="button primary"
            href={searchUrl(customQuery)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!keywords.trim() && !mint.trim() && !account.trim()}
            onClick={event => { if (!keywords.trim() && !mint.trim() && !account.trim()) event.preventDefault(); }}
          >
            Search this query ↗
          </a>
          <button className="button outline" type="button" onClick={() => { setKeywords(""); setMint(""); setAccount(""); }}>
            Clear
          </button>
        </div>
      </section>

      <section className="panel" style={{ padding: 20 }}>
        <h3>3 · Verify what you find</h3>
        <ol className="muted small" style={{ paddingLeft: 20, lineHeight: 1.8 }}>
          <li>Open the original post and check its timestamp, author and context. Google snippets can be stale or misleading.</li>
          <li>Copy any claimed contract address and inspect it in the radar's token discovery, risk and wallet-intelligence tools.</li>
          <li>Confirm that the mint, token identity, liquidity and trading pair match. Never treat a post or search ranking as proof of legitimacy.</li>
          <li>Record social claims as unverified evidence unless independently confirmed by on-chain or market data.</li>
        </ol>
        <div className="notice warning" style={{ marginTop: 14 }}>
          Search results are not automatically imported into the radar. We intentionally do not scrape X or bypass its API restrictions. Automated indexing, completeness and freshness are not guaranteed.
        </div>
      </section>
    </div>
  );
}
