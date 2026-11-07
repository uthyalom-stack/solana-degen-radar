import type { Env, SocialAdapter } from "../types";
import type { ProviderHealth } from "@radar/shared";

/**
 * Reddit Adapter: ingests discussions from Solana and meme-coin communities using Reddit's documented public JSON endpoints.
 */
export class RedditAdapter implements SocialAdapter {
  id = "reddit";
  name = "Reddit Communities";
  platform = "reddit";

  private subreddits = ["solana", "CryptoMoonShots", "memecoins", "SolanaMemeCoins"];

  async fetchObservations(env: Env) {
    const userAgent = env.REDDIT_USER_AGENT || "Mozilla/5.0 (compatible; SolanaDegenRadar/1.0; +https://github.com/solana-degen-radar)";
    const observations: Array<{
      source: string;
      sourceId: string;
      text: string;
      url?: string;
      observedAt: string;
      metrics?: Record<string, number>;
    }> = [];

    for (const sub of this.subreddits) {
      try {
        const url = `https://www.reddit.com/r/${sub}/new.json?limit=25`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": userAgent,
            Accept: "application/json",
          },
        });

        if (!res.ok) continue;

        const data: any = await res.json();
        const posts = data?.data?.children || [];

        for (const post of posts) {
          const p = post.data;
          if (!p || p.over_18 || p.stickied) continue;

          const text = `${p.title || ""}\n${p.selftext || ""}`.trim();
          if (!text) continue;

          const observedAt = p.created_utc
            ? new Date(p.created_utc * 1000).toISOString()
            : new Date().toISOString();

          observations.push({
            source: `reddit:r/${sub}`,
            sourceId: `reddit_${p.id || crypto.randomUUID()}`,
            text: text.slice(0, 5000),
            url: p.permalink ? `https://reddit.com${p.permalink}` : undefined,
            observedAt,
            metrics: {
              upvotes: Number(p.ups) || 0,
              comments: Number(p.num_comments) || 0,
              engagement: (Number(p.ups) || 0) + (Number(p.num_comments) || 0) * 2,
            },
          });
        }
      } catch (err) {
        console.error(`Reddit scan error for r/${sub}:`, err);
      }
    }

    return observations;
  }

  async checkHealth(env: Env): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const userAgent = env.REDDIT_USER_AGENT || "Mozilla/5.0 (compatible; SolanaDegenRadar/1.0)";
      const res = await fetch("https://www.reddit.com/r/solana/new.json?limit=1", {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
      });
      const latencyMs = Date.now() - startTime;

      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: res.ok ? "healthy" : res.status === 429 ? "degraded" : "unavailable",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        details: { httpStatus: res.status, subreddits: this.subreddits },
      };
    } catch (e) {
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: "unavailable",
        latencyMs: Date.now() - startTime,
        lastCheckedAt: new Date().toISOString(),
        details: { error: String(e) },
      };
    }
  }
}
