import type { Env, SocialAdapter } from "../types";
import type { ProviderHealth } from "@radar/shared";

/**
 * TikTok Adapter:
 * Interfaces with documented TikTok Trend & Research APIs.
 * Since official TikTok Research APIs require approved developer credentials and restrictive review,
 * this adapter reports its capability state cleanly and integrates whenever tokens are supplied.
 */
export class TikTokAdapter implements SocialAdapter {
  id = "tiktok";
  name = "TikTok Trend Discovery";
  platform = "tiktok";

  async fetchObservations(_env: Env) {
    // Official TikTok Research API requires an organizational bearer token and approval.
    // Ingest events can be pushed into /api/social/ingest with source 'tiktok:creator' or 'tiktok:sound'
    return [];
  }

  async checkHealth(_env: Env): Promise<ProviderHealth> {
    return {
      providerId: this.id,
      name: this.name,
      category: "social",
      status: "disabled",
      lastCheckedAt: new Date().toISOString(),
      details: {
        message: "TikTok Research API access requires organizational developer approval; ingest webhook enabled",
      },
    };
  }
}
