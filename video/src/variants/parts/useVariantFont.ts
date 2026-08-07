// useVariantFont.ts: the ONLY file in the variation system that loads a font.
//
// Native FontFace plus delayRender, no packages. See the long note in fonts.ts
// for why this beats @remotion/google-fonts: it removes a per-render network
// dependency and the silent fallback-typeface failure that comes with it.
//
// THE IMPORTANT LINE IS cancelRender, NOT continueRender. If a font file is
// missing, the render must FAIL. Continuing would silently ship a video set in
// Helvetica, and nobody would notice until it was posted.

import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { useCallback, useEffect, useState } from 'react';
import { font, type FontKey } from '../fonts';

/** Module-scope cache, so a face is fetched once per render process, not per frame. */
const loaded = new Map<string, Promise<void>>();

function loadOnce(key: FontKey): Promise<void> {
  const spec = font(key);
  const cached = loaded.get(key);
  if (cached) return cached;

  const p = (async () => {
    const face = new FontFace(
      spec.family,
      `url(${staticFile(`fonts/${spec.file}`)}) format('woff2')`,
      { weight: String(spec.weight), style: spec.style },
    );
    const f = await face.load();
    document.fonts.add(f);
  })();

  loaded.set(key, p);
  return p;
}

/**
 * Load one face and hold frame 0 until it is ready.
 *
 * Only the face this variant actually uses is loaded. Loading all ten would be
 * a few megabytes of decode per worker to use one of them.
 */
export function useVariantFont(key: FontKey): boolean {
  const [handle] = useState(() => delayRender(`font:${key}`));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    loadOnce(key)
      .then(() => {
        if (!live) return;
        setReady(true);
        continueRender(handle);
      })
      .catch((e) => {
        // Fail the render. Never continue into a fallback typeface.
        cancelRender(
          new Error(
            `could not load ${font(key).file}. Run: cd video && node scripts/fetch-fonts.mjs\n${String(e)}`,
          ),
        );
      });
    return () => {
      live = false;
    };
  }, [handle, key]);

  return ready;
}

/**
 * Measure a line of text in the real, loaded font.
 *
 * Synchronous and canvas-based, so it happens during render with no effect and
 * no second delayRender. The estimate in fonts.ts decides which hooks are
 * ALLOWED into the bank; this decides what a line actually measures once the
 * font is on the page. Both exist because the first has to run in node and the
 * second has to be exact.
 */
let ctx: CanvasRenderingContext2D | null = null;

export function useTextMeasurer(): (text: string, cssFont: string) => number {
  return useCallback((text: string, cssFont: string) => {
    if (!ctx) {
      const c = document.createElement('canvas');
      ctx = c.getContext('2d');
    }
    if (!ctx) return 0;
    ctx.font = cssFont;
    return ctx.measureText(text).width;
  }, []);
}
