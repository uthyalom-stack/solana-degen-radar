import type { Env } from "../types";
import type { LiveTransactionRecord } from "@radar/shared";

export class LiveSwapService {
  /**
   * Get dynamic decimals for token mint via RPC
   */
  static async getMintDecimals(env: Env, mint: string): Promise<number> {
    if (mint === "So11111111111111111111111111111111111111112") return 9; // SOL has 9 decimals
    const rpcUrl = env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
      : (env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenSupply",
          params: [mint, { commitment: "confirmed" }],
        }),
      });
      const data: any = await res.json();
      return data?.result?.value?.decimals ?? 6;
    } catch {
      return 6; // Fallback to 6 decimals if RPC unreachable
    }
  }

  /**
   * Fetch SPL token balances (both Tokenkeg and Token-2022) for a wallet
   */
  static async getWalletSplBalances(env: Env, walletAddress: string): Promise<Array<{ mint: string; amount: string; decimals: number; uiAmount: number; program: string }>> {
    const rpcUrl = env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
      : (env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");

    const programs = [
      { name: "Tokenkeg", id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { name: "Token-2022", id: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
    ];

    const allBalances: Array<{ mint: string; amount: string; decimals: number; uiAmount: number; program: string }> = [];

    for (const prog of programs) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenAccountsByOwner",
            params: [
              walletAddress,
              { programId: prog.id },
              { encoding: "jsonParsed", commitment: "confirmed" },
            ],
          }),
        });
        const data: any = await res.json();
        const accounts = data?.result?.value || [];
        for (const a of accounts) {
          const info = a.account?.data?.parsed?.info;
          allBalances.push({
            mint: info?.mint,
            amount: info?.tokenAmount?.amount || "0",
            decimals: info?.tokenAmount?.decimals || 6,
            uiAmount: info?.tokenAmount?.uiAmount || 0,
            program: prog.name,
          });
        }
      } catch {
        // Fallback gracefully on program query failure
      }
    }

    return allBalances;
  }

  /**
   * Request live Jupiter quote with dynamic decimal support
   */
  static async getQuote(
    inputMint: string,
    outputMint: string,
    amountLamports: string,
    slippageBps = 50
  ): Promise<any> {
    const url = `https://api.jup.ag/swap/v1/quote?inputMint=${encodeURIComponent(
      inputMint
    )}&outputMint=${encodeURIComponent(
      outputMint
    )}&amount=${encodeURIComponent(amountLamports)}&slippageBps=${slippageBps}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "SolanaDegenRadar/1.0" },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Jupiter quote error (${res.status}): ${err}`);
    }
    return await res.json();
  }

  /**
   * Build serialized VersionedTransaction for Phantom signing
   */
  static async buildSwapTransaction(
    quoteResponse: any,
    userPublicKey: string,
    prioritizationFeeLamports: number | "auto" = "auto"
  ): Promise<{
    swapTransaction: string;
    lastValidBlockHeight: number;
    feePayer: string;
  }> {
    if (!userPublicKey || !quoteResponse) {
      throw new Error("Missing userPublicKey or quoteResponse");
    }

    const res = await fetch("https://api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "SolanaDegenRadar/1.0",
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Jupiter swap transaction build failed (${res.status}): ${err}`);
    }

    const data: any = await res.json();
    return {
      swapTransaction: data.swapTransaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
      feePayer: userPublicKey,
    };
  }

  /**
   * Record submitted transaction in database
   */
  static async recordSubmittedTransaction(
    db: D1Database,
    tx: {
      signature: string;
      walletAddress: string;
      inputMint: string;
      outputMint: string;
      inputAmount: number;
      outputAmount: number;
      slippageBps: number;
      priceImpactPct?: number;
      routePlan?: unknown;
    }
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO live_transactions (
           signature, wallet_address, input_mint, output_mint, input_amount, output_amount,
           slippage_bps, price_impact_pct, status, submitted_at, route_plan_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`
      )
      .bind(
        tx.signature,
        tx.walletAddress,
        tx.inputMint,
        tx.outputMint,
        tx.inputAmount,
        tx.outputAmount,
        tx.slippageBps,
        tx.priceImpactPct || 0,
        new Date().toISOString(),
        JSON.stringify(tx.routePlan || {})
      )
      .run();
  }

  /**
   * Check on-chain confirmation status of a submitted transaction via Solana RPC
   */
  static async checkTransactionStatus(
    db: D1Database,
    env: Env,
    signature: string
  ): Promise<{
    signature: string;
    status: "submitted" | "confirming" | "confirmed" | "failed" | "expired";
    confirmations?: number;
    err?: any;
  }> {
    const rpcUrl = env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`
      : (env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }],
        }),
      });

      const data: any = await res.json();
      const statusObj = data?.result?.value?.[0];

      if (!statusObj) {
        return { signature, status: "submitted" };
      }

      if (statusObj.err) {
        await db
          .prepare("UPDATE live_transactions SET status = 'failed', error_message = ? WHERE signature = ?")
          .bind(JSON.stringify(statusObj.err), signature)
          .run();
        return { signature, status: "failed", err: statusObj.err };
      }

      if (statusObj.confirmationStatus === "finalized" || statusObj.confirmationStatus === "confirmed") {
        await db
          .prepare("UPDATE live_transactions SET status = 'confirmed', confirmed_at = ? WHERE signature = ?")
          .bind(new Date().toISOString(), signature)
          .run();
        return { signature, status: "confirmed", confirmations: statusObj.confirmations };
      }

      return { signature, status: "confirming", confirmations: statusObj.confirmations };
    } catch {
      return { signature, status: "submitted" };
    }
  }

  /**
   * Get user's live transaction history
   */
  static async getTransactionHistory(db: D1Database, walletAddress?: string): Promise<LiveTransactionRecord[]> {
    const query = walletAddress
      ? db.prepare("SELECT * FROM live_transactions WHERE wallet_address = ? ORDER BY submitted_at DESC LIMIT 50").bind(walletAddress)
      : db.prepare("SELECT * FROM live_transactions ORDER BY submitted_at DESC LIMIT 50");

    const rows = await query.all<any>();
    return (rows.results || []).map(r => ({
      signature: r.signature,
      walletAddress: r.wallet_address,
      inputMint: r.input_mint,
      outputMint: r.output_mint,
      inputAmount: r.input_amount,
      outputAmount: r.output_amount,
      slippageBps: r.slippage_bps,
      priceImpactPct: r.price_impact_pct,
      status: r.status,
      errorMessage: r.error_message,
      submittedAt: r.submitted_at,
      confirmedAt: r.confirmed_at,
      routePlan: JSON.parse(r.route_plan_json || "{}"),
    }));
  }
}
