import { useEffect, useState } from 'react';
// The call script lives in the repo and is bundled (not a public URL), so the
// PIN below is the only way in. Raw import keeps the HTML byte-for-byte.
import scriptHtml from './one-call-script.html?raw';

const PIN = '1176';
const UNLOCK_KEY = 'one_call_script_unlocked';

/**
 * PIN-gated host for the one-call sales script at /script (works on
 * heyelsie.com and app.heyelsie.com). Public route, no login. Enter 1176 to
 * view; the script renders in an iframe so its own styles + script run intact.
 */
export default function ScriptPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    document.title = 'Call script';
    try {
      if (sessionStorage.getItem(UNLOCK_KEY) === '1') setUnlocked(true);
    } catch { /* sessionStorage blocked — user just re-enters the PIN */ }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim() === PIN) {
      setUnlocked(true);
      try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch { /* ignore */ }
    } else {
      setError(true);
      setPin('');
    }
  };

  if (unlocked) {
    return (
      <iframe
        title="Call script"
        srcDoc={scriptHtml}
        className="fixed inset-0 w-full h-full border-0"
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F7F4] px-4">
      <form onSubmit={submit} className="w-full max-w-xs bg-white border border-[#E5E7EB] rounded-2xl p-7 text-center shadow-sm">
        <div className="w-11 h-11 rounded-xl bg-[#EEF2F8] grid place-items-center mx-auto mb-4 text-[#3C5A87] text-lg">🔒</div>
        <h1 className="text-[#1A1A1A] font-bold text-[17px] mb-1">Enter PIN</h1>
        <p className="text-[#6B7280] text-[13px] mb-5">This page is protected.</p>
        <input
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(false); }}
          inputMode="numeric"
          autoFocus
          placeholder="••••"
          className="w-full h-12 text-center text-[20px] tracking-[8px] font-mono bg-white border border-[#E5E7EB] rounded-xl text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87] mb-3"
        />
        {error && <p className="text-[#B42318] text-[13px] mb-3">Wrong PIN, try again.</p>}
        <button type="submit" className="w-full h-11 rounded-xl bg-[#3C5A87] text-white font-semibold text-[15px] hover:bg-[#33507a]">
          Unlock
        </button>
      </form>
    </div>
  );
}
