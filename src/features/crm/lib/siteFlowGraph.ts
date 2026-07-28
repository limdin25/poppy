// The website sales flow, as a graph.
//
// PURE. No React, no React Flow import, no data fetching, so the whole shape of
// the canvas is unit testable without a browser.
//
// THIS IS A MAP, NOT AN ENGINE. Nothing here executes anything. The cron in
// api/cron/site-demo-followups.ts is the only thing that walks the ladder, and
// every edge label below is rendered from the SAME config that cron reads
// (platform_settings.site_demo_ladder). If the canvas and the cron ever
// disagree, the canvas is the bug.

import {
  resolveLadderConfig,
  type LadderConfig,
} from '@/core/site-demo/ladder';

export interface StateCount {
  state: string;
  in_state: number;
  ever_reached: number;
}

export interface FlowNodeData extends Record<string, unknown> {
  /** Hugo's words, not the database's. */
  label: string;
  /** The wk_site_pages state, or the derived stage name. */
  stateKey: string;
  inState: number;
  everReached: number;
  /** Percent lost between the previous node and this one. Null for the first. */
  dropOff: number | null;
  /** Which side panel this node opens. */
  panel: SitePanelKey;
  /** True for the two stages that are counters rather than states. */
  derived: boolean;
  tone: 'neutral' | 'waiting' | 'good';
}

export type SitePanelKey =
  | 'sms_copy'
  | 'opens'
  | 'prompts'
  | 'ladder'
  | 'pricing'
  | 'converted'
  | 'none';

export interface FlowNode {
  id: string;
  type: 'siteStage';
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  /** Shortcut edges are the "any engagement, any time" jumps. */
  kind: 'ladder' | 'shortcut';
  /** Which ladder timing this edge is governed by, for the panel to focus. */
  configKey?: keyof LadderConfig;
  animated?: boolean;
}

export interface SiteFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** The ladder, in order. Two of these are derived rather than stored states. */
const STAGES: Array<{
  key: string;
  label: string;
  panel: SitePanelKey;
  derived?: boolean;
  tone?: FlowNodeData['tone'];
}> = [
  { key: 'created', label: 'Site built', panel: 'none' },
  { key: 'sent', label: 'Sent to lead', panel: 'sms_copy' },
  { key: 'opened', label: 'Lead opened it', panel: 'opens' },
  { key: 'engaged', label: 'Chatted or called', panel: 'prompts', tone: 'good' },
  { key: 'nudged', label: 'Nudge sent', panel: 'ladder', derived: true, tone: 'waiting' },
  { key: 'ai_calling', label: 'AI called them', panel: 'ladder', derived: true, tone: 'waiting' },
  { key: 'checkout_sent', label: 'Checkout sent', panel: 'pricing' },
  { key: 'converted', label: 'Paid', panel: 'converted', tone: 'good' },
];

const X_GAP = 260;
const Y_MAIN = 0;
/** The two derived stages sit on a lower lane: they are a detour, not the spine. */
const Y_DETOUR = 170;

const DETOUR = new Set(['nudged', 'ai_calling']);

/** "2 hours", "10 minutes", "1 hour". Plain English, never "2h". */
export function humanHours(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  if (hours === 1) return '1 hour';
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${hours} hours`;
}

export function humanMinutes(mins: number): string {
  if (mins >= 60 && mins % 60 === 0) return humanHours(mins / 60);
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

/**
 * Drop-off from one stage to the next, as a percentage.
 * Returns null when the previous stage has nobody in it: 0 of 0 is not a
 * 100 percent drop, it is no information, and rendering it as 100 makes an
 * empty funnel look like a catastrophe.
 */
export function dropOff(prevReached: number, reached: number): number | null {
  if (!prevReached) return null;
  const lost = Math.max(0, prevReached - reached);
  return Math.round((lost / prevReached) * 100);
}

/**
 * Build the whole canvas.
 *
 * @param counts  rows from wk_site_funnel_summary
 * @param config  platform_settings.site_demo_ladder, the SAME object the cron reads
 */
export function buildSiteFlow(
  counts: StateCount[],
  config?: Partial<LadderConfig> | null,
): SiteFlow {
  const cfg = resolveLadderConfig(config);
  const by = new Map(counts.map((c) => [c.state, c]));

  // Drop-off follows the SPINE, not the array. The two detour stages are not
  // in the main path, so measuring "opened -> nudged" as a loss would report a
  // lead who is being chased as a lead we lost.
  const spine = STAGES.filter((s) => !DETOUR.has(s.key));

  const nodes: FlowNode[] = STAGES.map((stage, i) => {
    const row = by.get(stage.key);
    const inState = row?.in_state ?? 0;
    const everReached = row?.ever_reached ?? 0;

    let drop: number | null = null;
    const spineIndex = spine.findIndex((s) => s.key === stage.key);
    if (spineIndex > 0) {
      const prev = by.get(spine[spineIndex - 1].key);
      drop = dropOff(prev?.ever_reached ?? 0, everReached);
    }

    return {
      id: stage.key,
      type: 'siteStage' as const,
      position: {
        x: i * X_GAP,
        y: DETOUR.has(stage.key) ? Y_DETOUR : Y_MAIN,
      },
      data: {
        label: stage.label,
        stateKey: stage.key,
        inState,
        everReached,
        dropOff: drop,
        panel: stage.panel,
        derived: Boolean(stage.derived),
        tone: stage.tone || 'neutral',
      },
    };
  });

  const edges: FlowEdge[] = [
    {
      id: 'created-sent',
      source: 'created',
      target: 'sent',
      label: 'when the lead says yes, or an agent sends it',
      kind: 'ladder',
    },
    {
      id: 'sent-opened',
      source: 'sent',
      target: 'opened',
      label: 'they tap the link',
      kind: 'ladder',
    },
    {
      id: 'sent-nudged',
      source: 'sent',
      target: 'nudged',
      label: `if not opened after ${humanHours(cfg.unopened_1_hours)}, nudge 1`,
      kind: 'ladder',
      configKey: 'unopened_1_hours',
    },
    {
      id: 'opened-nudged',
      source: 'opened',
      target: 'nudged',
      label: `if no chat or call after ${humanMinutes(cfg.engage_1_minutes)}, nudge 1`,
      kind: 'ladder',
      configKey: 'engage_1_minutes',
    },
    {
      id: 'nudged-nudged2',
      source: 'nudged',
      target: 'nudged',
      label: `still nothing after ${humanHours(cfg.engage_2_hours)}, nudge 2`,
      kind: 'ladder',
      configKey: 'engage_2_hours',
    },
    {
      id: 'nudged-ai_calling',
      source: 'nudged',
      target: 'ai_calling',
      label: `still nothing after ${humanHours(cfg.ai_call_1_hours)}, the AI rings them (max ${cfg.max_outbound_calls} attempt${cfg.max_outbound_calls === 1 ? '' : 's'})`,
      kind: 'ladder',
      configKey: 'ai_call_1_hours',
    },
    {
      id: 'ai_calling-engaged',
      source: 'ai_calling',
      target: 'engaged',
      label: 'they pick up',
      kind: 'ladder',
    },
    {
      id: 'engaged-checkout_sent',
      source: 'engaged',
      target: 'checkout_sent',
      label: 'the checkout link is texted after every call and offered in chat',
      kind: 'ladder',
    },
    {
      id: 'checkout_sent-converted',
      source: 'checkout_sent',
      target: 'converted',
      label: 'they pay',
      kind: 'ladder',
      animated: true,
    },
  ];

  // The shortcut the ladder genuinely allows: engagement at ANY stage jumps
  // straight to "chatted or called" and stands the whole nudge sequence down.
  // Drawing the funnel as a straight line would pretend this does not happen.
  for (const from of ['sent', 'opened', 'nudged', 'ai_calling']) {
    edges.push({
      id: `shortcut-${from}-engaged`,
      source: from,
      target: 'engaged',
      label: 'any chat or call, at any stage',
      kind: 'shortcut',
    });
  }

  return { nodes, edges };
}

/** Every stage a shortcut edge must leave from. Exported so the test can assert it. */
export const SHORTCUT_SOURCES = ['sent', 'opened', 'nudged', 'ai_calling'] as const;

export const SITE_FLOW_STAGES = STAGES;
