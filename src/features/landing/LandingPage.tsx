import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, Check, ChevronDown, Star, MessageSquareText, ImageIcon,
  Bot, RefreshCw, Share2, Plug, ShieldCheck, Menu, X, Sparkles,
} from 'lucide-react'

/* ──────────────────────────────────────────────────────────────────────────
   HeyElsie Reviews landing (heyelsie.com).
   Visual language matched to alven.ai: warm cream body (#FEFDFD/#f5f3f1) with
   charcoal text, white hairline cards, black pill buttons, peach/copper
   accents — and a cinematic warm-blurred hero with frosted-glass panels.
   Display type: heavy neutral sans (Inter 900), never a serif.
   Integrity rule: NO invented testimonials or fake case studies — social proof
   is industry data with sources; demo visuals are labelled as examples.
   ────────────────────────────────────────────────────────────────────────── */

const GO = 'https://go.heyelsie.com'
const SIGNUP = `${GO}/onboarding`

/* alven.ai palette */
const INK = '#1a1816'
const CREAM = '#FEFDFD'
const CREAM_ALT = '#f5f3f1'

const NAV_LINKS: [string, string][] = [
  ['Features', '#features'],
  ['How it works', '#how'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
]

/** Progressive-enhancement reveal: content is VISIBLE on first paint (so
 *  crawlers/no-scroll renders always see it); only below-the-fold elements get
 *  hidden after mount and animate in on intersection. */
function Reveal({
  children, delay = 0, className = '',
}: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (el.getBoundingClientRect().top < window.innerHeight) return // in view — never hide
    setHidden(true)
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setHidden(false); io.disconnect() } },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ${hidden ? 'opacity-0 translate-y-6' : 'opacity-100 translate-y-0'} ${className}`}>
      {children}
    </div>
  )
}

/** Display type — deliberately neutral & heavy ("black Arial"), never a serif. */
const DISPLAY = 'font-black tracking-tight'
/** White card on cream, hairline border, soft shadow — alven's card recipe. */
const CARD = 'border border-[#e8e5e1] bg-white shadow-[0_1px_2px_rgba(26,24,22,0.04),0_8px_24px_rgba(26,24,22,0.04)]'
/** Frosted glass over the warm hero backdrop. */
const GLASS = 'border border-white/25 bg-white/10 backdrop-blur-[8px]'
/** Black pill button (alven's primary). */
const PILL_DARK = 'rounded-full bg-[#1a1816] text-[#FEFDFD] transition hover:bg-[#322d2d]'

const TRADES = ['Plumbers', 'Electricians', 'Roofers', 'Heating engineers', 'Builders', 'Decorators', 'Landscapers', 'Cleaners', 'Locksmiths', 'Pest control', 'Drainage', 'Removals']

const FEATURES = [
  {
    icon: ImageIcon,
    title: 'Personalised image requests',
    body: 'Every request includes a photo of your team with the customer\'s own first name on it: "Hi Sally!". People stop scrolling for their own name, and that\'s why these convert several times better than a plain text.',
  },
  {
    icon: RefreshCw,
    title: 'Review reactivation',
    body: 'Your past customers are sitting on hundreds of reviews you never asked for. Upload the list once, and we drip requests out gradually so the reviews land naturally, week after week.',
  },
  {
    icon: MessageSquareText,
    title: 'Smart follow-ups',
    body: 'Most reviews come from the gentle second nudge, not the first ask. Automatic reminders go out days later and stop instantly when the customer clicks or reviews.',
  },
  {
    icon: Bot,
    title: 'AI replies to every review',
    body: 'Great replies help ranking and show customers you care. Our AI drafts a personal reply to each review: 5-star thank-yous post automatically, tricky ones wait for your approval.',
  },
  {
    icon: Share2,
    title: 'Reviews become marketing',
    body: '5-star reviews can auto-post to your Google profile as fresh content, and website widgets show your reviews on your own site (honestly, all of them).',
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
  ['Who is HeyElsie Reviews for?', 'UK home-service businesses: plumbers, electricians, roofers, cleaners, landscapers and every trade in between. If your happy customers "keep meaning to" leave a review, this is built for you.'],
  ['How long does setup take?', 'About 10 minutes: connect your Google profile, upload your customer list (or connect your job software), and you\'re live. We also do it with you on a free 1-1 setup call.'],
  ['How quickly will I see reviews?', 'Reactivating a past-customer list typically produces the first new reviews within days. Roughly 10–15% of past customers and 20–30% of fresh customers leave one. Your mileage varies with your service quality.'],
  ['Can you hide or filter out bad reviews?', 'No, and be wary of anyone who says they can. Only asking "happy" customers (review gating) breaks Google\'s rules and, since April 2025, UK law (the DMCC Act). We ask ALL your customers, which keeps your profile safe and your rating honest.'],
  ['Do my customers get spammed?', 'Never. One polite ask plus up to three gentle reminders, only during daytime hours, with a working opt-out on every message. Anyone who replies STOP is never contacted again, on any channel.'],
  ['What\'s a "request"? What happens if I hit my limit?', 'A request is one review ask to one customer. Follow-ups are free and don\'t count. Hit your monthly cap and sending simply pauses until you upgrade (takes one click) or the month rolls over.'],
  ['Which review sites do you support?', 'Google, because that\'s what wins you jobs. When someone searches "plumber near me", Google reviews decide who they call.'],
  ['Does it work with my job software?', 'Yes, via Zapier (5,000+ apps) or our simple webhook. And a spreadsheet upload always works.'],
  ['Is there a contract?', 'No contract. 10-day free trial, cancel any time from your dashboard.'],
  ['Do you write fake reviews?', 'Absolutely not. Every review comes from your real customers, in their own words. We just make asking effortless.'],
]

function StarRow({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${className} fill-[#e0a468] text-[#e0a468]`} />
      ))}
    </span>
  )
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  useEffect(() => {
    document.title = 'HeyElsie Reviews: Get 4x more Google reviews'
  }, [])

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM, color: INK }}>
      {/* ── Nav — floating white glass pill (alven-style) ── */}
      <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between rounded-full border border-white/40 bg-white/70 px-5 py-2.5 shadow-[0_2px_16px_rgba(26,24,22,0.08)] backdrop-blur-[8px]">
          <a href="/" className={`text-lg ${DISPLAY}`}>
            HeyElsie <span className="font-light text-[#7D7467]">Reviews</span>
          </a>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} className="text-sm text-[#5c5c5c] transition hover:text-[#1a1816]">{label}</a>
            ))}
            <a href={GO} className="text-sm font-medium text-[#1a1816] hover:opacity-70">Log in</a>
            <a href={SIGNUP} className={`px-4 py-2 text-sm font-semibold ${PILL_DARK}`}>
              Start free trial
            </a>
          </nav>
          <button className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="mx-auto mt-2 max-w-5xl rounded-3xl border border-white/40 bg-white/90 px-5 py-3 shadow-lg backdrop-blur-[8px] md:hidden">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className="block py-2 text-sm">{label}</a>
            ))}
            <a href={GO} className="block py-2 text-sm font-medium">Log in</a>
            <a href={SIGNUP} className={`mt-2 block px-4 py-2.5 text-center text-sm font-semibold ${PILL_DARK}`}>Start free trial</a>
          </div>
        )}
      </header>

      {/* ── Hero — cinematic warm blur + frosted glass (alven's hero recipe) ── */}
      <section className="relative overflow-hidden px-4 pb-16 pt-32 md:pt-40" style={{ backgroundColor: '#241c16' }}>
        {/* warm soft-focus backdrop, built from layered gradients */}
        <div aria-hidden className="absolute inset-0"
          style={{ background: 'linear-gradient(115deg, #1f1712 0%, #3d2b1f 30%, #6b4a33 62%, #a97e57 88%, #c8a276 100%)' }} />
        <div aria-hidden className="pointer-events-none absolute -right-40 top-10 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(229,194,169,0.55),transparent)] blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-48 bottom-0 h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(20,14,10,0.7),transparent)] blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute left-1/3 top-1/4 h-[300px] w-[460px] rounded-full bg-[radial-gradient(closest-side,rgba(253,204,169,0.18),transparent)] blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 text-[#FEFDFD] lg:grid-cols-[1.15fr_1fr]">
          <div>
            <Reveal>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-white/85 ${GLASS}`}>
                <Star className="h-3.5 w-3.5 fill-[#FDCCA9] text-[#FDCCA9]" />
                93% of people read reviews before choosing a local business
              </span>
            </Reveal>
            <Reveal delay={80}>
              <h1 className={`mt-6 text-balance text-4xl leading-[1.05] sm:text-5xl md:text-6xl ${DISPLAY}`}>
                When someone Googles a plumber, they call the one with{' '}
                <span className="text-[#FDCCA9]">400 reviews</span>, not the one with 25.
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-lg text-white/75">
                HeyElsie Reviews turns your happy customers into Google reviews automatically: personalised texts and
                emails, clever follow-ups, AI replies. Set it up in 10 minutes, then forget it exists.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <a href={SIGNUP} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#FEFDFD] px-7 py-3.5 text-base font-semibold text-[#1a1816] shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition hover:bg-[#f5f3f1] sm:w-auto">
                  Get my first 25 reviews free <ArrowRight className="h-4 w-4" />
                </a>
                <a href="#how" className={`flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-base font-medium text-white/95 transition hover:bg-white/20 sm:w-auto ${GLASS}`}>
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-xs text-white/55">10-day free trial · no contract · built for UK trades</p>
            </Reveal>
          </div>

          {/* Right visual: frosted review card (demo data, clearly labelled) */}
          <Reveal delay={200}>
            <div className="relative mx-auto w-full max-w-md">
              <div className={`relative rounded-[2rem] p-6 ${GLASS} shadow-[0_24px_80px_rgba(0,0,0,0.35)]`}>
                <p className="absolute right-5 top-4 text-[10px] uppercase tracking-widest text-white/40">Example</p>
                <div className="flex items-center gap-3">
                  <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#E5C2A9] to-[#b27e5a] text-lg text-[#1a1816] ${DISPLAY}`}>G</div>
                  <div>
                    <p className="text-sm font-semibold text-white">Your Plumbing Co.</p>
                    <p className="flex items-center gap-1.5 text-xs text-white/70">
                      <span className="font-semibold text-[#FDCCA9]">4.9</span>
                      <StarRow className="h-3 w-3" />
                      <span>· 412 Google reviews</span>
                    </p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-white/20 bg-white/85 p-4 text-sm text-[#1a1816] backdrop-blur">
                  <StarRow />
                  <p className="mt-2 leading-relaxed">
                    "Came out same day, fixed the boiler, tidied up after. Got a text the next morning, took 10
                    seconds to leave the review."
                  </p>
                  <p className="mt-3 text-xs text-[#7D7467]">(what your next review looks like)</p>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/10 p-3 text-xs backdrop-blur">
                  <span className="text-white/70">This week</span>
                  <span className="font-semibold text-[#FDCCA9]">+27 new reviews</span>
                </div>
              </div>
              <div className="absolute -left-4 -top-5 hidden -rotate-3 rounded-2xl bg-[#FEFDFD] px-4 py-3 text-[#1a1816] shadow-2xl sm:block">
                <p className="text-[10px] uppercase tracking-wider text-[#7D7467]">SMS delivered</p>
                <p className="mt-0.5 text-sm font-semibold">"Hi Sally, thanks for…"</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Proof strip — industry data, honestly sourced ── */}
      <section className="px-4 py-14">
        <Reveal>
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              ['93%', 'of people read reviews before choosing a local business', 'BrightLocal'],
              ['88%', 'trust online reviews as much as personal recommendations', 'BrightLocal'],
              ['~4x', 'better response when the ask carries the customer\'s own name', 'industry benchmark'],
            ].map(([num, text, src]) => (
              <div key={text} className={`rounded-3xl p-5 ${CARD}`}>
                <p className={`text-3xl ${DISPLAY}`}>{num}</p>
                <p className="mt-1 text-xs text-[#7D7467]">{text}<br /><span className="opacity-70">({src})</span></p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Pain ── */}
      <section className="px-4 py-20" style={{ backgroundColor: CREAM_ALT }}>
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`max-w-3xl text-3xl sm:text-4xl ${DISPLAY}`}>Your work deserves more reviews than it gets</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ['😊 → 🤐', 'Happy customers, silent profiles', 'They say "you\'re a lifesaver!" at the door… and never quite get round to the review.'],
              ['⏰', 'You\'ve got no time to chase', 'Between jobs, quotes and invoices, "can you leave us a review?" is the first thing that slips.'],
              ['🥈', 'Rivals with worse work rank higher', 'Google can\'t see your workmanship. It sees review count, rating and freshness. That\'s the whole game.'],
            ].map(([icon, title, body], i) => (
              <Reveal key={title} delay={i * 100}>
                <div className={`h-full rounded-3xl p-6 ${CARD}`}>
                  <p className="text-2xl">{icon}</p>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-[#5c5c5c]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm font-medium">
              {['Win more jobs', 'Climb the Map Pack', 'Build instant trust', 'Stand out on Google'].map((b) => (
                <span key={b} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-[#5ab570]" /> {b}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Timeline ── */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`max-w-3xl text-3xl sm:text-4xl ${DISPLAY}`}>What your first week looks like</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ['Today', 'Ten-minute setup', 'Connect Google, upload your customer list (or link your job software), and your reactivation campaign arms itself.'],
              ['Day 2–3', 'First reviews land', 'Past customers start responding to their personalised asks. AI thank-you replies post automatically.'],
              ['Day 7', 'The flywheel is spinning', 'Every finished job now triggers its own request. Your count climbs weekly, while you do precisely nothing.'],
            ].map(([when, title, body], i) => (
              <Reveal key={when} delay={i * 100}>
                <div className={`relative h-full rounded-3xl p-6 pt-7 ${CARD}`}>
                  <span className="absolute -top-3 left-5 rounded-full bg-[#1a1816] px-3 py-0.5 text-xs font-semibold text-[#FEFDFD]">{when}</span>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-[#5c5c5c]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="px-4 py-20" style={{ backgroundColor: CREAM_ALT }}>
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`max-w-3xl text-3xl sm:text-4xl ${DISPLAY}`}>Set it. Forget it. Watch the stars stack up.</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ['01', 'Connect', 'Link your Google Business Profile (you stay in control, it\'s your own Google account) and bring in your customers.'],
              ['02', 'Launch', 'Requests drip out gradually: steady and natural, never a suspicious burst of 50 reviews in a day.'],
              ['03', 'Automate', 'New customers get asked automatically, non-responders get nudged, every review gets a reply, and your dashboard shows it all.'],
            ].map(([n, title, body], i) => (
              <Reveal key={title} delay={i * 100}>
                <div className={`h-full rounded-3xl p-6 ${CARD}`}>
                  <p className={`text-5xl text-[#E5C2A9] ${DISPLAY}`}>{n}</p>
                  <h3 className="mt-4 text-xl font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-[#5c5c5c]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Personalised image showcase ── */}
      <section className="px-4 py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-12 md:grid-cols-2">
          <Reveal>
            <div>
              <span className="flex w-fit items-center gap-1.5 rounded-full border border-[#E5C2A9] bg-[#FDCCA9]/30 px-3 py-1 text-xs font-semibold text-[#824C25]">
                <Sparkles className="h-3.5 w-3.5" /> The bit nobody else in the UK does
              </span>
              <h2 className={`mt-4 text-3xl sm:text-4xl ${DISPLAY}`}>A message with their name on your photo</h2>
              <p className="mt-3 text-[#5c5c5c]">
                "Hi Sally!" rendered onto a photo of your actual team. It feels personal because it is, and personal
                gets opened, clicked and acted on. Plain "please review us" texts get ignored; this doesn't.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {['Your photo, their name, generated automatically for every customer', 'Included with texts and emails', 'One upload, works forever'].map((b) => (
                  <li key={b} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#5ab570]" /> {b}</li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={150}>
            {/* Phone mock (demo data) */}
            <div className={`mx-auto w-72 rounded-[36px] p-3 ${CARD}`}>
              <div className="mx-auto mb-2 h-1 w-16 rounded-full bg-[#e8e5e1]" />
              <div className="rounded-2xl bg-gradient-to-br from-[#b27e5a] to-[#824C25] p-6 text-center text-[#FEFDFD]">
                <p className={`text-xl ${DISPLAY}`}>Hi Sally! 👋</p>
                <p className="mt-1 text-xs text-white/75">(The HeyElsie demo team)</p>
              </div>
              <div className="mt-2 rounded-2xl rounded-tl-sm bg-[#f5f3f1] p-3 text-[13px] leading-snug">
                Hey Sally, thanks for choosing us! Would you mind leaving a quick Google review? It only takes a
                minute and really helps: <span className="text-[#824C25] underline">go.heyelsie.com/r/x7k2q</span> Reply STOP to opt out.
              </div>
              <p className="mt-1 text-right text-[10px] text-[#7D7467]">09:41</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section id="features" className="px-4 py-20" style={{ backgroundColor: CREAM_ALT }}>
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`text-center text-3xl sm:text-4xl ${DISPLAY}`}>Getting reviews has never been this hands-off</h2>
            <p className="mt-2 text-center text-[#7D7467]">The platform does the heavy lifting. All of it.</p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className={`h-full rounded-3xl p-6 ${CARD}`}>
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#FDCCA9]/40 text-[#824C25]"><Icon className="h-5 w-5" /></div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-[#5c5c5c]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trades marquee ── */}
      <section className="px-4 py-14">
        <p className="text-center text-sm font-medium uppercase tracking-widest text-[#7D7467]">Built for every UK trade</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {TRADES.map((t) => (
            <span key={t} className="rounded-full border border-[#e8e5e1] bg-white px-4 py-1.5 text-sm text-[#5c5c5c]">{t}</span>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="px-4 py-20" style={{ backgroundColor: CREAM_ALT }}>
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`text-center text-3xl sm:text-4xl ${DISPLAY}`}>Simple pricing. Every feature, every plan.</h2>
            <p className="mt-2 text-center text-[#7D7467]">The only difference is how many customers you can ask each month. 10-day free trial on all plans.</p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PRICING.map((p, i) => (
              <Reveal key={p.name} delay={i * 80}>
                <div className={`relative flex h-full flex-col rounded-[2rem] bg-white p-7 ${p.popular
                  ? 'border-2 border-[#1a1816] shadow-[0_16px_48px_rgba(26,24,22,0.12)]'
                  : 'border border-[#e8e5e1] shadow-[0_1px_2px_rgba(26,24,22,0.04),0_8px_24px_rgba(26,24,22,0.04)]'}`}>
                  {p.popular && (
                    <span className="absolute right-6 top-6 rounded-full bg-[#1a1816] px-3 py-1 text-[11px] font-semibold text-[#FEFDFD]">Most popular</span>
                  )}
                  <h3 className="text-sm font-medium text-[#7D7467]">{p.name}</h3>
                  <p className={`mt-3 text-5xl ${DISPLAY}`}>£{p.price}<span className="text-sm font-normal text-[#7D7467]">/mo</span></p>
                  <p className="mt-1 text-sm text-[#5c5c5c]">{p.requests}</p>
                  <a href={SIGNUP} className={`mt-6 px-4 py-3 text-center text-sm font-semibold ${PILL_DARK}`}>
                    Start 10-day free trial
                  </a>
                  <ul className="mt-6 flex-1 space-y-2">
                    {PLAN_BULLETS.map((b) => (
                      <li key={b} className="flex items-center gap-2 text-sm">
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#5ab570]" />
                        <span className="text-[#322d2d]">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-[#7D7467]">
            Follow-up messages don't count towards your request limit. Multi-location? <a href="mailto:hello@heyelsie.com" className="underline">Email us</a> for a bundle.
          </p>
        </div>
      </section>

      {/* ── Compliance strip ── */}
      <section className="px-4 py-14">
        <div className={`mx-auto flex max-w-3xl items-start gap-4 rounded-3xl p-6 ${CARD}`}>
          <ShieldCheck className="h-8 w-8 shrink-0 text-[#5ab570]" />
          <div>
            <h3 className="font-semibold">Done properly, because your Google profile is worth protecting</h3>
            <p className="mt-1 text-sm text-[#5c5c5c]">
              No fake reviews, no cherry-picking happy customers, no spam. Every ask goes to real customers with a
              working opt-out, inside UK rules (PECR & the DMCC Act) and Google's policies. Tools that "filter out
              bad reviews" put your profile at risk of suspension. We never will.
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="px-4 py-20" style={{ backgroundColor: CREAM_ALT }}>
        <div className="mx-auto max-w-3xl">
          <h2 className={`text-center text-3xl sm:text-4xl ${DISPLAY}`}>Questions, answered</h2>
          <div className="mt-10 space-y-3">
            {FAQS.map(([q, a], i) => (
              <button key={q} onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className={`w-full rounded-2xl px-5 py-4 text-left transition hover:shadow-md ${CARD}`}>
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{q}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-[#7D7467] transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </span>
                {openFaq === i && <span className="mt-2 block text-sm text-[#5c5c5c]">{a}</span>}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA — warm glass block echoing the hero ── */}
      <section className="px-4 py-20">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-[2.5rem] p-10 text-center text-[#FEFDFD] sm:p-16" style={{ backgroundColor: '#241c16' }}>
          <div aria-hidden className="absolute inset-0"
            style={{ background: 'linear-gradient(115deg, #1f1712 0%, #3d2b1f 35%, #6b4a33 70%, #a97e57 100%)' }} />
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full bg-[radial-gradient(closest-side,rgba(229,194,169,0.5),transparent)] blur-3xl" />
          <div className="relative">
            <div className="mx-auto mb-5 flex w-fit gap-1">
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="h-6 w-6 fill-[#FDCCA9] text-[#FDCCA9]" />)}
            </div>
            <h2 className={`text-3xl sm:text-5xl ${DISPLAY}`}>Your next 25 reviews are on us</h2>
            <p className="mx-auto mt-4 max-w-lg text-white/75">
              Start the 10-day free trial, upload your customer list, and watch the first reviews arrive before you've
              paid a penny. If it doesn't work for your business, cancel in two clicks.
            </p>
            <a href={SIGNUP} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#FEFDFD] px-8 py-4 text-base font-semibold text-[#1a1816] shadow-[0_8px_32px_rgba(0,0,0,0.3)] transition hover:bg-[#f5f3f1]">
              Start getting reviews <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[#e8e5e1] px-4 py-12" style={{ backgroundColor: CREAM_ALT }}>
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <div>
            <p className={`text-base ${DISPLAY}`}>HeyElsie <span className="font-light text-[#7D7467]">Reviews</span></p>
            <p className="mt-2 text-xs text-[#7D7467]">Google review automation for UK service businesses.</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold">Explore</p>
            <ul className="mt-2 space-y-1 text-[#5c5c5c]">
              <li><a href="#features" className="hover:text-[#1a1816]">Features</a></li>
              <li><a href="#pricing" className="hover:text-[#1a1816]">Pricing</a></li>
              <li><a href={GO} className="hover:text-[#1a1816]">Log in</a></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-semibold">Company</p>
            <ul className="mt-2 space-y-1 text-[#5c5c5c]">
              <li><a href="/terms" className="hover:text-[#1a1816]">Terms</a></li>
              <li><a href="/privacy" className="hover:text-[#1a1816]">Privacy</a></li>
              <li><a href="mailto:hello@heyelsie.com" className="hover:text-[#1a1816]">hello@heyelsie.com</a></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-5xl text-[11px] leading-relaxed text-[#7D7467]">
          <p>
            Review requests are sent on behalf of our clients to their own customers only. Every message identifies
            the business and includes an opt-out: reply STOP to any text to unsubscribe instantly. Message and data
            rates may apply. We never solicit, write or filter reviews in breach of Google's policies or the UK
            Digital Markets, Competition and Consumers Act.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} HeyElsie. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
