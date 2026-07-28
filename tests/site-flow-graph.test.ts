import { describe, it, expect } from 'vitest';

// Lives under src/features/crm, which vitest excludes from its default include,
// so it is loaded dynamically. Same pattern as tests/funnel-stages.test.ts.
const load = () => import('../src/features/crm/lib/siteFlowGraph');

const counts = (over: Record<string, [number, number]> = {}) => {
  const base: Record<string, [number, number]> = {
    created: [0, 100],
    sent: [10, 100],
    opened: [8, 60],
    engaged: [4, 20],
    nudged: [12, 45],
    ai_calling: [2, 9],
    checkout_sent: [3, 15],
    converted: [5, 5],
    ...over,
  };
  return Object.entries(base).map(([state, [in_state, ever_reached]]) => ({
    state,
    in_state,
    ever_reached,
  }));
};

describe('the nodes', () => {
  it('draws all eight stages in Hugo words, not database words', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    expect(nodes.map((n) => n.data.label)).toEqual([
      'Site built',
      'Sent to lead',
      'Lead opened it',
      'Chatted or called',
      'Nudge sent',
      'AI called them',
      'Checkout sent',
      'Paid',
    ]);
  });

  it('carries both counts for every stage', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    const opened = nodes.find((n) => n.id === 'opened')!;
    expect(opened.data.inState).toBe(8);
    expect(opened.data.everReached).toBe(60);
  });

  it('shows zeroes rather than blowing up when a stage has no row', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow([]);
    expect(nodes).toHaveLength(8);
    expect(nodes.every((n) => n.data.inState === 0 && n.data.everReached === 0)).toBe(true);
  });

  // nudged and ai_calling are counters, not states: a lead who is nudged and
  // then opens would otherwise have to move backwards.
  it('marks the two derived stages and puts them on their own lane', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    const derived = nodes.filter((n) => n.data.derived).map((n) => n.id);
    expect(derived).toEqual(['nudged', 'ai_calling']);
    const spineY = nodes.find((n) => n.id === 'opened')!.position.y;
    for (const id of derived) {
      expect(nodes.find((n) => n.id === id)!.position.y).not.toBe(spineY);
    }
  });
});

describe('drop-off', () => {
  it('measures loss between consecutive stages', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    // sent 100 -> opened 60 is a 40 percent drop
    expect(nodes.find((n) => n.id === 'opened')!.data.dropOff).toBe(40);
    // opened 60 -> engaged 20 is 67 percent
    expect(nodes.find((n) => n.id === 'engaged')!.data.dropOff).toBe(67);
  });

  it('has no drop-off on the first stage', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    expect(nodes.find((n) => n.id === 'created')!.data.dropOff).toBeNull();
  });

  // 0 of 0 is not a 100 percent drop, it is no information. Rendering it as
  // 100 makes a brand new funnel look like a catastrophe.
  it('returns null rather than 100 when the previous stage is empty', async () => {
    const { dropOff, buildSiteFlow } = await load();
    expect(dropOff(0, 0)).toBeNull();
    const { nodes } = buildSiteFlow([]);
    expect(nodes.every((n) => n.data.dropOff === null)).toBe(true);
  });

  it('never reports a negative drop when a later stage somehow counts higher', async () => {
    const { dropOff } = await load();
    expect(dropOff(10, 15)).toBe(0);
  });

  // The detour stages are not on the spine. Measuring opened -> nudged as a
  // loss would report a lead we are actively chasing as a lead we lost.
  it('measures along the spine, skipping the detour stages', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    // engaged compares against opened (60), not against nudged (45)
    expect(nodes.find((n) => n.id === 'engaged')!.data.dropOff).toBe(67);
    // checkout compares against engaged (20), not ai_calling (9)
    expect(nodes.find((n) => n.id === 'checkout_sent')!.data.dropOff).toBe(25);
  });
});

describe('the edges', () => {
  it('draws the shortcut from every pre-checkout stage', async () => {
    const { buildSiteFlow, SHORTCUT_SOURCES } = await load();
    const { edges } = buildSiteFlow(counts());
    const shortcuts = edges.filter((e) => e.kind === 'shortcut');
    expect(shortcuts.map((e) => e.source).sort()).toEqual([...SHORTCUT_SOURCES].sort());
    expect(shortcuts.every((e) => e.target === 'engaged')).toBe(true);
  });

  it('never points an edge at a node that does not exist', async () => {
    const { buildSiteFlow } = await load();
    const { nodes, edges } = buildSiteFlow(counts());
    const ids = new Set(nodes.map((n) => n.id));
    for (const e of edges) {
      expect(ids.has(e.source), `source ${e.source}`).toBe(true);
      expect(ids.has(e.target), `target ${e.target}`).toBe(true);
    }
  });

  it('gives every edge a unique id', async () => {
    const { buildSiteFlow } = await load();
    const { edges } = buildSiteFlow(counts());
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });
});

// This is the test that makes the canvas real rather than decorative. The edge
// labels come from the same config the cron reads, so changing a delay changes
// both the picture and the behaviour.
describe('edge labels come from the ladder config', () => {
  it('uses the defaults when nothing is configured', async () => {
    const { buildSiteFlow } = await load();
    const { edges } = buildSiteFlow(counts());
    expect(edges.find((e) => e.id === 'sent-nudged')!.label).toContain('2 hours');
    expect(edges.find((e) => e.id === 'opened-nudged')!.label).toContain('10 minutes');
    expect(edges.find((e) => e.id === 'nudged-ai_calling')!.label).toContain('1 day');
  });

  it('moves when the config moves', async () => {
    const { buildSiteFlow } = await load();
    const { edges } = buildSiteFlow(counts(), {
      unopened_1_hours: 6,
      engage_1_minutes: 30,
      ai_call_1_hours: 48,
      max_outbound_calls: 1,
    });
    expect(edges.find((e) => e.id === 'sent-nudged')!.label).toContain('6 hours');
    expect(edges.find((e) => e.id === 'opened-nudged')!.label).toContain('30 minutes');
    const call = edges.find((e) => e.id === 'nudged-ai_calling')!;
    expect(call.label).toContain('2 days');
    expect(call.label).toContain('max 1 attempt');
    expect(call.label).not.toContain('attempts');
  });

  it('tells the panel which timing each edge controls', async () => {
    const { buildSiteFlow } = await load();
    const { edges } = buildSiteFlow(counts());
    expect(edges.find((e) => e.id === 'opened-nudged')!.configKey).toBe('engage_1_minutes');
    expect(edges.find((e) => e.id === 'nudged-ai_calling')!.configKey).toBe('ai_call_1_hours');
  });
});

describe('human readable durations', () => {
  it('writes plain English, never 2h', async () => {
    const { humanHours, humanMinutes } = await load();
    expect(humanHours(0.5)).toBe('30 minutes');
    expect(humanHours(1)).toBe('1 hour');
    expect(humanHours(2)).toBe('2 hours');
    expect(humanHours(24)).toBe('1 day');
    expect(humanHours(48)).toBe('2 days');
    expect(humanMinutes(10)).toBe('10 minutes');
    expect(humanMinutes(1)).toBe('1 minute');
    expect(humanMinutes(120)).toBe('2 hours');
  });
});

describe('every node knows which panel it opens', () => {
  it('maps each stage to the setting that actually drives it', async () => {
    const { buildSiteFlow } = await load();
    const { nodes } = buildSiteFlow(counts());
    const panel = (id: string) => nodes.find((n) => n.id === id)!.data.panel;
    expect(panel('sent')).toBe('sms_copy');
    expect(panel('opened')).toBe('opens');
    expect(panel('engaged')).toBe('prompts');
    expect(panel('nudged')).toBe('ladder');
    expect(panel('ai_calling')).toBe('ladder');
    expect(panel('checkout_sent')).toBe('pricing');
    expect(panel('converted')).toBe('converted');
  });
});
