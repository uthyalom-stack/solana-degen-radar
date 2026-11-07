import type { Env, SocialAdapter } from "../types";
import type { ProviderHealth } from "@radar/shared";

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValue(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (match) return decodeXml(match[1]);
  if (tag === "link") {
    const attr = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    if (attr) return attr[1];
  }
  return "";
}

const DEFAULT_FEEDS = [
  "https://cointelegraph.com/rss",
  "https://coindesk.com/arc/outboundfeeds/rss/",
  "https://decrypt.co/feed",
];

export class RssNewsAdapter implements SocialAdapter {
  id = "rss";
  name = "Crypto News Feeds (RSS/Atom)";
  platform = "news";

  async fetchObservations(env: Env) {
    const customFeeds = (env.SOCIAL_RSS_FEEDS || "")
      .split(/[,\n]/)
      .map(x => x.trim())
      .filter(Boolean);

    const feeds = customFeeds.length > 0 ? customFeeds : DEFAULT_FEEDS;
    const observations: Array<{
      source: string;
      sourceId: string;
      text: string;
      url?: string;
      observedAt: string;
      metrics?: Record<string, number>;
    }> = [];

    for (const feed of feeds) {
      try {
        const parsed = new URL(feed);
        if (parsed.protocol !== "https:") continue;

        const response = await fetch(feed, {
          headers: {
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
            "User-Agent": "SolanaDegenRadar/1.0",
          },
        });
        if (!response.ok) continue;

        const xml = await response.text();
        const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, 30);

        for (const [index, match] of blocks.entries()) {
          const block = match[2];
          const title = xmlValue(block, "title");
          const summary =
            xmlValue(block, "description") ||
            xmlValue(block, "summary") ||
            xmlValue(block, "content");
          const link = xmlValue(block, "link");
          const guid =
            xmlValue(block, "guid") ||
            xmlValue(block, "id") ||
            link ||
            `${feed}#${index}`;
          const published =
            xmlValue(block, "pubDate") ||
            xmlValue(block, "published") ||
            xmlValue(block, "updated");

          const textContent = `${title}\n${summary}`.trim();
          if (!textContent) continue;

          observations.push({
            source: `news:${parsed.hostname}`,
            sourceId: `${feed}:${guid}`,
            text: textContent.slice(0, 5000),
            url: link || feed,
            observedAt:
              published && !Number.isNaN(Date.parse(published))
                ? new Date(published).toISOString()
                : new Date().toISOString(),
            metrics: { engagement: 5 },
          });
        }
      } catch (err) {
        console.error(`RSS fetch error for ${feed}:`, err);
      }
    }

    return observations;
  }

  async checkHealth(env: Env): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const feed = (env.SOCIAL_RSS_FEEDS || "").split(",")[0]?.trim() || DEFAULT_FEEDS[0];
      const res = await fetch(feed, {
        method: "HEAD",
        headers: { "User-Agent": "SolanaDegenRadar/1.0" },
      });
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: res.ok ? "healthy" : "degraded",
        latencyMs: Date.now() - startTime,
        lastCheckedAt: new Date().toISOString(),
        details: { sampleFeed: feed },
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
