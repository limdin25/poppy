"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { landingCopy } from "./copy";
import {
  AUDIENCE_BANDS,
  MAX_ACCOUNTS,
  earningsRange,
  monthlyEarnings,
} from "./earnings";

const MONTHS = 12;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Counts a number up when it changes, so a new answer feels given rather than
 *  recalculated. Respects prefers-reduced-motion by landing on the value immediately. */
function useCountUp(target: number, play: boolean) {
  const [shown, setShown] = useState(play ? target : 0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!play) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion is a zero-length animation rather than a separate branch, so the
    // value still lands from inside the frame callback instead of synchronously here.
    const from = fromRef.current;
    const start = performance.now();
    const duration = reduce ? 0 : 700;
    let frame = 0;

    const tick = (now: number) => {
      const t = duration === 0 ? 1 : Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (target - from) * eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, play]);

  return play ? shown : 0;
}

/* The snowball chart. A filled band between the low and high estimate for each month,
   drawn with two plain SVG paths on a 0..100 viewBox so it scales to any card width.
   The band widening to the right is the honest part: it is not decoration, it is the
   range genuinely growing as the numbers get less certain. */
function SnowballChart({
  lows,
  highs,
  play,
}: {
  lows: number[];
  highs: number[];
  play: boolean;
}) {
  const max = Math.max(...highs, 1);
  const x = (i: number) => (i / (MONTHS - 1)) * 100;
  const y = (v: number) => 100 - (v / max) * 92;

  const topLine = highs.map((v, i) => `${x(i)},${y(v)}`).join(" L");
  const bottomLine = [...lows]
    .map((v, i) => ({ v, i }))
    .reverse()
    .map(({ v, i }) => `${x(i)},${y(v)}`)
    .join(" L");
  const band = `M${topLine} L${bottomLine} Z`;
  const mid = lows.map((v, i) => `${x(i)},${y((v + highs[i]) / 2)}`).join(" L");

  return (
    <div className="relative">
      {/* The curve is the same shape for every band, because growth is multiplicative.
          Without this label a bigger selection would redraw an identical picture and the
          tap would feel like it did nothing, so the scale is stated instead of implied. */}
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-medium text-foreground-secondary tabular-nums sm:text-xs">
          {usd(max)}
        </span>
        <span className="text-[10px] text-foreground-secondary sm:text-xs">
          {landingCopy.calculator.chartAxisNote}
        </span>
      </div>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-40 w-full sm:h-52"
        aria-hidden
      >
        <defs>
          <linearGradient id="snowball-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F56040" stopOpacity="0.25" />
            <stop offset="50%" stopColor="#E1306C" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#C13584" stopOpacity="0.38" />
          </linearGradient>
          <linearGradient id="snowball-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F56040" />
            <stop offset="50%" stopColor="#E1306C" />
            <stop offset="100%" stopColor="#C13584" />
          </linearGradient>
          <clipPath id="snowball-reveal">
            <rect x="0" y="0" width={play ? 100 : 0} height="100">
              <animate
                attributeName="width"
                from="0"
                to="100"
                dur="0.9s"
                fill="freeze"
                begin={play ? "0s" : "indefinite"}
              />
            </rect>
          </clipPath>
        </defs>

        <g clipPath="url(#snowball-reveal)">
          <path d={band} fill="url(#snowball-band)" />
          <path
            d={`M${mid}`}
            fill="none"
            stroke="url(#snowball-line)"
            strokeWidth="1.6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>

      <div className="mt-2 flex justify-between text-[10px] text-foreground-secondary sm:text-xs">
        <span>Month 1</span>
        <span>Month 12</span>
      </div>
    </div>
  );
}

export function EarningsCalculator() {
  const copy = landingCopy.calculator;
  const [bandId, setBandId] = useState(AUDIENCE_BANDS[1].id);
  const [accounts, setAccounts] = useState(1);
  const [play, setPlay] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  // The section plays itself the first time it is seen. Nothing is asked before
  // something is given, so there is no empty state and no Calculate button.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer (older browser, or a server-rendered pass hydrating): show the
      // finished state rather than leaving every figure at zero.
      const id = setTimeout(() => setPlay(true), 0);
      return () => clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPlay(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const band = AUDIENCE_BANDS.find((b) => b.id === bandId) ?? AUDIENCE_BANDS[1];

  const { lows, highs, final, first } = useMemo(() => {
    const points = Array.from({ length: MONTHS }, (_, i) =>
      monthlyEarnings(band.viewsPerVideo, i + 1, accounts),
    );
    const ranges = points.map((p) => earningsRange(p));
    return {
      lows: ranges.map((r) => r.low),
      highs: ranges.map((r) => r.high),
      final: ranges[MONTHS - 1],
      first: ranges[0],
    };
  }, [band, accounts]);

  const shownLow = useCountUp(final.low, play);
  const shownHigh = useCountUp(final.high, play);

  return (
    <section
      id="calculator"
      ref={sectionRef}
      className="scroll-mt-24 py-20 md:py-28"
    >
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {copy.title}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-foreground-secondary">
          {copy.subtitle}
        </p>

        <div className="mx-auto mt-8 flex flex-wrap justify-center gap-3">
          {copy.facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm shadow-sm"
            >
              <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text font-bold text-transparent">
                {fact.value}
              </span>
              <span className="text-foreground-secondary">{fact.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          {/* Two questions. Both are things the visitor already knows about themselves,
              so nothing here needs working out. */}
          <div className="rounded-2xl border border-border bg-white p-6 sm:p-7 lg:col-span-2">
            <fieldset>
              <legend className="text-sm font-semibold text-foreground">
                {copy.audienceQuestion}
              </legend>
              <p className="mt-1 text-xs text-foreground-secondary">
                {copy.audienceHint}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {AUDIENCE_BANDS.map((option) => {
                  const active = option.id === bandId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setBandId(option.id)}
                      aria-pressed={active}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "border-transparent bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] text-white shadow-sm"
                          : "border-border bg-white text-foreground-secondary hover:border-accent/40 hover:text-foreground"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-8">
              <legend className="text-sm font-semibold text-foreground">
                {copy.accountsQuestion}
              </legend>
              <p className="mt-1 text-xs text-foreground-secondary">
                {copy.accountsHint}
              </p>
              <div className="mt-4 flex gap-2">
                {Array.from({ length: MAX_ACCOUNTS }, (_, i) => i + 1).map((n) => {
                  const active = n === accounts;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAccounts(n)}
                      aria-pressed={active}
                      aria-label={`${n} ${
                        n === 1 ? copy.accountsUnit.one : copy.accountsUnit.many
                      }`}
                      className={`h-12 flex-1 rounded-xl border text-base font-bold transition-colors ${
                        active
                          ? "border-transparent bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] text-white shadow-sm"
                          : "border-border bg-white text-foreground-secondary hover:border-accent/40 hover:text-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {/* The answer. The word Estimate sits inside the same glance as the money, on
              purpose: it is impossible to read the number without it. */}
          <div className="flex flex-col rounded-2xl border border-border bg-white p-6 sm:p-7 lg:col-span-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold tracking-widest text-foreground-secondary uppercase">
                {copy.resultLabel}
              </span>
              <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-[11px] font-medium text-foreground-secondary">
                {copy.estimateBadge}
              </span>
            </div>

            <div
              data-testid="calc-result"
              className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1"
            >
              <span className="text-4xl font-bold tracking-tight text-foreground tabular-nums sm:text-5xl">
                {usd(shownLow)}
              </span>
              <span className="text-lg text-foreground-secondary">
                {copy.rangeJoin}
              </span>
              <span className="text-4xl font-bold tracking-tight text-foreground tabular-nums sm:text-5xl">
                {usd(shownHigh)}
              </span>
              <span className="text-base text-foreground-secondary">
                {copy.perMonth}
              </span>
            </div>

            <p className="mt-2 text-sm text-foreground">
              {copy.monthOne
                .replace("{low}", usd(first.low))
                .replace("{high}", usd(first.high))}
            </p>

            {final.clamped && (
              <p className="mt-3 rounded-xl border border-border bg-background-secondary px-4 py-3 text-xs leading-relaxed text-foreground-secondary">
                {copy.clampNote}
              </p>
            )}

            <div className="mt-6 flex-1">
              <span className="text-sm font-semibold text-foreground">
                {copy.chartTitle}
              </span>
              <div className="mt-4">
                <SnowballChart lows={lows} highs={highs} play={play} />
              </div>
              <p className="mt-2 text-xs text-foreground-secondary">
                {copy.chartFootnote}
              </p>
            </div>

            <p className="mt-5 text-sm leading-relaxed text-foreground-secondary">
              {copy.snowball}
            </p>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-border bg-background-secondary p-6">
          <p className="text-sm font-semibold text-foreground">
            {copy.disclaimerTitle}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {copy.disclaimerLead}
          </p>
          <ul className="mt-3 space-y-1.5">
            {copy.disclaimerPoints.map((point) => (
              <li
                key={point}
                className="flex gap-2 text-sm leading-relaxed text-foreground-secondary"
              >
                <span aria-hidden className="text-foreground-secondary">
                  •
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
