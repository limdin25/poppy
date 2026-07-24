// Speed dialer toggle — ONE source of truth.
//
// The status-bar "Speed: ON/OFF" button writes this localStorage key and
// fires the `elsie-crm-pause-dialer` window event.
//
// Hugo 2026-07-24: the toggle only ever reached dialer-pro's own state
// machine. The GLOBAL softphone (mounted on every page) ran its own
// post-call countdown and dialled the next lead regardless — "the dialer
// just starts on its own, even when the speed is off". Every auto-advance
// path now reads this helper instead of keeping a private copy.
//
// Speed ON  = auto-advance to the next lead after each call.
// Speed OFF = stop after every call; the agent presses for the next one.

export const SPEED_DIALER_LS_KEY = 'elsie_crm_pause_dialer';
export const SPEED_DIALER_EVENT = 'elsie-crm-pause-dialer';

/** true when auto-advance is allowed. A missing key means ON (the default). */
export function isSpeedDialerOn(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(SPEED_DIALER_LS_KEY) !== 'true';
  } catch {
    return true;
  }
}

/** Subscribe to toggle flips. Returns the unsubscribe function. */
export function subscribeSpeedDialer(onChange: () => void): () => void {
  window.addEventListener(SPEED_DIALER_EVENT, onChange);
  return () => window.removeEventListener(SPEED_DIALER_EVENT, onChange);
}
