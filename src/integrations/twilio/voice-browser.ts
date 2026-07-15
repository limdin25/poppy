// core/integrations/twilio-voice.ts
//
// Single owner of the Twilio Voice SDK in the browser.
// Features (e.g. /smsv2 softphone, dialer) MUST go through this wrapper —
// never import @twilio/voice-sdk directly from a feature.
//
// Lifecycle:
//   1. fetchVoiceToken()                  — calls wk-voice-token (Bearer = Supabase JWT)
//   2. createDevice(token)                — registers a Twilio Device for this tab
//   3. device.connect({ params })         — places an outbound call via TwiML App
//   4. device.on('incoming', cb)          — inbound calls from <Client> dial
//   5. destroyDevice()                    — on logout / tab close
//
// Failure modes are surfaced via typed events; UI shows banners for them.

import type { Device as TwilioDevice, Call as TwilioCall } from '@twilio/voice-sdk';
import { supabase } from '@/integrations/supabase/browser';

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// ----------------------------------------------------------------------------
// Token fetch
// ----------------------------------------------------------------------------

export interface VoiceTokenResponse {
  token: string;
  identity: string;          // profile uuid
  ttl_seconds: number;
  extension: string | null;
}

export interface VoiceTokenError {
  error: string;
  missing_env?: string[];
  hint?: string;
}

/** PR 139 (Hugo 2026-04-28): typed errors so callers can distinguish a
 *  Supabase-session failure (re-auth needed) from a wk-voice-token
 *  failure (service down) from a transport-only blip (recoverable). */
export class SupabaseSessionMissingError extends Error {
  constructor() {
    super('Not authenticated — sign in to use the softphone.');
    this.name = 'SupabaseSessionMissingError';
  }
}

export class SupabaseSessionRefreshError extends Error {
  constructor(message: string) {
    super(`Supabase session refresh failed: ${message}`);
    this.name = 'SupabaseSessionRefreshError';
  }
}

export class VoiceTokenUnauthorizedError extends Error {
  constructor() {
    super('wk-voice-token rejected the Supabase JWT (401) twice.');
    this.name = 'VoiceTokenUnauthorizedError';
  }
}

/**
 * PR 139 (Hugo 2026-04-28): fetchVoiceToken now refreshes the Supabase
 * session BEFORE asking wk-voice-token for a Twilio access token. The
 * old order (cached JWT → wk-voice-token → 401 → toast) treated transport
 * recovery as if the agent had hung up.
 *
 * New order:
 *   1. supabase.auth.getSession() — must exist or we throw.
 *   2. If the session JWT expires in <60s (or already expired), call
 *      supabase.auth.refreshSession() FIRST.
 *   3. POST wk-voice-token with the (possibly refreshed) JWT.
 *   4. If wk-voice-token returns 401, defensively refresh once more and
 *      retry. Two 401s in a row is a real auth failure.
 *
 * Logs at every step so the console tells the full story when something
 * breaks: refresh start → session ok / refreshed → wk-voice-token result.
 */
export async function fetchVoiceToken(): Promise<VoiceTokenResponse> {
  console.info('[voice-token] refresh start');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    console.error('[voice-token] no Supabase session — agent must sign in');
    throw new SupabaseSessionMissingError();
  }

  let accessToken = session.access_token;
  // session.expires_at is unix seconds. Convert to ms for arithmetic.
  const expiresAtMs =
    typeof session.expires_at === 'number' ? session.expires_at * 1000 : 0;
  const msLeft = expiresAtMs ? expiresAtMs - Date.now() : Number.POSITIVE_INFINITY;

  if (expiresAtMs && msLeft < 60_000) {
    console.info(
      '[voice-token] supabase session near expiry, refreshing first',
      { msLeft }
    );
    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshed?.session?.access_token) {
      const msg = refreshError?.message ?? 'no session returned';
      console.error('[voice-token] supabase refresh failed:', msg);
      throw new SupabaseSessionRefreshError(msg);
    }
    accessToken = refreshed.session.access_token;
    const newExp =
      typeof refreshed.session.expires_at === 'number'
        ? refreshed.session.expires_at * 1000
        : 0;
    console.info(
      '[voice-token] supabase session refreshed, new exp in',
      newExp ? Math.floor((newExp - Date.now()) / 1000) : 'unknown',
      's'
    );
  } else {
    console.info(
      '[voice-token] supabase session ok, exp in',
      msLeft === Number.POSITIVE_INFINITY ? 'unknown' : Math.floor(msLeft / 1000),
      's'
    );
  }

  // First wk-voice-token attempt.
  let resp = await fetch(`${FN_BASE}/wk-voice-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  // 401 — defensive Supabase refresh + retry once. If still 401 it's a
  // genuine auth failure (re-auth required).
  if (resp.status === 401) {
    console.warn('[voice-token] 401 from wk-voice-token, attempting Supabase refresh');
    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshed?.session?.access_token) {
      const msg = refreshError?.message ?? '401 + no refresh session';
      console.error('[voice-token] post-401 supabase refresh failed:', msg);
      throw new SupabaseSessionRefreshError(msg);
    }
    accessToken = refreshed.session.access_token;
    resp = await fetch(`${FN_BASE}/wk-voice-token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (resp.status === 401) {
      console.error('[voice-token] still 401 after refresh — re-auth required');
      throw new VoiceTokenUnauthorizedError();
    }
  }

  if (!resp.ok) {
    let body: VoiceTokenError | null = null;
    try { body = await resp.json(); } catch { /* ignore */ }
    if (resp.status === 503 && body?.missing_env) {
      console.error('[voice-token] failed: missing env', body.missing_env);
      throw new Error(
        `Voice SDK not configured. Missing env vars: ${body.missing_env.join(', ')}.`
      );
    }
    const msg = body?.error ?? `Voice token fetch failed (${resp.status})`;
    console.error('[voice-token] failed:', msg);
    throw new Error(msg);
  }

  const tokenResp = (await resp.json()) as VoiceTokenResponse;
  console.info('[voice-token] wk-voice-token success, ttl=', tokenResp.ttl_seconds);
  return tokenResp;
}

// ----------------------------------------------------------------------------
// Device manager
// ----------------------------------------------------------------------------

let device: TwilioDevice | null = null;
let currentToken: VoiceTokenResponse | null = null;
let renewalTimer: number | null = null;

// PR 144 (Hugo 2026-04-28, Phase 1.4): TOCTOU singleton lock for
// createDevice. Two consumers (Softphone + DialerPage, or Strict-Mode
// double-mount) could previously race past the
// `if (device && currentToken) return ...` check, both fetch a token,
// both `new Device(...)`, both register. The gateway evicts one with
// `error 31005 HANGUP` (same family of bug as PR 143's multi-tab fix
// but in a single tab). Sharing the in-flight Promise serialises
// concurrent callers onto a single Device.
let inFlightCreate: Promise<DeviceHandle> | null = null;
let pendingDestroy: Promise<void> | null = null;

// PR 132 (Hugo 2026-04-28, Bug 2): track consecutive failed re-registrations
// so we surface a single persistent toast after 3 failures instead of
// stacking dismissable toasts on every retry. Reset to 0 on a successful
// updateToken / registered event.
let consecutiveTokenRefreshFailures = 0;

/** PR 132: external listener invoked when re-registration has failed 3
 *  times in a row. Lets ActiveCallProvider surface a single "Phone offline"
 *  toast with a manual retry button instead of every error stacking. */
type TokenRefreshFailListener = (retryFn: () => Promise<void>) => void;
const tokenRefreshFailListeners = new Set<TokenRefreshFailListener>();

export function addTokenRefreshFailListener(
  listener: TokenRefreshFailListener
): () => void {
  tokenRefreshFailListeners.add(listener);
  return () => {
    tokenRefreshFailListeners.delete(listener);
  };
}

// Module-level listener registry for inbound calls. Subscribers are notified
// after the device has auto-accepted the call so the UI can transition into
// the live-call screen. Returning the unsubscribe handle keeps callers
// reference-clean (e.g. ActiveCallProvider on unmount).
type IncomingCallListener = (call: TwilioCall) => void;
const incomingCallListeners = new Set<IncomingCallListener>();

export function addIncomingCallListener(listener: IncomingCallListener): () => void {
  incomingCallListeners.add(listener);
  return () => {
    incomingCallListeners.delete(listener);
  };
}

/** Lazy-import the SDK so SSR / non-voice routes don't pay the bundle cost. */
async function loadVoiceSdk(): Promise<typeof import('@twilio/voice-sdk')> {
  return import('@twilio/voice-sdk');
}

export interface DeviceHandle {
  device: TwilioDevice;
  identity: string;
  extension: string | null;
}

export async function createDevice(): Promise<DeviceHandle> {
  if (pendingDestroy) {
    await pendingDestroy;
  }
  if (device && currentToken) {
    return { device, identity: currentToken.identity, extension: currentToken.extension };
  }
  // PR 144: serialise concurrent callers onto a single Device.
  if (inFlightCreate) {
    return inFlightCreate;
  }
  inFlightCreate = (async (): Promise<DeviceHandle> => {
    const tokenResp = await fetchVoiceToken();
    const { Device } = await loadVoiceSdk();

    const d = new Device(tokenResp.token, {
      // Background audio constraints — keep mic open during the call lifecycle.
      closeProtection: true,
      logLevel: 'warn',
      edge: 'roaming',         // pick best Twilio edge automatically
      // PR 144 (Hugo 2026-04-28, Phase 1.1): turn ON the precision flag
      // so gateway HANGUP errors surface as their precise sub-codes
      // (31002 ConnectionDeclined / 31204 InvalidJWT / 31205 Expired)
      // instead of getting collapsed into generic 31005. Twilio docs:
      // https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice
      // (`enableImprovedSignalingErrorPrecision` table at the bottom).
      enableImprovedSignalingErrorPrecision: true,
    });

  // (Earlier: tried setAudioConstraints({ echoCancellation, noiseSuppression,
  // autoGainControl }) here for self-call echo. Reverted on 2026-04-26 because
  // Hugo started seeing 31401 PermissionDeniedError after that change. Twilio
  // already applies sensible defaults; rely on those. If self-call echo
  // returns, fix the room (headphones), not the SDK config.)

  // PR 132 (Hugo 2026-04-28, Bug 2): "Connection lost (31005). Refresh the
  // page if it doesn't recover." used to be the agent's only escape after
  // the 1-hour token expired and the SDK dropped its WebSocket transport.
  // Now we auto-refetch a fresh access token from wk-voice-token and call
  // device.updateToken — the SDK reconnects without a page refresh.
  // Codes we react to:
  //   31005 — Connection lost (signaling transport closed)
  //   31204 — JWT validation error (almost always token-expired)
  //   20104 — InvalidAccessToken
  // The Voice SDK also fires 'tokenWillExpire' ~30s before exp; we use that
  // as a proactive trigger too (belt-and-braces with the 5-min timer).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  d.on('error', (err: any) => {
    const code = err?.code as number | undefined;
    if (code === 31005 || code === 31204 || code === 20104) {
      console.warn('[twilio-voice] device error → auto-refresh token', code, err?.message);
      void refreshDeviceToken('error_31005');
    }
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (d as any).on?.('tokenWillExpire', () => {
    console.info('[twilio-voice] tokenWillExpire — refreshing');
    void refreshDeviceToken('tokenWillExpire');
  });
  // 2026-05-22 (Hugo): the SDK fires 'unregistered' when the WebSocket
  // drops without an explicit error code (network blip, gateway
  // failover, etc.). Before, we never caught this — Device.state went
  // to 'unregistered' but our deviceReady React state stayed true,
  // leaving the dialer "ready" UI but no actual call path. Now we
  // try a token refresh + re-register; ensureDeviceReady() also
  // polls in the background to catch any case this listener misses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (d as any).on?.('unregistered', () => {
    console.warn('[twilio-voice] device unregistered — attempting re-register');
    void refreshDeviceToken('unregistered');
  });

  // Inbound calls — wk-voice-twiml-incoming routes a PSTN ring to a Client
  // identity. The agent's browser receives an 'incoming' Call here. We
  // DO NOT auto-accept anymore — IncomingCallModal subscribes via
  // addIncomingCallListener, shows a ringing UI with caller info, and
  // calls call.accept() / call.reject() based on the agent's choice.
  // Twilio's 25s <Dial timeout> falls through to voicemail automatically
  // if the agent ignores the ring.
  d.on('incoming', (call: TwilioCall) => {
    incomingCallListeners.forEach((listener) => {
      try {
        listener(call);
      } catch (e) {
        console.warn('[twilio-voice] incoming listener threw:', e);
      }
    });
  });

    await d.register();

    device = d;
    currentToken = tokenResp;
    scheduleTokenRenewal(tokenResp.ttl_seconds, tokenResp.token);

    return { device: d, identity: tokenResp.identity, extension: tokenResp.extension };
  })();
  try {
    return await inFlightCreate;
  } finally {
    // Whether resolved or rejected, clear the in-flight handle so a
    // future caller after destroyDevice() can create a fresh one.
    inFlightCreate = null;
  }
}

/**
 * PR 132 (Hugo 2026-04-28, Bug 2): Decode the JWT exp claim so we schedule
 * the refresh against the TOKEN'S OWN expiry, not just the server-reported
 * ttl_seconds. The two should match, but if a clock or the server's TTL
 * is off, exp is the source of truth Twilio uses to validate the token.
 * Returns null if the token can't be parsed.
 */
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    // base64url → base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * PR 132 (Hugo 2026-04-28, Bug 2): refresh the Twilio Device's access
 * token in-place. Used by:
 *   1. The proactive 5-min-before-expiry timer (scheduleTokenRenewal).
 *   2. The device 'error' listener (codes 31005 / 31204 / 20104) — the
 *      SDK can recover without a page refresh once it has a fresh token.
 *   3. The 'tokenWillExpire' SDK event (fires ~30s before exp).
 *
 * Tracks consecutive failures and broadcasts a single "Phone offline"
 * toast after 3 in a row, so we don't stack dismissable toasts on every
 * retry. The retry function passed to listeners restarts the refresh
 * loop on demand (manual button click).
 */
async function refreshDeviceToken(reason: string = 'scheduled'): Promise<void> {
  if (!device) return;
  console.info('[twilio-voice] token refresh →', reason);
  try {
    const fresh = await fetchVoiceToken();
    await device.updateToken(fresh.token);
    currentToken = fresh;
    consecutiveTokenRefreshFailures = 0;
    scheduleTokenRenewal(fresh.ttl_seconds, fresh.token);
  } catch (e) {
    consecutiveTokenRefreshFailures++;
    console.error(
      '[twilio-voice] token refresh failed',
      { reason, attempts: consecutiveTokenRefreshFailures },
      e
    );
    if (consecutiveTokenRefreshFailures >= 3) {
      // Single persistent banner — listener resets the counter when the
      // user clicks "Retry" so subsequent failures still escalate.
      tokenRefreshFailListeners.forEach((fn) => {
        try {
          fn(async () => {
            consecutiveTokenRefreshFailures = 0;
            await refreshDeviceToken('manual_retry');
          });
        } catch (err) {
          console.warn('[twilio-voice] token-fail listener threw', err);
        }
      });
    }
  }
}

function scheduleTokenRenewal(ttlSeconds: number, token?: string): void {
  if (renewalTimer !== null) {
    window.clearTimeout(renewalTimer);
    renewalTimer = null;
  }
  // PR 132: prefer the JWT's own exp claim (token-truth) over server-
  // reported ttl_seconds. Fall back to ttl_seconds if exp can't be parsed.
  let renewInMs: number;
  const tokenForExp = token ?? currentToken?.token ?? null;
  const exp = tokenForExp ? decodeJwtExp(tokenForExp) : null;
  if (exp) {
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = exp - nowSec;
    // 5-minute buffer per Hugo's brief. Floor at 30s so a near-expired
    // token still gets a refresh attempt.
    renewInMs = Math.max(30_000, (remaining - 300) * 1000);
  } else {
    renewInMs = Math.max(30_000, (ttlSeconds - 300) * 1000);
  }
  renewalTimer = window.setTimeout(() => {
    void refreshDeviceToken('scheduled');
  }, renewInMs);
}

export async function destroyDevice(): Promise<void> {
  if (renewalTimer !== null) {
    window.clearTimeout(renewalTimer);
    renewalTimer = null;
  }
  const p = (async () => {
    if (device) {
      try { await device.unregister(); } catch { /* ignore */ }
      try { device.destroy(); } catch { /* ignore */ }
    }
    device = null;
    currentToken = null;
  })();
  pendingDestroy = p;
  try { await p; } finally { pendingDestroy = null; }
}

// ----------------------------------------------------------------------------
// Outbound call helper
// ----------------------------------------------------------------------------

export interface OutboundParams {
  to: string;                // E.164 number to dial
  agentId?: string;          // for server-side logging hint (TwiML App ignores it)
  /** Extra params forwarded as form fields on the wk-voice-twiml-outgoing
   *  POST. Used to bake CallId (our wk_calls UUID) + ContactId in so the
   *  TwiML handler can match the existing row instead of inserting a dupe. */
  extraParams?: Record<string, string>;
}

export async function dial(params: OutboundParams): Promise<TwilioCall> {
  // Auto-initialise the device if the agent clicks Call before the
  // useTwilioDevice hook's mount-effect has finished registering. This
  // happens on a fresh tab → click Call quickly → the previous code
  // threw "Voice device not initialised". Now we just register lazily.
  if (!device) {
    await createDevice();
  }
  if (!device) {
    throw new Error('Voice device failed to initialise. Try refreshing the page.');
  }
  // The TwiML App points at wk-voice-twiml-outgoing. Twilio forwards
  // these `params` as form fields on that POST.
  const call = await (device as TwilioDevice).connect({
    params: {
      To: params.to,
      ...(params.agentId ? { AgentId: params.agentId } : {}),
      ...(params.extraParams ?? {}),
    },
  });
  return call;
}

// ----------------------------------------------------------------------------
// Helpers for UI hooks
// ----------------------------------------------------------------------------

export function getDevice(): TwilioDevice | null {
  return device;
}

export function getIdentity(): string | null {
  return currentToken?.identity ?? null;
}

/**
 * Return every Call the Twilio Device is currently maintaining.
 * The SDK keeps prior Calls alive across `device.connect()` invocations —
 * if we don't iterate them when muting, a zombie call from an earlier dial
 * keeps streaming the agent's mic to its (now stale) leg.
 */
export function getDeviceCalls(): TwilioCall[] {
  if (!device) return [];
  try {
    // The .calls getter returns the SDK's internal list directly.
    return [...device.calls];
  } catch {
    return [];
  }
}

// Stash original tracks so unmute can restore them. Keyed by sender object.
// Cleared as soon as we restore. Module-level because the Call object exposes
// no place to attach metadata.
const _stashedTracks = new WeakMap<RTCRtpSender, MediaStreamTrack>();

/**
 * Mute every active Call on the Device using THREE layered mechanisms so the
 * callee CANNOT hear the agent after toggling Mute, even when:
 *   - the Twilio SDK's own .mute() fails to take effect for any reason
 *   - the agent's environment is fighting back (echo, ambient pickup)
 *   - we have multiple Calls alive at once (zombies from prior dials)
 *
 * Layer 1: `call.mute(shouldMute)` — what the SDK officially exposes. Sets
 *           the local audio track's `enabled` to !shouldMute, which makes
 *           WebRTC send silence frames instead of voice. This is the soft
 *           mute Twilio documents.
 *
 * Layer 2: `track.enabled = !shouldMute` on every track of the Call's local
 *           MediaStream — belt-and-braces in case Layer 1's track binding
 *           drifted (e.g. after a track replacement during reconnect).
 *
 * Layer 3: `RTCRtpSender.replaceTrack(null)` on every audio sender of every
 *           PeerConnection — HARD mute. WebRTC stops sending RTP packets
 *           entirely (no silence frames either). This is the only way to be
 *           100% certain no audio leaves the browser. We stash the original
 *           track and restore it on unmute via `replaceTrack(originalTrack)`.
 *
 * Returns shouldMute when at least one Call was processed. Logs a detailed
 * report of every sender's state so DevTools console proves whether the
 * mute actually engaged at the WebRTC level. If the callee still hears the
 * agent after we log "every sender muted", the audio leak is environmental
 * (e.g. the callee's own mic picking up ambient sound) — not software.
 */
export function muteAllCalls(shouldMute: boolean, fallbackCall?: TwilioCall | null): boolean {
  // device.calls is only populated reliably for inbound calls — outbound
  // dials placed via device.connect() come back as a Call object that the
  // caller holds, but the SDK does NOT push them into the public `calls`
  // array (verified live: Hugo's mute logs showed `calls: 0, senders: []`
  // mid-call). If the device list is empty, fall back to whatever Call the
  // caller is holding (activeTwilioCallRef / device.activeCall).
  let calls = getDeviceCalls();
  if (calls.length === 0 && fallbackCall) {
    calls = [fallbackCall];
  }
  let processed = false;
  const report: Array<{ idx: number; sender: number; trackId: string; enabled: boolean; replaced: boolean }> = [];

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];

    // Layer 1: the SDK's documented mute (also fires the 'mute' event).
    try { c.mute(shouldMute); processed = true; } catch (e) { console.warn('[twilio-voice] mute layer1 threw', e); }

    // Layer 2: directly disable every track on the Call's local stream.
    try {
      const stream = c.getLocalStream?.();
      stream?.getAudioTracks?.().forEach((t: MediaStreamTrack) => {
        t.enabled = !shouldMute;
      });
    } catch (e) { console.warn('[twilio-voice] mute layer2 threw', e); }

    // Layer 3: replace the audio sender's track. This is the only mute that
    // truly stops RTP packets from being sent. We have to reach into the
    // SDK's private _mediaHandler to get the RTCPeerConnection.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pc: RTCPeerConnection | undefined = (c as any)?._mediaHandler?.version?.pc;
      if (pc && typeof pc.getSenders === 'function') {
        const senders = pc.getSenders();
        for (let s = 0; s < senders.length; s++) {
          const sender = senders[s];
          if (sender.track && sender.track.kind !== 'audio') continue;

          if (shouldMute) {
            // Stash the current track so we can restore on unmute.
            if (sender.track) _stashedTracks.set(sender, sender.track);
            // Fire-and-forget — replaceTrack returns a Promise but we don't
            // need to await it for the mute to engage at the sender level.
            void sender.replaceTrack(null).catch((e) =>
              console.warn('[twilio-voice] replaceTrack(null) rejected', e)
            );
            report.push({
              idx: i,
              sender: s,
              trackId: sender.track?.id ?? '<gone>',
              enabled: false,
              replaced: true,
            });
          } else {
            // Restore the original track if we have it stashed.
            const original = _stashedTracks.get(sender);
            if (original) {
              void sender.replaceTrack(original).catch((e) =>
                console.warn('[twilio-voice] replaceTrack(restore) rejected', e)
              );
              _stashedTracks.delete(sender);
              report.push({
                idx: i,
                sender: s,
                trackId: original.id,
                enabled: true,
                replaced: true,
              });
            } else {
              // No stash — re-enable whatever's there.
              if (sender.track) sender.track.enabled = true;
              report.push({
                idx: i,
                sender: s,
                trackId: sender.track?.id ?? '<none>',
                enabled: sender.track?.enabled ?? false,
                replaced: false,
              });
            }
          }
        }
      }
    } catch (e) { console.warn('[twilio-voice] mute layer3 threw', e); }
  }

  console.info('[twilio-voice] muteAllCalls', { shouldMute, calls: calls.length, senders: report });
  return processed && shouldMute;
}

/**
 * Disconnect every active Call on the Device. Used to evict zombies before
 * placing a fresh dial so we don't accumulate parallel audio paths.
 */
export function disconnectAllCalls(): void {
  if (!device) return;
  try {
    device.disconnectAll();
  } catch (e) {
    console.warn('[twilio-voice] disconnectAll threw', e);
  }
}

/**
 * PR 132 (Hugo 2026-04-28, Bug 1): "Dial failed: A Call is already active".
 * Twilio's Device.connect() throws this when a previous Call object is still
 * in `device.calls`. The fix: BEFORE every fresh dial, disconnect every
 * existing Call AND wait until the SDK fires 'disconnect' on each one (or a
 * 1500ms timeout per call elapses). Only then is it safe to call
 * device.connect() again.
 *
 * Returns once every prior Call has fired its 'disconnect' event or the
 * timeout elapsed. Resilient to .on() throws and Calls that never fire the
 * event (rare but documented in the SDK changelog).
 */
export async function disconnectAllCallsAndWait(timeoutMs = 1500): Promise<void> {
  if (!device) return;
  // Snapshot the Calls before we start disconnecting — the SDK may mutate
  // device.calls as each one resolves.
  const calls = getDeviceCalls();
  if (calls.length === 0) return;

  await Promise.all(
    calls.map(
      (call) =>
        new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          try {
            // 'disconnect' fires once the leg is fully torn down. If the
            // Call already disconnected before we attached, .on may never
            // fire — the timeout below covers that.
            call.on('disconnect', finish);
            call.on('cancel', finish);
            call.on('reject', finish);
          } catch (e) {
            console.warn('[twilio-voice] disconnectAllCallsAndWait .on threw', e);
          }
          try {
            call.disconnect();
          } catch (e) {
            console.warn('[twilio-voice] disconnectAllCallsAndWait .disconnect threw', e);
            // If .disconnect throws, the Call may already be dead — resolve
            // immediately rather than wait for an event that won't fire.
            finish();
            return;
          }
          window.setTimeout(finish, timeoutMs);
        })
    )
  );
}

/**
 * PR 132 (Hugo 2026-04-28, Bug 4): expose the SDK Device's current status
 * ('registered' / 'registering' / 'unregistered' / 'destroyed') so the
 * dialer can wait for 'registered' before pressing connect(). Returns null
 * if no device exists.
 */
export function getDeviceStatus(): string | null {
  if (!device) return null;
  try {
    // The Voice SDK Device exposes .state in v2.x. The shape isn't typed
    // in the version pinned here, so we read defensively.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((device as any).state as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * 2026-05-22 (Hugo): defensive recovery primitive used by the dialer to
 * keep the Twilio Device alive across long idle windows. Returns true
 * if the device is currently registered (or got recovered to that
 * state), false if recovery failed.
 *
 * Behaviour:
 *   • No device exists yet → call createDevice() (4-retry already
 *     baked into the caller's mount-effect, so we only try once here).
 *   • Device exists and state === 'registered' → no-op, return true.
 *   • Device exists but state is 'unregistered' / 'destroyed' / null
 *     → tear it down via destroyDevice() and rebuild via createDevice().
 *     Mirrors the manual hard-refresh that has been the workaround.
 */
export async function ensureDeviceReady(): Promise<boolean> {
  if (!device) {
    try {
      await createDevice();
      return getDeviceStatus() === 'registered';
    } catch (e) {
      console.warn('[twilio-voice] ensureDeviceReady: createDevice failed', e);
      return false;
    }
  }
  const status = getDeviceStatus();
  if (status === 'registered') return true;
  console.warn('[twilio-voice] ensureDeviceReady: device state =', status, '— recreating');
  try {
    await destroyDevice();
    await createDevice();
    return getDeviceStatus() === 'registered';
  } catch (e) {
    console.warn('[twilio-voice] ensureDeviceReady: recreate failed', e);
    return false;
  }
}

/** PR 132: exposed for unit tests of the 31005 auto-refresh path. */
export const __test_refreshDeviceToken = refreshDeviceToken;
export function __test_setDevice(d: TwilioDevice | null, token?: VoiceTokenResponse | null): void {
  device = d;
  if (token !== undefined) currentToken = token;
}
export function __test_resetTokenFailureCount(): void {
  consecutiveTokenRefreshFailures = 0;
}
