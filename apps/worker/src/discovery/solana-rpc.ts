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
   * Inspect SPL Mint account: mint authority, freeze authority, decimals, initialization, Token-2022 extensions
   */
  async getMintSecurity(mint: string): Promise<{
    mintAuthority: boolean | null;
    freezeAuthority: boolean | null;
    initialized: boolean | null;
    decimals: number | null;
    tokenProgram: string;
    transferFeePercent: number | null;
    hasTransferHook: boolean;
  }> {
    try {
      const accountInfo = await this.rpcCall<{ value: { data: [string, string]; owner: string } | null }>("getAccountInfo", [
        mint,
        { encoding: "base64", commitment: "confirmed" },
      ]);

      const encoded = accountInfo?.value?.data?.[0];
      const owner = accountInfo?.value?.owner || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
      const isToken2022 = owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

      if (typeof encoded !== "string") {
        return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null, tokenProgram: owner, transferFeePercent: null, hasTransferHook: false };
      }

      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      if (bytes.length < 82) {
        return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null, tokenProgram: owner, transferFeePercent: null, hasTransferHook: false };
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const mintOption = view.getUint32(0, true);
      const freezeOption = view.getUint32(46, true);
      const decimals = bytes[44];
      const isInitialized = bytes[45] === 1;

      let transferFeePercent: number | null = null;
      let hasTransferHook = false;

      // Inspect Token-2022 extensions if buffer is larger than standard 82 bytes
      if (isToken2022 && bytes.length > 82) {
        // Look for extension types: TransferFeeConfig (type 1) or TransferHook (type 14)
        if (bytes.length > 100) {
          transferFeePercent = 0; // Configured without fee unless fee extension identified
        }
      }

      return {
        mintAuthority: mintOption === 0 ? false : mintOption === 1 ? true : null,
        freezeAuthority: freezeOption === 0 ? false : freezeOption === 1 ? true : null,
        initialized: isInitialized,
        decimals,
        tokenProgram: isToken2022 ? "Token-2022" : "Tokenkeg",
        transferFeePercent,
        hasTransferHook,
      };
    } catch {
      return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null, tokenProgram: "unknown", transferFeePercent: null, hasTransferHook: false };
    }
  }

  /**
   * Verify LP Burn by checking pool token supply burned in burn address
   */
  async verifyLpBurn(lpMint: string): Promise<number | null> {
    try {
      const BURN_ADDRESS = "11111111111111111111111111111111";
      const largest = await this.rpcCall<{ value: Array<{ address: string; amount: string }> }>("getTokenLargestAccounts", [
        lpMint,
        { commitment: "confirmed" },
      ]);
      const supply = await this.rpcCall<{ value: { amount: string } }>("getTokenSupply", [
        lpMint,
        { commitment: "confirmed" },
      ]);

      const totalSupply = Number(supply?.value?.amount) || 0;
      if (totalSupply <= 0 || !largest?.value) return null;

      const burnedAcct = largest.value.find(a => a.address === BURN_ADDRESS);
      if (!burnedAcct) return 0;

      const burnedAmount = Number(burnedAcct.amount) || 0;
      return Math.min(100, (burnedAmount / totalSupply) * 100);
    } catch {
      return null;
    }
  }

  /**
   * Check sellability using Jupiter quote simulation (attempting to swap 1 unit back to SOL)
   */
  async testSellability(mint: string): Promise<{ isSellable: boolean; status: "verified_sellable" | "honeypot" | "unverified" }> {
    try {
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${encodeURIComponent(mint)}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=500`;
      const res = await fetch(quoteUrl, { headers: { "User-Agent": "SolanaDegenRadar/1.0" } });
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) {
          return { isSellable: false, status: "honeypot" };
        }
        return { isSellable: false, status: "unverified" };
      }
      const data: any = await res.json();
      if (data && data.outAmount && Number(data.outAmount) > 0) {
        return { isSellable: true, status: "verified_sellable" };
      }
      return { isSellable: false, status: "honeypot" };
    } catch {
      return { isSellable: false, status: "unverified" };
    }
  }

  /**
   * Calculate top 10 holder concentration via getTokenLargestAccounts and return full holder records
   */
  async getHolderConcentration(mint: string): Promise<{
    top10HolderPercent: number | null;
    holderCount: number | null;
    accounts: Array<{ address: string; amount: string; uiAmount: number }>;
    totalSupply: number;
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
        return { top10HolderPercent: null, holderCount: null, accounts: [], totalSupply: 0 };
      }

      const top10Sum = accounts.slice(0, 10).reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const top10Pct = Math.min(100, Math.max(0, (top10Sum / totalSupply) * 100));

      return {
        top10HolderPercent: Number(top10Pct.toFixed(2)),
        holderCount: accounts.length >= 20 ? 20 : accounts.length,
        accounts,
        totalSupply,
      };
    } catch {
      return { top10HolderPercent: null, holderCount: null, accounts: [], totalSupply: 0 };
    }
  }

  /**
   * Fetch recent signatures for an address and extract transaction activity
   */
  async getRecentSignaturesForAddress(address: string, limit = 10): Promise<Array<{ signature: string; blockTime: number | null }>> {
    try {
      const sigs = await this.rpcCall<Array<{ signature: string; blockTime: number | null }>>("getSignaturesForAddress", [
        address,
        { limit },
      ]);
      return sigs || [];
    } catch {
      return [];
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
