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
    const payload = JSON.stringify({ session: watchSession(), event, meta });
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
