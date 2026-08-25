// The refurb estimator. Talk through the photos, get a costing and a builder's list.
//
// Hugo, 2026-08-25, correcting the first build of this screen: "He's gonna be
// on the computer recording and then he's gonna be looking at Rightmove, the
// photos. He's not going to the house, it's via the photos. And he doesn't need
// the room. He can go straight on this page. He's gonna speak up and then this
// page gonna take the text he's saying and then it's gonna spit out the message
// for the builder and our version of the costs."
//
// So: ONE box, one button. No wizard, no room-by-room questions. He talks, we
// read it, we price it from our own card, he sends the list to a builder.
//
// The example on screen is doing real work and is not decoration. Pedro is not
// a builder and "describe the property" produces three words. A worked example
// of somebody talking through photographs is what makes the difference between
// a recording we can price and one we cannot, and it costs nothing to show.
//
// EVERY LINE SHOWS THE WORDS THAT PRODUCED IT. The reader is a model and models
// mishear. Putting its quote and its own confidence next to each priced line is
// what makes this checkable rather than a black box, and it is why a wrong line
// is a five second fix instead of a wrong offer.
//
// The rate card, the maths and the builder's message all live in
// ../lib/refurbCard.ts. This file is the screen and the one fetch.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Check, ClipboardCopy, Eye, HardHat, Loader2, Mic,
  PoundSterling, Sparkles,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { builderBrief, gbp, type Estimate } from '../lib/refurbCard';

const STORE_KEY = 'elsie.refurb-estimator.v2';

interface HeardLine { key: string; heard?: string; confidence?: string }
interface ApiResult {
  band: string | null;
  summary: string | null;
  estimate: Estimate;
  heard: HeardLine[];
  brief: string;
}

const EXAMPLE = `Right, 14 Oundle Road, three bed terrace, on for 95 grand. Going through the pictures now.

Front of the house looks alright, brickwork is fine, no cracks I can see. Roof looks straight, gutters have got grass growing out of them and there's a green stain down the wall so it's been overflowing a while.

Living room, big room, but the walls have got that woodchip paper painted over and it's coming away by the door. Carpet is old and stained, that's coming up.

Kitchen is the old orange pine stuff, doors all look like they shut but the worktop is burnt by the cooker. No extractor. I'd rip it out to be honest, nobody's renting that.

Bathroom is actually not bad, white suite, all matches, tiles are plain white. There's black mould in the corner above the bath and I can't see a fan anywhere.

Bedrooms, front one is a good double, magnolia walls, looks sound. Back bedroom has flowery wallpaper peeling in the corners. Third one is tiny, box room.

Fuse box in the hallway picture is one of those old grey ones with the fuse wire, no trip switches. Radiators look like the thin old ones and there's a gas fire in the living room so there might be a back boiler.

Garden out the back is a small yard, all concrete, weeds everywhere, and the fence on the left is flat on the floor.

House is empty apart from a sofa and some bin bags in the back bedroom.`;

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-testid="copy-button"
      onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors',
        done ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#3C5A87] text-white hover:bg-[#324D74]',
      )}
    >
      {done ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
      {done ? 'Copied' : label}
    </button>
  );
}

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  seen:   { label: 'seen in the photos', cls: 'bg-[#DCFCE7] text-[#166534]' },
  likely: { label: 'likely', cls: 'bg-[#F3F4F6] text-[#6B7280]' },
  guess:  { label: 'a guess, check it', cls: 'bg-[#FEF3C7] text-[#B45309]' },
};

export default function RefurbEstimatorPage() {
  const [params] = useSearchParams();

  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as
      { address: string; sqm: string; transcript: string } | null; }
    catch { return null; }
  }, []);

  const [address, setAddress] = useState(params.get('address') ?? saved?.address ?? '');
  const [sqm, setSqm] = useState(params.get('sqm') ?? saved?.sqm ?? '');
  const [transcript, setTranscript] = useState(saved?.transcript ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [anchor, setAnchor] = useState(true);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ address, sqm, transcript })); }
    catch { /* private browsing, not worth a message */ }
  }, [address, sqm, transcript]);

  const generate = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('You are not signed in. Refresh the page and try again.');
      const res = await fetch('/api/crm/refurb-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          transcript,
          address,
          floorAreaSqm: sqm ? Number(sqm) : null,
        }),
      });
      // Read as text first: this call can run 30 seconds and a gateway timeout
      // answers HTML, which JSON.parse turns into a baffling "Unexpected token A".
      const raw = await res.text();
      let json: Record<string, unknown>;
      try { json = JSON.parse(raw) as Record<string, unknown>; }
      catch { throw new Error(`The server answered with an error (HTTP ${res.status}). Try again.`); }
      if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
      setResult(json as unknown as ApiResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [transcript, address, sqm]);

  // Rebuilt on this side so the anchor switch is instant and costs nothing.
  // Same function the server used, so the two can never word it differently.
  const brief = useMemo(() => {
    if (!result) return '';
    return builderBrief(result.estimate.lines, {
      address,
      includeBudget: anchor,
      budget: result.estimate.budget,
      unknowns: result.estimate.unknowns,
    });
  }, [result, address, anchor]);

  const heardFor = useCallback(
    (key: string) => result?.heard.find((h) => h.key === key),
    [result],
  );

  return (
    <div className="h-full overflow-y-auto bg-[#F7F8FA]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">

        {/* ---- what to do, in six words and then a paragraph ---- */}
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[#EEF2F8] p-2.5"><Mic className="h-5 w-5 text-[#3C5A87]" /></div>
            <div>
              <h1 className="text-[18px] font-bold text-[#1A1A1A]">Price up a refurb from the photos</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6B7280]">
                Open the property on Rightmove and scroll through the pictures. Talk through
                what you see, front of the house first, then each room, then the garden. Say
                what state it is in and what you think needs doing. Do not worry about
                sounding tidy, it does not have to be neat.
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#6B7280]">
                Put what you said in the box below. You can talk straight into it with the
                microphone key on your keyboard, or paste the text from a screen recording.
                Then press the button and it gives you our costs and a message for the builder.
              </p>
            </div>
          </div>
        </div>

        {/* ---- the inputs ---- */}
        <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className="mb-1 block text-[12px] font-semibold text-[#374151]">Which property?</label>
              <input
                data-testid="estimator-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="14 Oundle Road, Birmingham B44"
                className="w-full rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3C5A87]"
              />
            </div>
            <div className="sm:w-44">
              <label className="mb-1 block text-[12px] font-semibold text-[#374151]">
                Size in sq m <span className="font-normal text-[#9CA3AF]">(optional)</span>
              </label>
              <input
                data-testid="estimator-sqm"
                value={sqm}
                onChange={(e) => setSqm(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder="88"
                className="w-full rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3C5A87]"
              />
            </div>
          </div>

          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="text-[12px] font-semibold text-[#374151]">What you said going through the photos</label>
            <button
              type="button"
              data-testid="load-example"
              onClick={() => setTranscript(EXAMPLE)}
              className="text-[11.5px] font-semibold text-[#3C5A87] hover:underline"
            >
              Show me an example
            </button>
          </div>
          <textarea
            data-testid="estimator-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            placeholder={'Talk or paste here. For example:\n\n"Front of the house looks fine, gutters are full of grass. Living room has woodchip paper coming away and the carpet is stained. Kitchen is old orange pine, worktop is burnt, I would rip it out. Bathroom is not bad but there is black mould above the bath and no fan..."'}
            className="w-full resize-y rounded-xl border border-[#E5E7EB] px-3.5 py-3 text-[14px] leading-relaxed outline-none focus:border-[#3C5A87]"
          />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#9CA3AF]">
            <span>{transcript.trim().split(/\s+/).filter(Boolean).length} words</span>
            <span>Saved on this computer as you type</span>
          </div>

          <button
            type="button"
            data-testid="estimator-generate"
            disabled={busy || transcript.trim().length < 40}
            onClick={() => void generate()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3C5A87] py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#324D74] disabled:cursor-not-allowed disabled:bg-[#C7CDD6]"
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading it and pricing it up</>
              : <><Sparkles className="h-4 w-4" /> Generate the costs and the builder message</>}
          </button>
          {transcript.trim().length < 40 && (
            <p className="mt-2 text-center text-[11.5px] text-[#9CA3AF]">
              Say a bit more first, at least a couple of sentences.
            </p>
          )}
          {error && (
            <div className="mt-3 flex gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#DC2626]" />
              <p data-testid="estimator-error" className="text-[12.5px] leading-relaxed text-[#991B1B]">{error}</p>
            </div>
          )}
        </div>

        {result && (
          <>
            {/* ---- the three numbers ---- */}
            <div data-testid="estimate-totals" className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-[#EEF2F8] p-2.5"><PoundSterling className="h-5 w-5 text-[#3C5A87]" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                    Our budget for {address || 'this property'}
                  </p>
                  <p data-testid="estimate-budget" className="mt-0.5 text-[34px] font-bold leading-none text-[#1A1A1A]">
                    {gbp(result.estimate.budget)}
                  </p>
                  <p className="mt-1.5 text-[12px] text-[#6B7280]">
                    materials and labour, plus VAT, and before the 5% contingency the deal
                    calculator adds itself
                  </p>
                  {result.summary && (
                    <p className="mt-2.5 text-[13px] leading-relaxed text-[#374151]">{result.summary}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: 'Budget', v: result.estimate.budget, hint: 'our own crew' },
                  { label: 'Medium', v: result.estimate.medium, hint: 'normal builder' },
                  { label: 'Premium', v: result.estimate.premium, hint: 'top of the range' },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl bg-[#F9FAFB] px-3 py-2.5">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{c.label}</p>
                    <p className="mt-0.5 text-[17px] font-bold text-[#1A1A1A]">{gbp(c.v)}</p>
                    <p className="text-[10.5px] text-[#9CA3AF]">{c.hint}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-[#9CA3AF]">
                All three are the same list of jobs, priced at three different labour rates,
                and all three include materials. {result.estimate.scaleNote}
              </p>
            </div>

            {result.estimate.warnings.map((w) => (
              <div key={w} className="mt-3 flex gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#B45309]" />
                <p className="text-[12.5px] leading-relaxed text-[#78350F]">{w}</p>
              </div>
            ))}

            {/* ---- the lines, with the words that produced each one ---- */}
            <div className="mt-3 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white">
              <div className="border-b border-[#F3F4F6] px-4 py-3">
                <h2 className="text-[14px] font-bold text-[#1A1A1A]">Where the money goes</h2>
                <p className="mt-0.5 text-[11.5px] text-[#9CA3AF]">
                  Each line shows what you said that put it there. If one is wrong, say it
                  differently and run it again.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-[#F3F4F6] text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">
                      <th className="px-4 py-2 text-left font-semibold">Work</th>
                      <th className="px-2 py-2 text-right font-semibold">Budget</th>
                      <th className="px-2 py-2 text-right font-semibold">Medium</th>
                      <th className="px-4 py-2 text-right font-semibold">Premium</th>
                    </tr>
                  </thead>
                  <tbody data-testid="estimate-lines">
                    {result.estimate.lines.map((l) => {
                      const h = heardFor(l.key);
                      const conf = CONFIDENCE[l.confidence] ?? CONFIDENCE.likely;
                      return (
                        <tr key={l.key} className="border-b border-[#F9FAFB] last:border-0 align-top">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-[#1A1A1A]">{l.label}</span>
                              {l.units > 1 && Number.isInteger(l.units) && (
                                <span className="text-[10.5px] font-semibold text-[#6B7280]">x{l.units}</span>
                              )}
                              {l.units < 1 && (
                                <span className="text-[10.5px] text-[#9CA3AF]">{Math.round(l.units * 100)}% of the house</span>
                              )}
                              <span className={cn('rounded-full px-1.5 py-[1px] text-[9px] font-bold uppercase', conf.cls)}>
                                {conf.label}
                              </span>
                              {l.source === 'course' && (
                                <span className="rounded-full bg-[#FEF3C7] px-1.5 py-[1px] text-[9px] font-bold uppercase text-[#B45309]">
                                  off card
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-[11.5px] leading-snug text-[#6B7280]">{l.detail}</p>
                            {h?.heard && (
                              <p className="mt-1 text-[11px] italic leading-snug text-[#9CA3AF]">
                                you said: &ldquo;{h.heard}&rdquo;
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-[#1A1A1A]">{gbp(l.budget)}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-[#6B7280]">{gbp(l.medium)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[#9CA3AF]">{gbp(l.premium)}</td>
                        </tr>
                      );
                    })}
                    {!result.estimate.lines.length && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center italic text-[#9CA3AF]">
                        Nothing matched the rate card. Describe the rooms in a bit more detail and try again.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {result.estimate.offCard.length > 0 && (
                <div className="border-t border-[#F3F4F6] bg-[#FFFBEB] px-4 py-2.5 text-[11.5px] leading-relaxed text-[#78350F]">
                  <strong>{gbp(result.estimate.offCardBudget)}</strong> of this is marked <em>off card</em>:
                  roofs, windows, damp and heating. Our offer engine refuses to price those from
                  photographs, so they were never inside the ballpark figure. They need a builder to look.
                </div>
              )}
            </div>

            {/* ---- what photos cannot show ---- */}
            {result.estimate.unknowns.length > 0 && (
              <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#3C5A87]" />
                  <h2 className="text-[14px] font-bold text-[#1A1A1A]">What the photos cannot tell you</h2>
                </div>
                <ul className="space-y-1.5">
                  {result.estimate.unknowns.map((u) => (
                    <li key={u} className="flex gap-2 text-[12.5px] leading-relaxed text-[#374151]">
                      <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#9CA3AF]" />{u}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-[#9CA3AF]">
                  These go on the builder message too, so he knows what to look at when he walks it.
                </p>
              </div>
            )}

            {/* ---- the builder's message ---- */}
            <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <HardHat className="h-4 w-4 text-[#3C5A87]" />
                  <h2 className="text-[14px] font-bold text-[#1A1A1A]">Message for the builder</h2>
                </div>
                <Copy text={brief} label="Copy" />
              </div>
              <label className="mb-3 flex items-center gap-2 text-[12px] text-[#374151]">
                <input
                  type="checkbox"
                  data-testid="anchor-toggle"
                  checked={anchor}
                  onChange={(e) => setAnchor(e.target.checked)}
                  className="h-4 w-4 accent-[#3C5A87]"
                />
                Put our budget on it, to anchor him at a price
              </label>
              <pre
                data-testid="builder-brief"
                className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-[#F9FAFB] p-3.5 font-sans text-[12.5px] leading-relaxed text-[#374151]"
              >{brief}</pre>
              <p className="mt-2 text-[11px] leading-relaxed text-[#9CA3AF]">
                Saved on this computer only for now. Copy it out before you close the page,
                it is not written onto the deal yet.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
