// The builder board. One lane per house, one card per builder-for-that-house.
//
// Hugo, 2026-08-28, relaying Pedro: "a pipeline the same as we have for the
// properties but now for the builders, so he can have better control of how he
// can coordinate which builder has been booked for what property, maybe on the
// same place where he calls the builder, a kanban view there."
//
// THE CARD IS A BUILDER-FOR-A-HOUSE, not a builder and not a house. "Jerry for
// Whitworth Road." A builder alone has 228 rows and no context; a house alone
// is the property pipeline we already have. The pairing is the unit of work.
//
// THE LANE HEADER IS THE ANSWER TO THE QUESTION. Green with a name, or red
// saying nobody is going. Scroll the page and the whole operation has been read
// without a single click, which is the thing that did not exist.
//
// WHAT THE HEADER SHOUTS ABOUT, and why. Six viewings ran on 26 and 27 August
// and a builder turned up at three. Every failure was a man who said yes and
// was never told which door: CJS Builders on the morning of his own viewing,
// "Assume today's meet isn't on? No address." So a booked builder with no
// address is red, louder than the stage he is in.
//
// Native HTML5 drag and drop, no library, matching PipelinesPage: optimistic
// move, write through, roll back and say so on failure.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Check, ChevronDown, ChevronRight, GripVertical,
  Images, Loader2, MapPinOff, MessageSquare, Phone, RefreshCw,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import {
  STAGES, alertsFor, verdictFor, orderHouses, cardsInStage, bookedOther,
  clashingHouses, countdown, ukWhen, money, reportedButNotMarked,
  type BoardCard, type BoardHouse, type BuilderStage, type HouseState,
} from '../../lib/builderBoard';
import BuilderCardDrawer, { type CardPatch } from './BuilderCardDrawer';

interface Props {
  houses: BoardHouse[];
  busy: boolean;
  onMove: (card: BoardCard, stage: BuilderStage) => void;
  onSave: (card: BoardCard, patch: CardPatch) => void;
  onRing: (card: BoardCard) => void;
  onText: (card: BoardCard) => void;
  onOpenHouse: (propertyId: string) => void;
  onRefresh: () => void;
}

const SKIN: Record<HouseState, { bar: string; ink: string; dot: string }> = {
  covered:   { bar: 'bg-[#ECFDF5] border-[#10B981]/40', ink: 'text-[#047857]', dot: 'bg-[#10B981]' },
  at_risk:   { bar: 'bg-[#FFFBEB] border-[#F59E0B]/50', ink: 'text-[#B45309]', dot: 'bg-[#F59E0B]' },
  uncovered: { bar: 'bg-[#FEF2F2] border-[#DC2626]/40', ink: 'text-[#B91C1C]', dot: 'bg-[#DC2626]' },
  done:      { bar: 'bg-[#F3F3EE] border-[#E5E7EB]',    ink: 'text-[#6B7280]', dot: 'bg-[#9CA3AF]' },
};

export default function BuilderBoard({
  houses, busy, onMove, onSave, onRing, onText, onOpenHouse, onRefresh,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [swap, setSwap] = useState<{ card: BoardCard; house: BoardHouse; other: BoardCard } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const cardsById = useRef(new Map<string, BoardCard>());

  const ordered = useMemo(() => orderHouses(houses), [houses]);
  const clashes = useMemo(() => clashingHouses(houses), [houses]);

  // Resolved from the live houses rather than held in state, so a card edited
  // in the drawer shows the reloaded truth instead of the copy it opened with.
  const open = useMemo(() => {
    const hit = houses
      .map((h) => ({ house: h, card: h.cards.find((x) => x.outreachId === openId) }))
      .find((r) => r.card !== undefined);
    return hit?.card ? { card: hit.card, house: hit.house } : null;
  }, [openId, houses]);

  // A house that is already sorted opens folded, so the screen is a to-do list
  // rather than an archive.
  //
  // DECIDED ONCE, AT MOUNT, and never recomputed. Proven necessary the first
  // time a booking was made on the real board: booking the man turns the lane
  // green, and a rule that re-read the verdict folded the lane shut under the
  // press that had just been made. What Pedro opens stays open until he shuts
  // it. A house that appears later opens, because a new house needs a person.
  const [shut, setShut] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const h of houses) {
      const v = verdictFor(h);
      if (v.state === 'done' || v.state === 'covered') s.add(h.propertyId);
    }
    return s;
  });
  const toggle = (id: string) => setShut((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => {
    const map = new Map<string, BoardCard>();
    for (const h of houses) for (const c of h.cards) map.set(c.outreachId, c);
    cardsById.current = map;
  }, [houses]);

  const drop = (e: React.DragEvent, house: BoardHouse, stage: BuilderStage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragging;
    setDragging(null); setOver(null);
    if (!id) return;
    const card = cardsById.current.get(id);
    if (!card || card.stage === stage) return;
    if (card.propertyId !== house.propertyId) return;  // lanes are houses; no cross-house drops
    // One house, one slot. Silently swapping is how two men turn up at a door.
    if (stage === 'booked') {
      const other = bookedOther(house, card.outreachId);
      if (other) { setSwap({ card, house, other }); return; }
    }
    onMove(card, stage);
  };

  if (houses.length === 0) {
    return (
      <div className="p-8 text-center text-[13px] text-[#6B7280]" data-testid="builder-board-empty">
        No houses with a viewing booked. Book a viewing time on a house and it appears here.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="builder-board">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
          {ordered.length} {ordered.length === 1 ? 'house' : 'houses'} with a viewing
        </span>
        <button
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[#3C5A87] hover:text-[#2A4166]"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {ordered.map((house) => {
        const v = verdictFor(house);
        const skin = SKIN[v.state];
        const isFolded = shut.has(house.propertyId);
        return (
          <section
            key={house.propertyId}
            data-testid="builder-lane"
            data-state={v.state}
            className={cn('rounded-2xl border overflow-hidden', skin.bar)}
          >
            <header className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => toggle(house.propertyId)}
                className="p-0.5 rounded hover:bg-black/[0.06] flex-shrink-0"
                title={isFolded ? 'Open' : 'Fold away'}
                data-testid="builder-lane-toggle"
              >
                {isFolded ? <ChevronRight className="w-4 h-4 text-[#6B7280]" /> : <ChevronDown className="w-4 h-4 text-[#6B7280]" />}
              </button>
              <span className={cn('w-2 h-2 rounded-full flex-shrink-0', skin.dot)} />
              <button
                onClick={() => onOpenHouse(house.propertyId)}
                className="text-[13px] font-bold text-[#1A1A1A] hover:underline truncate text-left"
              >
                {house.viewingAddress || house.address}
              </button>
              <span className="text-[11px] text-[#6B7280] whitespace-nowrap">
                {house.viewingAt ? ukWhen(house.viewingAt) : 'no time booked'}
              </span>
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap',
                  v.urgent && v.state !== 'covered' ? 'bg-[#DC2626] text-white' : 'bg-black/[0.06] text-[#6B7280]',
                )}
              >
                {countdown(house.viewingAt)}
              </span>
              <span className={cn('text-[12px] font-semibold truncate ml-1', skin.ink)} data-testid="builder-lane-verdict">
                {v.line}
              </span>
              {!house.houseNumberKnown && (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-[#DC2626] text-white px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0">
                  <MapPinOff className="w-3 h-3" /> No house number
                </span>
              )}
            </header>

            {!isFolded && (
              <div className="flex gap-2 overflow-x-auto px-3 pb-3">
                {STAGES.map((s) => {
                  const cards = cardsInStage(house, s.id);
                  const isOver = over === `${house.propertyId}:${s.id}`;
                  return (
                    <div
                      key={s.id}
                      data-testid="builder-column"
                      data-stage={s.id}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(`${house.propertyId}:${s.id}`); }}
                      onDragLeave={() => setOver((c) => (c === `${house.propertyId}:${s.id}` ? null : c))}
                      onDrop={(e) => drop(e, house, s.id)}
                      className={cn(
                        'w-[210px] flex-shrink-0 rounded-xl border bg-white/70 flex flex-col',
                        isOver ? 'border-[#3C5A87] bg-[#EEF2F8]' : 'border-black/[0.07]',
                      )}
                    >
                      <div className="px-2 py-1.5 border-b border-black/[0.06]" title={s.hint}>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
                          {s.title}
                        </span>
                        <span className="ml-1 text-[10px] font-semibold text-[#9CA3AF] tabular-nums">
                          {cards.length}
                        </span>
                      </div>
                      <div className="p-1.5 space-y-1.5 min-h-[54px] max-h-[300px] overflow-y-auto">
                        {cards.map((c) => (
                          <Card
                            key={c.outreachId}
                            card={c}
                            house={house}
                            clash={clashes.get(c.builderId) ?? null}
                            dragging={dragging === c.outreachId}
                            onDragStart={(e) => {
                              setDragging(c.outreachId);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', c.outreachId);
                            }}
                            onDragEnd={() => { setDragging(null); setOver(null); }}
                            onRing={() => onRing(c)}
                            onText={() => onText(c)}
                            onOpen={() => setOpenId(c.outreachId)}
                            onBeen={() => onMove(c, 'been')}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {open && (
        <BuilderCardDrawer
          key={open.card.outreachId}
          card={open.card}
          house={open.house}
          saving={busy}
          onClose={() => setOpenId(null)}
          onSave={(patch) => { onSave(open.card, patch); setOpenId(null); }}
          onMove={(stage) => {
            if (stage === open.card.stage) return;
            const other = stage === 'booked' ? bookedOther(open.house, open.card.outreachId) : null;
            setOpenId(null);
            if (other) { setSwap({ card: open.card, house: open.house, other }); return; }
            onMove(open.card, stage);
          }}
          onRing={() => onRing(open.card)}
          onText={() => onText(open.card)}
        />
      )}

      {swap && (
        <SwapDialog
          swap={swap}
          onCancel={() => setSwap(null)}
          onConfirm={() => {
            const { card, other } = swap;
            setSwap(null);
            // Take the old one out first, or two rows briefly claim one slot.
            onMove(other, 'coming');
            onMove(card, 'booked');
          }}
        />
      )}
    </div>
  );
}

function Card({
  card, house, clash, dragging, onDragStart, onDragEnd, onRing, onText, onOpen, onBeen,
}: {
  card: BoardCard;
  house: BoardHouse;
  clash: string[] | null;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRing: () => void;
  onText: () => void;
  onOpen: () => void;
  onBeen: () => void;
}) {
  const alerts = alertsFor(card, house);
  const stop = alerts.find((a) => a.tone === 'stop');
  const warn = alerts.find((a) => a.tone === 'warn');
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid="builder-card"
      data-outreach={card.outreachId}
      className={cn(
        'group rounded-lg border bg-white px-2 py-1.5 cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
        stop ? 'border-[#DC2626]/50 ring-1 ring-[#DC2626]/20' : 'border-[#E5E7EB]',
      )}
    >
      <div className="flex items-start gap-1">
        <GripVertical className="w-3 h-3 text-[#D1D5DB] flex-shrink-0 mt-0.5" />
        <button
          onClick={onOpen}
          data-testid="builder-card-open"
          className="text-[11.5px] font-semibold text-[#1A1A1A] leading-tight break-words flex-1 text-left hover:underline"
        >
          {card.builderName}
        </button>
      </div>

      {stop && (
        <p className="mt-1 text-[10px] font-semibold text-[#B91C1C] leading-snug flex items-start gap-1" data-testid="builder-card-stop">
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
          <span>{stop.text}</span>
        </p>
      )}
      {!stop && warn && (
        <p className="mt-1 text-[10px] text-[#B45309] leading-snug">{warn.text}</p>
      )}

      {card.attendedAt && (
        <p className="mt-1 text-[10px] text-[#047857] font-semibold">
          Walked it {countdown(card.attendedAt)}
          {card.quoteAmount != null ? ` · ${money(card.quoteAmount)}` : ' · no price yet'}
        </p>
      )}

      {/* An empty body with pictures on it is not an empty message. Ten of
          these were invisible on the first build. */}
      {card.mediaCount > 0 && (
        <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[#3C5A87]">
          <Images className="h-3 w-3" /> {card.mediaCount} photo{card.mediaCount > 1 ? 's' : ''} from him
        </p>
      )}

      {card.comeBackAt && (
        <p className="mt-1 text-[10px] text-[#6B7280] flex items-center gap-1">
          <CalendarClock className="w-3 h-3" /> {ukWhen(card.comeBackAt)}
        </p>
      )}

      {clash && clash.length > 1 && (
        <p className="mt-1 text-[10px] font-semibold text-[#B45309]">
          Also down for {clash.filter((a) => a !== house.address).length} other viewing at the same time
        </p>
      )}

      {card.addressSentAt && (card.stage === 'coming' || card.stage === 'booked') && (
        <p className="mt-1 text-[10px] text-[#047857] flex items-center gap-1">
          <Check className="w-3 h-3" /> Has the address
        </p>
      )}

      <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onRing} title="Ring him" className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87]">
          <Phone className="w-3 h-3" />
        </button>
        <button onClick={onText} title="Text him" className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87]">
          <MessageSquare className="w-3 h-3" />
        </button>
        {reportedButNotMarked(card) && (
          <button
            onClick={onBeen}
            data-testid="builder-card-been"
            title="He went. Mark him Been."
            className="ml-auto rounded bg-[#047857] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white hover:bg-[#065F46]"
          >
            Been
          </button>
        )}
      </div>
    </div>
  );
}

function SwapDialog({
  swap, onCancel, onConfirm,
}: {
  swap: { card: BoardCard; house: BoardHouse; other: BoardCard };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-[420px] p-5"
        onClick={(e) => e.stopPropagation()}
        data-testid="builder-swap-dialog"
      >
        <h3 className="text-[15px] font-bold text-[#1A1A1A]">One builder for this viewing</h3>
        <p className="mt-2 text-[13px] text-[#4B5563] leading-relaxed">
          <b>{swap.other.builderName}</b> is booked for {swap.house.viewingAddress || swap.house.address}.
          Booking <b>{swap.card.builderName}</b> puts {swap.other.builderName} back to Coming, so only
          one man turns up.
        </p>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-[#6B7280] hover:bg-black/[0.04]">
            Leave it
          </button>
          <button
            onClick={onConfirm}
            data-testid="builder-swap-confirm"
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-[#3C5A87] text-white hover:bg-[#2A4166]"
          >
            Swap them
          </button>
        </div>
      </div>
    </div>
  );
}
