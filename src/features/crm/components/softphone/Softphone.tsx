import { useState } from 'react';
import {
  Phone,
  PhoneOff,
  MicOff,
  Mic,
  Maximize2,
  Minus,
  X,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import DialPad from './DialPad';
import { useActiveCallCtx } from '../live-call/ActiveCallContext';
import { useTwilioDevice } from '../../hooks/useTwilioDevice';
import { useSpendLimit } from '../../hooks/useSpendLimit';
import { formatDuration, formatPence } from '../../data/helpers';
import LiveCallScreen from '../live-call/LiveCallScreen';
import { useCurrentAgent } from '../../hooks/useCurrentAgent';
import { useCallerId } from '../../hooks/useCallerId';

export default function Softphone() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const device = useTwilioDevice();
  const {
    phase,
    call,
    durationSec,
    fullScreen,
    setFullScreen,
    startCall,
    endCall,
    muted,
    toggleMute,
    previewContactId,
  } = useActiveCallCtx();
  const spend = useSpendLimit();
  const { agent: me } = useCurrentAgent();
  const { numbers, defaultId, setCallerId } = useCallerId();

  // Drop recovery now lives inside ActiveCallContext (call.on('disconnect')).
  // The launcher status reflects the unified phase + the Twilio device
  // registration state.
  const launcherStatus =
    phase === 'in_call' || phase === 'placing'
      ? phase === 'in_call' ? 'On call' : 'Calling…'
      : device.status === 'ready'
        ? 'Ready'
        : device.status === 'registering'
          ? 'Connecting…'
          : 'Offline';

  const handleCall = (phone: string) => {
    if (spend.isLimitReached) return;
    void startCall('manual-' + Date.now(), phone, 'Direct dial');
    setOpen(false);
  };

  // Render the live call full-screen overlay if the call is active and
  // full-screen mode is on. PR 10: also render in idle-preview mode so
  // the agent can open the call room layout for a contact from the
  // inbox without dialling.
  if ((phase !== 'idle' || previewContactId !== null) && fullScreen) {
    return <LiveCallScreen />;
  }

  // Placing collapsed bar (calling but not yet answered) — black + ringing
  // dot. Hugo's call (2026-04-26): orange "felt off" for a connecting state.
  if (phase === 'placing' && !fullScreen) {
    return (
      <div className="fixed bottom-5 right-5 z-[120] bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-[320px] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#1A1A1A] text-white flex items-center gap-2">
          <span className="relative w-2 h-2 inline-flex">
            <span className="absolute inset-0 rounded-full bg-white animate-ping" />
            <span className="relative w-2 h-2 rounded-full bg-white" />
          </span>
          <span className="text-[13px] font-semibold">Calling…</span>
          <button
            onClick={() => setFullScreen(true)}
            className="ml-auto p-1 hover:bg-white/20 rounded"
            title="Open full call screen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="px-4 py-3">
          <div className="text-[14px] font-semibold text-[#1A1A1A]">{call?.contactName}</div>
          <div className="text-[12px] text-[#6B7280] tabular-nums">{call?.phone}</div>
        </div>
        <div className="px-3 py-2 border-t border-[#E5E7EB]">
          <CallBtn
            icon={<PhoneOff className="w-4 h-4" />}
            label="Cancel"
            onClick={endCall}
            danger
          />
        </div>
      </div>
    );
  }

  // Mid-call collapsed bar
  if (phase === 'in_call' && !fullScreen) {
    return (
      <div className="fixed bottom-5 right-5 z-[120] bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-[320px] overflow-hidden">
        <div className="px-4 py-2.5 bg-[#3C5A87] text-white flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span className="text-[13px] font-semibold">In call · {formatDuration(durationSec)}</span>
          <button
            onClick={() => setFullScreen(true)}
            className="ml-auto p-1 hover:bg-white/20 rounded"
            title="Open full call screen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="px-4 py-3">
          <div className="text-[14px] font-semibold text-[#1A1A1A]">{call?.contactName}</div>
          <div className="text-[12px] text-[#6B7280] tabular-nums">{call?.phone}</div>
        </div>
        <div className="px-3 py-2 border-t border-[#E5E7EB] grid grid-cols-2 gap-1">
          {/* PR 110 (Hugo 2026-04-28): Hold + Xfer were rendered with no
              onClick — pure dead UI. PR 89 removed them from
              LiveCallScreen for the same reason. Removed here too. */}
          <CallBtn
            icon={muted ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            label={muted ? 'Unmute' : 'Mute'}
            onClick={toggleMute}
            active={muted}
          />
          <CallBtn
            icon={<PhoneOff className="w-4 h-4" />}
            label="End"
            onClick={endCall}
            danger
          />
        </div>
      </div>
    );
  }

  // Post-call collapsed (rare — usually full-screen).
  // Guard: only render the orange "Pick outcome" button when there's a real
  // wk_calls.id (UUID) to apply the outcome to. Without it, wk-outcome-apply
  // can't fire and the click would be a no-op + leak fake state.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hasRealCallId = !!call?.callId && UUID_RE.test(call.callId);
  if (phase === 'post_call' && !fullScreen && hasRealCallId) {
    return (
      <button
        onClick={() => setFullScreen(true)}
        className="fixed bottom-5 right-5 z-[120] bg-[#F59E0B] text-white px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 text-[13px] font-semibold"
      >
        <Maximize2 className="w-4 h-4" />
        Pick outcome for {call?.contactName}
      </button>
    );
  }

  // Idle: floating launcher bottom-right
  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-5 right-5 z-[120] bg-[#3C5A87] hover:bg-[#3C5A87]/90 text-white w-12 h-12 rounded-full shadow-[0_8px_24px_rgba(30,154,128,0.35)] flex items-center justify-center"
        title="Open softphone"
      >
        <Phone className="w-5 h-5" strokeWidth={2.2} />
      </button>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[120] bg-white border border-[#E5E7EB] rounded-full shadow-[0_4px_16px_rgba(0,0,0,0.1)] pl-2 pr-4 py-2 flex items-center gap-2 hover:shadow-[0_6px_24px_rgba(0,0,0,0.12)] transition-all"
      >
        <span className="w-8 h-8 rounded-full bg-[#3C5A87] text-white flex items-center justify-center">
          <Phone className="w-4 h-4" strokeWidth={2.2} />
        </span>
        <div className="text-left">
          <div className="text-[12px] font-semibold text-[#1A1A1A]">Softphone</div>
          <div className="text-[10px] text-[#6B7280]">{launcherStatus}</div>
        </div>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[120] bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-[280px] overflow-hidden">
      <div className="px-3 py-2 bg-[#F3F3EE] border-b border-[#E5E7EB] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#3C5A87]" />
        <span className="text-[12px] font-semibold text-[#1A1A1A]">{me?.name ?? 'Agent'}</span>
        <span className="text-[11px] text-[#6B7280]">· Available</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 text-[#6B7280] hover:bg-black/[0.05] rounded"
            title="Minimise"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-[#6B7280] hover:bg-black/[0.05] rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* PR 109 (Hugo 2026-04-28): hide spend numbers + the limit-reached
          banner from non-admins. The internal spend.isLimitReached gate
          on Start (line 54) still blocks the call — only the display
          changes per role. */}
      {spend.isAdmin && (
        <>
          <div className="px-3 py-2 text-[11px] text-[#6B7280] flex items-center justify-between">
            <span>Spend today</span>
            <span className="tabular-nums font-medium text-[#1A1A1A]">
              {formatPence(spend.spendPence)}
              <span className="text-[#9CA3AF]">
                {' / '}∞
              </span>
            </span>
          </div>

          {spend.isLimitReached && (
            <div className="mx-3 mb-2 p-2 bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg text-[11px] text-[#B91C1C]">
              Daily limit reached. Ask admin to raise.
            </div>
          )}
        </>
      )}

      {/* Calling from — picks the caller ID (persists as the agent's default
          number; "Auto" clears it so the server falls back). */}
      <div className="px-3 pt-2">
        <label className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">
          Calling from
        </label>
        <select
          value={defaultId ?? ''}
          onChange={(e) => void setCallerId(e.target.value || null)}
          className="mt-1 w-full text-[12px] text-[#1A1A1A] border border-[#E5E7EB] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
        >
          <option value="">Auto (default number)</option>
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label ? `${n.label} · ${n.e164}` : n.e164}
            </option>
          ))}
        </select>
      </div>

      <div className="px-3 pb-3 pt-2">
        <DialPad onCall={handleCall} />
      </div>

      <div className="px-3 py-2 border-t border-[#E5E7EB] text-[10px] text-[#9CA3AF] space-y-0.5">
        <div className="flex justify-between">
          <span>Mic</span>
          <span className="text-[#6B7280]">Built-in microphone</span>
        </div>
        <div className="flex justify-between">
          <span>Output</span>
          <span className="text-[#6B7280]">Headphones</span>
        </div>
      </div>
    </div>
  );
}

function CallBtn({
  icon,
  label,
  onClick,
  danger,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors',
        active && 'bg-[#3C5A87] text-white',
        !active && danger && 'bg-[#FEF2F2] text-[#EF4444] hover:bg-[#FCA5A5]/40',
        !active && !danger && 'text-[#6B7280] hover:bg-[#F3F3EE]'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
