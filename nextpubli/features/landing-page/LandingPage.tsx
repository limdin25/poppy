"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { landingCopy } from "./copy";
import { DemoWall } from "./DemoWall";
import { EarningsCalculator } from "./EarningsCalculator";

const HERO_IMAGES_COL1 = [
  "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1598300042247-d088f8ab3a91?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&h=500&fit=crop",
];

const HERO_IMAGES_COL2 = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?w=400&h=500&fit=crop",
];

/* ─── Navbar ─── */
function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-border/50 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
            HeyPubli
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <a href="#influencers" className="text-sm font-medium text-accent">
            {landingCopy.nav.forInfluencers}
          </a>
          <Link
            href="/for-brands"
            className="text-sm text-foreground-secondary transition-colors hover:text-foreground"
          >
            {landingCopy.nav.forBrands}
          </Link>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="text-sm font-medium text-foreground-secondary transition-colors hover:text-foreground"
          >
            {landingCopy.nav.login}
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/25 transition-all hover:shadow-xl hover:shadow-accent/30"
          >
            {landingCopy.nav.cta}
          </Link>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg md:hidden"
          aria-label="Menu"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {mobileOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-white px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            <a href="#influencers" className="text-sm font-medium text-accent">
              {landingCopy.nav.forInfluencers}
            </a>
            <Link href="/for-brands" className="text-sm text-foreground-secondary">
              {landingCopy.nav.forBrands}
            </Link>
            <Link href="/login" className="text-sm text-foreground-secondary">
              {landingCopy.nav.login}
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-3 text-center text-sm font-medium text-white"
            >
              {landingCopy.nav.cta}
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ─── Hero with scrolling images ─── */
function Hero() {
  return (
    <section
      id="influencers"
      className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <div className="mb-4 md:mb-6 inline-flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1.5 text-[10px] font-medium text-foreground-secondary shadow-sm sm:px-3 sm:py-2 sm:text-xs sm:gap-2">
                <svg
                  className="h-3 w-3 sm:h-4 sm:w-4 shrink-0 text-accent"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                Powered by Seedance 2.5
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1.5 text-[10px] font-medium text-foreground-secondary shadow-sm sm:px-3 sm:py-2 sm:text-xs sm:gap-2">
                <svg
                  className="h-3 w-3 sm:h-4 sm:w-4 shrink-0 text-success"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                100% automatic posting
              </div>
            </div>

            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-[3.5rem]">
              {landingCopy.hero.title}{" "}
              <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
                {landingCopy.hero.titleHighlight}
              </span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-foreground-secondary">
              {landingCopy.hero.subtitle}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:gap-4">
              <Link
                href="/signup"
                className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-accent/25 transition-all hover:shadow-xl hover:shadow-accent/30 sm:px-8 sm:py-4 sm:text-base"
              >
                {landingCopy.hero.cta}
              </Link>
              <a
                href="#how-it-works"
                className="flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-background-secondary sm:px-8 sm:py-4 sm:text-base"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                See how it works
              </a>
            </div>
          </div>

          <div className="relative hidden h-[520px] overflow-hidden rounded-3xl lg:block">
            <div className="absolute inset-0 grid grid-cols-2 gap-3">
              <div className="relative overflow-hidden">
                <div
                  className="flex flex-col gap-3"
                  style={{ animation: "scroll-up 25s linear infinite" }}
                >
                  {[...HERO_IMAGES_COL1, ...HERO_IMAGES_COL1].map((src, i) => (
                    <div
                      key={`col1-${i}`}
                      className="relative h-[200px] w-full shrink-0 overflow-hidden rounded-2xl"
                    >
                      <Image
                        src={src}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="200px"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative mt-12 overflow-hidden">
                <div
                  className="flex flex-col gap-3"
                  style={{ animation: "scroll-down 25s linear infinite" }}
                >
                  {[...HERO_IMAGES_COL2, ...HERO_IMAGES_COL2].map((src, i) => (
                    <div
                      key={`col2-${i}`}
                      className="relative h-[200px] w-full shrink-0 overflow-hidden rounded-2xl"
                    >
                      <Image
                        src={src}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="200px"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-white to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-white to-transparent" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Stats (black background) ─── */
function Stats() {
  return (
    <section className="bg-foreground py-16">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-6 sm:grid-cols-3">
        {landingCopy.stats.items.map((stat) => (
          <div key={stat.value} className="text-center">
            <div className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-4xl font-bold tracking-tight text-transparent md:text-5xl">
              {stat.value}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {stat.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* How It Works. Three steps, icon above the words, big number, and a soft cyan thread
   running behind the icons so the eye reads 01 -> 02 -> 03 without being told to. The
   cyan belongs to the icon set, which is why it appears here and nowhere else. */
function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-background-secondary py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {landingCopy.howItWorks.title}
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-foreground-secondary">
          {landingCopy.howItWorks.subtitle}
        </p>

        <div className="relative mt-12 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-8 lg:gap-16">
          {/* The thread sits at the icons' centre line and stops short of the outer
              edges so it reads as a link between them, not a rule across the page. */}
          <div
            aria-hidden
            className="absolute top-11 right-[16%] left-[16%] hidden h-px md:block"
            style={{
              backgroundImage:
                "linear-gradient(to right, transparent, #67E8F9 12%, #22D3EE 50%, #67E8F9 88%, transparent)",
            }}
          />

          {landingCopy.howItWorks.steps.map((step) => (
            <div
              key={step.number}
              className="relative flex flex-col items-center px-2 text-center"
            >
              {/* The icons carry their own transparent rounded corners, so no wrapper
                  background is needed. A padded wrapper produced a visible halo. */}
              <Image
                src={step.icon}
                alt=""
                width={512}
                height={512}
                className="relative z-10 h-[88px] w-[88px] shrink-0"
              />

              <div className="mt-5 text-3xl font-black tracking-tight text-foreground sm:text-4xl">
                {step.number}
              </div>

              <h3 className="mt-1.5 text-lg font-bold text-foreground sm:text-xl">
                {step.title}
              </h3>

              <div className="mt-2 space-y-0.5">
                {step.lines.map((line) => (
                  <p
                    key={line}
                    className="text-sm leading-relaxed text-foreground-secondary sm:text-base"
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Value Props (4 cards) ─── */
const valuePropIcons: Record<string, React.ReactNode> = {
  brands: (
    <svg
      className="h-7 w-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0a2.999 2.999 0 00.68-1.317L5.046 3.09A1.5 1.5 0 016.536 2h10.928a1.5 1.5 0 011.49 1.09l1.367 4.943A3 3 0 0021 9.35"
      />
    </svg>
  ),
  auto: (
    <svg
      className="h-7 w-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
      />
    </svg>
  ),
  payment: (
    <svg
      className="h-7 w-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  ),
  support: (
    <svg
      className="h-7 w-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
      />
    </svg>
  ),
};

function ValueProps() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {landingCopy.valueProps.title}
        </h2>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {landingCopy.valueProps.items.map((item) => (
            <div
              key={item.title}
              className="group rounded-2xl border border-border bg-white p-7 transition-all hover:border-accent/30 hover:shadow-lg"
            >
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-colors group-hover:bg-gradient-to-br group-hover:from-[#F56040] group-hover:via-[#E1306C] group-hover:to-[#C13584] group-hover:text-white">
                {valuePropIcons[item.icon]}
              </div>
              <h3 className="text-lg font-bold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Requirements ─── */
function Requirements() {
  return (
    <section className="bg-background-secondary py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {landingCopy.requirements.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-lg text-foreground-secondary">
          {landingCopy.requirements.subtitle}
        </p>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-white p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
              <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
              Any size
            </div>
            <div className="mt-1 text-sm text-foreground-secondary">
              follower count
            </div>
            <div className="mt-3 text-xs text-foreground-secondary">
              Followers is a dead metric. A small account with real engagement wins
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
              <svg
                className="h-8 w-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6"
                />
              </svg>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
              1%+
            </div>
            <div className="mt-1 text-sm text-foreground-secondary">
              engagement rate
            </div>
            <div className="mt-3 text-xs text-foreground-secondary">
              Real engagement is what converts into sales
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-white p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584]">
              <svg
                className="h-8 w-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z"
                />
              </svg>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
              Pro
            </div>
            <div className="mt-1 text-sm text-foreground-secondary">
              professional communication
            </div>
            <div className="mt-3 text-xs text-foreground-secondary">
              Responsible and aligned with brands
            </div>
          </div>
        </div>

        <div className="mx-auto mt-10 flex flex-wrap justify-center gap-3">
          {landingCopy.requirements.categories.map((cat) => (
            <div
              key={cat.name}
              className="flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="text-lg">{cat.emoji}</span>
              <span className="font-medium text-foreground">{cat.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ Accordion ─── */
function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {landingCopy.faq.title}
        </h2>

        <div className="mt-14 space-y-3">
          {landingCopy.faq.items.map((item, i) => {
            const isOpen = openIndex === i;
            return (
              <div
                key={item.question}
                className="overflow-hidden rounded-2xl border border-border bg-white transition-shadow hover:shadow-sm"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-5 text-left"
                >
                  <span className="pr-4 text-base font-semibold text-foreground">
                    {item.question}
                  </span>
                  <svg
                    className={`h-5 w-5 shrink-0 text-foreground-secondary transition-transform duration-200 ${isOpen ? "rotate-45" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                </button>
                <div
                  className={`grid transition-all duration-200 ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <div className="overflow-hidden">
                    <p className="px-6 pb-5 text-sm leading-relaxed text-foreground-secondary">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Final CTA ─── */
function FinalCta() {
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#F56040] via-[#E1306C] to-[#C13584] px-8 py-16 text-center md:px-16 md:py-24">
          <div className="absolute inset-0">
            <div className="absolute top-0 right-0 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          </div>

          <div className="relative z-10">
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              {landingCopy.finalCta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/80">
              {landingCopy.finalCta.subtitle}
            </p>

            <div className="mt-4 flex items-center justify-center gap-2 sm:mt-6 sm:gap-4">
              <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1.5 text-[10px] font-medium text-white backdrop-blur-sm sm:px-4 sm:py-2 sm:text-xs sm:gap-2">
                <svg
                  className="h-3 w-3 sm:h-4 sm:w-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                Powered by Seedance 2.5
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1.5 text-[10px] font-medium text-white backdrop-blur-sm sm:px-4 sm:py-2 sm:text-xs sm:gap-2">
                <svg
                  className="h-3 w-3 sm:h-4 sm:w-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.73a8.19 8.19 0 004.76 1.52v-3.4a4.85 4.85 0 01-1-.16z" />
                </svg>
                TikTok Partners (Coming soon)
              </div>
            </div>

            <Link
              href="/signup"
              className="mt-6 inline-block rounded-full bg-white px-8 py-3 text-sm font-semibold text-accent shadow-lg transition-all hover:shadow-xl sm:mt-8 sm:px-10 sm:py-4 sm:text-base"
            >
              {landingCopy.finalCta.cta}
            </Link>
            <p className="mt-4 text-sm text-white/60">
              Free forever. No credit card required.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─── */
function Footer() {
  return (
    <footer className="bg-foreground py-16 text-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-12 md:grid-cols-4">
          <div className="md:col-span-2">
            <span className="text-xl font-bold">
              <span className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] bg-clip-text text-transparent">
                HeyPubli
              </span>
            </span>

            <div className="mt-4 flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70">
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                Powered by Seedance 2.5
              </div>
              <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70">
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                100% automatic posting
              </div>
            </div>

            <p className="mt-5 max-w-md text-sm leading-relaxed text-white/50">
              {landingCopy.footer.description}
            </p>
            <p className="mt-3 text-xs text-white/30">{landingCopy.footer.address}</p>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/70">
              {landingCopy.footer.columns.platform.title}
            </h4>
            <ul className="space-y-2.5">
              {landingCopy.footer.columns.platform.links.map((link) => (
                <li key={link}>
                  <a
                    href="#"
                    className="text-sm text-white/50 transition-colors hover:text-white"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/70">
              {landingCopy.footer.columns.resources.title}
            </h4>
            <ul className="space-y-2.5">
              {landingCopy.footer.columns.resources.links.map((link) => (
                <li key={link}>
                  <a
                    href="#"
                    className="text-sm text-white/50 transition-colors hover:text-white"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>

            <h4 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-white/70">
              Contact
            </h4>
            <div className="space-y-1 text-sm text-white/50">
              <p>Brands: {landingCopy.footer.emails.brands}</p>
              <p>Creators: {landingCopy.footer.emails.creators}</p>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-xs text-white/30">{landingCopy.footer.copyright}</p>

          <div className="flex items-center gap-6">
            <a
              href="#"
              className="text-xs text-white/30 transition-colors hover:text-white/60"
            >
              {landingCopy.footer.legal.terms}
            </a>
            <a
              href="#"
              className="text-xs text-white/30 transition-colors hover:text-white/60"
            >
              {landingCopy.footer.legal.privacy}
            </a>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://instagram.com/heypubli"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 transition-colors hover:text-white"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
            </a>
            <a
              href="https://tiktok.com/@heypubli"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 transition-colors hover:text-white"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.73a8.19 8.19 0 004.76 1.52v-3.4a4.85 4.85 0 01-1-.16z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Main Page ─── */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <Hero />
      <Stats />
      <HowItWorks />
      <ValueProps />
      <Requirements />
      <EarningsCalculator />
      <DemoWall />
      <FAQ />
      <FinalCta />
      <Footer />
    </div>
  );
}
