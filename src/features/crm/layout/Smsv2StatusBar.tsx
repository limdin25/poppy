import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Bell, Circle, Mail, MessageSquare, Phone, PhoneOff, Trophy,
  Clapperboard, Eye, MousePointerClick, PlayCircle, PoundSterling, Send,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/core/lib/cn';
import { useSpendLimit } from '../hooks/useSpendLimit';
import { useKillSwitch } from '../hooks/useKillSwitch';
import { useAgentPresence } from '../hooks/useAgentPresence';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { useInboxNotifications } from '../hooks/useInboxNotifications';
import {
  useNotifications, desktopPopupsSupported, showDesktopPopup,
  type FunnelNotification,
} from '../hooks/useNotifications';
import { useLeaderboard, RANGE_LABELS, DEFAULT_LEADERBOARD_RANGE } from '../hooks/useLeaderboard';
import { formatPence, formatRelativeTime, formatDuration, formatDateTime } from '../data/helpers';

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  available: { label: 'Available', colour: '#3C5A87' },
  busy: { label: 'In call', colour: '#3C5A87' },
  idle: { label: 'Idle', colour: '#F59E0B' },
  offline: { label: 'Offline', colour: '#9CA3AF' },
};

// Funnel rows carry a `kind`, not a `channel` — without this map every one of
// them would fall through to the message icon.
const KIND_ICON: Record<string, { Icon: typeof Bell; colour: string }> = {
  vsl_sent: { Icon: Send, colour: 'text-[#0EA5E9]' },
  vsl_link_click: { Icon: MousePointerClick, colour: 'text-[#38BDF8]' },
  vsl_open: { Icon: Eye, colour: 'text-[#38BDF8]' },
  vsl_play: { Icon: PlayCircle, colour: 'text-[#F59E0B]' },
  vsl_watched_50: { Icon: Clapperboard, colour: 'text-[#F59E0B]' },
  vsl_watched_90: { Icon: Clapperboard, colour: 'text-[#F97316]' },
  vsl_watched_100: { Icon: Clapperboard, colour: 'text-[#F97316]' },
  vsl_cta_click: { Icon: MousePointerClick, colour: 'text-[#F97316]' },
  vsl_checkout_start: { Icon: PoundSterling, colour: 'text-[#A855F7]' },
  vsl_paid: { Icon: PoundSterling, colour: 'text-[#16A34A]' },
};

/** One shape for both bell sources so the popover renders a single sorted list. */
interface BellItem {
  id: string;
  Icon: typeof Bell;
  colour: string;
  title: string;
  preview: string;
  ts: string;
  to: string;
}

const trim = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3)}…` : s);

export default function Smsv2StatusBar() {
  const spend = useSpendLimit();
  const ks = useKillSwitch();
  const presence = useAgentPresence();
  const { firstName, agent: me } = useCurrentAgent();
  const [open, setOpen] = useState(false);
  const status = STATUS_LABELS[presence.status] ?? STATUS_LABELS.available;

  // PR 109 (Hugo 2026-04-28): top-nav bell + mini leaderboard popovers.
  const notifications = useInboxNotifications();
  // Hugo 2026-07-26: funnel activity shares the SAME bell — a second one would
  // just be a second thing to miss.
  const funnel = useNotifications();
  const navigate = useNavigate();
  const board = useLeaderboard(DEFAULT_LEADERBOARD_RANGE);
  const [bellOpen, setBellOpen] = useState(false);
  const [popupsOn, setPopupsOn] = useState(
    () => desktopPopupsSupported() && Notification.permission === 'granted'
  );
  const [trophyOpen, setTrophyOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const trophyRef = useRef<HTMLDivElement>(null);

  // Close popovers on outside click. Mounting once is enough — the
  // listener is cheap and lets the agent dismiss without an extra btn.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (bellOpen && bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
      if (
        trophyOpen &&
        trophyRef.current &&
        !trophyRef.current.contains(e.target as Node)
      ) {
        setTrophyOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [bellOpen, trophyOpen]);

  // Desktop pop-up for a funnel event. Fired from an effect keyed on the newest
  // unread row — NOT from inside a state updater, which under StrictMode would
  // pop twice in dev.
  const latestId = funnel.latest?.id;
  useEffect(() => {
    if (!funnel.latest) return;
    const n = funnel.latest;
    showDesktopPopup(n, () => navigate(n.link || `/admin/crm/contacts/${n.contactId ?? ''}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId]);

  // One list, newest first. Both sources normalise to BellItem so the popover
  // stays a single renderer.
  const bellItems: BellItem[] = useMemo(() => {
    const fromFunnel: BellItem[] = funnel.items.map((n: FunnelNotification) => {
      const k = KIND_ICON[n.kind] ?? { Icon: Clapperboard, colour: 'text-[#3C5A87]' };
      return {
        id: n.id,
        Icon: k.Icon,
        colour: k.colour,
        title: n.title,
        preview: n.body,
        ts: n.createdAt,
        // Relative path: react-router cannot navigate to an absolute URL.
        to: n.link || `/admin/crm/contacts/${n.contactId ?? ''}`,
      };
    });
    const fromInbox: BellItem[] = notifications.recent.map((n) => ({
      id: n.id,
      Icon: n.channel === 'whatsapp' ? MessageSquare : n.channel === 'email' ? Mail : Phone,
      colour:
        n.channel === 'whatsapp' ? 'text-[#25D366]'
          : n.channel === 'email' ? 'text-[#3B82F6]'
            : 'text-[#3C5A87]',
      title: n.contactName,
      preview: n.body,
      ts: n.createdAt,
      to: `/admin/crm/inbox?contact=${n.contactId}`,
    }));
    const seen = new Set<string>();
    return [...fromFunnel, ...fromInbox]
      .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      .sort((a, b) => +new Date(b.ts) - +new Date(a.ts))
      .slice(0, 30);
  }, [funnel.items, notifications.recent]);

  const unreadTotal = notifications.unread + funnel.unread;

  const askForPopups = useCallback(async () => {
    if (!desktopPopupsSupported()) return;
    try {
      // Must be inside a user gesture — hence a button, not an auto-prompt.
      const p = await Notification.requestPermission();
      setPopupsOn(p === 'granted');
    } catch {
      setPopupsOn(false);
    }
  }, []);

  // Ranked by calls MADE — "who's calling more" (Hugo 2026-07-24). Sourced
  // from the wk_leaderboard RPC so agents see each other, not just
  // themselves (wk_calls RLS clips the raw rows to your own).
  const top5 = useMemo(
    () =>
      [...board.rows]
        .sort((a, b) => b.calls - a.calls || b.answered - a.answered)
        .slice(0, 5),
    [board.rows]
  );

  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-[#F3F3EE]/60 rounded-full border border-[#E5E7EB]">
      {/* PR 109 (Hugo 2026-04-28): hide spend numbers from non-admins.
          Behaviour (limit-reached lockout) still applies — only the
          numbers and progress bar disappear from agents' view. */}
      {spend.isAdmin && (
        <>
          {/* Spend pill */}
          <div className="flex items-center gap-2">
            <div className="text-[11px] text-[#6B7280] font-medium">Spend today</div>
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    spend.percentUsed > 80 ? 'bg-[#EF4444]' : 'bg-[#3C5A87]'
                  )}
                  style={{ width: `${spend.percentUsed}%` }}
                />
              </div>
              <span className="text-[11px] tabular-nums text-[#1A1A1A] font-semibold">
                {formatPence(spend.spendPence)}
                <span className="text-[#9CA3AF] font-normal">
                  {' / '}∞
                </span>
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px h-4 bg-[#E5E7EB]" />
        </>
      )}

      {/* PR 109 ITEM M: Bell + popover. Counts inbound messages received
          since the user opened the page. Click resets unread + reveals
          the last 20 inbound rows with deep-link to the right thread. */}
      <div className="relative" ref={bellRef}>
        <button
          onClick={() => {
            const next = !bellOpen;
            setBellOpen(next);
            // One entry point for both sources; each markAllRead is idempotent.
            if (next) { notifications.markAllRead(); funnel.markAllRead(); }
            if (next) setTrophyOpen(false);
          }}
          className="relative flex items-center justify-center w-7 h-7 rounded-full hover:bg-black/[0.05] text-[#6B7280] hover:text-[#1A1A1A]"
          title="New messages and funnel activity"
          data-testid="statusbar-bell"
        >
          <Bell className="w-3.5 h-3.5" strokeWidth={2} />
          {unreadTotal > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-[#EF4444] text-white text-[9px] font-bold tabular-nums">
              {unreadTotal > 99 ? '99+' : unreadTotal}
            </span>
          )}
        </button>
        {bellOpen && (
          <div
            className="absolute right-0 top-full mt-2 bg-white border border-[#E5E7EB] rounded-xl shadow-lg w-[min(340px,calc(100vw-24px))] max-h-[420px] overflow-y-auto z-50"
            data-testid="statusbar-bell-popover"
          >
            <div className="px-3 py-2 border-b border-[#E5E7EB] text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
              Activity
            </div>
            {/* Desktop pop-ups are opt-in and the browser demands a click to
                ask. Hidden where the API doesn't exist (iOS Safari). */}
            {desktopPopupsSupported() && !popupsOn && (
              <button
                onClick={askForPopups}
                data-testid="enable-desktop-popups"
                className="w-full text-left px-3 py-2 border-b border-[#E5E7EB] bg-[#EEF2F8] text-[11.5px] font-semibold text-[#3C5A87] hover:bg-[#e3ebf5]"
              >
                🔔 Turn on desktop pop-ups — get told the moment a lead watches
              </button>
            )}
            {bellItems.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-[#9CA3AF] italic">
                Nothing new yet.
              </div>
            ) : (
              <ul className="divide-y divide-[#E5E7EB]">
                {bellItems.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={n.to}
                      onClick={() => setBellOpen(false)}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-[#F3F3EE]/50"
                      data-testid={`bell-item-${n.id}`}
                    >
                      <n.Icon className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', n.colour)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-semibold text-[#1A1A1A] truncate">
                            {n.title}
                          </span>
                          {/* Relative reads fast; the exact stamp Hugo asked
                              for is one hover away. */}
                          <span
                            className="text-[10px] text-[#9CA3AF] tabular-nums whitespace-nowrap"
                            title={formatDateTime(n.ts)}
                          >
                            {formatRelativeTime(n.ts)}
                          </span>
                        </div>
                        {n.preview && (
                          <div className="text-[11px] text-[#6B7280] truncate">
                            {trim(n.preview)}
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Speed dialer pause toggle */}
      <SpeedDialerToggle />

      {/* AI coach toggle */}
      <button
        onClick={() => ks.toggle('aiCoach')}
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors',
          ks.aiCoach
            ? 'bg-[#9CA3AF]/20 text-[#6B7280]'
            : 'bg-[#EEF2F8] text-[#3C5A87] hover:bg-[#3C5A87]/15'
        )}
        title={ks.aiCoach ? 'AI Coach disabled (kill switch active)' : 'AI Coach enabled'}
      >
        <Bot className="w-3 h-3" strokeWidth={2} />
        Coach: {ks.aiCoach ? 'OFF' : 'ON'}
      </button>

      {/* PR 109 ITEM N: mini leaderboard popover. Top 5 by calls picked
          up. Hugo's own row gets a green left border so they spot it. */}
      <div className="relative" ref={trophyRef}>
        <button
          onClick={() => {
            setTrophyOpen((o) => !o);
            setBellOpen(false);
          }}
          className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-black/[0.05] text-[#6B7280] hover:text-[#1A1A1A]"
          title={`Leaderboard — ${RANGE_LABELS[DEFAULT_LEADERBOARD_RANGE].toLowerCase()}`}
          data-testid="statusbar-trophy"
        >
          <Trophy className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        {trophyOpen && (
          <div
            className="absolute right-0 top-full mt-2 bg-white border border-[#E5E7EB] rounded-xl shadow-lg w-[460px] z-50"
            data-testid="statusbar-trophy-popover"
          >
            <div className="px-3 py-2 border-b border-[#E5E7EB] flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold flex items-center gap-1">
                <Trophy className="w-3 h-3 text-[#3C5A87]" /> Leaderboard · {RANGE_LABELS[DEFAULT_LEADERBOARD_RANGE].toLowerCase()}
              </span>
              <Link
                to="/admin/crm/leaderboard"
                onClick={() => setTrophyOpen(false)}
                className="text-[10px] font-medium text-[#3C5A87] hover:underline"
              >
                Full board →
              </Link>
            </div>
            <table className="w-full text-[12px]">
              <thead className="bg-[#F3F3EE]/50 text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">Agent</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Made</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Picked</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Msgs</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Avg dur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {top5.map((r, i) => {
                  const isMe = me?.id === r.agentId;
                  return (
                    <tr
                      key={r.agentId}
                      className={cn(
                        isMe && 'bg-[#EEF2F8] border-l-2 border-[#3C5A87]'
                      )}
                    >
                      <td className="px-2 py-1.5 truncate max-w-[160px]">
                        <span className="inline-flex items-center gap-1">
                          {i === 0 && (
                            <Trophy className="w-3 h-3 text-[#F59E0B]" />
                          )}
                          <span className="font-medium text-[#1A1A1A]">
                            {r.agentName}
                          </span>
                          {isMe && (
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-[#3C5A87]">
                              you
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.calls}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-[#3C5A87]">
                        {r.answered}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.messagesSent}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#6B7280]">
                        {r.avgDurationSec > 0
                          ? formatDuration(r.avgDurationSec)
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
                {top5.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-2 py-3 text-center text-[#9CA3AF] italic text-[11px]"
                    >
                      {board.loading ? 'Loading…' : 'No agents set to compete yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-[#E5E7EB]" />

      {/* Presence pill */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-[#1A1A1A] hover:bg-black/[0.04] px-2 py-0.5 rounded-full transition-colors"
        >
          <Circle className="w-2.5 h-2.5" fill={status.colour} stroke={status.colour} />
          {firstName || 'Agent'} · {status.label}
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-[#E5E7EB] rounded-xl shadow-lg p-1 z-50 w-32">
            {(['available', 'idle', 'offline'] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  presence.setStatus(s);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-left rounded-lg hover:bg-[#F3F3EE]"
              >
                <Circle
                  className="w-2.5 h-2.5"
                  fill={STATUS_LABELS[s].colour}
                  stroke={STATUS_LABELS[s].colour}
                />
                {STATUS_LABELS[s].label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const PAUSE_LS_KEY = 'elsie_crm_pause_dialer';

function SpeedDialerToggle() {
  const [paused, setPaused] = useState(
    () => localStorage.getItem(PAUSE_LS_KEY) === 'true'
  );

  const toggle = useCallback(() => {
    const next = !paused;
    setPaused(next);
    localStorage.setItem(PAUSE_LS_KEY, String(next));
    window.dispatchEvent(new Event('elsie-crm-pause-dialer'));
  }, [paused]);

  return (
    <button
      onClick={toggle}
      className={cn(
        'flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors',
        paused
          ? 'bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2]'
          : 'bg-[#EEF2F8] text-[#3C5A87] hover:bg-[#3C5A87]/15'
      )}
      title={paused ? 'Speed dialer paused — press Next to advance' : 'Speed dialer active — auto-advances after each call'}
    >
      <PhoneOff className="w-3 h-3" strokeWidth={2} />
      Speed: {paused ? 'OFF' : 'ON'}
    </button>
  );
}
