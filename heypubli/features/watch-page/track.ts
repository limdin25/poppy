"use client";

/**
 * The /watch beacons. One random session id per browser session, minted here,
 * so the funnel can count "of everyone who arrived, how many played, watched,
 * pressed the button" without knowing who anyone is.
 *
 * sendBeacon first: it survives the page being torn down, which is exactly
 * what happens the moment the CTA opens WhatsApp. fetch keepalive is the
 * fallback for browsers that refuse sendBeacon.
 */

const KEY = "hp_watch_session";
const TOKEN_KEY = "hp_watch_u";

/**
 * Personal links: /watch?u=<opaque id> ties this visit to the lead we sent the
 * link to. Captured once on load, remembered for the whole session, attached
 * to every beacon, so "someone watched" becomes "THIS lead watched". A visit
 * without ?u= stays anonymous, exactly as before.
 */
export function captureWatchToken(): void {
  try {
    const u = new URLSearchParams(window.location.search).get("u");
    if (u && /^[a-z0-9-]{4,64}$/i.test(u)) sessionStorage.setItem(TOKEN_KEY, u);
  } catch {
    // Storage blocked: the visit just stays anonymous.
  }
}

function watchToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function watchSession(): string {
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Storage blocked (private mode): a per-call id still counts events,
    // it just cannot join them into one visit.
    return `anon-${Date.now().toString(16)}`;
  }
}

export function trackWatch(event: string, meta?: Record<string, unknown>): void {
  try {
    const u = watchToken();
    const payload = JSON.stringify({
      session: watchSession(),
      event,
      meta: u ? { ...meta, u } : meta,
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon("/api/watch/track", blob)) return;
    }
    // The rejection handler matters: fetch fails ASYNCHRONOUSLY, outside the
    // try/catch below, and an analytics beacon must never surface an error.
    fetch("/api/watch/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Tracking must never break the page it is tracking.
  }
}
