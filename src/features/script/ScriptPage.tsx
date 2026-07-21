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
    <div className="min-h-screen flex items-center justify-center bg-[#0d0d0f] px-4">
      <form onSubmit={submit} className="w-full max-w-xs bg-[#17171b] border border-white/10 rounded-2xl p-7 text-center">
        <div className="w-11 h-11 rounded-xl bg-white/10 grid place-items-center mx-auto mb-4 text-white text-lg">🔒</div>
        <h1 className="text-white font-bold text-[17px] mb-1">Enter PIN</h1>
        <p className="text-white/50 text-[13px] mb-5">This page is protected.</p>
        <input
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError(false); }}
          inputMode="numeric"
          autoFocus
          placeholder="••••"
          className="w-full h-12 text-center text-[20px] tracking-[8px] font-mono bg-[#0d0d0f] border border-white/15 rounded-xl text-white focus:outline-none focus:border-white/40 mb-3"
        />
        {error && <p className="text-[#f87171] text-[13px] mb-3">Wrong PIN, try again.</p>}
        <button type="submit" className="w-full h-11 rounded-xl bg-white text-black font-semibold text-[15px] hover:bg-white/90">
          Unlock
        </button>
      </form>
    </div>
  );
}
