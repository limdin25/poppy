import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, Check, ChevronDown, Star, MessageSquareText, ImageIcon,
  Bot, RefreshCw, Share2, Plug, ShieldCheck, Menu, X, Sparkles,
} from 'lucide-react'

/* ──────────────────────────────────────────────────────────────────────────
   HeyElsie Reviews landing (heyelsie.com) — structure modelled on the mapped
   competitor anatomy (see REVIEWHARVEST_MAP.md §5), every word ours, UK-first.
   Integrity rule: NO invented testimonials or fake case studies — social proof
   here is industry data with sources, until we have real client results.
   ────────────────────────────────────────────────────────────────────────── */

const GO = 'https://go.heyelsie.com'
const SIGNUP = `${GO}/onboarding`

const NAV_LINKS: [string, string][] = [
  ['Features', '#features'],
  ['How it works', '#how'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
]

function Reveal({
  children, delay = 0, className = '',
}: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}>
      {children}
    </div>
  )
}

const TRADES = ['Plumbers', 'Electricians', 'Roofers', 'Heating engineers', 'Builders', 'Decorators', 'Landscapers', 'Cleaners', 'Locksmiths', 'Pest control', 'Drainage', 'Removals']

const FEATURES = [
  {
    icon: ImageIcon,
    title: 'Personalised image requests',
    body: 'Every request includes a photo of your team with the customer\'s own first name on it — "Hi Sally!". People stop scrolling for their own name, and that\'s why these convert several times better than a plain text.',
  },
  {
    icon: RefreshCw,
    title: 'Review reactivation',
    body: 'Your past customers are sitting on hundreds of reviews you never asked for. Upload the list once — we drip requests out gradually so the reviews land naturally, week after week.',
  },
  {
    icon: MessageSquareText,
    title: 'Smart follow-ups',
    body: 'Most reviews come from the gentle second nudge, not the first ask. Automatic reminders go out days later and stop instantly when the customer clicks or reviews.',
  },
  {
    icon: Bot,
    title: 'AI replies to every review',
    body: 'Great replies help ranking and show customers you care. Our AI drafts a personal reply to each review — 5-star thank-yous post automatically, tricky ones wait for your approval.',
  },
  {
    icon: Share2,
    title: 'Reviews become marketing',
    body: '5-star reviews can auto-post to your Google profile as fresh content, and website widgets show your reviews on your own site — honestly, all of them.',
  },
  {
    icon: Plug,
    title: 'Fits how you already work',
    body: 'Connect your job software through Zapier or our webhook, or just upload a spreadsheet. Finish a job → customer gets asked. Nothing else to remember.',
  },
]

const PRICING = [
  { name: 'Starter', price: 99, requests: 'Up to 50 requests/mo', popular: false },
  { name: 'Growth', price: 179, requests: '50–100 requests/mo', popular: true },
  { name: 'Pro', price: 279, requests: '100–300 requests/mo', popular: false },
]

const PLAN_BULLETS = [
  'Get 4x more reviews', 'Automated texts & emails', 'Review reactivation',
  'Dynamic review follow-ups', 'AI smart messaging', 'Personalised image requests',
  'Auto AI review replies', 'Social review posting', 'Website review widgets',
  'CRM integration & Zapier', 'Unlimited users', '1-1 setup call',
]

const FAQS: [string, string][] = [
  ['Who is HeyElsie Reviews for?', 'UK home-service businesses — plumbers, electricians, roofers, cleaners, landscapers and every trade in between. If your happy customers "keep meaning to" leave a review, this is built for you.'],
  ['How long does setup take?', 'About 10 minutes: connect your Google profile, upload your customer list (or connect your job software), and you\'re live. We also do it with you on a free 1-1 setup call.'],
  ['How quickly will I see reviews?', 'Reactivating a past-customer list typically produces the first new reviews within days. Roughly 10–15% of past customers and 20–30% of fresh customers leave one — your mileage varies with your service quality.'],
  ['Can you hide or filter out bad reviews?', 'No — and be wary of anyone who says they can. Only asking "happy" customers (review gating) breaks Google\'s rules and, since April 2025, UK law (the DMCC Act). We ask ALL your customers, which keeps your profile safe and your rating honest.'],
  ['Do my customers get spammed?', 'Never. One polite ask plus up to three gentle reminders, only during daytime hours, with a working opt-out on every message. Anyone who replies STOP is never contacted again — on any channel.'],
  ['What\'s a "request"? What happens if I hit my limit?', 'A request is one review ask to one customer — follow-ups are free and don\'t count. Hit your monthly cap and sending simply pauses until you upgrade (takes one click) or the month rolls over.'],
  ['Which review sites do you support?', 'Google — because that\'s what wins you jobs. When someone searches "plumber near me", Google reviews decide who they call.'],
  ['Does it work with my job software?', 'Yes — via Zapier (5,000+ apps) or our simple webhook. And a spreadsheet upload always works.'],
  ['Is there a contract?', 'No contract. 14-day free trial, cancel any time from your dashboard.'],
  ['Do you write fake reviews?', 'Absolutely not. Every review comes from your real customers, in their own words. We just make asking effortless.'],
]

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/" className="text-lg font-bold text-brand">HeyElsie <span className="font-light text-ink">Reviews</span></a>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} className="text-sm text-ink-subtle hover:text-ink">{label}</a>
            ))}
            <a href={GO} className="text-sm font-medium text-ink hover:text-brand">Log in</a>
            <a href={SIGNUP} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
              Start free trial
            </a>
          </nav>
          <button className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-bg px-4 py-3 md:hidden">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className="block py-2 text-sm text-ink">{label}</a>
            ))}
            <a href={GO} className="block py-2 text-sm font-medium text-ink">Log in</a>
            <a href={SIGNUP} className="mt-2 block rounded-xl bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white">Start free trial</a>
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-4 pb-16 pt-16 text-center md:pt-24">
        <Reveal>
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            When someone Googles a plumber, they call the one with <span className="text-brand">400 reviews</span> — not the one with 25.
          </h1>
        </Reveal>
        <Reveal delay={100}>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-subtle">
            HeyElsie Reviews turns your happy customers into Google reviews automatically — personalised texts and
            emails, clever follow-ups, AI replies. Set it up in 10 minutes, then forget it exists.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={SIGNUP} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-7 py-3.5 text-base font-semibold text-white shadow-card hover:bg-brand-600 sm:w-auto">
              Get my first 25 reviews free <ArrowRight className="h-4 w-4" />
            </a>
            <a href="#how" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-7 py-3.5 text-base font-medium text-ink hover:bg-elevated sm:w-auto">
              See how it works
            </a>
          </div>
          <p className="mt-3 text-xs text-ink-subtle">14-day free trial · no contract · built for UK trades</p>
        </Reveal>
        {/* Proof strip — industry data, honestly sourced */}
        <Reveal delay={300}>
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              ['93%', 'of people read reviews before choosing a local business', 'BrightLocal'],
              ['88%', 'trust online reviews as much as personal recommendations', 'BrightLocal'],
              ['~4x', 'better response when the ask carries the customer\'s own name', 'industry benchmark'],
            ].map(([num, text, src]) => (
              <div key={text} className="rounded-2xl border border-border bg-surface p-4">
                <p className="text-2xl font-bold text-brand">{num}</p>
                <p className="mt-1 text-xs text-ink-subtle">{text}<br /><span className="opacity-60">— {src}</span></p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Pain ── */}
      <section className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight">Your work deserves more reviews than it gets</h2>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ['😊 → 🤐', 'Happy customers, silent profiles', 'They say "you\'re a lifesaver!" at the door… and never quite get round to the review.'],
              ['⏰', 'You\'ve got no time to chase', 'Between jobs, quotes and invoices, "can you leave us a review?" is the first thing that slips.'],
              ['🥈', 'Rivals with worse work rank higher', 'Google can\'t see your workmanship — it sees review count, rating and freshness. That\'s the whole game.'],
            ].map(([icon, title, body], i) => (
              <Reveal key={title} delay={i * 100}>
                <div className="rounded-2xl border border-border bg-bg p-6">
                  <p className="text-2xl">{icon}</p>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-ink-subtle">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm font-medium text-ink">
              {['Win more jobs', 'Climb the Map Pack', 'Build instant trust', 'Stand out on Google'].map((b) => (
                <span key={b} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500" /> {b}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Timeline ── */}
      <section className="py-16">
        <div className="mx-auto max-w-4xl px-4">
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight">What your first week looks like</h2>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ['Today', 'Ten-minute setup', 'Connect Google, upload your customer list (or link your job software), and your reactivation campaign arms itself.'],
              ['Day 2–3', 'First reviews land', 'Past customers start responding to their personalised asks. AI thank-you replies post automatically.'],
              ['Day 7', 'The flywheel is spinning', 'Every finished job now triggers its own request. Your count climbs weekly — while you do precisely nothing.'],
            ].map(([when, title, body], i) => (
              <Reveal key={when} delay={i * 100}>
                <div className="relative rounded-2xl border border-border bg-surface p-6">
                  <span className="absolute -top-3 left-5 rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-white">{when}</span>
                  <h3 className="mt-2 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-ink-subtle">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight">Set it. Forget it. Watch the stars stack up.</h2>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ['1 · Connect', 'Link your Google Business Profile (you stay in control — it\'s your own Google account) and bring in your customers.'],
              ['2 · Launch', 'Requests drip out gradually — steady and natural, never a suspicious burst of 50 reviews in a day.'],
              ['3 · Automate', 'New customers get asked automatically, non-responders get nudged, every review gets a reply, and your dashboard shows it all.'],
            ].map(([title, body], i) => (
              <Reveal key={title} delay={i * 100}>
                <div className="rounded-2xl bg-bg p-6">
                  <h3 className="font-semibold text-brand">{title}</h3>
                  <p className="mt-2 text-sm text-ink-subtle">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Personalised image showcase ── */}
      <section className="py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 md:grid-cols-2">
          <Reveal>
            <div>
              <span className="flex w-fit items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                <Sparkles className="h-3.5 w-3.5" /> The bit nobody else in the UK does
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight">A message with their name on your photo</h2>
              <p className="mt-3 text-ink-subtle">
                "Hi Sally!" rendered onto a photo of your actual team. It feels personal because it is — and personal
                gets opened, clicked and acted on. Plain "please review us" texts get ignored; this doesn't.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {['Your photo, their name — generated automatically for every customer', 'Included with texts and emails', 'One upload, works forever'].map((b) => (
                  <li key={b} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {b}</li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={150}>
            {/* Phone mock */}
            <div className="mx-auto w-72 rounded-[36px] border-4 border-ink/80 bg-white p-3 shadow-card">
              <div className="mx-auto mb-2 h-1 w-16 rounded-full bg-ink/20" />
              <div className="rounded-xl bg-gradient-to-br from-brand to-brand-600 p-6 text-center text-white">
                <p className="text-xl font-bold">Hi Sally! 👋</p>
                <p className="mt-1 text-xs text-white/80">— The HeyElsie demo team</p>
              </div>
              <div className="mt-2 rounded-2xl rounded-tl-sm bg-border/40 p-3 text-[13px] leading-snug text-ink">
                Hey Sally, thanks for choosing us! Would you mind leaving a quick Google review? It only takes a
                minute and really helps: <span className="text-brand underline">go.heyelsie.com/r/x7k2q</span> Reply STOP to opt out.
              </div>
              <p className="mt-1 text-right text-[10px] text-ink-subtle">09:41</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section id="features" className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight">Getting reviews has never been this hands-off</h2>
            <p className="mt-2 text-center text-ink-subtle">The platform does the heavy lifting. All of it.</p>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="h-full rounded-2xl border border-border bg-bg p-6">
                  <Icon className="h-6 w-6 text-brand" />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-ink-subtle">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trades marquee ── */}
      <section className="py-12">
        <p className="text-center text-sm font-medium uppercase tracking-wide text-ink-subtle">Built for every UK trade</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-4">
          {TRADES.map((t) => (
            <span key={t} className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm text-ink">{t}</span>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-5xl px-4">
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight">Simple pricing. Every feature, every plan.</h2>
            <p className="mt-2 text-center text-ink-subtle">The only difference is how many customers you can ask each month. 14-day free trial on all plans.</p>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PRICING.map((p, i) => (
              <Reveal key={p.name} delay={i * 80}>
                <div className={`relative flex h-full flex-col rounded-2xl border bg-bg p-6 ${p.popular ? 'border-brand shadow-card' : 'border-border'}`}>
                  {p.popular && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-white">Most popular</span>
                  )}
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-2 text-3xl font-bold">£{p.price}<span className="text-sm font-normal text-ink-subtle">/mo</span></p>
                  <p className="text-sm text-ink-subtle">{p.requests}</p>
                  <ul className="mt-4 flex-1 space-y-1.5">
                    {PLAN_BULLETS.map((b) => (
                      <li key={b} className="flex items-center gap-2 text-sm"><Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> {b}</li>
                    ))}
                  </ul>
                  <a href={SIGNUP}
                    className={`mt-5 rounded-xl px-4 py-2.5 text-center text-sm font-semibold ${p.popular ? 'bg-brand text-white hover:bg-brand-600' : 'border border-border text-ink hover:bg-elevated'}`}>
                    Start 14-day free trial
                  </a>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-ink-subtle">
            Follow-up messages don't count towards your request limit. Multi-location? <a href="mailto:hello@heyelsie.com" className="underline">Email us</a> for a bundle.
          </p>
        </div>
      </section>

      {/* ── Compliance strip ── */}
      <section className="py-12">
        <div className="mx-auto flex max-w-3xl items-start gap-4 rounded-2xl border border-border bg-surface p-6 mx-4 sm:mx-auto">
          <ShieldCheck className="h-8 w-8 shrink-0 text-emerald-500" />
          <div>
            <h3 className="font-semibold">Done properly — because your Google profile is worth protecting</h3>
            <p className="mt-1 text-sm text-ink-subtle">
              No fake reviews, no cherry-picking happy customers, no spam. Every ask goes to real customers with a
              working opt-out, inside UK rules (PECR & the DMCC Act) and Google's policies. Tools that "filter out
              bad reviews" put your profile at risk of suspension — we never will.
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="border-t border-border bg-surface py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold tracking-tight">Questions, answered</h2>
          <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-bg">
            {FAQS.map(([q, a], i) => (
              <button key={q} onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-5 py-4 text-left">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{q}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </span>
                {openFaq === i && <span className="mt-2 block text-sm text-ink-subtle">{a}</span>}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-20 text-center">
        <div className="mx-auto max-w-2xl px-4">
          <div className="mx-auto mb-4 flex w-fit gap-1">
            {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="h-6 w-6 fill-amber-400 text-amber-400" />)}
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Your next 25 reviews are on us</h2>
          <p className="mt-3 text-ink-subtle">
            Start the 14-day free trial, upload your customer list, and watch the first reviews arrive before you've
            paid a penny. If it doesn't work for your business, cancel in two clicks.
          </p>
          <a href={SIGNUP} className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-brand px-8 py-4 text-base font-semibold text-white shadow-card hover:bg-brand-600">
            Start getting reviews <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-surface py-10">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 sm:grid-cols-3">
          <div>
            <p className="text-base font-bold text-brand">HeyElsie <span className="font-light text-ink">Reviews</span></p>
            <p className="mt-2 text-xs text-ink-subtle">Google review automation for UK service businesses.</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold">Explore</p>
            <ul className="mt-2 space-y-1 text-ink-subtle">
              <li><a href="#features" className="hover:text-ink">Features</a></li>
              <li><a href="#pricing" className="hover:text-ink">Pricing</a></li>
              <li><a href={GO} className="hover:text-ink">Log in</a></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-semibold">Company</p>
            <ul className="mt-2 space-y-1 text-ink-subtle">
              <li><a href="/terms" className="hover:text-ink">Terms</a></li>
              <li><a href="/privacy" className="hover:text-ink">Privacy</a></li>
              <li><a href="mailto:hello@heyelsie.com" className="hover:text-ink">hello@heyelsie.com</a></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-5xl px-4 text-[11px] leading-relaxed text-ink-subtle">
          <p>
            Review requests are sent on behalf of our clients to their own customers only. Every message identifies
            the business and includes an opt-out — reply STOP to any text to unsubscribe instantly. Message and data
            rates may apply. We never solicit, write or filter reviews in breach of Google's policies or the UK
            Digital Markets, Competition and Consumers Act.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} HeyElsie. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
