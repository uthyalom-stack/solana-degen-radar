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
    hasPermanentDelegate?: boolean;
    hasNonTransferable?: boolean;
    defaultAccountState?: string | null;
    detectedExtensions?: string[];
    unknownExtensions?: number[];
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
      let hasPermanentDelegate = false;
      let hasNonTransferable = false;
      let defaultAccountState: string | null = null;
      const detectedExtensions: string[] = [];
      const unknownExtensions: number[] = [];

      // Official SPL Token-2022 Mint binary layout:
      // Base mint struct: 82 bytes (offset 0..81)
      // Padded to base account size: bytes 0..164 (165 bytes total account size in Tokenkeg)
      // Account type tag: 1 byte at byte 165 (value 1 for Mint)
      // Extension TLV entries begin strictly at byte 166.
      if (isToken2022 && bytes.length >= 170) {
        let offset = 166;
        while (offset + 4 <= bytes.length) {
          const extType = view.getUint16(offset, true);
          const extLen = view.getUint16(offset + 2, true);
          const dataStart = offset + 4;

          if (dataStart + extLen > bytes.length) break;

          // Official SPL Token-2022 extension type identifiers:
          // TransferFeeConfig = 1
          // DefaultAccountState = 6
          // NonTransferable = 9
          // PermanentDelegate = 12
          // TransferHook = 14
          switch (extType) {
            case 1: { // TransferFeeConfig
              detectedExtensions.push("TransferFeeConfig");
              if (extLen >= 108) {
                const feeBps = view.getUint16(dataStart + 106, true);
                transferFeePercent = feeBps / 100;
              } else if (extLen >= 90) {
                const feeBps = view.getUint16(dataStart + 88, true);
                transferFeePercent = feeBps / 100;
              }
              break;
            }
            case 6: { // DefaultAccountState (Official Type 6)
              detectedExtensions.push("DefaultAccountState");
              // SPL Token AccountState enum: 0 = Uninitialized, 1 = Initialized, 2 = Frozen
              const stateByte = bytes[dataStart];
              defaultAccountState = stateByte === 0 ? "uninitialized" : stateByte === 1 ? "initialized" : stateByte === 2 ? "frozen" : "unknown";
              break;
            }
            case 9: { // NonTransferable (Official Type 9)
              detectedExtensions.push("NonTransferable");
              hasNonTransferable = true;
              break;
            }
            case 12: { // PermanentDelegate (Official Type 12)
              detectedExtensions.push("PermanentDelegate");
              hasPermanentDelegate = true;
              break;
            }
            case 14: { // TransferHook (Official Type 14)
              detectedExtensions.push("TransferHook");
              if (extLen >= 64) {
                hasTransferHook = true;
              }
              break;
            }
            default: {
              detectedExtensions.push(`UnknownExtension(${extType})`);
              unknownExtensions.push(extType);
              break;
            }
          }

          offset = dataStart + extLen;
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
        hasPermanentDelegate,
        hasNonTransferable,
        defaultAccountState,
        detectedExtensions,
        unknownExtensions,
      };
    } catch {
      return { mintAuthority: null, freezeAuthority: null, initialized: null, decimals: null, tokenProgram: "unknown", transferFeePercent: null, hasTransferHook: false };
    }
  }

  /**
   * Verify LP Burn by resolving token account owners and checking token supply owned by burn addresses
   */
  async verifyLpBurn(lpMint: string): Promise<number | null> {
    try {
      // Verified Solana burn addresses:
      // 1. Solana System Program (tokens transferred to an account owned by System Program cannot be transferred out)
      // 2. Solana Incinerator
      const BURN_ADDRESSES = new Set([
        "11111111111111111111111111111111",
        "1nc1nerator11111111111111111111111111111111",
      ]);

      const [largest, supply] = await Promise.all([
        this.rpcCall<{ value: Array<{ address: string; amount: string }> }>("getTokenLargestAccounts", [
          lpMint,
          { commitment: "confirmed" },
        ]),
        this.rpcCall<{ value: { amount: string } }>("getTokenSupply", [
          lpMint,
          { commitment: "confirmed" },
        ]),
      ]);

      const totalSupply = Number(supply?.value?.amount) || 0;
      if (totalSupply <= 0 || !largest?.value || !largest.value.length) return null;

      // Resolve true owners of the top LP accounts
      const accountAddresses = largest.value.map(a => a.address);
      const ownerMap = await this.resolveTokenAccountOwners(accountAddresses);

      let burnedAmount = 0;
      for (const account of largest.value) {
        const owner = ownerMap.get(account.address) || account.address;
        if (BURN_ADDRESSES.has(owner)) {
          burnedAmount += Number(account.amount) || 0;
        }
      }

      return Math.min(100, Number(((burnedAmount / totalSupply) * 100).toFixed(2)));
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
   * Resolve true wallet owners for SPL token accounts (reading owner at bytes 32..64)
   */
  async resolveTokenAccountOwners(tokenAccounts: string[]): Promise<Map<string, string>> {
    const ownerMap = new Map<string, string>();
    if (!tokenAccounts.length) return ownerMap;

    try {
      const accountsInfo = await this.rpcCall<{ value: Array<{ data: [string, string] } | null> }>("getMultipleAccounts", [
        tokenAccounts.slice(0, 20),
        { encoding: "base64", commitment: "confirmed" },
      ]);

      const base58Chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const toBase58 = (bytes: Uint8Array): string => {
        const digits = [0];
        for (let i = 0; i < bytes.length; i++) {
          let carry = bytes[i];
          for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
          }
          while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
          }
        }
        let str = "";
        for (let i = 0; i < bytes.length && bytes[i] === 0; i++) str += "1";
        for (let i = digits.length - 1; i >= 0; i--) str += base58Chars[digits[i]];
        return str;
      };

      const values = accountsInfo?.value || [];
      for (let i = 0; i < values.length; i++) {
        const info = values[i];
        const accountAddress = tokenAccounts[i];
        if (!info || !info.data?.[0]) {
          ownerMap.set(accountAddress, accountAddress);
          continue;
        }

        const bytes = Uint8Array.from(atob(info.data[0]), c => c.charCodeAt(0));
        if (bytes.length >= 64) {
          const ownerBytes = bytes.slice(32, 64);
          const ownerPubkey = toBase58(ownerBytes);
          ownerMap.set(accountAddress, ownerPubkey);
        } else {
          ownerMap.set(accountAddress, accountAddress);
        }
      }
      return ownerMap;
    } catch {
      return ownerMap;
    }
  }

  /**
   * Fetch and parse actual transaction details for shared funding analysis
   */
  async getParsedTransaction(signature: string): Promise<{
    signature: string;
    blockTime: number | null;
    transfers: Array<{ from: string; to: string; lamports: number }>;
  } | null> {
    try {
      const tx = await this.rpcCall<any>("getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);

      if (!tx) return null;
      const transfers: Array<{ from: string; to: string; lamports: number }> = [];

      const instructions = tx.transaction?.message?.instructions || [];
      for (const ix of instructions) {
        if (ix.program === "system" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info;
          transfers.push({
            from: info.source,
            to: info.destination,
            lamports: Number(info.lamports) || 0,
          });
        }
      }

      return {
        signature,
        blockTime: tx.blockTime,
        transfers,
      };
    } catch {
      return null;
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

  /**
   * Discover fresh SPL Token / Token-2022 mint initializations directly from program history.
   * This is a bounded recent-signature poll, not a substitute for a paid streaming/indexing feed.
   */
  async discoverRecentMintInitializations(limit = 8): Promise<Array<{
    mint: string; signature: string; slot: number | null; blockTime: number | null;
    decimals: number | null; mintAuthority: string | null; tokenProgram: string;
  }>> {
    const programs = [
      { id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", name: "Tokenkeg" },
      { id: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", name: "Token-2022" },
    ];
    const found = new Map<string, {
      mint: string; signature: string; slot: number | null; blockTime: number | null;
      decimals: number | null; mintAuthority: string | null; tokenProgram: string;
    }>();
    for (const program of programs) {
      const signatures = await this.rpcCall<Array<{ signature: string; slot: number; blockTime: number | null }>>(
        "getSignaturesForAddress", [program.id, { limit: Math.max(1, Math.min(limit, 20)), commitment: "confirmed" }]
      );
      for (const entry of signatures || []) {
        const tx = await this.rpcCall<any>("getTransaction", [
          entry.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }
        ]);
        const instructions: any[] = [
          ...(tx?.transaction?.message?.instructions || []),
          ...((tx?.meta?.innerInstructions || []).flatMap((group: any) => group.instructions || [])),
        ];
        for (const instruction of instructions) {
          const parsed = instruction?.parsed;
          const type = String(parsed?.type || "").toLowerCase();
          if (!["initializemint", "initializemint2"].includes(type)) continue;
          const info = parsed?.info || {};
          const mint = typeof info.mint === "string" ? info.mint : "";
          if (!mint || mint.length < 32 || mint.length > 64) continue;
          found.set(mint, {
            mint,
            signature: entry.signature,
            slot: Number.isFinite(Number(entry.slot)) ? Number(entry.slot) : null,
            blockTime: entry.blockTime ?? null,
            decimals: Number.isInteger(Number(info.decimals)) ? Number(info.decimals) : null,
            mintAuthority: typeof info.mintAuthority === "string" ? info.mintAuthority : null,
            tokenProgram: program.name,
          });
        }
      }
    }
    return Array.from(found.values());
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
