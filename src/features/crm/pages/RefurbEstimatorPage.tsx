// The refurb estimator. One box per part of the property, each with a mic.
//
// Hugo, 2026-08-25, correcting the second build of this screen: "There is only
// one session, only one box. It should be one box per room. Talk about the
// bathroom and then there's a button where he can press the audio and he can
// speak and explain about that part of the property, and then the bedroom. And
// then another part is gonna say garden, front of the house, things like this.
// Now there are many sections of the parts of the property, SO HE DOESN'T
// FORGET TO LOOK AT ANYTHING on the property, and then speaks on the mic."
//
// THE POINT IS THE CHECKLIST, NOT THE TYPING. One big box got a description of
// the kitchen and nothing about the fuse board, because nothing on screen ever
// mentioned the fuse board. Fourteen labelled boxes with a counter at the top
// make the gap visible: he can see which parts of the property he has not
// looked at yet, which is exactly what Hugo asked for.
//
// Each box has its own microphone button. He presses it, talks about that part
// of the property, presses it again. The words land in that box and he can fix
// them by hand. Only one box can be recording at a time because there is only
// one microphone, which useDictation enforces.
//
// The list of parts, the rate card, the maths and the builder's message all
// live in ../lib/refurbCard.ts. This file is the screen.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Check, ClipboardCopy, Eye, HardHat, Loader2, Mic, Square,
  PoundSterling, Sparkles,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useDictation } from '../lib/useDictation';
import {
  SECTIONS, builderBrief, missingSections, gbp,
  type Estimate, type SectionAnswer,
} from '../lib/refurbCard';

const STORE_KEY = 'elsie.refurb-estimator.v3';

interface HeardLine { key: string; heard?: string; confidence?: string }
interface ApiResult {
  band: string | null;
  summary: string | null;
  estimate: Estimate;
  heard: HeardLine[];
  brief: string;
}

const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  seen:   { label: 'seen in the photos', cls: 'bg-[#DCFCE7] text-[#166534]' },
  likely: { label: 'likely', cls: 'bg-[#F3F4F6] text-[#6B7280]' },
  guess:  { label: 'a guess, check it', cls: 'bg-[#FEF3C7] text-[#B45309]' },
};

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

export default function RefurbEstimatorPage() {
  const [params] = useSearchParams();

  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as
        { address: string; sqm: string; texts: Record<string, string> } | null;
    } catch { return null; }
  }, []);

  const [address, setAddress] = useState(params.get('address') ?? saved?.address ?? '');
  const [sqm, setSqm] = useState(params.get('sqm') ?? saved?.sqm ?? '');
  const [texts, setTexts] = useState<Record<string, string>>(saved?.texts ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [anchor, setAnchor] = useState(true);

  const dictation = useDictation();

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ address, sqm, texts })); }
    catch { /* private browsing, not worth a message */ }
  }, [address, sqm, texts]);

  /** Dictation appends. He is adding to what he already said about this part of
   *  the property, never replacing it, and never losing what he typed by hand. */
  const appendText = useCallback((id: string, words: string) => {
    if (!words) return;
    setTexts((t) => {
      const prev = (t[id] ?? '').trim();
      return { ...t, [id]: prev ? `${prev} ${words}` : words };
    });
  }, []);

  const answers: SectionAnswer[] = useMemo(
    () => SECTIONS.map((s) => ({ id: s.id, text: texts[s.id] ?? '' })),
    [texts],
  );
  const missing = useMemo(() => missingSections(answers), [answers]);
  const doneCount = SECTIONS.length - missing.length;
  const enoughToPrice = answers.some((a) => a.text.trim().length > 20);

  const generate = useCallback(async () => {
    dictation.stop();
    setBusy(true); setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('You are not signed in. Refresh the page and try again.');
      const res = await fetch('/api/crm/refurb-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sections: answers, address, floorAreaSqm: sqm ? Number(sqm) : null }),
      });
      // Read as text first: this call can run 30 seconds and a gateway timeout
      // answers HTML, which JSON.parse turns into a baffling "Unexpected token A".
      const raw = await res.text();
      let json: Record<string, unknown>;
      try { json = JSON.parse(raw) as Record<string, unknown>; }
      catch { throw new Error(`The server answered with an error (HTTP ${res.status}). Try again.`); }
      if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
      setResult(json as unknown as ApiResult);
      // The answer is below fourteen boxes, so it needs bringing into view.
      setTimeout(() => document.getElementById('estimate-result')?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [answers, address, sqm, dictation]);

  // Rebuilt on this side so the anchor switch is instant and costs nothing.
  // Same function the server used, so the two can never word it differently.
  const brief = useMemo(() => {
    if (!result) return '';
    return builderBrief(result.estimate.lines, {
      address, includeBudget: anchor, budget: result.estimate.budget,
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

        {/* ---- what to do ---- */}
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[#EEF2F8] p-2.5"><Mic className="h-5 w-5 text-[#3C5A87]" /></div>
            <div>
              <h1 className="text-[18px] font-bold text-[#1A1A1A]">Price up a refurb from the photos</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6B7280]">
                Open the property on Rightmove next to this page. Go down the list below,
                one part of the property at a time. Press the microphone on a box, say what
                you can see in the pictures, press it again to stop. If something looks fine,
                say that, it counts.
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#6B7280]">
                You do not have to fill in all of them, but the ones you skip are the ones
                nobody has looked at, so the list tells you which those are. When you are
                done, press the button at the bottom.
              </p>
              {!dictation.supported && (
                <p className="mt-2 rounded-lg bg-[#FFFBEB] px-3 py-2 text-[12.5px] text-[#78350F]">
                  This browser cannot do dictation, so the microphone buttons are hidden.
                  Type into the boxes instead, or open this page in Chrome.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ---- the property ---- */}
        <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
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
        </div>

        {/* ---- the checklist counter. The whole reason this is a list. ---- */}
        <div className="sticky top-0 z-10 mt-3 rounded-2xl border border-[#E5E7EB] bg-white/95 p-4 backdrop-blur">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-[#1A1A1A]">
              <span data-testid="sections-done">{doneCount}</span> of {SECTIONS.length} parts of the property done
            </span>
            <span className={cn('font-medium', missing.length ? 'text-[#B45309]' : 'text-[#166534]')}>
              {missing.length ? `${missing.length} still to look at` : 'Nothing missed'}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F3F4F6]">
            <div
              className="h-full rounded-full bg-[#3C5A87] transition-all duration-300"
              style={{ width: `${(doneCount / SECTIONS.length) * 100}%` }}
            />
          </div>
          {missing.length > 0 && missing.length <= 6 && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#9CA3AF]">
              Not looked at yet: {missing.map((s) => s.label.toLowerCase()).join(', ')}.
            </p>
          )}
        </div>

        {dictation.error && (
          <div className="mt-3 flex gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#DC2626]" />
            <p className="text-[12.5px] leading-relaxed text-[#991B1B]">{dictation.error}</p>
          </div>
        )}

        {/* ---- one box per part of the property ---- */}
        <div className="mt-3 space-y-3">
          {SECTIONS.map((s) => {
            const recording = dictation.activeId === s.id;
            const filled = (texts[s.id] ?? '').trim().length > 2;
            return (
              <div
                key={s.id}
                data-testid={`section-${s.id}`}
                className={cn(
                  'rounded-2xl border bg-white p-4 transition-colors',
                  recording ? 'border-[#DC2626] ring-2 ring-[#FEE2E2]' : 'border-[#E5E7EB]',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-bold text-[#1A1A1A]">{s.label}</h2>
                      {filled && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-[#DCFCE7] px-1.5 py-[1px] text-[9.5px] font-bold uppercase text-[#166534]">
                          <Check className="h-2.5 w-2.5" /> done
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B7280]">{s.look}</p>
                  </div>

                  {dictation.supported && (
                    <button
                      type="button"
                      data-testid={`mic-${s.id}`}
                      onClick={() => (recording ? dictation.stop() : dictation.start(s.id, (w) => appendText(s.id, w)))}
                      className={cn(
                        'flex h-11 flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold transition-colors',
                        recording
                          ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]'
                          : 'bg-[#EEF2F8] text-[#3C5A87] hover:bg-[#DCE5F1]',
                      )}
                    >
                      {recording
                        ? <><Square className="h-3.5 w-3.5 fill-current" /> Stop</>
                        : <><Mic className="h-4 w-4" /> Speak</>}
                    </button>
                  )}
                </div>

                {recording && (
                  <p className="mt-2.5 flex items-center gap-2 text-[12.5px] italic text-[#DC2626]">
                    <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[#DC2626]" />
                    {dictation.interim || 'Listening, start talking about this part.'}
                  </p>
                )}

                <textarea
                  data-testid={`text-${s.id}`}
                  value={texts[s.id] ?? ''}
                  onChange={(e) => setTexts((t) => ({ ...t, [s.id]: e.target.value }))}
                  rows={3}
                  placeholder={dictation.supported
                    ? 'Press Speak and talk, or type it here.'
                    : 'Type what you can see here.'}
                  className="mt-2.5 w-full resize-y rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-[14px] leading-relaxed outline-none focus:border-[#3C5A87]"
                />
              </div>
            );
          })}
        </div>

        {/* ---- generate ---- */}
        <div className="mt-4">
          <button
            type="button"
            data-testid="estimator-generate"
            disabled={busy || !enoughToPrice}
            onClick={() => void generate()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3C5A87] py-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#324D74] disabled:cursor-not-allowed disabled:bg-[#C7CDD6]"
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading it and pricing it up</>
              : <><Sparkles className="h-4 w-4" /> Generate the costs and the builder message</>}
          </button>
          {!enoughToPrice && (
            <p className="mt-2 text-center text-[11.5px] text-[#9CA3AF]">
              Fill in at least one part of the property first.
            </p>
          )}
          {missing.length > 0 && enoughToPrice && !busy && (
            <p className="mt-2 text-center text-[11.5px] text-[#B45309]">
              You can generate now, but {missing.length} part{missing.length > 1 ? 's have' : ' has'} not
              been looked at, and anything you skip gets priced as if it were fine.
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
          <div id="estimate-result" className="scroll-mt-24">
            {/* ---- the three numbers ---- */}
            <div data-testid="estimate-totals" className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-5">
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
                All three are the same list of jobs at three different labour rates, and all
                three include materials. {result.estimate.scaleNote}
              </p>
            </div>

            {result.estimate.warnings.map((w) => (
              <div key={w} className="mt-3 flex gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#B45309]" />
                <p className="text-[12.5px] leading-relaxed text-[#78350F]">{w}</p>
              </div>
            ))}

            {/* ---- the lines, each showing the words that produced it ---- */}
            <div className="mt-3 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white">
              <div className="border-b border-[#F3F4F6] px-4 py-3">
                <h2 className="text-[14px] font-bold text-[#1A1A1A]">Where the money goes</h2>
                <p className="mt-0.5 text-[11.5px] text-[#9CA3AF]">
                  Each line shows what you said that put it there. If one is wrong, fix that
                  box and generate again.
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
                        <tr key={l.key} className="border-b border-[#F9FAFB] align-top last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-[#1A1A1A]">{l.label}</span>
                              {l.where && <span className="text-[10.5px] text-[#6B7280]">{l.where}</span>}
                              {l.units > 1 && Number.isInteger(l.units) && (
                                <span className="text-[10.5px] font-semibold text-[#6B7280]">x{l.units}</span>
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
                        Nothing matched the rate card. Say a bit more about each part and try again.
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
          </div>
        )}
      </div>
    </div>
  );
}
