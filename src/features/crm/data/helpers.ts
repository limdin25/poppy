// Format helpers shared across smsv2 UI

export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Absolute date + time, pinned to Europe/London.
 *
 *  Hugo 2026-07-26: "of course all with date and time stamp". The explicit zone
 *  is a no-op for a UK browser and the only way the stamp is right on a laptop
 *  set to another zone — which is exactly when someone would be misled.
 *  Pair it with formatRelativeTime: relative as the label, this in the title. */
export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

export function statusColour(status: string): string {
  switch (status) {
    case 'available':
    case 'connected':
    case 'busy':
      return '#3C5A87';
    case 'idle':
    case 'ringing':
    case 'connecting':
      return '#F59E0B';
    case 'offline':
    case 'failed':
      return '#EF4444';
    default:
      return '#9CA3AF';
  }
}
