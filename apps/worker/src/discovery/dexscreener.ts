import type { Env, Pair } from "../types";
import type { ProviderHealth } from "@radar/shared";

export class DexScreenerClient {
  private baseUrl: string;

  constructor(env: Env) {
    this.baseUrl = (env.DEXSCREENER_BASE_URL || "https://api.dexscreener.com").replace(/\/$/, "");
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "SolanaDegenRadar/1.0" },
    });
    if (!res.ok) throw new Error(`DEX Screener HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  async getLatestProfiles(): Promise<string[]> {
    try {
      const data = await this.get<Array<{ chainId?: string; tokenAddress?: string }>>("/token-profiles/latest/v1");
      return (data || [])
        .filter(item => item.chainId === "solana" && item.tokenAddress)
        .map(item => item.tokenAddress!);
    } catch {
      return [];
    }
  }

  async getBoostedTokens(): Promise<string[]> {
    try {
      const [latest, top] = await Promise.all([
        this.get<Array<{ chainId?: string; tokenAddress?: string }>>("/token-boosts/latest/v1").catch(() => []),
        this.get<Array<{ chainId?: string; tokenAddress?: string }>>("/token-boosts/top/v1").catch(() => []),
      ]);

      const mints = [...(latest || []), ...(top || [])]
        .filter(item => item.chainId === "solana" && item.tokenAddress)
        .map(item => item.tokenAddress!);

      return Array.from(new Set(mints));
    } catch {
      return [];
    }
  }

  async getPairsForMints(mints: string[]): Promise<Pair[]> {
    if (!mints.length) return [];
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < mints.length; i += 30) {
        chunks.push(mints.slice(i, i + 30));
      }

      const results = await Promise.all(
        chunks.map(chunk =>
          this.get<Pair[]>(`/tokens/v1/solana/${chunk.join(",")}`).catch(() => [])
        )
      );

      return results.flat().filter(p => p.chainId === "solana" && p.baseToken?.address);
    } catch {
      return [];
    }
  }

  async checkHealth(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      await this.get<unknown>("/token-profiles/latest/v1");
      const latencyMs = Date.now() - startTime;

      return {
        providerId: "dexscreener",
        name: "DEX Screener API",
        category: "market",
        status: "healthy",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        details: { baseUrl: this.baseUrl },
      };
    } catch (e) {
      return {
        providerId: "dexscreener",
        name: "DEX Screener API",
        category: "market",
        status: "degraded",
        latencyMs: Date.now() - startTime,
        lastCheckedAt: new Date().toISOString(),
        details: { error: String(e) },
      };
    }
  }
}
