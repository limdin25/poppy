export function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

export function formatCountdown(targetDate: Date | string): string {
  const target =
    typeof targetDate === "string" ? new Date(targetDate) : targetDate;
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return "expired";
  const day = Math.floor(diff / 86_400_000);
  const hr = Math.floor((diff % 86_400_000) / 3_600_000);
  if (day > 0) return `${day}d ${hr}h`;
  const min = Math.floor((diff % 3_600_000) / 60_000);
  return `${hr}h ${min}m`;
}
