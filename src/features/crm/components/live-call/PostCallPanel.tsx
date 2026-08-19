import { useEffect, useState } from 'react';
import {
  Sparkles,
  Clock,
  PhoneMissed,
  X,
  Voicemail,
  Ban,
  Pause,
  SkipForward,
  Phone,
  ArrowLeft,
  HardHat,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/core/lib/cn';
import { useActiveCallCtx } from './ActiveCallContext';
import { useSmsV2 } from '../../store/SmsV2Store';
import { isSpeedDialerOn, subscribeSpeedDialer } from '../../lib/speedDialer';
import FollowupPromptModal from '../followups/FollowupPromptModal';
import { usePropertyListings } from '../../hooks/usePropertyListings';
import { ukInputToIso, ukLabel } from '../../lib/ukTime';
import { supabase } from '@/integrations/supabase/browser';

/** The builder viewing, booked right where the call ends.
 *
 *  Hugo, 2026-08-19: "build a calendar next to the call disposition. If you
 *  book a builder we can add the date there right after the call. UK time.
 *  And it reflects on the cockpit's calendar." Property calls only. The time
 *  is typed as UK wall time whatever zone the agent sits in (Pedro is in the
 *  Philippines), and the note travels with the booking so the calendar card
 *  is not a bare time: his first booking saved without the note and the
 *  card told nobody anything. */
function BuilderViewingBox({ propertyOptions, quickNote }: {
  propertyOptions: Array<{ id: string; address: string | null }>;
  quickNote: string;
}) {
  const [propId, setPropId] = useState(propertyOptions[0]?.id ?? '');
  useEffect(() => {
    if (!propId && propertyOptions[0]?.id) setPropId(propertyOptions[0].id);
  }, [propertyOptions, propId]);
  const [dueLocal, setDueLocal] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!propId || !dueLocal || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const iso = ukInputToIso(dueLocal);
      const res = await fetch('/api/crm/book-viewing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // The quick note is the fallback: Pedro types the booking words
        // there first, and losing them was the whole bug.
        body: JSON.stringify({ propertyId: propId, at: iso, note: note.trim() || quickNote.trim() || null }),
      });
      const raw = await res.text();
      let json: { ok?: boolean; error?: string };
      try { json = JSON.parse(raw) as typeof json; } catch { json = { error: `HTTP ${res.status}` }; }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Could not book it');
      setSavedAt(iso);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not book it');
    } finally {
      setSaving(false);
    }
  };

  if (savedAt) {
    return (
      <div
        className="mt-5 rounded-[12px] border border-[#BBD4BE] bg-[#EDF6EE] px-3 py-2.5 text-[12px] text-[#1A3A24]"
        data-testid="builder-viewing-booked"
      >
        <HardHat className="inline w-3.5 h-3.5 mr-1 -mt-0.5 text-[#2E7D46]" />
        Builder viewing booked for <b>{ukLabel(savedAt)}</b> UK. It is on the cockpit
        calendar, note included. Hugo sorts out which builder goes.
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-[12px] border border-[#E5E7EB] bg-white p-3" data-testid="builder-viewing-box">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
        <HardHat className="w-3.5 h-3.5 text-[#3C5A87]" />
        Book the builder viewing (UK time)
      </div>
      {propertyOptions.length > 1 && (
        <select
          value={propId}
          onChange={(e) => setPropId(e.target.value)}
          className="w-full mb-2 px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] bg-white"
        >
          {propertyOptions.map((p) => (
            <option key={p.id} value={p.id}>{(p.address ?? 'Unnamed house').split(',')[0]}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          data-testid="builder-viewing-when"
          className="flex-1 px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!propId || !dueLocal || saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-[#3C5A87] text-white rounded-[8px] hover:bg-[#3C5A87]/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardHat className="w-3.5 h-3.5" />}
          Book it
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the calendar (your quick note is used if this stays empty)"
        className="w-full mt-2 px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
      />
      {error && <div className="mt-1.5 text-[11px] text-[#EF4444]">{error}</div>}
    </div>
  );
}

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Clock,
  PhoneMissed,
  X,
  Voicemail,
  Ban,
};

export default function PostCallPanel() {
  const { applyOutcome, call, lastEndedContactId, openPreviousCall } = useActiveCallCtx();
  const store = useSmsV2();
  // Both dialer surfaces own their own pacing (CallerPad at /dialer, the
  // WrapUpCard at /dialer-pro). Hugo 2026-07-24: this was an exact-match on
  // '/admin/crm/dialer' only, so on /dialer-pro this panel ran a SECOND
  // countdown on top of the dialer's own and auto-dialled the next lead.
  const onCallerDialer = useLocation().pathname.startsWith('/admin/crm/dialer');
  const columns = store.columns;
  const autoAdvanceSeconds = store.activeCampaign?.autoAdvanceSeconds ?? 10;
  const [secondsLeft, setSecondsLeft] = useState(autoAdvanceSeconds);
  // Speed: OFF must stop the countdown dead — no outcome is auto-submitted
  // and no next call is placed until the agent presses for it.
  const [speedOn, setSpeedOn] = useState(isSpeedDialerOn);
  useEffect(() => subscribeSpeedDialer(() => setSpeedOn(isSpeedDialerOn())), []);
  const [paused, setPaused] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // PR 105 (Hugo 2026-04-28): the chosen outcome card stays highlighted
  // as "this is the one you picked", while the rest dim out so it's
  // obvious WHICH card the agent clicked. Skipped / Next-now leave
  // pickedColumnId null and every card just dims.
  const [pickedColumnId, setPickedColumnId] = useState<string | null>(null);
  // PR 19: when the picked stage carries requires_followup=true, open
  // the prompt modal BEFORE committing applyOutcome. Pausing the auto-
  // advance timer while the modal is open keeps the agent from being
  // dragged onto the next call before they've set the timer.
  const [pendingFollowupColId, setPendingFollowupColId] = useState<string | null>(null);
  // PR 90 (Hugo 2026-04-27): the quick-note input was uncontrolled \u2014
  // anything typed disappeared on phase change. Now state-bound + threaded
  // through applyOutcome.
  const [quickNote, setQuickNote] = useState('');

  // Reset countdown if the active campaign changes (different auto-advance)
  useEffect(() => {
    setSecondsLeft(autoAdvanceSeconds);
  }, [autoAdvanceSeconds]);

  useEffect(() => {
    if (paused || submitted || pendingFollowupColId || onCallerDialer || !speedOn) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [paused, submitted, pendingFollowupColId, onCallerDialer, speedOn]);

  useEffect(() => {
    if (secondsLeft === 0 && !paused && !submitted && !onCallerDialer && speedOn) {
      const def = columns.find((c) => c.isDefaultOnTimeout);
      if (def) handleClick(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, paused, submitted, onCallerDialer, speedOn]);

  const handleClick = (columnId: string) => {
    if (submitted) return;
    const col = columns.find((c) => c.id === columnId);
    // PR 105: mark the visually-picked card as soon as the agent clicks
    // (before the follow-up modal opens) so they can see WHAT they chose.
    setPickedColumnId(columnId);
    // PR 19: if the picked stage requires a follow-up, open the modal
    // FIRST and let the agent pick a time + note. The actual outcome
    // submission happens in commitOutcome after the modal saves or is
    // skipped.
    if (col?.requiresFollowup) {
      setPendingFollowupColId(columnId);
      return;
    }
    commitOutcome(columnId);
  };

  const commitOutcome = (columnId: string) => {
    setPickedColumnId(columnId);
    setSubmitted(true);
    const note = quickNote.trim() || undefined;
    // Defer slightly so the button's optimistic disabled state paints first
    setTimeout(() => applyOutcome(columnId, note), 200);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (submitted || onCallerDialer) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const col = columns.find((c) => c.position === num);
        if (col) handleClick(col.id);
      } else if (e.key.toLowerCase() === 'p') {
        setPaused((p) => !p);
      } else if (e.key.toLowerCase() === 's') {
        setSubmitted(true);
        setTimeout(() => applyOutcome('skipped', quickNote.trim() || undefined), 200);
      } else if (e.key.toLowerCase() === 'n') {
        setSubmitted(true);
        setTimeout(() => applyOutcome('next-now', quickNote.trim() || undefined), 200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, columns]);

  const nextId = store.queue[0];
  const nextContact = nextId ? store.getContact(nextId) : undefined;

  // The builder viewing box, property calls only. The contact the call was
  // about knows whether this is a house conversation (lead_type is stamped
  // by the property room) and which houses hang off the branch.
  const endedContact = call?.contactId ? store.getContact(call.contactId) : undefined;
  const isPropertyCall = endedContact?.customFields?.lead_type === 'estate_agent';
  const { listings } = usePropertyListings(isPropertyCall ? endedContact?.phone : null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b border-[#E5E7EB] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#3C5A87]" />
        <span className="text-[13px] font-semibold text-[#1A1A1A]">
          ✅ Call ended · {call?.contactName} · Recording saved
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-3">
          ⚡ Pick an outcome — pipeline columns
        </div>

        {/* Hugo 2026-04-26 (PR 17): outcome cards are pure pipeline
            routing now. The +SMS / +task / +tag automation badges came
            off because Hugo doesn't want the post-call pick to fire
            extra side-effects — the SMS already went out via the mid-
            call SMS sender (PR 16, mandatory stage). The outcome card
            just records WHERE the lead lands. */}
        <div className="grid grid-cols-2 gap-3">
          {columns.map((col) => {
            const Icon = ICON_MAP[col.icon] ?? Sparkles;
            // PR 105: three visual states for outcome cards.
            //   picked   → the card the agent chose, green border + ✓ badge.
            //   dimmed   → submitted but NOT picked → faded out so contrast is clear.
            //   default  → pre-submit, hover-able.
            const isPicked = submitted && pickedColumnId === col.id;
            const isDimmed = submitted && pickedColumnId !== col.id;
            return (
              <button
                key={col.id}
                onClick={() => handleClick(col.id)}
                disabled={submitted}
                data-testid={`postcall-outcome-${col.id}`}
                data-picked={isPicked ? 'true' : undefined}
                className={cn(
                  'relative group p-3 rounded-2xl border-2 text-left bg-white transition-all',
                  isPicked
                    ? 'border-[#3C5A87] border-[3px] bg-[#EEF2F8] shadow-[0_8px_28px_rgba(30,154,128,0.45)] cursor-default ring-2 ring-[#3C5A87]/20'
                    : isDimmed
                      ? 'border-[#E5E7EB] opacity-25 grayscale cursor-not-allowed'
                      : 'border-[#E5E7EB] hover:border-[#3C5A87]/50 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]'
                )}
              >
                {/* PR 114 (Hugo 2026-04-28): louder DONE badge + bigger
                    tick. Hugo: "very clear orange DONE, very obvious
                    which one is selected." */}
                {isPicked && (
                  <>
                    <span
                      className="absolute -top-2 -right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F59E0B] text-white text-[10px] font-bold uppercase tracking-wide shadow-md"
                      aria-label="Picked"
                    >
                      ✓ DONE
                    </span>
                    <span className="absolute bottom-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#3C5A87] text-white text-[16px] font-bold shadow-md">
                      ✓
                    </span>
                  </>
                )}
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${col.colour}1A`, color: col.colour }}
                  >
                    <Icon className="w-4 h-4" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-[#9CA3AF] tabular-nums">
                      {col.position}.
                    </span>
                    <span
                      className={cn(
                        'text-[14px] font-semibold truncate',
                        isPicked ? 'text-[#3C5A87]' : 'text-[#1A1A1A]'
                      )}
                    >
                      {col.name}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Quick note — single row, full width. The "Quick SMS template"
            dropdown that used to live here was removed: SMS automation runs
            from the column's automation rules already (no manual override
            needed at this surface), and Hugo asked for buttons-only here. */}
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1.5">
            Quick note
          </div>
          <input
            value={quickNote}
            onChange={(e) => setQuickNote(e.target.value)}
            placeholder="Add a note (optional)…"
            data-testid="postcall-quicknote"
            className="w-full px-3 py-2 text-[13px] bg-white border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
          />
        </div>

        {isPropertyCall && listings.length > 0 && (
          <BuilderViewingBox
            propertyOptions={listings.map((l) => ({ id: l.id, address: l.address }))}
            quickNote={quickNote}
          />
        )}

        {/* Empty-state hint when no pipeline columns are hydrated yet. The
            most common cause is a fresh workspace before useHydratePipelineColumns
            populates the store. Without this, PostCallPanel rendered just
            the section header + dropdown and looked broken. */}
        {columns.length === 0 && (
          <div className="mt-4 p-3 rounded-[10px] bg-[#FEF7E6] border border-[#FDE68A] text-[12px] text-[#1A1A1A]">
            No pipeline columns yet. Open Settings → Pipelines and add a few
            stages so you can pick an outcome from buttons here.
          </div>
        )}
      </div>

      {/* Footer auto-advance — hidden on /crm/dialer where CallerPad owns pacing */}
      {onCallerDialer ? null : <div className="px-5 py-3 border-t border-[#E5E7EB] bg-[#F3F3EE]/50 flex items-center gap-3">
        <div className="flex-1 text-[12px] text-[#6B7280]">
          {!speedOn ? (
            <span>Speed: OFF — press <span className="text-[#1A1A1A] font-semibold">Next call</span> when you're ready</span>
          ) : paused ? (
            <span>Paused — pick when ready</span>
          ) : (
            <>
              Next call in{' '}
              <span className="text-[#1A1A1A] font-semibold tabular-nums">
                0:{secondsLeft.toString().padStart(2, '0')}
              </span>
              {nextContact && (
                <span className="ml-2 text-[#9CA3AF]">
                  · Next: <span className="text-[#1A1A1A] font-medium">{nextContact.name}</span>
                </span>
              )}
              {!nextContact && <span className="ml-2 text-[#9CA3AF]">· Queue empty</span>}
            </>
          )}
          <span className="ml-2 text-[10px] text-[#9CA3AF]">
            ⌨ 1–9 · S skip · P pause · N next call
          </span>
        </div>
        {lastEndedContactId && (
          <button
            onClick={openPreviousCall}
            disabled={submitted}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-[#E5E7EB] text-[12px] font-medium text-[#6B7280] hover:bg-white disabled:opacity-50"
            title="Go back to the previous call's room (doesn't end the dial cycle)"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Previous call
          </button>
        )}
        <button
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-[#E5E7EB] text-[12px] font-medium text-[#6B7280] hover:bg-white"
        >
          <Pause className="w-3.5 h-3.5" /> {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => {
            if (submitted) return;
            setSubmitted(true);
            setTimeout(() => applyOutcome('skipped', quickNote.trim() || undefined), 200);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] border border-[#E5E7EB] text-[12px] font-medium text-[#6B7280] hover:bg-white"
        >
          <SkipForward className="w-3.5 h-3.5" /> Skip
        </button>
        <button
          onClick={() => {
            if (submitted) return;
            setSubmitted(true);
            setTimeout(() => applyOutcome('next-now', quickNote.trim() || undefined), 200);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#3C5A87] text-white text-[12px] font-semibold hover:bg-[#3C5A87]/90 shadow-[0_4px_12px_rgba(30,154,128,0.35)]"
        >
          <Phone className="w-3.5 h-3.5" /> Next call
        </button>
      </div>}

      {/* PR 19: follow-up prompt for Nurturing / Callback / Interested.
          Mount only when the agent picks a follow-up stage; auto-
          unmount after save/skip + commitOutcome runs. */}
      {pendingFollowupColId && call?.contactId && (() => {
        const col = columns.find((c) => c.id === pendingFollowupColId);
        const contact = store.getContact(call.contactId);
        if (!col || !contact) return null;
        const suggestedHours =
          col.name.toLowerCase() === 'callback'
            ? 2
            : col.name.toLowerCase() === 'interested'
              ? 24
              : 24 * 3; // Nurturing default
        return (
          <FollowupPromptModal
            open
            onOpenChange={(o) => {
              if (!o) {
                // Closed without saving = treated as "skip" — still
                // commits the outcome so the contact moves to the
                // chosen stage; agent just hasn't set a follow-up.
                const colId = pendingFollowupColId;
                setPendingFollowupColId(null);
                if (colId) commitOutcome(colId);
              }
            }}
            contactId={contact.id}
            contactName={contact.name}
            columnId={col.id}
            columnName={col.name}
            suggestedHoursAhead={suggestedHours}
            callId={call.callId}
            initialNote={quickNote}
            onSaved={() => {
              const colId = pendingFollowupColId;
              setPendingFollowupColId(null);
              if (colId) commitOutcome(colId);
            }}
          />
        );
      })()}
    </div>
  );
}
