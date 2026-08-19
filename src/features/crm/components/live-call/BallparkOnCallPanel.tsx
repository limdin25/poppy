// The ballpark on call one, behind one very clear button.
//
// Hugo, 2026-08-19 (voice): "from the call number one we need a button there
// that Pedro presses, very clear button on the top, and then give us the
// ballpark when Pedro is ready. Pedro says: okay, let me check my system
// here, I'm not making an offer. I just want to know if I'm in the ballpark
// or a million miles off." The course teaches exactly this move ("Offer
// Without Offering": desktop homework first, then the ballpark question on
// the call itself), and the homework side already exists: the overnight
// machine priced the comps before Pedro ever dialled.
//
// THE FIGURE NEVER COMES FROM THE SCRIPT. Call one's script carries no money
// tokens (tests/property-script-isolation.test.ts pins that), so the only
// number Pedro can say on call one is the one this panel returns AFTER the
// system has heard THIS call. No press, no figure. The press runs the live
// path (live:true): skip the stored homework, listen to the call happening
// right now, price the works from what the agent just said, skip the deep
// photo pass so the answer lands while they are still on the phone. The
// ballpark-runner cron re-does the full-depth version after hangup and THAT
// is what arms the deal; this panel writes nothing.

import { useCallback, useState } from 'react';
import { Calculator, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

interface EngineBand {
  open?: number;
  ceiling?: number;
  gdv?: number;
  refurb?: number;
  evidence?: Array<{ address?: string; price?: number; date?: string }>;
}

interface FetchResult {
  ok?: boolean;
  reason?: string;
  detail?: string;
  engine?: EngineBand;
  error?: string;
}

const gbp = (n: number | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `£${Math.round(n).toLocaleString('en-GB')}` : null;

/** The refusal, said the way Pedro should hear it mid-call. */
function refusalText(reason: string | undefined, detail: string | undefined, httpError?: string): string {
  if (reason === 'nothing_heard') {
    return 'Nothing heard on this call yet. Ask the condition questions first (stage 3), then press again.';
  }
  if (reason === 'engine_unreachable' || httpError) {
    return 'The pricing system is not answering right now. Do not invent a number: say the director is still pricing it and book the callback.';
  }
  const why = (detail ?? '').trim();
  return `The system will not put a figure on this one from today's call${why ? `: ${why}` : '.'} Do not float any number. Say the director is still pricing it and book the callback.`;
}

export default function BallparkOnCallPanel({ propertyId }: { propertyId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'refused'>('idle');
  const [band, setBand] = useState<EngineBand | null>(null);
  const [refusal, setRefusal] = useState<string>('');

  const run = useCallback(async () => {
    setState('loading');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/crm/fetch-ballpark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ propertyId, live: true }),
      });
      // Text first: a gateway timeout answers with a plain-text crash page,
      // and parsing it as JSON printed "Unexpected token 'A'" at Hugo once
      // already (TodayPanel, 19 Aug).
      const raw = await res.text();
      let json: FetchResult;
      try { json = JSON.parse(raw) as FetchResult; } catch { json = { error: `HTTP ${res.status}` }; }
      const open = json.engine?.open;
      if (json.ok && typeof open === 'number' && Number.isFinite(open)) {
        setBand(json.engine ?? null);
        setState('ok');
      } else {
        setRefusal(refusalText(json.reason, json.detail, json.error));
        setState('refused');
      }
    } catch {
      setRefusal(refusalText(undefined, undefined, 'network'));
      setState('refused');
    }
  }, [propertyId]);

  if (state === 'idle') {
    return (
      <div
        className="border-b border-[#CBDACB] bg-[#F1F7F1] px-3 py-2.5"
        data-testid="ballpark-call1-panel"
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void run()}
            data-testid="ballpark-call1-button"
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-[8px] bg-[#2E7D46] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#256A3A]"
          >
            <Calculator className="h-4 w-4" />
            Get the ballpark
          </button>
          <span className="text-[11px] leading-snug text-[#3B5A44]">
            <b>Press at stage 5</b>, once you have the condition answers. It hears
            this call and prices it. Say the checking-my-system line while it thinks.
          </span>
        </div>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div
        className="flex items-center gap-2.5 border-b border-[#CBDACB] bg-[#F1F7F1] px-3 py-2.5"
        data-testid="ballpark-call1-panel"
      >
        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-[#2E7D46]" />
        <span className="text-[11.5px] leading-snug text-[#3B5A44]">
          Listening to this call and pricing the works, ten seconds or so. Keep them
          talking: "just checking my system here, bear with me."
        </span>
      </div>
    );
  }

  if (state === 'refused') {
    return (
      <div
        className="flex items-start gap-2 border-b border-[#EBD9B4] bg-[#FDF3E3] px-3 py-2.5"
        data-testid="ballpark-call1-panel"
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#9A6B1E]" />
        <span className="flex-1 text-[11.5px] leading-snug text-[#9A6B1E]">
          <b>No figure on this one.</b> {refusal}
        </span>
        <button
          type="button"
          onClick={() => void run()}
          className="flex-shrink-0 self-center inline-flex items-center gap-1 rounded-[7px] border border-[#D9C08A] px-2 py-1 text-[10.5px] font-semibold text-[#9A6B1E] hover:bg-[#F7E8CB]"
        >
          <RefreshCw className="h-3 w-3" />
          Try again
        </button>
      </div>
    );
  }

  const open = gbp(band?.open ?? undefined);
  const ceiling = gbp(band?.ceiling ?? undefined);
  const worth = gbp(band?.gdv ?? undefined);
  const works = gbp(band?.refurb ?? undefined);
  const proof = (band?.evidence ?? [])
    .slice(0, 2)
    .map((e) => [e.address, gbp(e.price)].filter(Boolean).join(' sold '))
    .filter(Boolean);

  return (
    <div
      className="border-b border-[#BBD4BE] bg-[#EDF6EE] px-3 py-2.5"
      data-testid="ballpark-call1-panel"
    >
      <div className="text-[9.5px] font-bold uppercase tracking-wide text-[#2E7D46]">
        Say this, word for word, then silence
      </div>
      <div className="mt-1 text-[13px] font-semibold leading-snug text-[#1A3A24]">
        "If I was to come in around <span className="text-[#155724]">{open}</span>, would
        I be in the ballpark, or am I a million miles off?"
      </div>
      <div className="mt-1.5 text-[10.5px] leading-snug text-[#3B5A44]">
        {ceiling && <><b>Never above {ceiling}</b>, even if pushed. </>}
        One number, then silence. No negotiating today: note their reaction in the
        Houses tab and book the callback.
        {(worth || works) && (
          <>
            {' '}Priced from this call: {worth ? <>worth about {worth} done up</> : null}
            {worth && works ? ', ' : null}
            {works ? <>around {works} of works</> : null}.
          </>
        )}
      </div>
      {proof.length > 0 && (
        <div className="mt-1 text-[10px] text-[#4E6B55]">
          Backed by: {proof.join(' and ')}
        </div>
      )}
      <button
        type="button"
        onClick={() => void run()}
        className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[#2E7D46] hover:text-[#1F5C33]"
      >
        <RefreshCw className="h-3 w-3" />
        Heard more since? Re-check
      </button>
    </div>
  );
}
