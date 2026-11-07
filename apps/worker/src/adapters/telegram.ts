import type { Env, SocialAdapter } from "../types";
import type { ProviderHealth } from "@radar/shared";

export class TelegramAdapter implements SocialAdapter {
  id = "telegram";
  name = "Telegram Channels & Alerts";
  platform = "telegram";

  async fetchObservations(_env: Env) {
    // Telegram is primarily push-based via webhook
    return [];
  }

  async checkHealth(env: Env): Promise<ProviderHealth> {
    const isConfigured = Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
    const webhookReady = Boolean(env.TELEGRAM_WEBHOOK_SECRET);

    if (!isConfigured) {
      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: "disabled",
        lastCheckedAt: new Date().toISOString(),
        details: { message: "Bot token or chat ID not set in secrets" },
      };
    }

    const startTime = Date.now();
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
      const payload: any = await res.json().catch(() => ({}));
      const latencyMs = Date.now() - startTime;

      return {
        providerId: this.id,
        name: this.name,
        category: "social",
        status: res.ok && payload.ok ? "healthy" : "degraded",
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
        details: { botUsername: payload?.result?.username, webhookConfigured: webhookReady },
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

  static async sendAlert(env: Env, text: string): Promise<boolean> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          disable_web_page_preview: true,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      return res.ok && data.ok === true;
    } catch {
      return false;
    }
  }
}
