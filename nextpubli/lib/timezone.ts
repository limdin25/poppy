// Scheduling timezones. The DB always stores UTC; wall times are converted on
// the way in (composer) and out (display/edit) using real IANA rules — London
// and Lisbon observe DST, so fixed offsets would silently drift an hour.

export const SCHEDULING_TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Rio_Branco", label: "Acre (GMT-5)" },
  { value: "Europe/Lisbon", label: "Lisboa" },
  { value: "Europe/London", label: "Londres" },
  { value: "America/New_York", label: "Nova York" },
  { value: "UTC", label: "UTC" },
] as const;

export type SchedulingTimezone = (typeof SCHEDULING_TIMEZONES)[number]["value"];

export function isSchedulingTimezone(tz: string): tz is SchedulingTimezone {
  return SCHEDULING_TIMEZONES.some((t) => t.value === tz);
}

export const DEFAULT_TIMEZONE: SchedulingTimezone = "America/Sao_Paulo";

/** The timezone's UTC offset (ms) at a given instant, DST-aware. */
function tzOffsetAt(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** "2026-06-12T17:00" (datetime-local, wall time in `timeZone`) → UTC ISO. */
export function localToUtcIso(local: string, timeZone: string): string {
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const naive = new Date(`${withSeconds}Z`); // wall time read as if it were UTC
  let offset = tzOffsetAt(naive, timeZone);
  let utc = naive.getTime() - offset;
  // One refinement pass for instants near a DST transition.
  const refined = tzOffsetAt(new Date(utc), timeZone);
  if (refined !== offset) {
    offset = refined;
    utc = naive.getTime() - offset;
  }
  return new Date(utc).toISOString();
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" wall time in `timeZone`, for datetime-local inputs. */
export function utcIsoToLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + tzOffsetAt(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}

// --- São Paulo shortcuts (the app default; Brazil abolished DST in 2019) ---

/** "2026-06-12T17:00" (datetime-local, São Paulo) → "2026-06-12T20:00:00.000Z". */
export function spLocalToUtcIso(local: string): string {
  return localToUtcIso(local, DEFAULT_TIMEZONE);
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" in São Paulo time, for datetime-local inputs. */
export function utcIsoToSpLocal(iso: string): string {
  return utcIsoToLocal(iso, DEFAULT_TIMEZONE);
}

/** UTC ISO → "12/06/2026, 17:00" (pt-BR, São Paulo) for display. */
export function formatSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
