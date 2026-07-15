import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { ACTIVE_PIPELINE } from '../../data/mockPipelines';
import { useSmsV2 } from '../../store/SmsV2Store';

interface Props {
  value?: string; // pipeline column id
  onChange: (columnId: string) => void;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** When set, the popover lists ONLY columns belonging to this
   *  pipeline. Used by the dialer-pro live-call + wrap-up surfaces so
   *  agents don't see every workspace pipeline mixed together.
   *  Cross-pipeline callers (contacts list, inbox) omit it and get
   *  the unfiltered list as before. */
  pipelineId?: string | null;
}

/**
 * Reusable pipeline stage selector. Drop-in anywhere a contact's stage
 * needs to be visible + editable (inbox, contacts list, pipeline cards,
 * contact detail, etc.).
 *
 * PR 41 (Hugo 2026-04-27): the dropdown now portals to document.body
 * with viewport-fixed positioning so parent overflow:hidden / auto
 * (Pipelines kanban columns, live-call resizable panels) can't clip it.
 *
 * Size variants:
 *   - xs: very compact, for inline embedding (e.g. mid-call SMS card header)
 *   - sm: default
 *   - md: pipeline cards / detail header
 */
export default function StageSelector({ value, onChange, size = 'sm', className, pipelineId }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  // PR 83 (Hugo 2026-04-27): read columns from the DB-hydrated store.
  // Mock fallback only when the store hasn't loaded yet (e.g. fresh
  // session before useHydratePipelineColumns finishes). Hugo's bug:
  // mock IDs aren't UUIDs, so persist.moveToColumn skipped DB writes
  // and the stage didn't stick on reload.
  const { columns: storeCols } = useSmsV2();
  const columns = useMemo(() => {
    const all = storeCols.length > 0 ? storeCols : ACTIVE_PIPELINE.columns;
    if (!pipelineId) return all;
    return all.filter((c) => c.pipelineId === pipelineId);
  }, [storeCols, pipelineId]);
  // Always look up the current stage in the FULL list so we still
  // render a label when the contact's existing column belongs to a
  // different pipeline than the active one (UX: don't pretend the
  // contact has no stage just because the picker is scoped).
  const allColumnsForLookup = storeCols.length > 0 ? storeCols : ACTIVE_PIPELINE.columns;
  const current = allColumnsForLookup.find((c) => c.id === value);

  // Compute viewport position whenever opening or on resize/scroll.
  useEffect(() => {
    if (!open) {
      setPopoverPos(null);
      return;
    }
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      // Try below the trigger; flip above if there's no room.
      const POPOVER_HEIGHT = 240; // approximate, capped via max-h
      const spaceBelow = window.innerHeight - t.bottom;
      const top =
        spaceBelow >= POPOVER_HEIGHT || t.top < POPOVER_HEIGHT
          ? t.bottom + 4
          : t.top - POPOVER_HEIGHT - 4;
      // Keep within viewport horizontally.
      const POPOVER_WIDTH = 200;
      const left = Math.min(t.left, window.innerWidth - POPOVER_WIDTH - 8);
      setPopoverPos({ top, left: Math.max(8, left) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  return (
    <div className={cn('relative inline-block', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full font-medium border transition-colors',
          size === 'xs'
            ? 'text-[9px] px-1.5 py-0 leading-none gap-1'
            : size === 'sm'
              ? 'text-[10px] px-2 py-0.5'
              : 'text-[12px] px-2.5 py-1'
        )}
        style={
          current
            ? {
                background: `${current.colour}1A`,
                color: current.colour,
                borderColor: `${current.colour}40`,
              }
            : { background: '#F3F3EE', color: '#6B7280', borderColor: '#E5E7EB' }
        }
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: current?.colour ?? '#9CA3AF' }}
        />
        {current?.name ?? 'Set stage…'}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && popoverPos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[400] min-w-[180px] max-w-[260px] max-h-[260px] overflow-y-auto bg-white border border-[#E5E7EB] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.1)] py-1"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          {columns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-[#F3F3EE]/60"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: c.colour }}
              />
              <span className="flex-1 text-[#1A1A1A]">{c.name}</span>
              {c.id === value && (
                <Check className="w-3 h-3 text-[#3C5A87]" />
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
