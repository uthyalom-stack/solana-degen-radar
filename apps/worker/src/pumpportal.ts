interface PumpPortalEnv {
  DB: D1Database;
  PUMPPORTAL_API_KEY?: string;
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });

type StreamStatus = {
  state: "connected" | "connecting" | "disconnected" | "error";
  connectedAt?: string;
  lastMessageAt?: string;
  receivedEvents?: number;
  lastError?: string;
};

/**
 * Optional PumpPortal stream bridge. It subscribes only to free new-token and
 * migration events; it never subscribes to metered token/account trade streams.
 * The API key is kept in Worker secrets and is never returned to the dashboard.
 */
export class PumpPortalStream {
  private socket?: WebSocket;

  constructor(private readonly state: DurableObjectState, private readonly env: PumpPortalEnv) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/status") return json(await this.state.storage.get<StreamStatus>("status") ?? { state: this.env.PUMPPORTAL_API_KEY ? "disconnected" : "error", lastError: this.env.PUMPPORTAL_API_KEY ? undefined : "PUMPPORTAL_API_KEY is not configured" });
    if (path !== "/start" || request.method !== "POST") return new Response("Not found", { status: 404 });
    if (!this.env.PUMPPORTAL_API_KEY) return json({ state: "error", error: "PUMPPORTAL_API_KEY is not configured" }, 409);
    await this.connect();
    return json({ state: this.socket?.readyState === WebSocket.OPEN ? "connected" : "connecting" });
  }

  async alarm(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      await this.state.storage.put("status", { state: "error", lastError: String(error) } satisfies StreamStatus);
      await this.state.storage.setAlarm(Date.now() + 60_000);
    }
  }

  private async connect(): Promise<void> {
    if (!this.env.PUMPPORTAL_API_KEY) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      await this.state.storage.setAlarm(Date.now() + 10 * 60_000);
      return;
    }

    await this.state.storage.put("status", { state: "connecting" } satisfies StreamStatus);
    const url = `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(this.env.PUMPPORTAL_API_KEY)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      // Only new-token and migration events are subscribed. No trade stream is enabled.
      socket.send(JSON.stringify({ method: "subscribeNewToken" }));
      socket.send(JSON.stringify({ method: "subscribeMigration" }));
      this.state.waitUntil(this.state.storage.put("status", { state: "connected", connectedAt: new Date().toISOString(), receivedEvents: 0 } satisfies StreamStatus));
      this.state.waitUntil(this.state.storage.setAlarm(Date.now() + 10 * 60_000));
    });

    socket.addEventListener("message", event => {
      this.state.waitUntil(this.handleMessage(event.data));
    });

    socket.addEventListener("close", event => {
      this.socket = undefined;
      this.state.waitUntil(this.state.storage.put("status", { state: "disconnected", lastError: `WebSocket closed (${event.code})` } satisfies StreamStatus));
      this.state.waitUntil(this.state.storage.setAlarm(Date.now() + 30_000));
    });

    socket.addEventListener("error", () => {
      this.socket = undefined;
      try { socket.close(); } catch { /* The socket may already be closed. */ }
      this.state.waitUntil(this.state.storage.put("status", { state: "error", lastError: "PumpPortal WebSocket error" } satisfies StreamStatus));
      this.state.waitUntil(this.state.storage.setAlarm(Date.now() + 30_000));
    });
    await this.state.storage.setAlarm(Date.now() + 10 * 60_000);
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      const raw = typeof data === "string" ? data : "";
      if (!raw || raw.length > 25_000) return;
      const event: any = JSON.parse(raw);
      const mint = typeof event.mint === "string" ? event.mint : "";
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
      const observedAt = new Date().toISOString();
      const eventType = String(event.txType || event.type || "unknown").slice(0, 40);
      const metadata = JSON.stringify({ provider: "pumpportal", eventType, uri: event.uri ?? null, raw: event });
      await this.env.DB.batch([
        this.env.DB.prepare(`INSERT INTO tokens (mint,name,symbol,first_seen_at,source,metadata_json) VALUES (?,?,?,?,?,?)
          ON CONFLICT(mint) DO UPDATE SET name=COALESCE(tokens.name,excluded.name),symbol=COALESCE(tokens.symbol,excluded.symbol),metadata_json=json_patch(COALESCE(tokens.metadata_json,'{}'),excluded.metadata_json)`)
          .bind(mint, typeof event.name === "string" ? event.name.slice(0, 160) : null, typeof event.symbol === "string" ? event.symbol.slice(0, 40) : null, observedAt, "pumpportal", metadata),
        this.env.DB.prepare("INSERT OR IGNORE INTO pumpportal_events (id,mint,event_type,observed_at,raw_json) VALUES (?,?,?,?,?)")
          .bind(String(event.signature || event.txHash || crypto.randomUUID()).slice(0, 200), mint, eventType, observedAt, metadata),
      ]);
      const status = await this.state.storage.get<StreamStatus>("status") ?? { state: "connected" as const };
      await this.state.storage.put("status", { ...status, state: "connected", lastMessageAt: observedAt, receivedEvents: (status.receivedEvents ?? 0) + 1 });
    } catch (error) {
      await this.state.storage.put("status", { state: "error", lastError: `Could not store stream event: ${String(error)}` } satisfies StreamStatus);
    }
  }
}
