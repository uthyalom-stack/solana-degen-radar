import type { Env, SocialAdapter } from "../types";
import type { ProviderHealth } from "@radar/shared";

/**
 * X (Twitter) Adapter:
 * Uses Twitter API v2 recent search (`/2/tweets/search/recent`) when `X_BEARER_TOKEN` is configured.
 * When unconfigured or rate limited, gracefully reports status without breaking execution.
 */
export class XAdapter implements SocialAdapter {
  id = "x";
  name = "X (Twitter) Crypto Search";
  platform = "x";

  async fetchObservations(env: Env) {
    if (!env.X_BEARER_TOKEN) {
      return [];
    }

    try {
      const query = encodeURIComponent("(#solana OR solana OR $SOL) (meme OR pump OR launch) -is:retweet lang:en");
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=created_at,public_metrics`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
          Accept: "application/json",
        },
      });

      if (!res.ok) return [];

      const data: any = await res.json();
      const tweets = data?.data || [];

      return tweets.map((t: any) => ({
        source: "x:search",
        sourceId: `x_${t.id}`,
        text: String(t.text || "").slice(0, 5000),
        url: `https://x.com/i/status/${t.id}`,
        observedAt: t.created_at || new Date().toISOString(),
        metrics: {
          likes: t.public_metrics?.like_count || 0,
          retweets: t.public_metrics?.retweet_count || 0,
          engagement: (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) * 3,
        },
      }));
    } catch (err) {
      console.error("X adapter error:", err);
      return [];
    }
  }

  async checkHealth(env: Env): Promise<ProviderHealth> {
    if (!env.X_BEARER_TOKEN) {
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: "disabled",
        lastCheckedAt: new Date().toISOString(),
        details: { message: "X_BEARER_TOKEN secret is not set (API access required)" },
      };
    }

    const startTime = Date.now();
    try {
      const res = await fetch("https://api.twitter.com/2/tweets/search/recent?query=solana&max_results=10", {
        headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      });
      const latencyMs = Date.now() - startTime;

      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: res.ok ? "healthy" : res.status === 429 ? "degraded" : "unavailable",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        details: { httpStatus: res.status },
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
