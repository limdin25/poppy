// The public face at heypubli.com for signed-out visitors: what it is, how
// it works, what it costs, and the sign-in card. White-cream, Inter-heavy,
// one accent, nothing dark.

import { Camera, Mic, Clapperboard, ArrowRight, Check } from 'lucide-react';
import { AuthCard } from '../auth/AuthCard';

const STEPS = [
  {
    icon: Camera,
    title: 'Two photos',
    body: 'Upload a face and your product. We blend them into one photoreal scene, label sharp and readable.',
  },
  {
    icon: Mic,
    title: 'A voice you approve',
    body: 'Type the script, pick a voice or clone your own, and listen. Nothing animates until you approve the take.',
  },
  {
    icon: Clapperboard,
    title: 'A finished ad',
    body: 'The approved voice drives the scene: lips, gestures, product in hand. Vertical, ready to post.',
  },
];

const PRICING_POINTS = [
  'Around 10 finished video ads per pack',
  'Photoreal scene photos included',
  'Voice takes cost pennies, retry freely',
  'Failed generations refund themselves',
  'Credits do not expire',
];

function FlowMockCard({ label, body, icon: Icon }: { label: string; body: string; icon: typeof Camera }) {
  return (
    <div className="flex-1 rounded-2xl border border-hairline bg-white p-4 shadow-card">
      <span className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-page">
        <Icon size={14} className="text-ink-muted" />
      </span>
      <p className="text-[12px] font-bold text-ink">{label}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{body}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-full overflow-y-auto bg-page">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-[15px] font-black tracking-tight text-ink">UGC Factory</span>
        <a
          href="#signin"
          className="rounded-full border border-hairline bg-white px-4 py-1.5 text-[12px] font-semibold text-ink shadow-card"
        >
          Sign in
        </a>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 md:grid-cols-[1.2fr_1fr] md:pt-16">
        <div>
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight text-ink md:text-6xl">
            Your product,
            <br />
            in a creator's hands,
            <br />
            by tonight.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-muted">
            Upload two photos, approve a voice, and get a scroll-stopping video ad. No creators to
            chase, no shoots to book, no editor to wait on.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <a
              href="#signin"
              className="flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-black"
            >
              Make your first ad
              <ArrowRight size={15} />
            </a>
            <span className="text-[12px] text-ink-subtle">£49 pack, about 10 finished ads</span>
          </div>

          <div className="mt-12 hidden items-center gap-3 md:flex">
            <FlowMockCard icon={Camera} label="Photos" body="Face + product become one scene" />
            <ArrowRight size={16} className="shrink-0 text-ink-subtle" />
            <FlowMockCard icon={Mic} label="Voice" body="Approve the take you love" />
            <ArrowRight size={16} className="shrink-0 text-ink-subtle" />
            <FlowMockCard icon={Clapperboard} label="Ad" body="Lip-synced, vertical, yours" />
          </div>
        </div>

        <div id="signin" className="justify-self-center md:justify-self-end">
          <AuthCard />
        </div>
      </section>

      <section className="border-t border-hairline bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
                Step {i + 1}
              </p>
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-page">
                <step.icon size={16} className="text-ink" />
              </span>
              <h2 className="text-[16px] font-extrabold tracking-tight text-ink">{step.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-hairline bg-white p-8 shadow-card">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            One pack, no subscription
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-5xl font-black tracking-tight text-ink">£49</span>
            <span className="text-[13px] text-ink-muted">for 4,900 credits</span>
          </div>
          <ul className="mt-5 space-y-2.5">
            {PRICING_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2 text-[13px] text-ink-muted">
                <Check size={14} className="mt-0.5 shrink-0 text-done" />
                {point}
              </li>
            ))}
          </ul>
          <a
            href="#signin"
            className="mt-6 block rounded-btn bg-ink py-3 text-center text-[13px] font-semibold text-white transition-colors hover:bg-black"
          >
            Get started
          </a>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-[11px] text-ink-subtle">
          <span>UGC Factory</span>
          <span>Made for founders who would rather ship than film.</span>
        </div>
      </footer>
    </div>
  );
}
