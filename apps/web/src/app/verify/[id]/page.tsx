"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface PnlCard {
  id: string;
  card_type: string;
  trade_type: "PAPER" | "LIVE";
  mint?: string;
  symbol?: string;
  name?: string;
  buy_price_usd?: number;
  sell_price_usd?: number;
  invested_usd?: number;
  quantity?: number;
  realized_pnl_usd?: number;
  unrealized_pnl_usd?: number;
  roi_pct: number;
  duration_seconds?: number;
  tx_signature?: string;
  is_public: number;
  created_at: string;
  portfolioSummary?: any;
}

export default function VerifyPnlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [card, setCard] = useState<PnlCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCard() {
      try {
        const res = await fetch(`/api/pnl/card/${encodeURIComponent(id)}`);
        if (!res.ok) {
          throw new Error(`Record verification failed (HTTP ${res.status})`);
        }
        const data = await res.json();
        setCard(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Verification record not found");
      } finally {
        setLoading(false);
      }
    }
    fetchCard();
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#06090e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>🔍</div>
          <div>Verifying on-chain & simulation records...</div>
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div style={{ minHeight: "100vh", background: "#06090e", color: "#fff", padding: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 440, background: "#0d1522", padding: 24, borderRadius: 12, border: "1px solid #1e293b", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: "0 0 10px 0" }}>PnL Card Not Verified</h2>
          <p style={{ color: "#8b99ac", fontSize: 14 }}>
            {error || "The requested PnL card record does not exist in verified database records."}
          </p>
          <Link href="/" style={{ color: "#60a5fa", textDecoration: "none", fontSize: 13, display: "inline-block", marginTop: 12 }}>
            ← Return to Solana Degen Radar Terminal
          </Link>
        </div>
      </div>
    );
  }

  const isLive = card.trade_type === "LIVE";
  const isPositive = card.roi_pct >= 0;

  return (
    <div style={{ minHeight: "100vh", background: "#06090e", color: "#fff", padding: "40px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ maxWidth: 540, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
            <strong style={{ letterSpacing: "0.05em", color: "#60a5fa" }}>SOLANA DEGEN RADAR</strong>
            <span style={{ fontSize: 11, background: "#1e293b", padding: "2px 6px", borderRadius: 4 }}>VERIFIED RECORD</span>
          </div>
          <Link href="/" style={{ color: "#8b99ac", textDecoration: "none", fontSize: 12 }}>
            Open Terminal ↗
          </Link>
        </div>

        <div style={{ borderRadius: 16, padding: 24, background: "linear-gradient(135deg, #0d1522 0%, #060b13 100%)", border: "1px solid #223249" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22 }}>
                {card.symbol || card.name || "Portfolio Performance"}
              </h2>
              <div style={{ color: "#8b99ac", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>
                Record ID: {card.id}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "4px 8px",
                borderRadius: 4,
                background: isLive ? "rgba(239, 68, 68, 0.2)" : "rgba(100, 116, 139, 0.2)",
                color: isLive ? "#fca5a5" : "#94a3b8",
                border: isLive ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(100, 116, 139, 0.4)",
              }}
            >
              {isLive ? "⚡ LIVE ON-CHAIN" : "🧪 PAPER SIMULATION"}
            </span>
          </div>

          <div style={{ textAlign: "center", margin: "24px 0", padding: "16px 0", background: "rgba(255, 255, 255, 0.02)", borderRadius: 12 }}>
            <div style={{ color: "#8b99ac", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Verified Return on Investment
            </div>
            <div style={{ fontSize: 44, fontWeight: 900, color: isPositive ? "#4ade80" : "#f87171", margin: "6px 0" }}>
              {isPositive ? "+" : ""}{card.roi_pct.toFixed(2)}%
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: isPositive ? "#86efac" : "#fca5a5" }}>
              {isPositive ? "+" : ""}${Math.abs(card.realized_pnl_usd ?? card.unrealized_pnl_usd ?? 0).toFixed(2)} USD
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, fontSize: 13, marginBottom: 16 }}>
            {card.buy_price_usd != null && (
              <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
                <span style={{ color: "#8b99ac", fontSize: 11 }}>Buy Price</span>
                <div style={{ fontWeight: 700 }}>${card.buy_price_usd.toFixed(6)}</div>
              </div>
            )}
            {card.sell_price_usd != null && (
              <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
                <span style={{ color: "#8b99ac", fontSize: 11 }}>Exit Price</span>
                <div style={{ fontWeight: 700 }}>${card.sell_price_usd.toFixed(6)}</div>
              </div>
            )}
            {card.invested_usd != null && (
              <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
                <span style={{ color: "#8b99ac", fontSize: 11 }}>Capital Invested</span>
                <div style={{ fontWeight: 700 }}>${card.invested_usd.toFixed(2)}</div>
              </div>
            )}
            <div style={{ background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8 }}>
              <span style={{ color: "#8b99ac", fontSize: 11 }}>Generated Timestamp</span>
              <div style={{ fontWeight: 700 }}>{new Date(card.created_at).toLocaleString()}</div>
            </div>
          </div>

          {card.tx_signature && (
            <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(59, 130, 246, 0.08)", borderRadius: 8, border: "1px solid rgba(59, 130, 246, 0.2)" }}>
              <div style={{ color: "#93c5fd", fontSize: 11, fontWeight: 700 }}>ON-CHAIN SOLANA TRANSACTION</div>
              <a
                href={`https://solscan.io/tx/${card.tx_signature}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#60a5fa", fontSize: 12, wordBreak: "break-all", fontFamily: "monospace", display: "inline-block", marginTop: 4 }}
              >
                {card.tx_signature} ↗
              </a>
            </div>
          )}

          {!isLive && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(148, 163, 184, 0.06)", borderRadius: 8, fontSize: 12, color: "#94a3b8" }}>
              ℹ️ <strong>Simulated Trade Notice:</strong> This card reflects virtual paper trading execution and realistic price impact modeling in Cloudflare D1.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
