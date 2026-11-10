"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "sdr_spotify_embed_uri";

function toEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.hostname !== "open.spotify.com" && url.hostname !== "spotify.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "embed") parts.shift();
    const kind = parts[0];
    const id = parts[1];
    if (!["track", "album", "playlist", "episode", "show"].includes(kind) || !id || !/^[A-Za-z0-9]+$/.test(id)) return null;
    return `https://open.spotify.com/embed/${kind}/${id}?utm_source=generator&theme=0`;
  } catch {
    return null;
  }
}

export default function SpotifyPlayer() {
  const [input, setInput] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setEmbedUrl(toEmbedUrl(saved));
      setInput(saved);
    }
  }, []);

  const title = useMemo(() => {
    if (!embedUrl) return "Connect Spotify";
    const kind = embedUrl.split("/embed/")[1]?.split("/")[0] || "track";
    return `Spotify ${kind}`;
  }, [embedUrl]);

  function save() {
    const next = toEmbedUrl(input);
    if (!next) return;
    setEmbedUrl(next);
    window.localStorage.setItem(STORAGE_KEY, input.trim());
    setEditing(false);
    setExpanded(true);
  }

  function clear() {
    window.localStorage.removeItem(STORAGE_KEY);
    setEmbedUrl(null);
    setInput("");
    setEditing(true);
    setExpanded(true);
  }

  return (
    <>
      <section className={`spotify-dock ${expanded ? "is-expanded" : ""}`} aria-label="Spotify music player">
        <div className="spotify-dock-main">
          <div className="spotify-brand-mark" aria-hidden="true">●</div>
          <div className="spotify-track-meta">
            <strong>{title}</strong>
            <span>{embedUrl ? "Playback powered by Spotify" : "Paste a Spotify track, album or playlist link"}</span>
          </div>
          <div className="spotify-controls">
            {embedUrl && <button type="button" className="spotify-control" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Collapse Spotify player" : "Expand Spotify player"}>{expanded ? "−" : "＋"}</button>}
            <button type="button" className="spotify-control spotify-edit" onClick={() => { setEditing(!editing); setExpanded(true); }} aria-label="Set Spotify link">{embedUrl ? "Change" : "Add link"}</button>
          </div>
        </div>
        {editing && (
          <div className="spotify-setup">
            <input aria-label="Spotify link" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} placeholder="https://open.spotify.com/track/…" />
            <button type="button" className="button primary" onClick={save} disabled={!toEmbedUrl(input)}>Load</button>
            {embedUrl && <button type="button" className="button outline" onClick={clear}>Remove</button>}
          </div>
        )}
        {expanded && embedUrl && (
          <div className="spotify-embed-wrap">
            <iframe title="Spotify player" src={embedUrl} width="100%" height="152" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
          </div>
        )}
      </section>
      <button type="button" className={`spotify-island ${expanded ? "active" : ""}`} onClick={() => setExpanded(!expanded)} aria-label="Toggle Spotify player">
        <span className="spotify-island-dot">●</span><span>Spotify</span><span>{expanded ? "⌄" : "⌃"}</span>
      </button>
    </>
  );
}
