import type { Env, SocialAdapter } from "../types";
import type { ProviderHealth } from "@radar/shared";

type XUser = {
  id: string;
  username?: string;
  created_at?: string;
  verified?: boolean;
  public_metrics?: { followers_count?: number };
};

type XTweet = {
  id: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    retweet_count?: number;
    reply_count?: number;
    quote_count?: number;
  };
};

/**
 * X recent-search adapter.
 * Uses several low-noise discovery lanes and keeps query provenance with each observation.
 * Only official X API v2 is used; there is no browser scraping or unofficial endpoint.
 */
export class XAdapter implements SocialAdapter {
  id = "x";
  name = "X (Twitter) Early Discovery";
  platform = "x";

  private buildQueries(env: Env): Array<{ type: string; query: string }> {
    const configured = (env.X_SEARCH_QUERIES || "")
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 8);

    const base = configured.length ? configured.map((query, i) => ({ type: `custom_${i + 1}`, query })) : [
      { type: "launch_links", query: '(pump.fun OR pumpportal) (solana OR $SOL) -is:retweet lang:en' },
      { type: "chart_links", query: '(dexscreener.com OR birdeye.so) solana -is:retweet lang:en' },
      { type: "contract_callouts", query: '(CA OR mint OR "contract address") (solana OR $SOL) (meme OR token) -is:retweet lang:en' },
      { type: "emerging_narratives", query: '("solana meme" OR solanamemecoin OR "new meme coin") -is:retweet lang:en' },
    ];

    const tracked = (env.X_TRACKED_ACCOUNTS || "")
      .split(",")
      .map(value => value.trim().replace(/^@/, ""))
      .filter(value => /^[A-Za-z0-9_]{1,15}$/.test(value))
      .slice(0, 8);
    for (const username of tracked) {
      base.push({ type: "tracked_caller", query: `from:${username} (solana OR $SOL OR pump.fun) -is:retweet` });
    }
    return base.slice(0, 12);
  }

  async fetchObservations(env: Env) {
    if (!env.X_BEARER_TOKEN) return [];

    const observations: Array<{
      source: string;
      sourceId: string;
      text: string;
      url?: string;
      observedAt: string;
      metrics?: Record<string, unknown>;
    }> = [];
    const seen = new Set<string>();

    for (const lane of this.buildQueries(env)) {
      try {
        const params = new URLSearchParams({
          query: lane.query,
          max_results: "10",
          "tweet.fields": "created_at,public_metrics,author_id",
          expansions: "author_id",
          "user.fields": "created_at,public_metrics,verified,username",
        });
        const response = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params.toString()}`, {
          headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}`, Accept: "application/json" },
        });
        if (!response.ok) {
          console.warn("X search lane unavailable", lane.type, response.status);
          continue;
        }

        const payload = await response.json() as { data?: XTweet[]; includes?: { users?: XUser[] } };
        const users = new Map((payload.includes?.users || []).map(user => [user.id, user]));
        for (const tweet of payload.data || []) {
          if (!tweet.id || seen.has(tweet.id)) continue;
          seen.add(tweet.id);
          const author = tweet.author_id ? users.get(tweet.author_id) : undefined;
          const metrics = tweet.public_metrics || {};
          const likes = Number(metrics.like_count || 0);
          const reposts = Number(metrics.retweet_count || 0);
          const replies = Number(metrics.reply_count || 0);
          const quotes = Number(metrics.quote_count || 0);
          observations.push({
            source: "x:search",
            sourceId: `x_${tweet.id}`,
            text: String(tweet.text || "").slice(0, 5000),
            url: `https://x.com/i/status/${tweet.id}`,
            observedAt: tweet.created_at || new Date().toISOString(),
            metrics: {
              likes,
              retweets: reposts,
              replies,
              quotes,
              engagement: likes + reposts * 3 + replies + quotes * 2,
              authorId: author?.id || "",
              username: author?.username || "",
              followers: Number(author?.public_metrics?.followers_count || 0),
              verified: author?.verified ? 1 : 0,
              accountCreatedAt: author?.created_at || "",
              
              queryLane: lane.type === "launch_links" ? 1 : lane.type === "chart_links" ? 2 : lane.type === "contract_callouts" ? 3 : lane.type === "emerging_narratives" ? 4 : 5,
            },
          });
        }
      } catch (error) {
        console.error("X adapter lane error:", lane.type, error);
      }
    }
    return observations;
  }

  async checkHealth(env: Env): Promise<ProviderHealth> {
    if (!env.X_BEARER_TOKEN) {
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: "disabled",
        lastCheckedAt: new Date().toISOString(),
        details: { message: "X_BEARER_TOKEN secret is not set (official API access required)" },
      };
    }

    const startTime = Date.now();
    try {
      const params = new URLSearchParams({ query: "solana -is:retweet", max_results: "10" });
      const response = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params.toString()}`, {
        headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      });
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: response.ok ? "healthy" : response.status === 429 ? "degraded" : "unavailable",
        latencyMs: Date.now() - startTime,
        lastCheckedAt: new Date().toISOString(),
        details: { httpStatus: response.status, queryLanes: this.buildQueries(env).length },
      };
    } catch (error) {
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: "unavailable",
        latencyMs: Date.now() - startTime,
        lastCheckedAt: new Date().toISOString(),
        details: { error: String(error) },
      };
    }
  }
}
