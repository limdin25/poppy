"use client";

import { useState } from "react";
import {
  monthlyViews,
  monthlySales,
  monthlyEarnings,
  earningsRange,
} from "@/lib/earnings";
import { watchCopy } from "./copy";

/**
 * The one merged earnings block. Hugo, 2026-08-06: "the estimation should not
 * be based on the number of followers... assume 300 views per video and then
 * increase it by month... this is a snowball."
 *
 * So: no follower input at all. A fixed, modest 300 views per video, the same
 * tested snowball curve the landing page uses (lib/earnings.ts, every constant
 * pinned by tests), and one month slider. The displayed figure is a RANGE and
 * the honesty line stays, because the model is an estimate and a chart makes
 * an estimate look like a measurement.
 */

const BASELINE_VIEWS_PER_VIDEO = 300;
const MONTHS = 12;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function WatchEarnings() {
  const [month, setMonth] = useState(4);

  const point = monthlyEarnings(BASELINE_VIEWS_PER_VIDEO, month, 1);
  const range = earningsRange(point);
  const views = monthlyViews(BASELINE_VIEWS_PER_VIDEO, month, 1);
  const sales = monthlySales(BASELINE_VIEWS_PER_VIDEO, month, 1);

  const bars = Array.from({ length: MONTHS }, (_, i) =>
    monthlyEarnings(BASELINE_VIEWS_PER_VIDEO, i + 1, 1),
  );
  const max = bars[MONTHS - 1];

  return (
    <div data-testid="watch-earnings" className="rounded-3xl bg-white p-5 sm:p-7">
      {/* The snowball, visible: twelve bars that only ever climb. */}
      <div className="flex h-28 items-end gap-1.5" aria-hidden>
        {bars.map((v, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            onClick={() => setMonth(i + 1)}
            className={`flex-1 rounded-t-md transition-colors ${
              i + 1 === month ? "bg-[#E1306C]" : "bg-[#F3D3DF]"
            }`}
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] font-bold text-[#9CA3AF]">
        <span>Month 1</span>
        <span>Month 12</span>
      </div>

      <div className="mt-5">
        <label
          htmlFor="watch-month"
          className="text-[11px] font-black uppercase tracking-[0.14em] text-[#6B7280]"
        >
          {watchCopy.earnings.monthLabel(month)}
        </label>
        <input
          id="watch-month"
          data-testid="earnings-month"
          type="range"
          min={1}
          max={MONTHS}
          step={1}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="mt-2 w-full accent-[#E1306C]"
        />
      </div>

      <p
        data-testid="earnings-range"
        className="mt-4 text-[34px] font-black leading-none tracking-tight text-[#1A1A1A] sm:text-[42px]"
      >
        {watchCopy.earnings.range(usd(range.low), usd(range.high))}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-[#6B7280]">
        {watchCopy.earnings.detail(
          Math.round(views).toLocaleString("en-US"),
          Math.max(1, Math.round(sales)).toLocaleString("en-US"),
        )}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-[#6B7280]">
        {watchCopy.earnings.honesty}
      </p>
    </div>
  );
}
