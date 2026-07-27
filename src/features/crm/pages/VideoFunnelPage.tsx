// Video funnel board — every lead's VSL page grouped by funnel state, live.
// Agents see their own (RLS); admins see everyone. Realtime on wk_vsl_pages
// lights up "watching now". The admin gear opens the automation settings
// (platform_settings.vsl_automation via /api/admin/crm/vsl-settings).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard, Copy, Check, ExternalLink, Settings2, X, Loader2, Send, Eye, History,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { useSmsV2 } from '../store/SmsV2Store';
import { useImpersonatedAgentId } from '../lib/ViewAsContext';
import ContactIdentity from '../components/shared/ContactIdentity';
import AgentChip from '../components/shared/AgentChip';
import CalcChip from '../components/shared/CalcChip';
import FunnelLeadDrawer from '../components/funnel/FunnelLeadDrawer';
import { formatDateTime } from '../data/helpers';
// Stage rules live in lib/funnelStages so the inbox badges can share them —
// two copies of the rendering/render_ready carve-out WILL drift.
import {
  STATES, STAGE_STAMPS, boardKey, ago, type VslPage,
} from '../lib/funnelStages';

/** Preview marker. The board's own "open page" links must not burn the lead's
 *  first touch — without this, Hugo checking pages would consume the very
 *  first-click/first-open signal the notifications exist to report. */
const PREVIEW = '?p=1';

interface Summary {
  created: number; sent: number; clicked: number; opened: number; played: number;
  watched_50: number; watched_90: number; watched_100: number;
  cta_clicked: number; checkout_started: number; paid: number;
}

const STRIP: Array<{ key: keyof Summary; label: string }> = [
  { key: 'sent', label: 'Sent' },
  { key: 'clicked', label: 'Tapped' },
  { key: 'opened', label: 'Opened' },
  { key: 'played', label: 'Played' },
  { key: 'watched_50', label: '50%' },
  { key: 'watched_90', label: '90%' },
  { key: 'watched_100', label: '100%' },
  { key: 'cta_clicked', label: 'Clicked £1' },
  { key: 'paid', label: 'Paid' },
];

export default function VideoFunnelPage() {
  const { agent } = useCurrentAgent();
  // The lead's CALL OUTCOME (Interested / Nurturing / No pickup / ...). It is a
  // separate axis from the funnel stage — Hugo 2026-07-27: "inside the video
  // funnel we can see the label of each lead like interested, nurturing etc."
  // The funnel no longer writes it, so it stays whatever the agent picked.
  const { contacts, columns } = useSmsV2();
  const outcomeOf = useCallback(
    (contactId: string) => {
      const c = contacts.find((x) => x.id === contactId);
      if (!c?.pipelineColumnId) return null;
      return columns.find((col) => col.id === c.pipelineColumnId) ?? null;
    },
    [contacts, columns],
  );
  const isAdmin = agent?.isAdmin ?? false;
  const impId = useImpersonatedAgentId();
  const [pages, setPages] = useState<VslPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  // An ID, not the row: the board replaces every page object on each realtime
  // reload, so holding the object would freeze the drawer at its opening
  // snapshot while the board updated behind it.
  const [drawerPageId, setDrawerPageId] = useState<string | null>(null);
  /** Set when the card's green button opened the drawer, so it lands on the
   *  composer instead of the journey. */
  const [composeForId, setComposeForId] = useState<string | null>(null);
  const [watchingNow, setWatchingNow] = useState<Set<string>>(new Set());
  const watchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const pagesRef = useRef<VslPage[]>([]);
  pagesRef.current = pages;

  const load = useCallback(async () => {
    // "See as: <agent>" — admin impersonating sees that agent's video pages.
    let q = (supabase.from('wk_vsl_pages' as never) as any)
      .select('*, wk_contacts:contact_id ( owner_name:custom_fields->>owner_name, website:custom_fields->>website )')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (impId) q = q.eq('agent_id', impId);
    const { data } = await q;
    setPages((data as VslPage[]) || []);
    setLoading(false);

    // The strip gets its OWN aggregate. Counting the 500-row page above would
    // be a made-up number past 500 pages, and — more importantly — `state` is
    // forward-only, so a paid lead is no longer in 'opened' and every drop-off
    // percentage derived from the board columns would be wrong.
    const { data: sum, error: sumErr } = await (supabase as never as {
      rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: Summary[] | null; error: unknown }>;
    }).rpc('wk_vsl_funnel_summary', { p_since: null, p_until: null, p_agent: impId ?? null });
    if (sumErr) console.warn('[video-funnel] summary failed:', sumErr);
    setSummary(Array.isArray(sum) ? sum[0] ?? null : (sum as Summary | null));
  }, [impId]);

  useEffect(() => {
    load();
    const timers = watchTimers.current;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase
      .channel('vsl-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wk_vsl_pages' }, (payload) => {
        const row = payload.new as VslPage | undefined;
        if (row?.id) {
          // "Watching now" = a REAL beacon just landed (open_count or watched_pct
          // went up), not an automation/cron bookkeeping write. Refresh the
          // 3-minute timer each time so an active viewer never clears early.
          const prev = pagesRef.current.find((p) => p.id === row.id);
          const liveBeacon =
            (prev ? row.open_count > prev.open_count || row.watched_pct > prev.watched_pct : true) &&
            (row.state === 'opened' || row.state === 'watched');
          if (liveBeacon) {
            setWatchingNow((s) => new Set(s).add(row.id));
            const existing = timers.get(row.id);
            if (existing) clearTimeout(existing);
            timers.set(
              row.id,
              setTimeout(() => {
                setWatchingNow((s) => { const n = new Set(s); n.delete(row.id); return n; });
                timers.delete(row.id);
              }, 3 * 60_000),
            );
          }
        }
        // Debounce the full reload so a burst of beacons costs one refetch.
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => { load(); }, 1500);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
      if (debounce) clearTimeout(debounce);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [load]);

  // Derived from the LIVE list, so the open drawer updates as beacons land.
  const drawerPage = useMemo(
    () => (drawerPageId ? (pages.find((p) => p.id === drawerPageId) ?? null) : null),
    [pages, drawerPageId],
  );
  // Close only when the row genuinely vanished. Without the `pages.length > 0`
  // half, the transient empty array during a reload slams the drawer shut.
  useEffect(() => {
    if (drawerPageId && pages.length > 0 && !pages.some((p) => p.id === drawerPageId)) {
      setDrawerPageId(null);
    }
  }, [pages, drawerPageId]);

  const grouped = useMemo(() => {
    const g: Record<string, VslPage[]> = {};
    for (const s of STATES) g[s.key] = [];
    for (const p of pages) (g[boardKey(p)] ||= []).push(p);
    return g;
  }, [pages]);

  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  // sendVideo() used to live here and fired wk-sms-send with a body the agent
  // had never seen. Sending now happens only inside FunnelLeadDrawer's
  // composer, where the message is visible and editable and the channel is a
  // choice (Hugo 2026-07-27). Keeping a second send path here would also mean
  // two independent "already sent" guards — and a lead texted twice.

  async function nudge(p: VslPage) {
    const url = `https://heyelsie.com/${p.slug}`;
    const first = (p.owner_first || 'there').split(' ')[0];
    const body =
      p.state === 'sent'
        ? `Hi ${first}, did you get a chance to watch your video? Takes 90 seconds: ${url}`
        : `Hi ${first}, saw you had a look at the video — want me to get ${p.business_name} set up? It's £1 to start: ${url}`;
    const { error } = await supabase.functions.invoke('wk-schedule-send', {
      body: { contact_id: p.contact_id, body, delay_hours: 0 },
    });
    if (error) return; // leave un-nudged so the agent can retry
    setNudged((prev) => new Set(prev).add(p.id));
  }

  return (
    <div className="p-4 max-w-[1500px] mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Clapperboard className="w-5 h-5 text-[#3C5A87]" />
        <h1 className="text-[18px] font-black text-[#1A1A1A]">Video funnel</h1>
        <span className="text-[12px] text-[#6B7280]">
          {pages.length} page{pages.length === 1 ? '' : 's'} · updates live
        </span>
        {isAdmin && (
          <button
            onClick={() => setShowSettings(true)}
            className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-[#3C5A87] border border-[#c9d6e8] bg-white hover:bg-[#eaf1f8] rounded-[8px] px-3 py-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" /> Automation settings
          </button>
        )}
      </div>

      {/* Conversion at a glance — every stage counted from its own timestamp,
          so a lead who paid still counts as having opened and watched. */}
      {summary && (
        <div
          className="flex gap-2 overflow-x-auto pb-3 mb-1"
          data-testid="funnel-summary-strip"
        >
          {STRIP.map((s, i) => {
            const n = summary[s.key] ?? 0;
            const prev = i === 0 ? null : summary[STRIP[i - 1].key] ?? 0;
            const drop = prev && prev > 0 ? Math.round((n / prev) * 100) : null;
            return (
              <div
                key={s.key}
                className="min-w-[92px] flex-shrink-0 bg-white border border-[#E5E7EB] rounded-[10px] px-3 py-2"
              >
                <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
                  {s.label}
                </div>
                <div className="text-[18px] font-black text-[#1A1A1A] tabular-nums leading-tight">{n}</div>
                {drop !== null && (
                  <div className="text-[10px] text-[#6B7280] tabular-nums">{drop}% of prev</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-[#9CA3AF] italic">Loading…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STATES.map((s) => {
            // Nine full-width columns is 2,256px — well past the page, so the
            // later stages sat off-screen and read as "missing" (Hugo
            // 2026-07-27). An EMPTY stage collapses to a slim labelled spine,
            // so every stage of the funnel is on screen at once and the cards
            // still get their full width.
            const count = grouped[s.key]?.length || 0;
            const collapsed = count === 0;
            return (
            <div
              key={s.key}
              data-testid={`funnel-col-${s.key}`}
              className={collapsed
                ? 'min-w-[40px] w-[40px] flex-shrink-0'
                : 'min-w-[240px] w-[240px] flex-shrink-0'}
            >
              {collapsed ? (
                <div
                  className="h-full min-h-[120px] rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#FAFAF7] flex flex-col items-center justify-start pt-2 gap-2"
                  title={`${s.label} — empty`}
                >
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: s.color }}>0</span>
                  <span
                    className="text-[10px] font-semibold whitespace-nowrap text-[#9CA3AF]"
                    style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                  >
                    {s.label}
                  </span>
                </div>
              ) : (
              <>
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded-t-[10px] border-b-2"
                style={{ borderColor: s.color }}
              >
                <span className="text-[12px] font-bold" style={{ color: s.color }}>{s.label}</span>
                <span className="text-[11px] text-[#9CA3AF] tabular-nums">{count}</span>
              </div>
              <div className="space-y-2 pt-2">
                {(grouped[s.key] || []).map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    data-testid={`funnel-card-${p.id}`}
                    onClick={() => setDrawerPageId(p.id)}
                    onKeyDown={(e) => {
                      // Only when the CARD itself has focus — Space pressed
                      // inside a nested control must not re-open the drawer.
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDrawerPageId(p.id);
                      }
                    }}
                    title="Open this lead"
                    className={`bg-white border rounded-[10px] p-2.5 cursor-pointer hover:border-[#c9d6e8] hover:shadow-sm transition-colors ${
                      watchingNow.has(p.id) ? 'border-[#F59E0B] shadow-[0_0_0_2px_rgba(245,158,11,.25)]' : 'border-[#E5E7EB]'
                    }`}
                  >
                    {watchingNow.has(p.id) && (
                      <div className="flex items-center gap-1 text-[10px] font-bold text-[#B45309] mb-1">
                        <Eye className="w-3 h-3" /> WATCHING NOW — call them!
                      </div>
                    )}
                    {/* Plain text, not a link: one card, one action. The full
                        lead record is a footer link inside the drawer. */}
                    <div className="text-[13px] font-bold text-[#1A1A1A] leading-tight">
                      {p.business_name}
                    </div>
                    <ContactIdentity
                      owner={p.wk_contacts?.owner_name || p.owner_first}
                      website={p.wk_contacts?.website}
                      layout="stack"
                      size="xs"
                    />
                    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                      <AgentChip agentId={p.agent_id} size="xs" />
                      <CalcChip calcAt={p.calc_at} count={p.calc_count} />
                      {(() => {
                        const outcome = outcomeOf(p.contact_id);
                        if (!outcome) return null;
                        return (
                          <span
                            title={`Call outcome — ${outcome.name}`}
                            className="ml-auto flex-shrink-0 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full"
                            style={{ background: `${outcome.colour}1F`, color: outcome.colour }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: outcome.colour }} />
                            {outcome.name}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10.5px] text-[#9CA3AF]">
                      {p.town && <span>{p.town}</span>}
                      {p.watched_pct > 0 && <span>watched {p.watched_pct}%</span>}
                      {p.open_count > 0 && <span>{p.open_count} open{p.open_count === 1 ? '' : 's'}</span>}
                      {p.no_website && <span title="No website — video opens with the Google search" className="text-[#6B7280] font-bold">no site</span>}
                      <span className="ml-auto" title={formatDateTime(p.updated_at)}>{ago(p.updated_at)}</span>
                    </div>

                    {/* The moment this lead reached the stage they're sitting
                        in — relative to read fast, exact on hover. */}
                    {(() => {
                      const reached = [...STAGE_STAMPS].reverse().find((s) => p[s.key]);
                      if (!reached) return null;
                      const ts = p[reached.key] as string;
                      return (
                        <div
                          className="mt-1 text-[10px] text-[#6B7280] tabular-nums"
                          title={formatDateTime(ts)}
                        >
                          {reached.label} · {formatDateTime(ts)}
                        </div>
                      );
                    })()}

                    {/* render lifecycle on the card */}
                    {s.key === 'rendering' && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-[10.5px] font-semibold text-[#64748B]">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {p.render_status === 'queued' ? 'queued' : `rendering ${ago(p.render_started_at)}`}
                      </div>
                    )}
                    {p.render_status === 'failed' && s.key === 'created' && (
                      <div className="mt-1.5 text-[10px] text-[#B91C1C] leading-snug" title={p.render_error || ''}>
                        render failed — retry from the dialer
                      </div>
                    )}
                    {/* Scrubbing the preview must not open the drawer. */}
                    {s.key === 'render_ready' && p.video_url && (
                      <div className="mt-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                        <video
                          src={p.video_url}
                          poster={p.poster_url || undefined}
                          controls
                          playsInline
                          preload="none"
                          className="w-full rounded-[8px] bg-black aspect-[9/16] max-h-[220px]"
                        />
                        {/* Opens the composer rather than sending — the agent
                            reads and can edit the message first, and picks the
                            channel (Hugo 2026-07-27). */}
                        <button
                          onClick={() => { setComposeForId(p.id); setDrawerPageId(p.id); }}
                          disabled={sentIds.has(p.id)}
                          data-testid={`funnel-review-send-${p.id}`}
                          className="w-full flex items-center justify-center gap-1.5 text-[11.5px] font-bold text-white bg-[#16A34A] hover:bg-[#15803d] rounded-[8px] py-1.5 disabled:opacity-50"
                        >
                          {sentIds.has(p.id) ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                          {sentIds.has(p.id) ? 'Sent' : 'Looks good — review & send'}
                        </button>
                      </div>
                    )}

                    <div className="flex gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(`https://heyelsie.com/${p.slug}`);
                          setCopied(p.id);
                          setTimeout(() => setCopied(null), 1500);
                        }}
                        title="Copy link"
                        className="flex-1 flex items-center justify-center text-[11px] text-[#3C5A87] border border-[#E5E7EB] rounded-[6px] py-1 hover:bg-[#eaf1f8]"
                      >
                        {copied === p.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <a
                        href={`https://heyelsie.com/${p.slug}${PREVIEW}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open page (preview — not counted as the lead's visit)"
                        className="flex-1 flex items-center justify-center text-[11px] text-[#3C5A87] border border-[#E5E7EB] rounded-[6px] py-1 hover:bg-[#eaf1f8]"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        onClick={() => setDrawerPageId(p.id)}
                        title="Full activity, with timestamps"
                        data-testid={`funnel-activity-${p.id}`}
                        className="flex-1 flex items-center justify-center text-[11px] text-[#3C5A87] border border-[#E5E7EB] rounded-[6px] py-1 hover:bg-[#eaf1f8]"
                      >
                        <History className="w-3 h-3" />
                      </button>
                      {p.state !== 'paid' && p.state !== 'created' && (
                        <button
                          onClick={() => nudge(p)}
                          disabled={nudged.has(p.id)}
                          title="Text a nudge now"
                          className="flex-1 flex items-center justify-center text-[11px] text-white bg-[#3C5A87] rounded-[6px] py-1 hover:bg-[#33507a] disabled:opacity-50"
                        >
                          {nudged.has(p.id) ? <Check className="w-3 h-3" /> : <Send className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!grouped[s.key]?.length && (
                  <p className="text-[11px] text-[#D1D5DB] italic px-2">none</p>
                )}
              </div>
              </>
              )}
            </div>
            );
          })}
        </div>
      )}

      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
      {drawerPage && (
        <FunnelLeadDrawer
          page={drawerPage}
          previewUrl={`https://heyelsie.com/${drawerPage.slug}${PREVIEW}`}
          onClose={() => { setDrawerPageId(null); setComposeForId(null); }}
          onNudge={nudge}
          nudged={nudged.has(drawerPage.id)}
          startInCompose={composeForId === drawerPage.id}
          onSent={(id) => setSentIds((prev) => new Set(prev).add(id))}
        />
      )}
    </div>
  );
}

/* ---------------- admin settings drawer ---------------- */

interface RuleCfg { enabled: boolean; delay_minutes: number; template: string; max_sends: number; repeat_hours: number }
interface Cfg {
  enabled: boolean;
  default_video_url: string;
  send_template: string;
  send_template_no_site: string;
  cta_labels: { a: string; b: string };
  watched_threshold_pct: number;
  quiet_hours: { start: string; end: string };
  agent_disabled: string[];
  spots_per_town: number;
  proof_image_url: string;
  proof_caption: string;
  notify: Record<string, boolean>;
  rules: Record<string, RuleCfg>;
}

// Hugo asked for an email on every action; these let him quieten one without a
// deploy if the volume proves too much.
const NOTIFY_LABELS: Record<string, string> = {
  sent: 'Video texted',
  link_click: 'Tapped the link',
  open: 'Opened the page',
  play: 'Started the video',
  calc: 'Played with the calculator',
  watched_50: 'Watched 50%',
  watched_90: 'Watched 90%',
  watched_100: 'Watched to the end',
  cta_click: 'Clicked the £1 button',
  checkout_start: 'Started checkout',
  paid: 'Paid',
};

const RULE_LABELS: Record<string, string> = {
  sent_not_opened: 'Sent but never opened',
  opened_not_watched: 'Opened but didn’t watch',
  watched_no_click: 'Watched but didn’t click',
  checkout_abandoned: 'Started checkout, didn’t pay',
  paid_welcome: 'Paid — welcome message',
};

function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [aiMode, setAiMode] = useState('draft');
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [worker, setWorker] = useState<{ last_seen: string; current: string | null } | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const call = useCallback(async (method: 'GET' | 'POST', body?: unknown) => {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/crm/vsl-settings', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(res.status === 403 ? 'Admins only.' : `Request failed (${res.status})`);
    return res.json();
  }, []);

  const loadCfg = useCallback(() => {
    setErr('');
    call('GET')
      .then((d) => {
        setCfg(d.settings); setAiMode(d.ai_reply_mode); setAgents(d.agents || []);
        setWorker(d.render_worker || null); setQueueDepth(d.render_queue_depth || 0);
      })
      .catch((e) => setErr(e.message || 'Could not load settings.'));
  }, [call]);

  useEffect(() => { loadCfg(); }, [loadCfg]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    setErr('');
    try {
      await call('POST', { settings: cfg, ai_reply_mode: aiMode });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message || 'Save failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-[520px] h-full bg-white overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-black">Video funnel — automation</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#F3F3EE]"><X className="w-4 h-4" /></button>
        </div>

        {err ? (
          <div className="text-[13px] text-[#B91C1C]">
            {err}{' '}
            <button onClick={loadCfg} className="underline font-semibold">Retry</button>
          </div>
        ) : !cfg ? (
          <p className="text-[13px] text-[#9CA3AF] italic">Loading…</p>
        ) : (
          <div className="space-y-5">
            <label className="flex items-center gap-2 text-[14px] font-bold">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              Funnel live (button + automation on)
            </label>

            {/* The draft-queue killed 15 hot replies in July — surface it hard. */}
            <div className={`rounded-[10px] p-3 border ${aiMode === 'draft' ? 'bg-[#FFFBEB] border-[#FDE68A]' : 'bg-[#F0FDF4] border-[#BBF7D0]'}`}>
              <p className="text-[12.5px] font-bold mb-1">
                AI text replies: {aiMode === 'draft' ? '⚠️ DRAFT mode — replies wait for approval nobody does' : '✅ AUTO — replies send themselves'}
              </p>
              <button
                onClick={() => setAiMode(aiMode === 'draft' ? 'auto' : 'draft')}
                className="text-[12px] font-semibold text-[#3C5A87] underline"
              >
                Switch to {aiMode === 'draft' ? 'auto' : 'draft'}
              </button>
            </div>

            <div>
              <label className="text-[12px] font-bold block mb-1">Default video URL (until per-lead renders land)</label>
              <input
                value={cfg.default_video_url}
                onChange={(e) => set({ default_video_url: e.target.value })}
                placeholder="https://…/vsl.mp4"
                className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
              />
            </div>

            {/* the video factory's pulse */}
            <div className={`rounded-[10px] p-3 border text-[12px] ${
              worker && Date.now() - new Date(worker.last_seen).getTime() < 120_000
                ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
            }`}>
              <b>Render worker:</b>{' '}
              {worker
                ? Date.now() - new Date(worker.last_seen).getTime() < 120_000
                  ? `✅ online${worker.current ? ` — rendering ${worker.current}` : ''} · ${queueDepth} in queue`
                  : `⚠️ last seen ${new Date(worker.last_seen).toLocaleString('en-GB')} — videos won't render until it's back`
                : '⚠️ never seen — the VPS worker isn’t running yet'}
            </div>

            <div className="rounded-[10px] p-3 border border-[#E5E7EB] bg-[#FAFAF7] space-y-2">
              <p className="text-[12.5px] font-black">Proof below the button (before/after)</p>
              <div>
                <label className="text-[11px] font-bold block mb-1">Image URL</label>
                <input
                  value={cfg.proof_image_url}
                  onChange={(e) => set({ proof_image_url: e.target.value })}
                  placeholder="https://…/mayfair-before-after.png"
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold block mb-1">Caption above it</label>
                <input
                  value={cfg.proof_caption}
                  onChange={(e) => set({ proof_caption: e.target.value })}
                  placeholder="Examples of businesses that invest in reviews"
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
              <p className="text-[10.5px] text-[#9CA3AF]">Leave the URL blank to show the built-in Mayfair before/after cards; set it to override them with an image.</p>
            </div>

            <div>
              <label className="text-[12px] font-bold block mb-1">Send-video SMS ({'{first} {business} {url} {agent}'})</label>
              <textarea
                value={cfg.send_template}
                onChange={(e) => set({ send_template: e.target.value })}
                rows={3}
                className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
              />
            </div>

            <div>
              <label className="text-[12px] font-bold block mb-1">Send-video SMS — no-website leads</label>
              <textarea
                value={cfg.send_template_no_site}
                onChange={(e) => set({ send_template_no_site: e.target.value })}
                rows={3}
                className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-bold block mb-1">Button label A</label>
                <input
                  value={cfg.cta_labels.a}
                  onChange={(e) => set({ cta_labels: { ...cfg.cta_labels, a: e.target.value } })}
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
              <div>
                <label className="text-[12px] font-bold block mb-1">Button label B</label>
                <input
                  value={cfg.cta_labels.b}
                  onChange={(e) => set({ cta_labels: { ...cfg.cta_labels, b: e.target.value } })}
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[12px] font-bold block mb-1">"Watched" at %</label>
                <input
                  type="number"
                  value={cfg.watched_threshold_pct}
                  onChange={(e) => set({ watched_threshold_pct: Number(e.target.value) || 50 })}
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
              <div>
                <label className="text-[12px] font-bold block mb-1">Quiet from</label>
                <input
                  value={cfg.quiet_hours.start}
                  onChange={(e) => set({ quiet_hours: { ...cfg.quiet_hours, start: e.target.value } })}
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
              <div>
                <label className="text-[12px] font-bold block mb-1">until</label>
                <input
                  value={cfg.quiet_hours.end}
                  onChange={(e) => set({ quiet_hours: { ...cfg.quiet_hours, end: e.target.value } })}
                  className="w-full px-2.5 py-2 text-[13px] border border-[#D1D5DB] rounded-[8px]"
                />
              </div>
            </div>

            <div className="rounded-[10px] p-3 border border-[#E5E7EB] bg-[#FAFAF7]">
              <p className="text-[12.5px] font-black mb-1">Email me when…</p>
              <p className="text-[10.5px] text-[#9CA3AF] mb-2">
                Every event always shows in the bell and on the lead. These only
                control the email.
              </p>
              <div className="grid grid-cols-2 gap-x-3">
                {Object.keys(NOTIFY_LABELS).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-[12px] py-0.5">
                    <input
                      type="checkbox"
                      checked={cfg.notify?.[k] !== false}
                      onChange={(e) => set({ notify: { ...(cfg.notify || {}), [k]: e.target.checked } })}
                    />
                    {NOTIFY_LABELS[k]}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[13px] font-black mb-2">Follow-up rules</p>
              <div className="space-y-3">
                {Object.entries(cfg.rules).map(([key, rule]) => (
                  <div key={key} className="border border-[#E5E7EB] rounded-[10px] p-3">
                    <label className="flex items-center gap-2 text-[12.5px] font-bold mb-2">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) =>
                          set({ rules: { ...cfg.rules, [key]: { ...rule, enabled: e.target.checked } } })
                        }
                      />
                      {RULE_LABELS[key] || key}
                    </label>
                    <textarea
                      value={rule.template}
                      onChange={(e) =>
                        set({ rules: { ...cfg.rules, [key]: { ...rule, template: e.target.value } } })
                      }
                      rows={2}
                      className="w-full px-2.5 py-2 text-[12.5px] border border-[#E5E7EB] rounded-[8px] mb-2"
                    />
                    <div className="flex items-center gap-3 text-[11.5px] text-[#374151]">
                      <span>
                        after{' '}
                        <input
                          type="number"
                          value={rule.delay_minutes}
                          onChange={(e) =>
                            set({ rules: { ...cfg.rules, [key]: { ...rule, delay_minutes: Number(e.target.value) || 0 } } })
                          }
                          className="w-16 px-1.5 py-0.5 border border-[#E5E7EB] rounded"
                        />{' '}
                        min
                      </span>
                      <span>
                        max{' '}
                        <input
                          type="number"
                          value={rule.max_sends}
                          onChange={(e) =>
                            set({ rules: { ...cfg.rules, [key]: { ...rule, max_sends: Number(e.target.value) || 1 } } })
                          }
                          className="w-12 px-1.5 py-0.5 border border-[#E5E7EB] rounded"
                        />{' '}
                        sends
                      </span>
                      <span>
                        every{' '}
                        <input
                          type="number"
                          value={rule.repeat_hours}
                          onChange={(e) =>
                            set({ rules: { ...cfg.rules, [key]: { ...rule, repeat_hours: Number(e.target.value) || 24 } } })
                          }
                          className="w-12 px-1.5 py-0.5 border border-[#E5E7EB] rounded"
                        />{' '}
                        h
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {agents.length > 0 && (
              <div>
                <p className="text-[13px] font-black mb-2">Automation per agent</p>
                {agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-[12.5px] py-0.5">
                    <input
                      type="checkbox"
                      checked={!cfg.agent_disabled.includes(a.id)}
                      onChange={(e) =>
                        set({
                          agent_disabled: e.target.checked
                            ? cfg.agent_disabled.filter((id) => id !== a.id)
                            : [...cfg.agent_disabled, a.id],
                        })
                      }
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={save}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 text-[14px] font-bold text-white bg-[#1A1A1A] rounded-[10px] py-2.5 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
              {saved ? 'Saved' : 'Save settings'}
            </button>
            {err && <p className="text-[12px] text-[#B91C1C] text-center">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
