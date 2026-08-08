// The only file in the Flywheel VSL that loads a font.
//
// Same shape as variants/parts/useVariantFont.ts and for the same reason: native
// FontFace plus delayRender, no packages, no network at render time.
//
// cancelRender is the load-bearing line, NOT continueRender. A missing font must
// FAIL the render. Continuing would ship a sales video set in Helvetica and
// nobody would notice until it was on the page.

import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { useEffect, useState } from 'react';

export const DISPLAY_FAMILY = 'Archivo';
const FILE = 'Archivo-ExtraBold.woff2';

let loading: Promise<void> | null = null;

function loadOnce(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const face = new FontFace(DISPLAY_FAMILY, `url(${staticFile(`fonts/${FILE}`)}) format('woff2')`, {
      weight: '800',
    });
    document.fonts.add(await face.load());
  })();
  return loading;
}

export function useFlywheelFont(): boolean {
  const [handle] = useState(() => delayRender(`font:${DISPLAY_FAMILY}`));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    loadOnce()
      .then(() => {
        if (!live) return;
        setReady(true);
        continueRender(handle);
      })
      .catch((e) => {
        cancelRender(new Error(`could not load fonts/${FILE}: ${String(e)}`));
      });
    return () => {
      live = false;
    };
  }, [handle]);

  return ready;
}
