"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Track = {
  id: string; uri: string; name: string; artists: { name: string }[];
  album: { name: string; images?: { url: string }[] }; duration_ms: number;
};
type SpotifySdkPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (data: any) => void): boolean;
  removeListener(event: string): boolean;
  getCurrentState(): Promise<any>;
  togglePlay(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
};
declare global {
  interface Window {
    Spotify?: { Player: new (options: { name: string; volume: number; getOAuthToken: (cb: (token: string) => void) => void }) => SpotifySdkPlayer };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}
const AUTH_KEY = "sdr_spotify_session";
const VERIFIER_KEY = "sdr_spotify_verifier";
const CLIENT_ID = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || "";
const REDIRECT_URI = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI || (typeof window !== "undefined" ? window.location.origin : "");

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
async function createVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
async function challenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Spotify authorization failed");
  return data;
}
async function validSession() {
  let session = readSession();
  if (!session?.accessToken) return null;
  if (Date.now() < session.expiresAt - 60_000) return session;
  if (!session.refreshToken) { sessionStorage.removeItem(AUTH_KEY); return null; }
  const data = await tokenRequest(new URLSearchParams({
    grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: CLIENT_ID,
  }));
  session = { ...session, accessToken: data.access_token, refreshToken: data.refresh_token || session.refreshToken, expiresAt: Date.now() + data.expires_in * 1000 };
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

export default function SpotifyPlayer() {
  const playerRef = useRef<SpotifySdkPlayer | null>(null);
  const deviceRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(65);
  const [sdkReady, setSdkReady] = useState(false);

  const token = useCallback(async () => {
    const session = await validSession();
    if (!session) throw new Error("Connect your Spotify account again.");
    return session.accessToken as string;
  }, []);

  const connectAccount = useCallback(async () => {
    if (!CLIENT_ID) { setError("Spotify is not configured. Add NEXT_PUBLIC_SPOTIFY_CLIENT_ID and the matching redirect URI."); return; }
    if (!REDIRECT_URI) { setError("Spotify redirect URI is missing."); return; }
    const verifier = await createVerifier();
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    const scopes = ["streaming","user-read-email","user-read-private","user-read-playback-state","user-modify-playback-state","user-read-currently-playing"];
    const params = new URLSearchParams({
      client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI,
      code_challenge_method: "S256", code_challenge: await challenge(verifier), scope: scopes.join(" "),
    });
    window.location.assign("https://accounts.spotify.com/authorize?" + params.toString());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function callback() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const authError = url.searchParams.get("error");
      if (authError) { setError("Spotify authorization was declined."); url.searchParams.delete("error"); window.history.replaceState({}, "", url); return; }
      if (!code) { setAuthorized(Boolean(readSession()?.accessToken)); return; }
      const verifier = sessionStorage.getItem(VERIFIER_KEY);
      if (!verifier || !CLIENT_ID) { setError("Spotify sign-in could not be completed. Please connect again."); return; }
      try {
        setBusy(true);
        const data = await tokenRequest(new URLSearchParams({
          grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID, code_verifier: verifier,
        }));
        sessionStorage.setItem(AUTH_KEY, JSON.stringify({
          accessToken: data.access_token, refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        }));
        sessionStorage.removeItem(VERIFIER_KEY);
        url.searchParams.delete("code"); url.searchParams.delete("state");
        window.history.replaceState({}, "", url);
        if (!cancelled) setAuthorized(true);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Spotify sign-in failed."); }
      finally { if (!cancelled) setBusy(false); }
    }
    void callback();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authorized || !CLIENT_ID) return;
    let disposed = false;
    const init = async () => {
      try {
        await token();
        if (!window.Spotify) {
          await new Promise<void>((resolve, reject) => {
            const existing = document.querySelector<HTMLScriptElement>('script[data-spotify-sdk="true"]');
            if (existing) { if (window.Spotify) resolve(); else existing.addEventListener("load", () => resolve(), { once: true }); return; }
            const script = document.createElement("script");
            script.src = "https://sdk.scdn.co/spotify-player.js"; script.async = true; script.dataset.spotifySdk = "true";
            script.onload = () => resolve(); script.onerror = () => reject(new Error("Spotify player SDK failed to load"));
            document.body.appendChild(script);
            window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);
          });
        }
        if (window.Spotify) setSdkReady(true);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not initialize Spotify."); }
    };
    void init();
    return () => { disposed = true; if (disposed) playerRef.current?.disconnect(); };
  }, [authorized, token]);

  useEffect(() => {
    if (!authorized || !sdkReady || !window.Spotify || playerRef.current) return;
    let active = true;
    const player = new window.Spotify.Player({
      name: "Solana Degen Radar",
      volume: volume / 100,
      getOAuthToken: async cb => { try { cb(await token()); } catch (e) { setError(e instanceof Error ? e.message : "Spotify token expired."); } },
    });
    playerRef.current = player;
    player.addListener("ready", ({ device_id }: { device_id: string }) => { if (active) { deviceRef.current = device_id; setConnected(true); setError(""); } });
    player.addListener("not_ready", () => { if (active) setConnected(false); });
    player.addListener("player_state_changed", state => {
      if (!active || !state) return;
      setPlaying(!state.paused); setPosition(state.position || 0); setDuration(state.duration || 0);
      const t = state.track_window?.current_track;
      if (t) setTrack({ id:t.id, uri:t.uri, name:t.name, artists:t.artists || [], album:{ name:t.album?.name || "", images:t.album?.images || [] }, duration_ms:state.duration || 0 });
    });
    player.addListener("authentication_error", ({message}: {message:string}) => setError(message));
    player.addListener("account_error", () => setError("Spotify Premium is required for in-app playback."));
    player.addListener("initialization_error", ({message}: {message:string}) => setError(message));
    player.addListener("playback_error", ({message}: {message:string}) => setError(message));
    void player.connect().then(ok => { if (!ok && active) setError("Spotify player could not connect. Check your Premium account and browser permissions."); });
    return () => { active = false; player.disconnect(); playerRef.current = null; };
  }, [authorized, sdkReady, token, volume]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const accessToken = await token();
    const response = await fetch("https://api.spotify.com/v1" + path, {
      ...init, headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Spotify request failed");
    return data;
  }, [token]);

  const search = async () => {
    if (!query.trim()) return;
    try { setBusy(true); setError(""); const data = await api("/search?type=track&limit=8&q=" + encodeURIComponent(query.trim())); setResults(data.tracks?.items || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Search failed."); }
    finally { setBusy(false); }
  };

  const play = async (uri: string) => {
    if (!deviceRef.current) { setError("Spotify player is still connecting. Wait a moment and try again."); return; }
    try { setBusy(true); await api("/me/player/play?device_id=" + encodeURIComponent(deviceRef.current), { method:"PUT", body:JSON.stringify({ uris:[uri] }) }); setResults([]); setExpanded(true); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start playback."); }
    finally { setBusy(false); }
  };

  const disconnect = () => {
    playerRef.current?.disconnect(); playerRef.current = null; deviceRef.current = null;
    sessionStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(VERIFIER_KEY);
    setAuthorized(false); setConnected(false); setPlaying(false); setTrack(null); setResults([]);
  };

  const toggle = async () => { try { await playerRef.current?.togglePlay(); } catch (e) { setError(e instanceof Error ? e.message : "Playback control failed."); } };
  const seek = async (value: number) => { setPosition(value); try { await playerRef.current?.seek(value); } catch {} };

  return (
    <>
      <section className={`spotify-player ${expanded ? "expanded" : ""}`} aria-label="Spotify music player">
        <div className="spotify-player-bar">
          <div className="spotify-art">{track?.album.images?.[0]?.url ? <img src={track.album.images[0].url} alt="" /> : <span>♫</span>}</div>
          <div className="spotify-now-playing">
            <strong>{track?.name || "Your soundtrack"}</strong>
            <span>{track ? track.artists.map(a => a.name).join(", ") : connected ? "Choose a track to start listening" : "Connect your Spotify Premium account"}</span>
          </div>
          <div className="spotify-player-controls">
            {authorized && <button type="button" onClick={toggle} disabled={!connected} aria-label={playing ? "Pause" : "Play"}>{playing ? "Ⅱ" : "▶"}</button>}
            <button type="button" onClick={() => setExpanded(v => !v)} aria-label={expanded ? "Collapse player" : "Expand player"}>{expanded ? "⌄" : "⌃"}</button>
            {!authorized ? <button type="button" className="spotify-connect" onClick={connectAccount} disabled={busy}>Connect Spotify</button> : <button type="button" className="spotify-disconnect" onClick={disconnect}>Disconnect</button>}
          </div>
        </div>
        {expanded && (
          <div className="spotify-player-expanded">
            {authorized && (
              <>
                <div className="spotify-search"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&void search()} placeholder="Search Spotify tracks…" /><button type="button" onClick={()=>void search()} disabled={busy}>Search</button></div>
                {results.length>0 && <div className="spotify-results">{results.map(item=><button type="button" key={item.id} onClick={()=>void play(item.uri)}><span>{item.name}<small>{item.artists.map(a=>a.name).join(", ")}</small></span><b>▶</b></button>)}</div>}
                <div className="spotify-transport"><button type="button" onClick={()=>void playerRef.current?.previousTrack()}>Previous</button><button type="button" onClick={toggle} disabled={!connected}>{playing?"Pause":"Play"}</button><button type="button" onClick={()=>void playerRef.current?.nextTrack()}>Next</button><label>Volume <input type="range" min="0" max="100" value={volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);void playerRef.current?.setVolume(v/100);}} /></label></div>
                <input className="spotify-progress" aria-label="Playback position" type="range" min="0" max={duration||1} value={Math.min(position,duration||1)} onChange={e=>void seek(Number(e.target.value))}/>
                <div className="spotify-times"><span>{Math.floor(position/60000)}:{String(Math.floor(position/1000)%60).padStart(2,"0")}</span><span>{connected?"Spotify Connect device ready":"Connecting player…"}</span><span>{Math.floor(duration/60000)}:{String(Math.floor(duration/1000)%60).padStart(2,"0")}</span></div>
              </>
            )}
            {error && <p className="spotify-error" role="status">{error}</p>}
            {!authorized && <p className="spotify-hint">Connect your Spotify Premium account to search and control playback here. Spotify approval and a registered redirect URI are required for this commercial product.</p>}
          </div>
        )}
      </section>
      <button type="button" className="spotify-mobile-island" onClick={()=>setExpanded(v=>!v)} aria-label="Toggle Spotify player"><span className="spotify-live-dot"/><span>{track?.name || "Spotify"}</span><span>{playing?"Ⅱ":"♫"}</span></button>
    </>
  );
}
