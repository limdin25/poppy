// useTwilioDevice — thin React adapter over core/integrations/twilio-voice.
//
// The Voice SDK lives in core; this hook is the only feature-side wrapper.
// It owns: device lifecycle (register on mount, destroy on unmount of the
// last consumer), the active-call ref, and mute/dtmf relays for the UI.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Call as TwilioCall } from '@twilio/voice-sdk';
import {
  createDevice,
  destroyDevice,
  dial as voiceDial,
  getDevice,
} from '@/integrations/twilio/voice-browser';

export type DeviceStatus = 'idle' | 'registering' | 'ready' | 'error';

let consumerCount = 0;

export function useTwilioDevice(): {
  status: DeviceStatus;
  error: string | null;
  muted: boolean;
  setMuted: (m: boolean) => void;
  dial: (phone: string, extraParams?: Record<string, string>) => Promise<TwilioCall>;
  hangup: () => void;
  sendDigits: (digits: string) => void;
  activeCall: TwilioCall | null;
} {
  const [status, setStatus] = useState<DeviceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const callRef = useRef<TwilioCall | null>(null);
  const [activeCall, setActiveCall] = useState<TwilioCall | null>(null);

  // Register Twilio device once per page (refcounted across hook consumers).
  useEffect(() => {
    consumerCount++;
    let cancelled = false;
    (async () => {
      if (getDevice()) {
        if (!cancelled) setStatus('ready');
        return;
      }
      setStatus('registering');
      try {
        await createDevice();
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'device init failed');
        }
      }
    })();
    return () => {
      cancelled = true;
      consumerCount = Math.max(0, consumerCount - 1);
      if (consumerCount === 0) void destroyDevice();
    };
  }, []);

  const dial = useCallback(async (phone: string, extraParams?: Record<string, string>) => {
    setError(null);
    try {
      const call = await voiceDial({ to: phone, extraParams });
      callRef.current = call;
      setActiveCall(call);
      call.on('disconnect', () => {
        callRef.current = null;
        setActiveCall(null);
      });
      call.on('cancel', () => {
        callRef.current = null;
        setActiveCall(null);
      });
      call.on('reject', () => {
        callRef.current = null;
        setActiveCall(null);
      });
      return call;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'dial failed');
      throw e;
    }
  }, []);

  const hangup = useCallback(() => {
    try { callRef.current?.disconnect(); } catch { /* ignore */ }
    callRef.current = null;
    setActiveCall(null);
  }, []);

  const sendDigits = useCallback((digits: string) => {
    try { callRef.current?.sendDigits(digits); } catch { /* ignore */ }
  }, []);

  const setMuted = useCallback((m: boolean) => {
    try { callRef.current?.mute(m); } catch { /* ignore */ }
    setMutedState(m);
  }, []);

  return { status, error, muted, setMuted, dial, hangup, sendDigits, activeCall };
}
