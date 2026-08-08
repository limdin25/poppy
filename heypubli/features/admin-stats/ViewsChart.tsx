"use client";

// The trend line. Hugo, 08 Aug 2026: "always think UI/UX because I like to be
// good to visualize."
//
// Hand-rolled SVG rather than a chart library. Recharts is named in the project
// docs but is not actually installed, and a dependency is not something to add
// on my own initiative for one chart. Sixty lines of SVG has no supply chain,
// no bundle cost and no version to keep up with.
//
// It refuses to draw a line from one point. A single reading rendered as a flat
// line is a claim about a trend, and on day one there is no trend to claim.

export interface TimelinePoint {
  day: string;
  views: number;
  likes: number;
  reach: number;
  videos: number;
}

/** What each day added, from a series of running totals.
 *
 *  The first day is null, not its own total. The series may start mid-history
 *  (it is capped at 30 days), so treating day one's cumulative figure as a
 *  single day's gain would invent an enormous spike out of a window boundary. */
export function dailyGains(points: TimelinePoint[]): Array<number | null> {
  return points.map((p, i) => {
    if (i === 0) return null;
    // Views only accumulate. A fall is Instagram restating, not a loss.
    return Math.max(0, p.views - points[i - 1].views);
  });
}

const fmt = (v: number) => v.toLocaleString("en-GB");

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function ViewsChart({ points }: { points: TimelinePoint[] }) {
  const latest = points[points.length - 1];

  if (!points.length) {
    return (
      <div
        data-testid="views-chart"
        className="border border-border rounded-xl p-6 text-sm text-foreground-secondary"
      >
        Nothing recorded yet. The first reading lands on the hour.
      </div>
    );
  }

  if (points.length === 1) {
    return (
      <div data-testid="views-chart" className="border border-border rounded-xl p-4">
        <div className="text-xs text-foreground-secondary">Views on our videos</div>
        <div className="text-3xl font-bold mt-1">{fmt(latest.views)}</div>
        <div className="text-xs text-foreground-secondary mt-1">
          across {latest.videos} video{latest.videos === 1 ? "" : "s"}, on the{" "}
          <strong>first day of readings</strong>. A trend needs two days, so the line starts
          tomorrow.
        </div>
      </div>
    );
  }

  const gains = dailyGains(points);
  const maxViews = Math.max(...points.map((p) => p.views), 1);
  const maxGain = Math.max(...gains.map((g) => g ?? 0), 1);

  // A fixed viewBox scaled by CSS: crisp at any width, no resize listener.
  const W = 600;
  const H = 170;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const n = points.length;
  const x = (i: number) => PAD_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yLine = (v: number) => PAD_T + innerH - (v / maxViews) * innerH;
  const barW = Math.max(3, Math.min(28, (innerW / n) * 0.55));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${yLine(p.views)}`).join(" ");
  const area = `${line} L${x(n - 1)},${PAD_T + innerH} L${x(0)},${PAD_T + innerH} Z`;

  return (
    <div data-testid="views-chart" className="border border-border rounded-xl p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-xs text-foreground-secondary">Views on our videos</div>
          <div className="text-3xl font-bold">{fmt(latest.views)}</div>
        </div>
        <div className="text-xs text-foreground-secondary text-right">
          <div>
            <span className="inline-block w-2 h-2 rounded-sm bg-accent align-middle" /> gained that
            day
          </div>
          <div>
            <span className="inline-block w-3 h-0.5 bg-accent/50 align-middle" /> running total
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full mt-2"
        style={{ height: 170 }}
        role="img"
        aria-label={`Views on our videos, ${dayLabel(points[0].day)} to ${dayLabel(latest.day)}`}
      >
        <path d={area} fill="currentColor" className="text-accent/10" />
        <path d={line} fill="none" strokeWidth={2} className="stroke-accent/50" />
        {points.map((p, i) => {
          const g = gains[i];
          if (g == null) return null;
          const h = (g / maxGain) * innerH;
          return (
            <rect
              key={p.day}
              x={x(i) - barW / 2}
              y={PAD_T + innerH - h}
              width={barW}
              height={Math.max(1, h)}
              rx={2}
              className="fill-accent"
            >
              <title>
                {dayLabel(p.day)}: {fmt(g)} views that day, {fmt(p.views)} in total across{" "}
                {p.videos} video{p.videos === 1 ? "" : "s"}
              </title>
            </rect>
          );
        })}
        {points.map((p, i) =>
          // Only the ends and a middle tick, or the axis turns into a smear.
          i === 0 || i === n - 1 || (n > 4 && i === Math.floor(n / 2)) ? (
            <text
              key={`t-${p.day}`}
              x={x(i)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className="fill-current text-foreground-secondary"
              style={{ fontSize: 11 }}
            >
              {dayLabel(p.day)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
