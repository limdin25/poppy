import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Call as TwilioCall } from '@twilio/voice-sdk';
import { supabase } from '@/integrations/supabase/browser';
import {
  createDevice, dial as twilioDial, disconnectAllCalls, ensureDeviceReady, getDeviceStatus,
  disconnectAllCallsAndWait, muteAllCalls, getDeviceCalls,
  addTokenRefreshFailListener,
} from '@/integrations/twilio/voice-browser';
import { mapTwilioError } from '@/features/crm/caller-pad/lib/twilioErrorMap';
import { INITIAL, LS_KEY, reducer } from './reducer';
import type { QueueLead } from './types';

interface UseDialerMachineOpts {
  userId: string | null;
  campaignId: string | null;
  pipelineId: string | null;
  /** Asked about the lead ABOUT to be dialled: is this the video-funnel close
   *  call, or a normal cold dial? The answer is persisted onto the call row so
   *  the live coach (which is driven by Twilio and cannot see the browser)
   *  coaches the same script the agent has on screen. Omitted everywhere else,
   *  so every other dial path is unchanged. */
  scriptKeyForLead?: (contactId: string) => 'cold_call' | 'vsl_close' | 'property_call';
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function useDialerMachine({ userId, campaignId, pipelineId: _pipelineId, scriptKeyForLead, onToast }: UseDialerMachineOpts) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;

  const twilioCallRef = useRef<TwilioCall | null>(null);
  const dialedRef = useRef<Set<string>>(new Set());

  // Twilio Device lifecycle — retry up to 4 times with 2s delay
  const [deviceReady, setDeviceReady] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        if (cancelled) return;
        try {
          await createDevice();
          if (!cancelled) setDeviceReady(true);
          return;
        } catch (e) {
          console.warn(`[dialer-pro] createDevice attempt ${attempt}/4 failed`, e);
          if (attempt < 4 && !cancelled) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    })();
    return () => { cancelled = true; setDeviceReady(false); };
  }, []);

  // 2026-05-22 (Hugo, round 2): fully automatic recovery. Three things
  // working together so the agent never sees an offline phone:
  //   • Fast health-check (every 8s while deviceReady=true) — detects
  //     drops the 'unregistered' event listener missed.
  //   • Instant reconnect-on-drop: any transition to deviceReady=false
  //     (initial-mount failure, listener-triggered, health-check) fires
  //     ensureDeviceReady() immediately, with exponential backoff.
  //   • Backoff: 2s → 4s → 8s → 16s → 30s (cap). The toast surfaces
  //     only after 3 failed attempts so transient blips don't pop noise.
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  // Fast health-check while phone is up.
  useEffect(() => {
    if (!deviceReady) return;
    const id = window.setInterval(() => {
      const status = getDeviceStatus();
      if (status === 'registered') return;
      console.warn('[dialer-pro] health-check: device state =', status, '— flipping to recovering');
      setDeviceReady(false); // triggers the auto-recover effect below
    }, 8_000);
    return () => window.clearInterval(id);
  }, [deviceReady]);

  // Auto-recover loop. Runs whenever deviceReady is false (and the
  // initial mount-effect has had a chance to try). On success we reset
  // attempts; on failure we schedule the next attempt with backoff.
  useEffect(() => {
    if (deviceReady) {
      reconnectAttemptsRef.current = 0;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const attempt = reconnectAttemptsRef.current;
    // Skip the very first render where the initial-mount effect is
    // still doing its own 4-retry boot. After that, take over.
    if (attempt === 0 && !reconnecting) {
      // schedule a quick first attempt so initial-mount has time to win
      reconnectTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        void tryReconnect();
      }, 1_500);
      return () => {
        cancelled = true;
        if (reconnectTimerRef.current !== null) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };
    }
    async function tryReconnect() {
      if (cancelled) return;
      setReconnecting(true);
      const ok = await ensureDeviceReady().catch(() => false);
      if (cancelled) return;
      setReconnecting(false);
      if (ok) {
        setDeviceReady(true);
        reconnectAttemptsRef.current = 0;
        return;
      }
      reconnectAttemptsRef.current += 1;
      const n = reconnectAttemptsRef.current;
      // Surface a single toast once we've truly failed a few times.
      if (n === 3) onToast('Phone reconnecting…', 'info');
      if (n === 8) onToast('Phone offline — refresh the page if it keeps trying', 'error');
      const delays = [2_000, 4_000, 8_000, 16_000, 30_000];
      const delay = delays[Math.min(n - 1, delays.length - 1)];
      reconnectTimerRef.current = window.setTimeout(() => {
        if (!cancelled) void tryReconnect();
      }, delay);
    }
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
    // We intentionally exclude `reconnecting` from deps — the closure
    // reads it once at the top to skip-during-initial-boot, but we
    // don't want every reconnecting flip to re-create the schedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceReady, onToast]);

  // Kept around for the (rare) case where an admin wants to force a
  // manual retry — used by the optional "Reconnect" button in the UI
  // shown only after the auto-loop has failed N times.
  const reconnectDevice = useCallback(async (): Promise<boolean> => {
    reconnectAttemptsRef.current = 0;
    setReconnecting(true);
    try {
      const ok = await ensureDeviceReady();
      setDeviceReady(ok);
      return ok;
    } finally {
      setReconnecting(false);
    }
  }, []);

  // Disconnect any active call on unmount (e.g. modal close). Without
  // this, a Call left on the shared Device singleton becomes a zombie
  // that blocks subsequent dials with "A Call is already active".
  useEffect(() => {
    return () => {
      try { twilioCallRef.current?.disconnect(); } catch { /* ignore */ }
      twilioCallRef.current = null;
    };
  }, []);

  useEffect(() => {
    return addTokenRefreshFailListener((retry) => {
      onToast('Phone offline — refreshing connection…', 'error');
      window.requestAnimationFrame(() => {
        void retry().catch((e) => console.warn('[dialer-pro] retry threw', e));
      });
    });
  }, [onToast]);

  useEffect(() => {
    const onToggle = () => {
      const v = localStorage.getItem(LS_KEY) === 'true';
      dispatch({ type: 'PAUSE_AFTER_CALL', value: v });
    };
    window.addEventListener('elsie-crm-pause-dialer', onToggle);
    return () => window.removeEventListener('elsie-crm-pause-dialer', onToggle);
  }, []);

  // Queue status helper
  const updateQueueStatus = useCallback(
    async (queueId: string, status: 'pending' | 'dialing' | 'done' | 'missed' | 'skipped') => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).rpc('wk_update_queue_status', {
          p_queue_id: queueId,
          p_status: status,
        });
      } catch (e) {
        console.warn('[dialer-pro] updateQueueStatus failed', e);
      }
    },
    []
  );

  // Dial a lead
  const dialLead = useCallback(
    async (lead: QueueLead) => {
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'paused') return;

      // PR 46 (Hugo 2026-04-26) regression match: pre-dial
      // disconnectAllCalls killed the just-connecting Twilio Call on the
      // shared Device singleton, producing "hung up immediately" with
      // twilio_call_sid=NULL. Same root cause as ActiveCallContext line
      // 350. Zombie cleanup now only happens on hangUp / unmount.
      twilioCallRef.current = null;

      // Claim queue row
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: claimed, error: claimErr } = await (supabase as any).rpc('wk_claim_queue_row', {
        p_queue_id: lead.queueRowId,
        p_agent_id: userId,
      });
      if (claimErr) {
        onToast(`Claim failed: ${claimErr.message}`, 'error');
        return;
      }
      const claimedRow = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!claimedRow) {
        void updateQueueStatus(lead.queueRowId, 'missed');
        return;
      }

      // Which script is on the agent's screen for THIS lead. Persisted onto
      // wk_calls so the live coach (which is driven by Twilio and rebuilds its
      // context from the database, never from the browser) coaches the same
      // call the agent is reading.
      const leadScriptKey = scriptKeyForLead?.(lead.contactId);
      const scriptKeyBody = leadScriptKey === 'vsl_close' || leadScriptKey === 'property_call'
        ? { script_key: leadScriptKey }
        : {};

      // Create call record server-side
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.functions as any).invoke('wk-calls-create', {
        body: {
          contact_id: lead.contactId,
          to_phone: lead.phone,
          campaign_id: campaignId,
          // Spread, not a plain field: on a cold dial the request body stays
          // byte-identical to what it has always been.
          ...scriptKeyBody,
        },
      });
      if (error || !data) {
        const msg = (error?.message as string | undefined) ?? 'unknown error';
        onToast(`Could not place call: ${msg}`, 'error');
        void updateQueueStatus(lead.queueRowId, 'missed');
        return;
      }
      if (data.allowed === false) {
        const reason = (data.reason as string | undefined) ?? 'spend limit reached';
        onToast(`Call blocked: ${reason}`, 'error');
        void updateQueueStatus(lead.queueRowId, 'pending');
        return;
      }
      const callId = data.call_id as string | undefined;
      if (!callId) {
        onToast('Server did not return a call id', 'error');
        void updateQueueStatus(lead.queueRowId, 'missed');
        return;
      }

      dispatch({ type: 'DIAL_START', lead, callId });
      dialedRef.current.add(lead.queueRowId);

      try {
        const twilioCall = await twilioDial({
          to: lead.phone,
          extraParams: { CallId: callId, ContactId: lead.contactId },
        });
        twilioCallRef.current = twilioCall;
        const isThisCall = () => twilioCallRef.current === twilioCall;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (twilioCall as any).on?.('ringing', () => {
          if (isThisCall()) dispatch({ type: 'RINGING' });
        });
        twilioCall.on('accept', () => {
          if (!isThisCall()) return;
          // Force the mic LIVE at the SDK layer the moment the call connects.
          // The Twilio Device's audio input is SHARED across calls; a prior
          // call — or the global softphone now mounted on every page — can
          // leave the track muted (track.enabled=false / replaced sender),
          // which silences this fresh call even though our state says
          // unmuted (Hugo 2026-07-22: "mic on but not working in the app").
          try { muteAllCalls(false, twilioCall); } catch { /* ignore */ }
          dispatch({ type: 'CONNECTED' });
        });
        twilioCall.on('disconnect', () => {
          if (!isThisCall()) return;
          twilioCallRef.current = null;
          void updateQueueStatus(lead.queueRowId, 'done');
          dispatch({ type: 'CALL_ENDED', reason: 'hangup' });
        });
        twilioCall.on('cancel', () => {
          if (!isThisCall()) return;
          twilioCallRef.current = null;
          void updateQueueStatus(lead.queueRowId, 'missed');
          dispatch({ type: 'CALL_ENDED', reason: 'cancel' });
        });
        twilioCall.on('reject', () => {
          if (!isThisCall()) return;
          twilioCallRef.current = null;
          void updateQueueStatus(lead.queueRowId, 'missed');
          dispatch({ type: 'CALL_ENDED', reason: 'reject' });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        twilioCall.on('error', (err: any) => {
          if (!isThisCall()) return;
          const code = (err?.code as number | undefined) ?? 0;
          const mapped = mapTwilioError(code, err?.message ?? '');
          onToast(mapped.friendlyMessage, 'error');
          twilioCallRef.current = null;
          void updateQueueStatus(lead.queueRowId, 'missed');
          dispatch({ type: 'CALL_ENDED', reason: 'error', error: mapped.friendlyMessage });
          if (mapped.fatal) {
            void (async () => {
              try { await disconnectAllCallsAndWait(1500); } catch { try { disconnectAllCalls(); } catch { /* ignore */ } }
            })();
          }
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'dial crashed';
        onToast(`Dial failed: ${msg}`, 'error');
        void updateQueueStatus(lead.queueRowId, 'missed');
        dispatch({ type: 'CALL_ENDED', reason: 'failed', error: msg });
      }
    },
    [userId, campaignId, scriptKeyForLead, onToast, updateQueueStatus]
  );

  // Pick next lead from queue
  const pickNextLead = useCallback(
    async (queue: QueueLead[]): Promise<QueueLead | null> => {
      for (const lead of queue) {
        if (dialedRef.current.has(lead.queueRowId)) continue;
        if (!lead.phone) continue;
        return lead;
      }
      return null;
    },
    []
  );

  // Hang up
  const hangUp = useCallback(async () => {
    const c = twilioCallRef.current;
    twilioCallRef.current = null;
    if (c) try { c.disconnect(); } catch { /* ignore */ }
    try { disconnectAllCalls(); } catch { /* ignore */ }
    dispatch({ type: 'CALL_ENDED', reason: 'hangup' });
    try { await disconnectAllCallsAndWait(1500); } catch { /* ignore */ }
  }, []);

  // Mute toggle
  const muteToggle = useCallback(() => {
    const all = getDeviceCalls();
    const truth = twilioCallRef.current ?? all[all.length - 1] ?? null;
    if (!truth && all.length === 0) return;
    muteAllCalls(!state.isMuted, truth);
    dispatch({ type: 'MUTE_TOGGLE' });
  }, [state.isMuted]);

  // DTMF — send a touch-tone digit on the active call so the agent can
  // navigate IVR menus ("Press 1 for sales") from inside the CRM.
  // Twilio's Voice SDK exposes Call.sendDigits which accepts '0'-'9',
  // '*', '#', and 'w' (half-second pause). Returns the digit sent (or
  // null if no active call to send on) so the UI can keep a history.
  const sendDigit = useCallback((digit: string): string | null => {
    const call = twilioCallRef.current;
    if (!call) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call as any).sendDigits?.(digit);
      return digit;
    } catch (e) {
      console.warn('[dialer-pro] sendDigits failed', e);
      return null;
    }
  }, []);

  // Hold toggle — Twilio hold requires server-side TwiML update which
  // isn't wired yet, so we mute the agent's mic as a practical fallback.
  const holdToggle = useCallback(() => {
    const newHold = !state.isOnHold;
    const all = getDeviceCalls();
    const truth = twilioCallRef.current ?? all[all.length - 1] ?? null;
    if (truth || all.length > 0) {
      muteAllCalls(newHold, truth);
    }
    dispatch({ type: 'HOLD_TOGGLE' });
    if (!newHold && state.isMuted) {
      dispatch({ type: 'MUTE_TOGGLE' });
    }
  }, [state.isOnHold, state.isMuted]);

  // Voicemail drop — the agent heard the voicemail greeting and pressed
  // "Drop VM". wk-voicemail-drop replaces the CONTACT leg's TwiML with
  // <Play>{campaign recording}</Play><Hangup/>; once that resolves we free
  // the agent leg exactly like hangUp so the dialer advances immediately.
  const [dropping, setDropping] = useState(false);
  const dropVoicemail = useCallback(async () => {
    if (phaseRef.current !== 'connected') return;
    if (!state.currentCallId || state.voicemailDropped || dropping) return;
    // Capture the call BEFORE the await — same isThisCall discipline as the
    // Twilio event handlers. The invoke has no timeout; if the call ends
    // (the server-side drop itself frees the agent leg) and the dialer
    // advances while the request is in flight, a stale response must never
    // disconnect or re-label the NEXT call.
    const c = twilioCallRef.current;
    setDropping(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.functions as any).invoke('wk-voicemail-drop', {
        body: { call_id: state.currentCallId },
      });
      if (error || data?.error) {
        // FunctionsHttpError.message is always the generic non-2xx line; the
        // server's real reason (no recording / call ended / leg not found)
        // is in the response body on error.context.
        let msg = (data?.error as string | undefined) ?? (error?.message as string | undefined) ?? 'unknown error';
        const ctx = (error as { context?: Response } | null)?.context;
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json().catch(() => null);
          if (body?.error) msg = body.error as string;
        }
        onToast(`Drop failed: ${msg}`, 'error');
        return;
      }
      if (twilioCallRef.current === c) {
        // Normal path: still on the same call — mark it, free the agent leg.
        dispatch({ type: 'VOICEMAIL_DROPPED' });
        twilioCallRef.current = null;
        if (c) try { c.disconnect(); } catch { /* ignore */ }
        try { disconnectAllCalls(); } catch { /* ignore */ }
        dispatch({ type: 'CALL_ENDED', reason: 'vm_drop' });
        onToast('Voicemail dropped', 'success');
      } else if (twilioCallRef.current === null && (phaseRef.current as string) === 'wrap_up') {
        // The call already ended mid-request (disconnect handler beat us to
        // wrap-up) and no new call has started — still count the drop.
        dispatch({ type: 'VOICEMAIL_DROPPED' });
        onToast('Voicemail dropped', 'success');
      }
      // else: a newer call took over — the drop landed server-side
      // (voicemail_dropped is set); leave the new call untouched.
    } finally {
      setDropping(false);
    }
  }, [state.currentCallId, state.voicemailDropped, dropping, onToast]);

  // Apply outcome
  const [applying, setApplying] = useState(false);
  const applyOutcome = useCallback(
    async (columnId: string, agentNote?: string) => {
      if (!state.currentLead || !state.currentCallId) {
        onToast('Cannot save outcome — call ID missing', 'error');
        dispatch({ type: 'OUTCOME_DONE' });
        return;
      }
      setApplying(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.functions as any).invoke('wk-outcome-apply', {
          body: {
            call_id: state.currentCallId,
            contact_id: state.currentLead.contactId,
            column_id: columnId,
            agent_note: agentNote?.trim() || null,
          },
        });
        if (error) {
          onToast(`Outcome failed: ${error.message}`, 'error');
        } else {
          onToast('Outcome saved', 'success');
        }
      } finally {
        setApplying(false);
        dispatch({ type: 'OUTCOME_DONE' });
      }
    },
    [state.currentLead, state.currentCallId, onToast]
  );

  // Skip (no outcome)
  const skip = useCallback(() => {
    if (state.currentLead) {
      void updateQueueStatus(state.currentLead.queueRowId, 'skipped');
    }
    dispatch({ type: 'OUTCOME_DONE' });
  }, [state.currentLead, updateQueueStatus]);

  // Pause
  const pause = useCallback(() => {
    if (phaseRef.current === 'dialing' || phaseRef.current === 'ringing') {
      const c = twilioCallRef.current;
      twilioCallRef.current = null;
      if (c) try { c.disconnect(); } catch { /* ignore */ }
    }
    dispatch({ type: 'PAUSE' });
  }, []);

  // Resume
  const resume = useCallback(() => {
    dispatch({ type: 'RESUME' });
  }, []);

  // Stop
  const stop = useCallback(async () => {
    if (twilioCallRef.current) {
      try { twilioCallRef.current.disconnect(); } catch { /* ignore */ }
      twilioCallRef.current = null;
      try { disconnectAllCalls(); } catch { /* ignore */ }
    }
    dialedRef.current.clear();
    dispatch({ type: 'STOP' });
  }, []);

  // Dial now (bypass pacing countdown)
  const dialNow = useCallback(
    async (queue: QueueLead[]) => {
      dispatch({ type: 'PACING_CLEARED' });
      const next = await pickNextLead(queue);
      if (next) void dialLead(next);
      else onToast('Queue empty', 'info');
    },
    [pickNextLead, dialLead, onToast]
  );

  return {
    state,
    dispatch,
    deviceReady,
    reconnecting,
    reconnectDevice,
    applying,
    dialLead,
    pickNextLead,
    hangUp,
    muteToggle,
    holdToggle,
    sendDigit,
    dropVoicemail,
    dropping,
    applyOutcome,
    skip,
    pause,
    resume,
    stop,
    dialNow,
    dialedRef,
  };
}
