// One builder, one house, everything about him, and the four things Pedro
// promised on the phone that used to live nowhere.
//
// EVERY FIELD HERE IS A REAL SENTENCE FROM THE FIRST WEEK.
//
//   Agreed time    Fox Built: "I'm not available this Friday, but I can do
//                  Wednesday 2nd September at 5pm." He was marked as coming and
//                  the board showed him against a Friday he had turned down.
//   Ring him back  Gulliver Builders: "away on holiday until Monday 31st
//                  August, I can have a look once I'm back." Pedro: "I will
//                  check our diary for dates from the 31st and come back to
//                  you." Nothing came back. Same for Gud Builders ("busy till
//                  October"), Mark James ("I'm back on the 2nd") and Ground Up
//                  ("can you do an evening next week?").
//   He charges     Phil Oakley: "it's a cost of £120 including VAT, and if you
//                  go ahead with the work you get the £120 off the quote."
//                  CM Building: "a full Builder survey is £595 + VAT."
//   His price      JL Brickwork walked Lisle Road and sent his findings by
//                  WhatsApp the next day. Nothing in the app could hold them.
//
// UK time on both date fields (ukInputToIso), for the reason ukTime.ts exists:
// Pedro types from the Philippines and 5pm has to stay 5pm London.

import { useState } from 'react';
import { AlertTriangle, CalendarClock, MessageSquare, Phone, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import InboundMedia from '../InboundMedia';
import { ukInputToIso, isoToUkInput } from '../../lib/ukTime';
import { alertsFor, STAGES, ukWhen, money, type BoardCard, type BoardHouse, type BuilderStage } from '../../lib/builderBoard';

export interface CardPatch {
  agreedAt?: string | null;
  comeBackAt?: string | null;
  comeBackNote?: string | null;
  chargesAmount?: number | null;
  quoteAmount?: number | null;
  quoteNote?: string | null;
}

interface Props {
  card: BoardCard;
  house: BoardHouse;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: CardPatch) => void;
  onMove: (stage: BuilderStage) => void;
  onRing: () => void;
  onText: () => void;
}

export default function BuilderCardDrawer({
  card, house, saving, onClose, onSave, onMove, onRing, onText,
}: Props) {
  // Seeded once, at mount. The parent gives this component key={outreachId}, so
  // opening a different builder REMOUNTS it with his own figures rather than
  // syncing them in an effect, which is the same thing with a render wasted and
  // a chance of the previous man's numbers surviving the switch.
  const [agreed, setAgreed] = useState(() => (card.agreedAt ? isoToUkInput(card.agreedAt) : ''));
  const [back, setBack] = useState(() => (card.comeBackAt ? isoToUkInput(card.comeBackAt).slice(0, 10) : ''));
  const [backNote, setBackNote] = useState(card.comeBackNote ?? '');
  const [charges, setCharges] = useState(card.chargesAmount != null ? String(card.chargesAmount) : '');
  const [quote, setQuote] = useState(card.quoteAmount != null ? String(card.quoteAmount) : '');
  const [quoteNote, setQuoteNote] = useState(card.quoteNote ?? '');

  const alerts = alertsFor(card, house);

  const save = () => onSave({
    agreedAt: agreed ? ukInputToIso(agreed) : null,
    // A date with no time means the morning of that day, which is when a
    // "ring him back on the 31st" is actually useful.
    comeBackAt: back ? ukInputToIso(`${back}T09:00`) : null,
    comeBackNote: backNote.trim() || null,
    chargesAmount: charges.trim() === '' ? null : Number(charges),
    quoteAmount: quote.trim() === '' ? null : Number(quote),
    quoteNote: quoteNote.trim() || null,
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-[420px] max-w-full overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="builder-card-drawer"
      >
        <header className="sticky top-0 flex items-start gap-2 border-b border-[#E5E7EB] bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-[#1A1A1A]">{card.builderName}</h3>
            <p className="mt-0.5 truncate text-[11.5px] text-[#6B7280]">
              {house.viewingAddress || house.address}
              {house.viewingAt ? ` · ${ukWhen(house.viewingAt)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[#9CA3AF] hover:bg-black/[0.05]" title="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {alerts.length > 0 && (
            <div className="space-y-1">
              {alerts.map((a, i) => (
                <p
                  key={i}
                  className={cn(
                    'flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] leading-snug',
                    a.tone === 'stop' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#FFFBEB] text-[#B45309]',
                  )}
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" />
                  <span>{a.text}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onRing}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#3C5A87] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#2A4166]"
            >
              <Phone className="h-3.5 w-3.5" /> Ring him
            </button>
            <button
              onClick={onText}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-2 text-[12px] font-semibold text-[#3C5A87] hover:bg-[#F9FAFB]"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Text him
            </button>
          </div>

          <Field label="Where he is">
            <select
              value={card.stage}
              onChange={(e) => onMove(e.target.value as BuilderStage)}
              data-testid="drawer-stage"
              className="w-full rounded-lg border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
            >
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>

          {card.lastInboundBody ? (
            <Field label="The last thing he said">
              <p className="rounded-lg bg-[#F3F3EE] px-2 py-1.5 text-[11.5px] leading-relaxed text-[#4B5563]">
                {card.lastInboundBody}
              </p>
            </Field>
          ) : null}

          {/* What he sent back from the house. This is the deliverable of the
              whole builder operation, and on the first build it was invisible:
              the ten photographs JL Brickwork sent of 81 Lisle Road are stored
              as messages with an EMPTY BODY and a media url, so anything
              reading only the text saw ten blank lines. */}
          {card.mediaMessageIds.length > 0 ? (
            <Field
              label={`What he sent back (${card.mediaCount} photo${card.mediaCount > 1 ? 's' : ''})`}
              hint="Tap one to see it full size."
            >
              <div className="space-y-1.5" data-testid="drawer-photos">
                {card.mediaMessageIds.map((id) => (
                  <InboundMedia key={id} messageId={id} count={1} tone="light" />
                ))}
              </div>
            </Field>
          ) : null}

          <Field
            label="The time HE agreed to"
            hint="Only when it is not the viewing time. A builder who said a different day is not coming to this one."
          >
            <input
              type="datetime-local"
              value={agreed}
              onChange={(e) => setAgreed(e.target.value)}
              data-testid="drawer-agreed"
              className="w-full rounded-lg border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
            />
          </Field>

          <Field label="Ring him back on" hint="For the ones who said try me later. It comes up on his card that morning.">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 flex-shrink-0 text-[#9CA3AF]" />
              <input
                type="date"
                value={back}
                onChange={(e) => setBack(e.target.value)}
                data-testid="drawer-comeback"
                className="rounded-lg border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
              />
              <input
                type="text"
                value={backNote}
                onChange={(e) => setBackNote(e.target.value)}
                placeholder="back from holiday"
                className="min-w-0 flex-1 rounded-lg border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
              />
            </div>
          </Field>

          <Field label="He charges to attend" hint="Some do. Leave it empty if he comes for nothing.">
            <Money value={charges} onChange={setCharges} testid="drawer-charges" />
          </Field>

          <Field label="His price for the work" hint="What he came back with after walking it.">
            <Money value={quote} onChange={setQuote} testid="drawer-quote" />
            <textarea
              value={quoteNote}
              onChange={(e) => setQuoteNote(e.target.value)}
              rows={3}
              placeholder="What he said about the house"
              className="mt-1.5 w-full resize-y rounded-lg border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
            />
          </Field>

          {card.attendedAt ? (
            <p className="text-[11.5px] text-[#047857]">
              He walked it on {ukWhen(card.attendedAt)}
              {card.quoteAmount != null ? `, and quoted ${money(card.quoteAmount)}` : '.'}
            </p>
          ) : null}

          <button
            onClick={save}
            disabled={saving}
            data-testid="drawer-save"
            className="w-full rounded-lg bg-[#3C5A87] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#2A4166] disabled:opacity-50"
          >
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">{label}</label>
      {hint ? <p className="mb-1 mt-0.5 text-[10.5px] leading-snug text-[#9CA3AF]">{hint}</p> : <div className="h-1" />}
      {children}
    </div>
  );
}

function Money({ value, onChange, testid }: { value: string; onChange: (v: string) => void; testid: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[13px] font-semibold text-[#6B7280]">£</span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
        className="w-full rounded-lg border border-[#E5E7EB] px-2 py-1.5 text-[12.5px] tabular-nums"
      />
    </div>
  );
}
