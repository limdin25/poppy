// IncomingCallModal — replaces the auto-accept that twilio-voice.ts used
// to do. When an inbound Call arrives on the agent's Device, we show a
// ringing card (caller phone, matched contact name if any, Accept /
// Decline buttons) and loop a ringtone. The agent picks one:
//   - Accept → call.accept() → ActiveCallContext takes over via its
//     'accept' listener and morphs into the full live-call screen.
//   - Decline → call.reject() → Twilio's <Dial timeout> drops the leg
//     into voicemail per wk-voice-twiml-incoming's fallback.
// If the agent ignores it, Twilio's 25s timeout fires server-side and
// the Call disconnects on its own — we auto-clear when that happens.

import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import type { Call as TwilioCall } from '@twilio/voice-sdk';
import { addIncomingCallListener } from '@/integrations/twilio/voice-browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { findByPhone } from '../../../../../api/lib/phone-match';

// The ring is synthesised with Web Audio rather than shipped as a file.
//
// It used to be a data-URI WAV described in a comment as "~30KB". It was 44
// bytes: a bare WAV header declaring 1024 bytes of audio that were not there.
// So the ring was silent on every inbound call, and the agent only ever saw the
// modal. Generating it means there is no asset that can be wrong.
//
// UK ringing cadence: two 400ms bursts of 400Hz+450Hz split by 200ms, then two
// seconds of quiet.
function startRinging(): () => void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return () => {};
  const ctx = new Ctor();
  void ctx.resume();

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const oscs = [400, 450].map((hz) => {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    o.connect(gain);
    o.start();
    return o;
  });

  const burst = (at: number) => {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    gain.gain.setValueAtTime(0.18, at + 0.38);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
  };
  const schedule = () => {
    const t = ctx.currentTime;
    burst(t);
    burst(t + 0.6);
  };
  schedule();
  const timer = window.setInterval(schedule, 3000);

  return () => {
    window.clearInterval(timer);
    oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
    void ctx.close();
  };
}

export default function IncomingCallModal() {
  const { contacts } = useSmsV2();
  const [incoming, setIncoming] = useState<TwilioCall | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const originalTitleRef = useRef<string>('');

  useEffect(() => {
    return addIncomingCallListener((call) => {
      setIncoming(call);
      setAccepting(false);
      setProblem(null);
      const clear = () => setIncoming((cur) => (cur === call ? null : cur));
      // If Twilio's server-side timeout fires (25s no answer) or the
      // caller hangs up before the agent picks, the SDK emits these.
      // Clear the modal so we don't show a stale ring.
      call.on('cancel', clear);
      call.on('disconnect', clear);
      call.on('reject', clear);
      call.on('accept', clear); // agent accepted — ActiveCallContext owns it now
      // accept() acquires the microphone and can fail well after it returns.
      // Nothing listened for that, so a failed accept looked exactly like a
      // button that did nothing, and the agent pressed it again and again.
      call.on('error', (e: { message?: string }) => {
        setAccepting(false);
        setProblem(e?.message ?? 'Could not connect the call.');
      });
    });
  }, []);

  // Ask for the microphone while it is still ringing, not on the click.
  //
  // The Twilio SDK grabs the mic inside accept(). If the browser has not been
  // granted it yet, that click raises a permission prompt instead of answering,
  // and the accept is lost. Asking here means permission is already settled by
  // the time the agent presses the button.
  useEffect(() => {
    if (!incoming) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        // We only wanted the permission; the SDK opens its own stream.
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setProblem(
            e.name === 'NotAllowedError'
              ? 'Microphone blocked. Allow it in the address bar, then answer.'
              : `Microphone unavailable: ${e.message}`,
          );
        }
      });
    return () => { cancelled = true; };
  }, [incoming]);

  // Ringtone + tab-title flash while modal is up
  useEffect(() => {
    if (!incoming) return;
    originalTitleRef.current = document.title;
    let flashOn = false;
    const titleTimer = window.setInterval(() => {
      flashOn = !flashOn;
      document.title = flashOn ? '☎ Incoming call…' : originalTitleRef.current;
    }, 800);

    const stopRinging = startRinging();
    return () => {
      window.clearInterval(titleTimer);
      document.title = originalTitleRef.current;
      stopRinging();
    };
  }, [incoming]);

  if (!incoming) return null;

  const fromParam = incoming.parameters?.['From'] ?? '';
  const phone = typeof fromParam === 'string' ? fromParam : '';
  // The server already matched this caller and passes its answer down on the
  // TwiML; the phone match is the fallback. It compares the last 9 digits
  // (api/lib/phone-match.ts) rather than the whole string, which is why a
  // branch filed as "0191 625 0242" used to ring as an unknown caller.
  const serverContactId = incoming.customParameters?.get('contactId') || null;
  const matched = serverContactId
    ? contacts.find((c) => c.id === serverContactId) ?? findByPhone(contacts, phone, (c) => c.phone)
    : findByPhone(contacts, phone, (c) => c.phone);
  const displayName = matched?.name ?? 'Unknown caller';
  // What they last spoke to us about, so he knows the call before he takes it.
  const lastHouse = matched?.customFields?.property_address ?? '';

  const accept = () => {
    if (accepting) return; // a second press cancels nothing, it just confuses
    setAccepting(true);
    setProblem(null);
    try {
      incoming.accept();
    } catch (e) {
      setAccepting(false);
      setProblem(e instanceof Error ? e.message : 'Could not answer the call.');
    }
  };
  const decline = () => {
    try {
      incoming.reject();
    } catch (e) {
      console.warn('[incoming] reject failed', e);
    }
    setIncoming(null);
  };

  return (
    <>
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl w-[340px] overflow-hidden border border-[#E5E7EB]">
          <div className="bg-[#3C5A87] text-white px-5 py-3 flex items-center gap-2">
            <Phone className="w-4 h-4 animate-pulse" />
            <span className="text-[13px] font-semibold">Incoming call</span>
          </div>
          <div className="flex flex-col items-center py-6 px-5">
            <div className="w-20 h-20 rounded-full bg-[#3C5A87] flex items-center justify-center text-white text-[28px] font-bold mb-3">
              {displayName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="text-[17px] font-semibold text-[#1A1A1A]">{displayName}</div>
            <div className="text-[14px] text-[#6B7280] tabular-nums mt-1">{phone || 'No caller ID'}</div>
            {lastHouse && (
              <div className="mt-1 text-center text-[12px] leading-snug text-[#8a6d1a]" data-testid="incoming-last-house">
                Last spoke about {lastHouse}
              </div>
            )}
            <div className="text-[12px] text-[#9CA3AF] mt-1">
              {accepting ? 'connecting…' : 'ringing…'}
            </div>
            {problem && (
              <div className="mt-3 text-[12px] text-[#B91C1C] text-center leading-snug">
                {problem}
              </div>
            )}
          </div>
          <div className="px-5 pb-5 flex gap-3">
            <button
              onClick={decline}
              className="flex-1 flex items-center justify-center gap-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white text-[14px] font-semibold py-3 rounded-xl transition-colors"
            >
              <PhoneOff className="w-4 h-4" /> Decline
            </button>
            <button
              onClick={accept}
              disabled={accepting}
              className="flex-1 flex items-center justify-center gap-2 bg-[#3C5A87] hover:bg-[#178e74] disabled:opacity-60 text-white text-[14px] font-semibold py-3 rounded-xl transition-colors"
            >
              <Phone className="w-4 h-4" /> {accepting ? 'Connecting' : 'Accept'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
