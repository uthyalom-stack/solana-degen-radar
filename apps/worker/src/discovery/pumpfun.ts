import type { Env, Pair } from "../types";
import type { LaunchpadType, ProviderHealth } from "@radar/shared";

export class PumpFunDiscovery {
  static identifyLaunchpad(pair?: Pair | null, tokenSource?: string): LaunchpadType {
    if (!pair && tokenSource === "pumpportal") return "pumpfun";
    if (!pair) return "unknown";

    const dexId = (pair.dexId || "").toLowerCase();
    const url = (pair.url || "").toLowerCase();

    if (dexId.includes("pump") || url.includes("pump.fun") || tokenSource === "pumpportal") {
      return "pumpfun";
    }
    if (dexId.includes("raydium")) {
      return "raydium";
    }
    if (dexId.includes("meteora")) {
      return "meteora";
    }
    if (dexId.includes("orca")) {
      return "orca";
    }
    if (dexId.includes("moonshot") || url.includes("moonshot")) {
      return "moonshot";
    }
    return "unknown";
  }

  static async getRecentPumpPortalLaunches(db: D1Database, limit = 20): Promise<string[]> {
    try {
      const rows = await db
        .prepare(
          `SELECT mint FROM pumpportal_events
           WHERE julianday(observed_at) >= julianday('now','-7 days')
           GROUP BY mint ORDER BY MAX(observed_at) DESC LIMIT ?`
        )
        .bind(limit)
        .all<{ mint: string }>();

      return (rows.results || []).map(r => r.mint);
    } catch {
      return [];
    }
  }

  static async checkPumpPortalHealth(env: Env): Promise<ProviderHealth> {
    const isConfigured = Boolean(env.PUMPPORTAL_API_KEY);
    if (!isConfigured) {
      return {
        providerId: "pumpportal",
        name: "PumpPortal WebSocket Stream",
        category: "market",
        status: "disabled",
        lastCheckedAt: new Date().toISOString(),
        details: { message: "PUMPPORTAL_API_KEY not configured (optional real-time feed)" },
      };
    }

    try {
      const stub = env.PUMPPORTAL_STREAM.get(env.PUMPPORTAL_STREAM.idFromName("pumpportal-new-token-stream"));
      const res = await stub.fetch("https://pumpportal.internal/status");
      const status: any = await res.json().catch(() => ({}));

      return {
        providerId: "pumpportal",
        name: "PumpPortal WebSocket Stream",
        category: "market",
        status: status.state === "connected" ? "healthy" : "degraded",
        lastCheckedAt: new Date().toISOString(),
        details: status,
      };
    } catch (e) {
      return {
        providerId: "pumpportal",
        name: "PumpPortal WebSocket Stream",
        category: "market",
        status: "unavailable",
        lastCheckedAt: new Date().toISOString(),
        details: { error: String(e) },
      };
    }
  }
}
