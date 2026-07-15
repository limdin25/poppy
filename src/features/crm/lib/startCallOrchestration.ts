// startCallOrchestration — pure async helper that wires up the manual
// "Call" button to the real Twilio dial flow. ActiveCallContext.startCall
// delegates to this function so the heavy lifting (spend gate, server-side
// wk_calls row mint, dial) is unit-testable in isolation from React state.
//
// Steps:
//   1. Validate phone (no number → no call).
//   2. POST wk-calls-create — returns { call_id } and an `allowed` flag that
//      doubles as the spend / killswitch gate. The server is the source of
//      truth here: we never approve a dial the server didn't approve.
//   3. dial(phone, { CallId, ContactId }) — runs the Twilio Voice SDK
//      device.connect() with our minted UUID baked into the params, so
//      wk-voice-twiml-outgoing can match the inserted row instead of
//      creating a duplicate.
//   4. On success, return { ok: true, callId, twilioCall } so the caller
//      can attach state-machine listeners on the Call object.
//   5. On any failure, push exactly one toast and return a typed reason —
//      no half-state, no silent swallow.

import type { Call as TwilioCall } from '@twilio/voice-sdk';

export interface CreateCallResponse {
  call_id?: string;
  allowed?: boolean;
  reason?: string;
}

export interface CreateCallEnvelope {
  data: CreateCallResponse | null;
  error: { message: string } | null;
}

export interface StartCallDeps {
  invokeCreateCall: (input: {
    contact_id: string;
    to_phone: string;
  }) => Promise<CreateCallEnvelope>;
  dial: (phone: string, params?: Record<string, string>) => Promise<TwilioCall>;
  pushToast: (text: string, kind?: 'success' | 'info' | 'error') => void;
}

export interface StartCallInput {
  contactId: string;
  contactName: string;
  phone: string;
}

export type StartCallResult =
  | { ok: true; callId: string; twilioCall: TwilioCall }
  | {
      ok: false;
      reason: 'no_phone' | 'spend_blocked' | 'create_failed' | 'dial_failed';
      message: string;
    };

export async function startCallOrchestration(
  input: StartCallInput,
  deps: StartCallDeps
): Promise<StartCallResult> {
  const phone = input.phone.trim();
  if (!phone) {
    deps.pushToast('Cannot call — no phone number on file', 'error');
    return { ok: false, reason: 'no_phone', message: 'no phone number' };
  }

  const { data, error } = await deps.invokeCreateCall({
    contact_id: input.contactId,
    to_phone: phone,
  });

  if (error || !data) {
    const msg = error?.message ?? 'unknown error';
    deps.pushToast(`Could not place call: ${msg}`, 'error');
    return { ok: false, reason: 'create_failed', message: msg };
  }

  if (data.allowed === false) {
    const reasonText = data.reason ?? 'spend limit reached';
    deps.pushToast(`Call blocked: ${reasonText}`, 'error');
    return { ok: false, reason: 'spend_blocked', message: reasonText };
  }

  if (!data.call_id) {
    deps.pushToast('Server did not return a call id', 'error');
    return { ok: false, reason: 'create_failed', message: 'missing call_id' };
  }

  try {
    const twilioCall = await deps.dial(phone, {
      CallId: data.call_id,
      ContactId: input.contactId,
    });
    return { ok: true, callId: data.call_id, twilioCall };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown dial error';
    deps.pushToast(`Dial failed: ${msg}`, 'error');
    return { ok: false, reason: 'dial_failed', message: msg };
  }
}
