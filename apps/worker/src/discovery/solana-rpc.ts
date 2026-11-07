import type { Env } from "../types";
import type { SecurityEvidence, ProviderHealth } from "@radar/shared";

export class SolanaRpcClient {
  private endpoint: string;

  constructor(env: Env) {
    this.endpoint = env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
      : (env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");
  }

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T | null> {
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Math.floor(Math.random() * 100000),
          method,
          params,
        }),
      });

      if (!res.ok) return null;
      const data: any = await res.json();
      return (data?.result ?? null) as T | null;
    } catch {
      return null;
    }
  }

  /**
   * Inspect SPL Mint account: mint authority, freeze authority, decimals, initialization
   */
  async getMintSecurity(mint: string): Promise<{
    mintAuthority: boolean | null;
    freezeAuthority: boolean | null;
    initialized: boolean | null;
    decimals: number | null;
  }> {
    try {
      const accountInfo = await this.rpcCall<{ value: { data: [string, string] } | null }>("getAccountInfo", [
        mint,
        { encoding: "base64", commitment: "confirmed" },
      ]);

      const encoded = accountInfo?.value?.data?.[0];
      if (typeof encoded !== "string") {
        return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null };
      }

      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      if (bytes.length < 82) {
        return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null };
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const mintOption = view.getUint32(0, true);
      const freezeOption = view.getUint32(46, true);
      const decimals = bytes[44];
      const isInitialized = bytes[45] === 1;

      return {
        mintAuthority: mintOption === 0 ? false : mintOption === 1 ? true : null,
        freezeAuthority: freezeOption === 0 ? false : freezeOption === 1 ? true : null,
        initialized: isInitialized,
        decimals,
      };
    } catch {
      return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null };
    }
  }

  /**
   * Calculate top 10 holder concentration via getTokenLargestAccounts
   */
  async getHolderConcentration(mint: string): Promise<{
    top10HolderPercent: number | null;
    holderCount: number | null;
  }> {
    try {
      const [largestAccounts, supplyInfo] = await Promise.all([
        this.rpcCall<{ value: Array<{ address: string; amount: string; uiAmount: number }> }>("getTokenLargestAccounts", [
          mint,
          { commitment: "confirmed" },
        ]),
        this.rpcCall<{ value: { amount: string; uiAmount: number } }>("getTokenSupply", [
          mint,
          { commitment: "confirmed" },
        ]),
      ]);

      const accounts = largestAccounts?.value || [];
      const totalSupply = Number(supplyInfo?.value?.amount) || 0;

      if (!accounts.length || totalSupply <= 0) {
        return { top10HolderPercent: null, holderCount: null };
      }

      const top10Sum = accounts.slice(0, 10).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const top10Pct = Math.min(100, Math.max(0, (top10Sum / totalSupply) * 100));

      return {
        top10HolderPercent: Number(top10Pct.toFixed(2)),
        holderCount: accounts.length >= 20 ? 20 : accounts.length,
      };
    } catch {
      return { top10HolderPercent: null, holderCount: null };
    }
  }

  async checkHealth(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const slot = await this.rpcCall<number>("getSlot", []);
      const latencyMs = Date.now() - startTime;

      return {
        providerId: "solana-rpc",
        name: "Solana RPC / On-Chain Inspector",
        category: "rpc",
        status: slot !== null ? "healthy" : "degraded",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        details: { currentSlot: slot, endpoint: this.endpoint.split("?")[0] },
      };
    } catch (e) {
      return {
        providerId: "solana-rpc",
        name: "Solana RPC / On-Chain Inspector",
        category: "rpc",
        status: "unavailable",
        latencyMs: Date.now() - startTime,
        lastCheckedAt: new Date().toISOString(),
        details: { error: String(e) },
      };
    }
  }
}
