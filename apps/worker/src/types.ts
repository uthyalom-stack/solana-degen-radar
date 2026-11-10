import type { SecurityEvidence, LaunchpadType, ProviderHealth } from "@radar/shared";

export interface Env {
  DB: D1Database;
  APP_ENV: string;
  DASHBOARD_ORIGIN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOWED_CHANNELS?: string;
  DEXSCREENER_BASE_URL?: string;
  ADMIN_SECRET?: string;
  INTERNAL_WORKER_SECRET?: string;
  SOCIAL_INGEST_SECRET?: string;
  SOCIAL_RSS_FEEDS?: string;
  SOLANA_RPC_URL?: string;
  HELIUS_API_KEY?: string;
  PUMPPORTAL_API_KEY?: string;
  PUMPPORTAL_STREAM: DurableObjectNamespace;
  PAPER_STARTING_BALANCE?: string;
  X_BEARER_TOKEN?: string;
  REDDIT_USER_AGENT?: string;
  JITO_TIP_ACCOUNTS?: string;
  BRIDGE_PROGRAM_IDS?: string;
  SOLANA_DISCOVERY_PROGRAM_IDS?: string;
}

export type Pair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  boosts?: { active?: number };
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: Array<{ label?: string; url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
};

export interface TokenRow {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  first_seen_at: string;
  source: string;
  metadata_json: string | null;
  creator_address?: string | null;
  launchpad?: string | null;
  holder_count?: number | null;
  is_migrated?: number | null;
  migration_target?: string | null;
  lp_burned_percent?: number | null;
  top10_holder_percent?: number | null;
}

export interface SocialAdapter {
  id: string;
  name: string;
  platform: string;
  fetchObservations(env: Env): Promise<Array<{
    source: string;
    sourceId: string;
    text: string;
    url?: string;
    observedAt: string;
    metrics?: Record<string, number>;
  }>>;
  checkHealth(env: Env): Promise<ProviderHealth>;
}
