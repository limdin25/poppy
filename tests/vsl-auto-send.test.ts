import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTO_SEND_TTL_HOURS,
  autoSendDecision,
  type AutoSendPage,
} from '../api/lib/vsl-auto-send';

// Hugo 2026-07-27: "where we click make their video it should say make their
// video and send when ready. The agent knows exactly what's gonna happen."
//
// The agent is ON THE PHONE. A render takes ~10 minutes. Asking them to come
// back and press a second button is asking them to forget — so arming the send
// at the same moment they queue the render is the whole point.
//
// The flip side: an armed send is a text that will go out with nobody watching.
// Every guard below exists so it can only go out when it still makes sense.

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const NOW = new Date('2026-07-27T11:00:00Z');
const ARMED = new Date('2026-07-27T10:45:00Z').toISOString();

const page = (over: Partial<AutoSendPage> = {}): AutoSendPage => ({
  state: 'created',
  render_status: 'ready',
  video_url: 'https://cdn/v.mp4',
  auto_send_channel: 'sms',
  auto_send_armed_at: ARMED,
  ...over,
});

const ctx = (over: Partial<Parameters<typeof autoSendDecision>[1]> = {}) => ({
  now: NOW,
  funnelEnabled: true,
  insideHours: true,
  hasDefaultVideo: false,
  ...over,
});

describe('autoSendDecision', () => {
  it('sends once the render is ready', () => {
    expect(autoSendDecision(page(), ctx())).toEqual({ action: 'send' });
  });

  it('waits while the video is still rendering', () => {
    expect(autoSendDecision(page({ render_status: 'queued' }), ctx())).toEqual({ action: 'wait', reason: 'rendering' });
    expect(autoSendDecision(page({ render_status: 'rendering' }), ctx())).toEqual({ action: 'wait', reason: 'rendering' });
  });

  it('holds outside quiet hours rather than texting someone at 11pm', () => {
    expect(autoSendDecision(page(), ctx({ insideHours: false }))).toEqual({ action: 'wait', reason: 'quiet_hours' });
  });

  it('holds while the funnel is switched off — the master switch outranks the arm', () => {
    expect(autoSendDecision(page(), ctx({ funnelEnabled: false }))).toEqual({ action: 'wait', reason: 'funnel_off' });
  });

  it('gives up when the render failed — there is nothing to send', () => {
    expect(autoSendDecision(page({ render_status: 'failed' }), ctx()))
      .toEqual({ action: 'abort', reason: 'render_failed' });
  });

  it('expires an arm nobody collected, so a stale send cannot surprise a lead', () => {
    // The funnel being dark for two days must not mean a batch of week-old
    // leads all get texted the moment Hugo flips the switch.
    const stale = new Date(NOW.getTime() - (AUTO_SEND_TTL_HOURS + 1) * 3600_000).toISOString();
    expect(autoSendDecision(page({ auto_send_armed_at: stale }), ctx()))
      .toEqual({ action: 'abort', reason: 'expired' });
  });

  it('expires even while the funnel is off — the hold must not outlive the TTL', () => {
    const stale = new Date(NOW.getTime() - (AUTO_SEND_TTL_HOURS + 1) * 3600_000).toISOString();
    expect(autoSendDecision(page({ auto_send_armed_at: stale }), ctx({ funnelEnabled: false })))
      .toEqual({ action: 'abort', reason: 'expired' });
  });

  it('stands down if the lead was already sent by hand in the meantime', () => {
    expect(autoSendDecision(page({ state: 'sent' }), ctx())).toEqual({ action: 'abort', reason: 'already_sent' });
    expect(autoSendDecision(page({ state: 'opened' }), ctx())).toEqual({ action: 'abort', reason: 'already_sent' });
  });

  it('refuses a ready page with nothing playable on it', () => {
    expect(autoSendDecision(page({ video_url: null }), ctx())).toEqual({ action: 'abort', reason: 'no_video' });
  });

  it('accepts the workspace default video as playable', () => {
    expect(autoSendDecision(page({ video_url: null }), ctx({ hasDefaultVideo: true }))).toEqual({ action: 'send' });
  });

  it('does nothing at all for a page that was never armed', () => {
    expect(autoSendDecision(page({ auto_send_channel: null }), ctx()))
      .toEqual({ action: 'abort', reason: 'not_armed' });
  });
});

/* ------------------------------------------------------------------ */

const mig = read('supabase/migrations/20260727000010_vsl_auto_send.sql');
const cron = read('api/cron/vsl-auto-send.ts');
const vslPage = read('api/crm/vsl-page.ts');
const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };

describe('the arm is stored on the page, not held in the browser', () => {
  it('adds the channel, the armed stamp, who armed it and the exact body', () => {
    for (const col of [
      'auto_send_channel', 'auto_send_armed_at', 'auto_send_by',
      'auto_send_body', 'auto_send_subject', 'auto_send_error',
    ]) {
      expect(mig).toContain(col);
    }
  });

  it('stores the body the agent actually read, so the send holds no surprises', () => {
    // Re-templating at send time would let a settings edit change a message an
    // agent already approved on the phone.
    expect(mig).toMatch(/auto_send_body\s+text/);
    expect(cron).toMatch(/auto_send_body/);
    expect(cron).not.toMatch(/fillTemplate\(/);
  });

  it('constrains the channel at the database, not just in the UI', () => {
    expect(mig).toMatch(/auto_send_channel\s*=\s*any\s*\(array\['sms'::text,\s*'whatsapp'::text,\s*'email'::text\]\)/i);
  });

  it('indexes the queue the cron scans every minute', () => {
    expect(mig).toMatch(/create index if not exists [\s\S]*auto_send[\s\S]*on wk_vsl_pages/i);
    expect(mig).toMatch(/where auto_send_channel is not null/i);
  });
});

describe('the arming endpoint', () => {
  it('accepts an arm alongside the render request', () => {
    expect(vslPage).toMatch(/auto_send/);
    expect(vslPage).toMatch(/cancel_auto_send/);
  });

  it('rejects a channel it cannot actually send on', () => {
    expect(vslPage).toMatch(/AUTO_SEND_CHANNELS/);
  });

  it('refuses to arm a lead with no address for the chosen channel', () => {
    // Arming a send to nowhere means the agent walks away believing it went.
    expect(vslPage).toMatch(/no_destination/);
  });
});

describe('the cron', () => {
  it('runs every minute — a render finishing must not sit for five', () => {
    const entry = vercel.crons.find((c) => c.path === '/api/cron/vsl-auto-send');
    expect(entry).toBeTruthy();
    expect(entry!.schedule).toBe('* * * * *');
  });

  it('is CRON_SECRET-gated like every other cron here', () => {
    expect(cron).toMatch(/CRON_SECRET/);
    expect(cron).toMatch(/401/);
  });

  it('claims a page before sending, so two overlapping runs cannot double-text', () => {
    // The claim clears auto_send_channel in the same UPDATE that filters on it.
    expect(cron).toMatch(/\.not\('auto_send_channel', 'is', null\)|is not null/);
    expect(cron).toMatch(/CLAIM|claim/);
  });

  it('only marks the page sent after the send actually succeeded', () => {
    // Scope past the imports — advanceVslState is named at the top of the file.
    const loop = cron.split('for (const p of')[1] ?? '';
    const sendIdx = loop.search(/await deliver\(/);
    const advIdx = loop.search(/await advanceVslState\(/);
    expect(sendIdx).toBeGreaterThan(-1);
    expect(advIdx).toBeGreaterThan(sendIdx);
    // …and a throwing deliver() must skip the advance entirely.
    expect(loop).toMatch(/catch \(e\)[\s\S]{0,400}continue;/);
  });

  it('writes the outbound message to the same table the inbox reads', () => {
    // A text the agent cannot see in the thread is a text that did not happen,
    // as far as the next person to pick this lead up is concerned.
    expect(cron).toMatch(/wk_sms_messages/);
  });

  it('records why an arm was dropped instead of silently forgetting it', () => {
    expect(cron).toMatch(/auto_send_error/);
  });
});
