// The website sales flow, as a canvas.
//
// A LIVE MAP WITH REAL CONTROLS, NOT A SECOND AUTOMATION ENGINE. Nothing here
// executes anything. api/cron/site-demo-followups.ts is the only thing that
// walks the ladder, and it reads the same platform_settings.site_demo_ladder
// this page edits. If the canvas and the cron ever disagree, the canvas is the
// bug.
//
// The graph itself is built by a pure function (lib/siteFlowGraph.ts) so its
// shape is unit tested without a browser. This file is rendering and saving.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { supabase } from '@/integrations/supabase/browser';
import {
  buildSiteFlow,
  type FlowNodeData,
  type SitePanelKey,
  type StateCount,
} from '../lib/siteFlowGraph';
import {
  DEFAULT_LADDER_CONFIG,
  type LadderConfig,
} from '@/core/site-demo/ladder';

const C = {
  primary: '#3C5A87',
  surface: '#F3F3EE',
  border: '#E5E7EB',
  text: '#1A1A1A',
  muted: '#6B7280',
  waiting: '#F59E0B',
  good: '#166534',
};

interface FlowResponse {
  counts: StateCount[];
  counts_error?: string;
  ladder: LadderConfig;
  settings: { enabled: boolean; quiet_hours: { start: string; end: string } };
  is_admin: boolean;
}

/** One stage on the canvas. */
function StageNode({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const accent = d.tone === 'good' ? C.good : d.tone === 'waiting' ? C.waiting : C.primary;
  return (
    <div
      data-testid={`flow-node-${d.stateKey}`}
      style={{
        width: 200,
        background: '#fff',
        border: `1px solid ${selected ? accent : C.border}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 8,
        padding: '12px 14px',
        boxShadow: selected ? '0 4px 16px rgba(60,90,135,.16)' : '0 1px 2px rgba(0,0,0,.04)',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: C.border }} />
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>{d.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: accent, lineHeight: 1 }}>
          {d.inState}
        </span>
        <span style={{ fontSize: 11, color: C.muted }}>here now</span>
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
        {d.everReached} ever reached
        {d.dropOff !== null && (
          <span style={{ color: d.dropOff > 50 ? C.waiting : C.muted }}>
            {' '}
            &middot; {d.dropOff}% lost here
          </span>
        )}
      </div>
      {d.derived && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontStyle: 'italic' }}>
          counted from activity, not a stage
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: C.border }} />
    </div>
  );
}

const nodeTypes = { siteStage: StageNode };

const LADDER_FIELDS: Array<{ key: keyof LadderConfig; label: string; unit: string }> = [
  { key: 'unopened_1_hours', label: 'Not opened, first nudge', unit: 'hours after sending' },
  { key: 'unopened_2_hours', label: 'Not opened, second nudge', unit: 'hours after sending' },
  { key: 'engage_1_minutes', label: 'Opened but quiet, first nudge', unit: 'minutes after opening' },
  { key: 'engage_2_hours', label: 'Opened but quiet, second nudge', unit: 'hours after opening' },
  { key: 'ai_call_1_hours', label: 'AI rings them', unit: 'hours after opening' },
  { key: 'ai_call_gap_hours', label: 'Gap before the second call', unit: 'hours' },
  { key: 'max_outbound_calls', label: 'Most calls we will ever make', unit: 'attempts' },
];

export default function SiteFlowPage() {
  const [data, setData] = useState<FlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ key: SitePanelKey; title: string; focus?: string } | null>(null);
  const [draft, setDraft] = useState<LadderConfig>(DEFAULT_LADDER_CONFIG);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch('/api/crm/site-flow', {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const body = (await res.json()) as FlowResponse;
      setData(body);
      setDraft(body.ladder);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { nodes, edges } = useMemo(
    () => buildSiteFlow(data?.counts || [], data?.ladder),
    [data],
  );

  const rfEdges = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.animated,
        style: {
          stroke: e.kind === 'shortcut' ? C.waiting : C.primary,
          strokeWidth: e.kind === 'shortcut' ? 1 : 1.5,
          strokeDasharray: e.kind === 'shortcut' ? '4 4' : undefined,
        },
        labelStyle: { fontSize: 10, fill: C.muted },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
        data: { configKey: e.configKey },
      })),
    [edges],
  );

  const openPanel = useCallback((key: SitePanelKey, title: string, focus?: string) => {
    if (key === 'none') return;
    setPanel({ key, title, focus });
  }, []);

  const saveLadder = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      const res = await fetch('/api/crm/site-flow', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ladder: draft }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const body = await res.json();
      setData((d) => (d ? { ...d, ladder: body.ladder } : d));
      setDraft(body.ladder);
      setSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="site-flow-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.surface, overflowX: 'hidden' }}
    >
      <header style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, background: '#fff' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>Website flow</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: C.muted }}>
          What happens to a lead after we build them a website. Click any box to change the setting behind it.
        </p>
        {data && !data.settings.enabled && (
          <p
            data-testid="flow-disabled-banner"
            style={{ margin: '8px 0 0', fontSize: 12, color: C.waiting, fontWeight: 600 }}
          >
            The funnel is switched off, so nothing below is sending yet.
          </p>
        )}
        {data?.counts_error && (
          <p data-testid="flow-counts-warning" style={{ margin: '8px 0 0', fontSize: 12, color: C.muted }}>
            {data.counts_error} The settings below still work.
          </p>
        )}
        {error && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#B42318' }}>{error}</p>
        )}
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {/* Below 900px the canvas scrolls inside its own box. The page body
            must never scroll sideways, so the overflow lives here. */}
        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
          <div style={{ minWidth: 980, height: '100%', minHeight: 420 }}>
            <ReactFlow
              nodes={nodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: false }}
              onNodeClick={(_, node) => {
                const d = node.data as FlowNodeData;
                openPanel(d.panel, d.label);
              }}
              onEdgeClick={(_, edge) => {
                const key = (edge.data as { configKey?: string } | undefined)?.configKey;
                if (key) openPanel('ladder', 'Timings', key);
              }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#DDDDD6" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </div>

        {panel && (
          <aside
            data-testid="flow-panel"
            style={{
              width: 340,
              maxWidth: '100%',
              background: '#fff',
              borderLeft: `1px solid ${C.border}`,
              padding: 20,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: C.text }}>{panel.title}</h2>
              <button
                data-testid="flow-panel-close"
                onClick={() => setPanel(null)}
                style={{ border: 0, background: 'none', fontSize: 20, cursor: 'pointer', color: C.muted }}
                aria-label="Close panel"
              >
                &times;
              </button>
            </div>

            {panel.key === 'ladder' && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12, color: C.muted, marginTop: 0 }}>
                  These are the real timings. The job that texts and rings leads reads exactly these
                  numbers, so changing one here changes what actually happens.
                </p>
                {LADDER_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    style={{
                      display: 'block',
                      marginBottom: 14,
                      outline: panel.focus === f.key ? `2px solid ${C.primary}` : 'none',
                      outlineOffset: 4,
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text }}>
                      {f.label}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <input
                        data-testid={`ladder-${f.key}`}
                        type="number"
                        min={0}
                        step="any"
                        value={draft[f.key]}
                        disabled={!data?.is_admin}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))
                        }
                        style={{
                          width: 90,
                          padding: '6px 8px',
                          border: `1px solid ${C.border}`,
                          borderRadius: 6,
                          fontSize: 13,
                          color: C.text,
                        }}
                      />
                      <span style={{ fontSize: 11, color: C.muted }}>{f.unit}</span>
                    </span>
                  </label>
                ))}
                {data?.is_admin ? (
                  <button
                    data-testid="ladder-save"
                    onClick={saveLadder}
                    disabled={saving}
                    style={{
                      background: C.primary,
                      color: '#fff',
                      border: 0,
                      borderRadius: 6,
                      padding: '10px 16px',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: saving ? 'default' : 'pointer',
                      opacity: saving ? 0.6 : 1,
                    }}
                  >
                    {saving ? 'Saving' : 'Save timings'}
                  </button>
                ) : (
                  <p style={{ fontSize: 12, color: C.muted }}>Only an admin can change these.</p>
                )}
                {savedAt && (
                  <p data-testid="ladder-saved" style={{ fontSize: 12, color: C.good, marginTop: 10 }}>
                    Saved. The next run will use these.
                  </p>
                )}
              </div>
            )}

            {panel.key === 'sms_copy' && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>
                The text that goes out with the link lives in the message library
                (src/core/site-demo/messages.ts) and is checked by tests so it always fits in two
                SMS segments. Edit it there, not here.
              </p>
            )}

            {panel.key === 'opens' && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>
                Read only. Every open, tap, chat message and call is on the lead's own timeline in
                the inbox and on their contact page.
              </p>
            )}

            {panel.key === 'prompts' && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>
                The chat widget answers from the prompt stored on each site, and the phone is
                answered by the demo receptionist line. Both refuse to invent prices,
                certifications or guarantees.
              </p>
            )}

            {panel.key === 'pricing' && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>
                Website plus AI receptionist, 97 pounds a month, 1 pound today. The prices come from
                the Stripe settings, so they are changed in Stripe rather than here.
              </p>
            )}

            {panel.key === 'converted' && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>
                Read only. Leads who paid keep their site and get their own editor on
                go.heyelsie.com.
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
