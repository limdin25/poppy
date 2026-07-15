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

// Short, royalty-free phone-ring tone encoded as a tiny WAV so we don't
// need to ship a separate asset. Sine wave at 440Hz / 480Hz, ~2s long,
// loops cleanly. Kept here as a data URI to avoid build-time asset
// plumbing — the file is small (~30KB).
const RINGTONE_SRC =
  'data:audio/wav;base64,UklGRiQEAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAEAAA=';

export default function IncomingCallModal() {
  const { contacts } = useSmsV2();
  const [incoming, setIncoming] = useState<TwilioCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const originalTitleRef = useRef<string>('');

  useEffect(() => {
    return addIncomingCallListener((call) => {
      setIncoming(call);
      const clear = () => setIncoming((cur) => (cur === call ? null : cur));
      // If Twilio's server-side timeout fires (25s no answer) or the
      // caller hangs up before the agent picks, the SDK emits these.
      // Clear the modal so we don't show a stale ring.
      call.on('cancel', clear);
      call.on('disconnect', clear);
      call.on('reject', clear);
      call.on('accept', clear); // agent accepted — ActiveCallContext owns it now
    });
  }, []);

  // Ringtone + tab-title flash while modal is up
  useEffect(() => {
    if (!incoming) return;
    originalTitleRef.current = document.title;
    let flashOn = false;
    const titleTimer = window.setInterval(() => {
      flashOn = !flashOn;
      document.title = flashOn ? '☎ Incoming call…' : originalTitleRef.current;
    }, 800);

    const audio = audioRef.current;
    if (audio) {
      audio.loop = true;
      audio.currentTime = 0;
      // Play returns a promise; autoplay may be blocked if the agent
      // never interacted with the tab. We log and rely on the visual
      // ring + title flash in that case.
      void audio.play().catch((e) => console.warn('[incoming] ringtone blocked', e));
    }
    return () => {
      window.clearInterval(titleTimer);
      document.title = originalTitleRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    };
  }, [incoming]);

  if (!incoming) return null;

  const fromParam = incoming.parameters?.['From'] ?? '';
  const phone = typeof fromParam === 'string' ? fromParam : '';
  const matched = phone ? contacts.find((c) => c.phone === phone) : undefined;
  const displayName = matched?.name ?? 'Unknown caller';

  const accept = () => {
    try {
      incoming.accept();
    } catch (e) {
      console.warn('[incoming] accept failed', e);
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
      <audio ref={audioRef} src={RINGTONE_SRC} preload="auto" />
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
            <div className="text-[12px] text-[#9CA3AF] mt-1">ringing…</div>
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
              className="flex-1 flex items-center justify-center gap-2 bg-[#3C5A87] hover:bg-[#178e74] text-white text-[14px] font-semibold py-3 rounded-xl transition-colors"
            >
              <Phone className="w-4 h-4" /> Accept
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
