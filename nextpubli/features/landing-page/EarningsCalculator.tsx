"use client";

import { useState } from "react";

import { landingCopy } from "./copy";
import {
  cumulativeByMonth,
  monthlyCommission,
  salesPerMonth,
} from "./earnings";

const usd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/* Interactive replacement for the static "What 40% can look like" cards. The visitor
   sets views and conversion themselves; we only supply the product facts, so the result
   is their discovery, not our promise. */
export function EarningsCalculator() {
  const copy = landingCopy.calculator;
  const [views, setViews] = useState(500);
  const [conversionPct, setConversionPct] = useState(0.1);

  const sales = salesPerMonth(views, conversionPct);
  const monthly = monthlyCommission(views, conversionPct);
  const months = cumulativeByMonth(views, conversionPct, 12);
  const yearTotal = months[11];
  const oneIn = conversionPct > 0 ? Math.round(100 / conversionPct) : 0;

  return (
    <section id="calculator" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {copy.title}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-foreground-secondary">
          {copy.subtitle}
        </p>

        <div className="mx-auto mt-10 flex flex-wrap justify-center gap-3">
          {copy.facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm shadow-sm"
            >
              <span className="font-bold bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
                {fact.value}
              </span>
              <span className="text-foreground-secondary">{fact.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-5">
          <div className="rounded-2xl border border-border bg-white p-7 lg:col-span-2">
            <div>
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor="calc-views"
                  className="text-sm font-semibold text-foreground"
                >
                  {copy.viewsLabel}
                </label>
                <span className="text-sm font-bold text-accent">
                  {views.toLocaleString("en-US")}
                </span>
              </div>
              <input
                id="calc-views"
                type="range"
                min={100}
                max={20000}
                step={100}
                value={views}
                onChange={(e) => setViews(Number(e.target.value))}
                className="mt-3 w-full accent-[#E1306C]"
              />
            </div>

            <div className="mt-8">
              <div className="flex items-baseline justify-between">
                <label
                  htmlFor="calc-conversion"
                  className="text-sm font-semibold text-foreground"
                >
                  {copy.conversionLabel}
                </label>
                <span className="text-sm font-bold text-accent">
                  {conversionPct.toFixed(2)}%
                </span>
              </div>
              <input
                id="calc-conversion"
                type="range"
                min={0.01}
                max={1}
                step={0.01}
                value={conversionPct}
                onChange={(e) => setConversionPct(Number(e.target.value))}
                className="mt-3 w-full accent-[#E1306C]"
              />
              {oneIn > 0 && (
                <p className="mt-2 text-xs text-foreground-secondary">
                  {copy.conversionHint.replace(
                    "{n}",
                    oneIn.toLocaleString("en-US"),
                  )}
                </p>
              )}
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3 border-t border-border pt-6 text-center">
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {Math.round(sales).toLocaleString("en-US")}
                </div>
                <div className="mt-1 text-xs text-foreground-secondary">
                  {copy.outputs.sales}
                </div>
              </div>
              <div>
                <div className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-2xl font-bold text-transparent">
                  {usd(monthly)}
                </div>
                <div className="mt-1 text-xs text-foreground-secondary">
                  {copy.outputs.monthly}
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">
                  {usd(yearTotal)}
                </div>
                <div className="mt-1 text-xs text-foreground-secondary">
                  {copy.outputs.year}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-border bg-white p-7 lg:col-span-3">
            <span className="text-sm font-semibold text-foreground">
              {copy.chartTitle}
            </span>
            <div className="mt-6 flex h-40 flex-1 items-end gap-1.5 sm:gap-2">
              {months.map((total, i) => {
                const max = months[months.length - 1] || 1;
                const pct = Math.max((total / max) * 100, 3);
                return (
                  <div
                    key={i}
                    className="flex h-full flex-1 flex-col items-center gap-1.5"
                  >
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-[#F56040] via-[#E1306C] to-[#C13584] opacity-90"
                        style={{ height: `${pct}%` }}
                        title={usd(total)}
                      />
                    </div>
                    <span className="text-[9px] text-foreground-secondary sm:text-[10px]">
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-sm leading-relaxed text-foreground-secondary">
              {copy.snowball}
            </p>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-foreground-secondary">
          {copy.disclaimer}
        </p>
      </div>
    </section>
  );
}
