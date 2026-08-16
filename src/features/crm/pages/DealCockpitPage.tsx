// The Deal Cockpit. The whole business, in the order it should be worked.
//
// Hugo, 2026-08-15: "a standalone command center that acts as the digital CEO
// of the entire operation", "turn the user into a cyborg, human and AI working
// in one tight seamless loop."
//
// THREE COLUMNS: what to do next (the queue), the deal in front of you (the
// command panel), and why anything was ever decided (the history). Below
// 1280px the history becomes a tab; below 768px the whole deal becomes a
// full-screen sheet over the queue.
//
// WHAT THIS PAGE DOES NOT DO. It never moves a card. Pressing a button calls
// the routes that already exist, and those routes move the board exactly as
// they did before any of this. The machine decides what to look at and what to
// say; code decides money and moves.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Gauge, History, ListChecks, CalendarDays } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useIsMobile, useMediaQuery } from '@/core/hooks/useMediaQuery';
import { useCockpitDeals, useCockpitDeal, useCockpitCalendar } from '../hooks/useCockpit';
import { useDialerProModal } from '../layout/DialerProModalContext';
import CockpitQueue from '../components/cockpit/CockpitQueue';
import CockpitCommandPanel from '../components/cockpit/CockpitCommandPanel';
import CockpitTimeline from '../components/cockpit/CockpitTimeline';
import CockpitCalendar from '../components/cockpit/CockpitCalendar';
import ActionConfirmDialog from '../components/cockpit/ActionConfirmDialog';
import { COCKPIT_ACTIONS, type CockpitAction } from '../components/cockpit/cockpitActions';
import { NOTHING_WAITING, BRAIN_OFF_NOTE, BRAIN_ON_NOTE } from '../lib/dealDay';

export default function DealCockpitPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('deal');
  const isMobile = useIsMobile();
  // At xl the history has its own column, so offering it as a tab as well
  // shows the same thing twice side by side.
  const historyHasItsOwnColumn = useMediaQuery('(min-width: 1280px)');
  const { openDialerPro } = useDialerProModal();

  const { deals, setAside, managerEnabled, generatedAt, loading, error, reload } = useCockpitDeals();
  const { data: detail, loading: detailLoading, reload: reloadDetail } = useCockpitDeal(selectedId);
  const calendar = useCockpitCalendar(30);

  const [pending, setPending] = useState<CockpitAction | null>(null);
  // md to xl, where the history shares the centre column with the deal.
  const [tab, setTab] = useState<'deal' | 'history' | 'calendar'>('deal');

  const select = useCallback((propertyId: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (propertyId) next.set('deal', propertyId); else next.delete('deal');
      return next;
    }, { replace: true });
    setTab('deal');
  }, [setParams]);

  const ordered = useMemo(
    () => [...deals].sort((a, b) => b.attention - a.attention),
    [deals],
  );

  // ---- the cyborg part: two keys per deal ------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (pending) return;
      const i = ordered.findIndex((d) => d.propertyId === selectedId);
      if (e.key === 'j') { e.preventDefault(); select(ordered[Math.min(i + 1, ordered.length - 1)]?.propertyId ?? null); }
      if (e.key === 'k') { e.preventDefault(); select(ordered[Math.max(i - 1, 0)]?.propertyId ?? null); }
      if (e.key === 'r') { e.preventDefault(); void reload(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selectedId, select, reload, pending]);

  const afterCommit = useCallback(() => {
    setPending(null);
    void reload();
    void reloadDetail();
    // Advance to the next deal on its own, so a whole day is two keys each.
    const i = ordered.findIndex((d) => d.propertyId === selectedId);
    const next = ordered[i + 1];
    if (next) select(next.propertyId);
  }, [reload, reloadDetail, ordered, selectedId, select]);

  const deal = detail?.deal ?? null;
  const view = tab === 'history' && historyHasItsOwnColumn ? 'deal' : tab;

  const columnShell = 'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-soft';
  const columnHeader = 'flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cockpit-page">
      {/* ---- never scrolls ---- */}
      <header className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-4 py-3 md:px-5">
        <Gauge className="w-5 h-5 text-brand" />
        <h1 className="text-[18px] font-bold tracking-tight text-ink md:text-[22px]">Cockpit</h1>
        <p className="w-full text-[12px] text-ink-muted md:w-auto">
          {managerEnabled ? BRAIN_ON_NOTE : BRAIN_OFF_NOTE}
        </p>
        <div className="ml-auto flex items-center gap-3">
          {generatedAt && (
            <span className="hidden text-[10px] text-ink-subtle sm:inline">
              as of {new Date(generatedAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand hover:text-brand-700 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        // The last good list stays underneath. A stale queue beats a blank one.
        <div className="flex-shrink-0 border-b border-border bg-[#FEF2F2] px-4 py-2 text-[12px] text-[#DC2626]">
          {error}{' '}
          <button type="button" onClick={() => void reload()} className="underline">Try again</button>
        </div>
      )}

      {/* ---- the grid ---- */}
      <div
        data-testid="cockpit-grid"
        className="
          grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3
          md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] md:overflow-hidden
          xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)_minmax(320px,400px)]
        "
      >
        {/* ---- the queue ---- */}
        <section className={columnShell} data-testid="cockpit-queue">
          <div className={columnHeader}>
            <span className="text-[13px] font-semibold text-ink">Today</span>
            <span className="text-[11px] text-ink-subtle">{ordered.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !ordered.length ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 rounded-md bg-[#F3F4F6] animate-pulse" />
                ))}
              </div>
            ) : ordered.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12px] italic text-ink-subtle">
                {NOTHING_WAITING}
              </p>
            ) : (
              <CockpitQueue deals={ordered} selectedId={selectedId} onSelect={select} />
            )}
          </div>

          {/* WHAT IS NOT HERE, AND WHY. The cockpit is where a conversation is
              waiting on a decision; a branch nobody has reached is a phone
              number for the dialer. Saying so out loud beats silently dropping
              four cards in five and leaving somebody to wonder. */}
          {setAside && (setAside.calling_list + setAside.never_spoke + setAside.closed_door) > 0 && (
            <div className="flex-shrink-0 border-t border-border px-3 py-2 text-[10px] leading-snug text-ink-subtle">
              Not shown:{' '}
              {[
                setAside.calling_list + setAside.never_spoke > 0
                  && `${setAside.calling_list + setAside.never_spoke} waiting to be rung`,
                setAside.closed_door > 0 && `${setAside.closed_door} said no`,
                setAside.finished > 0 && `${setAside.finished} done`,
              ].filter(Boolean).join(', ')}
              . Those live in the calling list.
            </div>
          )}
        </section>

        {/* ---- the deal, and on md the history behind a tab ---- */}
        <section
          className={cn(columnShell, isMobile && !selectedId && view !== 'calendar' && 'hidden')}
          data-testid="cockpit-centre"
        >
          <div className={columnHeader}>
            <div className="flex items-center gap-1.5" data-testid="cockpit-view-tabs">
              {([
                ['deal', 'Do it', ListChecks],
                ...(historyHasItsOwnColumn ? [] : [['history', 'History', History] as const]),
                ['calendar', 'Calendar', CalendarDays],
              ] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium',
                    view === k ? 'bg-brand-50 text-brand' : 'text-ink-muted hover:bg-elevated',
                  )}
                >
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>

            {isMobile && (selectedId || view === 'calendar') && (
              <button
                type="button"
                onClick={() => select(null)}
                className="text-[11.5px] text-brand"
              >
                Back to the list
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {view === 'calendar' ? (
              <div className="h-full overflow-y-auto">
                <CockpitCalendar
                  items={calendar.items}
                  overdue={calendar.overdue}
                  loading={calendar.loading}
                  onOpen={(id) => { select(id); }}
                />
              </div>
            ) : !selectedId ? (
              <p className="px-4 py-8 text-center text-[12px] text-ink-subtle">
                Pick a deal on the left.
              </p>
            ) : detailLoading && !deal ? (
              <div className="space-y-3 p-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-md bg-[#F3F4F6] animate-pulse" />
                ))}
              </div>
            ) : !deal ? (
              <p className="px-4 py-8 text-center text-[12px] text-ink-subtle">
                That deal could not be opened.
              </p>
            ) : view === 'history' ? (
              <div className="h-full overflow-y-auto">
                <CockpitTimeline entries={detail?.timeline ?? []} loading={detailLoading} />
              </div>
            ) : (
              <CockpitCommandPanel
                deal={deal}
                reports={detail?.reports ?? {}}
                busy={pending}
                onRequest={(a) => {
                  // Comparisons is a pure reveal handled inside the panel, so
                  // it never reaches the gate.
                  if (COCKPIT_ACTIONS[a].kind !== 'reveal') setPending(a);
                }}
              />
            )}
          </div>
        </section>

        {/* ---- the history, its own column from 1280px ---- */}
        <section className={cn(columnShell, 'hidden xl:flex')} data-testid="cockpit-log">
          <div className={columnHeader}>
            <span className="text-[13px] font-semibold text-ink">History</span>
            <span className="text-[11px] text-ink-subtle">
              {detail?.timeline.length ?? 0}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {selectedId ? (
              <CockpitTimeline entries={detail?.timeline ?? []} loading={detailLoading} />
            ) : (
              <p className="px-4 py-8 text-center text-[12px] text-ink-subtle">
                The history of whichever deal you pick, and why every move was made.
              </p>
            )}
          </div>
        </section>
      </div>

      {pending && deal && (
        <ActionConfirmDialog
          deal={deal}
          action={pending}
          stages={detail?.stages ?? []}
          onCancel={() => setPending(null)}
          onCommitted={afterCommit}
          onCall={(contactId) => openDialerPro(contactId, { scriptKey: 'property_call', autoDial: true })}
        />
      )}
    </div>
  );
}
