/**
 * Spotify PKCE Service & Capability Manager
 * Follows official Spotify Authorization Code with PKCE Flow for Single Page Applications (SPA).
 */

export interface SpotifyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  artworkUrl: string;
  durationMs: number;
  previewUrl: string | null;
  uri?: string;
}

export interface SpotifyAuthState {
  isConnected: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  error: string | null;
  isPremium?: boolean;
}

export class SpotifyService {
  private static STORAGE_KEY_AUTH = "sdr_spotify_auth";
  private static STORAGE_KEY_VERIFIER = "sdr_spotify_code_verifier";

  static getAuthState(): SpotifyAuthState {
    if (typeof window === "undefined") {
      return { isConnected: false, accessToken: null, refreshToken: null, expiresAt: null, error: null };
    }
    try {
      const data = sessionStorage.getItem(this.STORAGE_KEY_AUTH);
      if (!data) return { isConnected: false, accessToken: null, refreshToken: null, expiresAt: null, error: null };
      const parsed = JSON.parse(data);
      const isExpired = parsed.expiresAt && Date.now() > parsed.expiresAt;
      return {
        isConnected: Boolean(parsed.accessToken && !isExpired),
        accessToken: isExpired ? null : parsed.accessToken,
        refreshToken: parsed.refreshToken || null,
        expiresAt: parsed.expiresAt || null,
        error: isExpired ? "Spotify session expired. Please re-authorize." : null,
        isPremium: parsed.isPremium,
      };
    } catch {
      return { isConnected: false, accessToken: null, refreshToken: null, expiresAt: null, error: null };
    }
  }

  static async initiateAuth(clientId: string, redirectUri: string): Promise<void> {
    if (!clientId) {
      throw new Error("Spotify Client ID is required");
    }

    // Generate random code verifier (43-128 chars)
    const array = new Uint8Array(64);
    window.crypto.getRandomValues(array);
    const codeVerifier = Array.from(array, dec => ("0" + dec.toString(16)).substr(-2)).join("");
    sessionStorage.setItem(this.STORAGE_KEY_VERIFIER, codeVerifier);

    // Hash with SHA-256 for code challenge
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest("SHA-256", data);
    const challengeBytes = new Uint8Array(digest);
    const codeChallenge = btoa(String.fromCharCode(...challengeBytes))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const scopes = [
      "streaming",
      "user-read-email",
      "user-read-private",
      "user-read-playback-state",
      "user-modify-playback-state",
    ].join(" ");

    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(
      clientId
    )}&scope=${encodeURIComponent(scopes)}&code_challenge_method=S256&code_challenge=${encodeURIComponent(
      codeChallenge
    )}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    window.location.href = authUrl;
  }

  static async handleCallback(clientId: string, redirectUri: string, code: string): Promise<SpotifyAuthState> {
    const codeVerifier = sessionStorage.getItem(this.STORAGE_KEY_VERIFIER);
    if (!codeVerifier) {
      throw new Error("PKCE Code verifier missing from session");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Spotify authorization failed: ${err}`);
    }

    const tokenData = await res.json();
    const authState: SpotifyAuthState = {
      isConnected: true,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      error: null,
    };

    sessionStorage.setItem(this.STORAGE_KEY_AUTH, JSON.stringify(authState));
    sessionStorage.removeItem(this.STORAGE_KEY_VERIFIER);

    // Check account capability
    try {
      const userRes = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${authState.accessToken}` },
      });
      if (userRes.ok) {
        const userProfile = await userRes.json();
        authState.isPremium = userProfile.product === "premium";
        sessionStorage.setItem(this.STORAGE_KEY_AUTH, JSON.stringify(authState));
      }
    } catch {
      // Non-fatal profile check
    }

    return authState;
  }

  static disconnect(): void {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(this.STORAGE_KEY_AUTH);
      sessionStorage.removeItem(this.STORAGE_KEY_VERIFIER);
    }
  }
}
