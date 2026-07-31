// The editor shell: top bar (back, project name, credits meter, Run all +
// partial-run menu), the canvas, the palette dock, the inspector panel and
// the toast. Below 768px the editor becomes review mode: pan, tap, approve;
// no graph editing (the palette and run controls hide).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Coins, MoreHorizontal, Play } from 'lucide-react';
import { FlowCanvas } from './FlowCanvas';
import { InspectorPanel } from './panel/InspectorPanel';
import { useCanvasStore } from './state/store';
import { meterTotals } from '../../core/graph/credits';
import { CAPABILITIES, isGenerator } from '../../core/graph/capabilities';
import { TID } from '../../testids';
import type { StageKind } from '../../core/graph/types';

const PALETTE: Array<{ kind: StageKind; key: string }> = [
  { kind: 'photo', key: 'I' },
  { kind: 'video', key: 'V' },
  { kind: 'voice', key: 'A' },
  { kind: 'text', key: 'T' },
  { kind: 'note', key: 'N' },
];

export default function CanvasPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const doc = useCanvasStore((s) => s.doc);
  const load = useCanvasStore((s) => s.load);
  const run = useCanvasStore((s) => s.run);
  const running = useCanvasStore((s) => s.running);
  const balance = useCanvasStore((s) => s.balance);
  const selection = useCanvasStore((s) => s.selection);
  const addNode = useCanvasStore((s) => s.addNode);
  const toast = useCanvasStore((s) => s.toast);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, load]);

  // Single-key node shortcuts (skipped while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const hit = PALETTE.find((p) => p.key.toLowerCase() === e.key.toLowerCase());
      if (hit && !e.metaKey && !e.ctrlKey) addNode(hit.kind);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNode]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const totals = useMemo(() => (doc ? meterTotals(doc) : null), [doc]);
  const selectionIsGenerator =
    selection !== null &&
    doc?.nodes.some((n) => n.id === selection && isGenerator(n.kind)) === true;

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex h-12 items-center gap-3 border-b border-hairline bg-white px-3">
        <Link to="/" aria-label="Back to projects" className="text-ink-muted hover:text-ink">
          <ChevronLeft size={18} />
        </Link>
        <h1 className="flex-1 truncate text-[13px] font-bold text-ink">{doc ? 'Your ad' : 'Loading'}</h1>

        <div
          data-testid={TID.creditsMeter}
          title={
            totals
              ? `Image ${totals.image} / Audio ${totals.audio} / Video ${totals.video} / Text ${totals.text}`
              : undefined
          }
          className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-semibold text-ink"
        >
          <Coins size={12} className="text-ink-muted" />
          <span data-testid={TID.creditsTotal}>{balance ?? '...'}</span>
        </div>

        <div className="relative hidden items-center gap-1 md:flex" ref={menuRef}>
          <button
            type="button"
            data-testid={TID.runAll}
            onClick={() => void run({ mode: 'all' })}
            disabled={running}
            className="flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-40"
          >
            <Play size={11} />
            {running ? 'Running' : 'Run all'}
          </button>
          <button
            type="button"
            data-testid={TID.runMenu}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More run options"
            className="rounded-full border border-hairline p-1.5 text-ink-muted hover:text-ink"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-50 w-44 rounded-xl border border-hairline bg-white py-1 shadow-selected">
              {[
                { tid: TID.runFromHere, label: 'Run from here', mode: 'from' as const },
                { tid: TID.runTillHere, label: 'Run till here', mode: 'till' as const },
              ].map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  data-testid={item.tid}
                  disabled={!selectionIsGenerator || running}
                  onClick={() => {
                    setMenuOpen(false);
                    if (selection) void run({ mode: item.mode, nodeId: selection });
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[12px] text-ink hover:bg-page disabled:opacity-40"
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                data-testid={TID.runAgain}
                disabled={!selectionIsGenerator || running}
                onClick={() => {
                  setMenuOpen(false);
                  if (selection) void run({ mode: 'single', nodeId: selection }, { force: true });
                }}
                className="block w-full px-3 py-1.5 text-left text-[12px] text-ink hover:bg-page disabled:opacity-40"
              >
                Run again (re-bills)
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <FlowCanvas />
        <InspectorPanel />

        <div className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-hairline bg-white px-2 py-1.5 shadow-card md:flex">
          {PALETTE.map((p) => (
            <button
              key={p.kind}
              type="button"
              data-testid={TID.paletteAdd(p.kind)}
              onClick={() => addNode(p.kind)}
              title={`${CAPABILITIES[p.kind].displayName} (${p.key})`}
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink-muted hover:bg-page hover:text-ink"
            >
              {CAPABILITIES[p.kind].displayName}
              <span className="ml-1 text-[9px] text-ink-subtle">{p.key}</span>
            </button>
          ))}
        </div>

        {toast && (
          <div
            data-testid={TID.toast}
            className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-white shadow-selected"
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
