import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight, Check, ChevronDown, Star, MessageSquareText, ImageIcon,
  Bot, RefreshCw, Share2, Plug, ShieldCheck, Menu, X, Sparkles,
} from 'lucide-react'
import { DISPLAY, CARD, STAR } from '@/core/ui/brand'

/* ──────────────────────────────────────────────────────────────────────────
   HeyElsie Reviews landing (heyelsie.com).
   Visual language matched to the per-lead VSL page — the surface that actually
   sells (api/vsl/page.ts). White ground, Google blue, heavy neutral display
   type (Inter 900), one blue button carrying the offer, and Google-shaped
   cards. Hugo 2026-07-26 replaced the previous alven.ai cream/copper skin:
   "same colour blue and white, same feeling as the clients vsl page".
   Integrity rule: NO invented testimonials or fake case studies — social proof
   is industry data with sources; demo visuals are labelled as examples.
   ────────────────────────────────────────────────────────────────────────── */

const GO = 'https://go.heyelsie.com'
const SIGNUP = `${GO}/onboarding`

/* palette — mirrors api/vsl/page.ts */
const INK = '#1A1A1A'
const WHITE = '#ffffff'
/* the palest blue wash for alternating sections — never grey, never cream */
const WASH = '#F8FAFD'

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

/** Blue pill button (the VSL page's primary, in pill form for the nav). */
const PILL_BLUE = 'rounded-full bg-[#1a73e8] text-white shadow-[0_6px_18px_rgba(26,115,232,0.30)] transition hover:bg-[#1557b0]'

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
        <Star key={i} className={className} style={{ fill: STAR, color: STAR }} />
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
    <div className="min-h-screen" style={{ backgroundColor: WHITE, color: INK }}>
      {/* ── Blue stat stripe — the VSL page opens on one too ── */}
      <div className="fixed inset-x-0 top-0 z-50 bg-[#1a73e8] px-4 py-2 text-center text-[12.5px] font-extrabold tracking-[0.2px] text-white">
        ⭐ 93% of people read reviews before choosing a local business
      </div>

      {/* ── Nav — white glass pill ── */}
      <header className="fixed inset-x-0 top-[34px] z-40 px-3 pt-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between rounded-full border border-[#E5E7EB] bg-white/85 px-5 py-2.5 shadow-[0_2px_16px_rgba(0,0,0,0.06)] backdrop-blur-[8px]">
          <a href="/" className={`text-lg ${DISPLAY}`}>
            HeyElsie <span className="font-light text-[#6B7280]">Reviews</span>
          </a>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} className="text-sm font-medium text-[#4B5563] transition hover:text-[#1a73e8]">{label}</a>
            ))}
            <a href={GO} className="text-sm font-bold text-[#1A1A1A] transition hover:text-[#1a73e8]">Log in</a>
            <a href={SIGNUP} className={`px-4 py-2 text-sm font-extrabold ${PILL_BLUE}`}>
              Start free trial
            </a>
          </nav>
          <button className="md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="mx-auto mt-2 max-w-5xl rounded-3xl border border-[#E5E7EB] bg-white/95 px-5 py-3 shadow-lg backdrop-blur-[8px] md:hidden">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className="block py-2 text-sm font-medium">{label}</a>
            ))}
            <a href={GO} className="block py-2 text-sm font-bold">Log in</a>
            <a href={SIGNUP} className={`mt-2 block px-4 py-2.5 text-center text-sm font-extrabold ${PILL_BLUE}`}>Start free trial</a>
          </div>
        )}
      </header>

      {/* ── Hero — white, blue accents, one blue button ── */}
      <section className="relative overflow-hidden px-4 pb-16 pt-40 md:pt-48">
        {/* soft blue light instead of the old warm blur */}
        <div aria-hidden className="pointer-events-none absolute -right-40 top-0 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(26,115,232,0.13),transparent)] blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-48 bottom-0 h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(26,115,232,0.09),transparent)] blur-2xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#D6E4FB] bg-[#E8F0FE] px-3 py-1 text-xs font-bold text-[#1557b0]">
                <Star className="h-3.5 w-3.5" style={{ fill: STAR, color: STAR }} />
                Built for UK trades · 10-day free trial
              </span>
            </Reveal>
            <Reveal delay={80}>
              <h1 className={`mt-6 text-balance text-4xl leading-[1.05] sm:text-5xl md:text-6xl ${DISPLAY}`}>
                When someone Googles a plumber, they call the one with{' '}
                <span className="text-[#1a73e8]">400 reviews</span>, not the one with 25.
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-lg text-[#4B5563]">
                HeyElsie Reviews turns your happy customers into Google reviews automatically: personalised texts and
                emails, clever follow-ups, AI replies. Set it up in 10 minutes, then forget it exists.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <a href={SIGNUP} className={`flex w-full items-center justify-center gap-2 px-7 py-3.5 text-base ${PILL_BLUE} sm:w-auto`}>
                  Get my first 25 reviews free <ArrowRight className="h-4 w-4" />
                </a>
                <a href="#how" className="flex w-full items-center justify-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-6 py-3.5 text-base font-bold text-[#1A1A1A] transition hover:border-[#1a73e8] hover:text-[#1a73e8] sm:w-auto">
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-xs font-semibold text-[#6B7280]">10-day free trial · no contract · built for UK trades</p>
            </Reveal>
          </div>

          {/* Right visual: a Google-shaped card (demo data, clearly labelled) */}
          <Reveal delay={200}>
            <div className="relative mx-auto w-full max-w-md">
              <div className={`relative rounded-[2rem] p-6 ${CARD} shadow-[0_18px_50px_rgba(0,0,0,0.10)]`}>
                <p className="absolute right-5 top-4 text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Example</p>
                <div className="flex items-center gap-3">
                  <div className={`grid h-11 w-11 place-items-center rounded-full bg-[#F8FAFD] text-lg text-[#1a73e8] ring-1 ring-[#E5E7EB] ${DISPLAY}`}>G</div>
                  <div>
                    <p className="text-sm font-bold text-[#1A1A1A]">Your Plumbing Co.</p>
                    <p className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                      <span className="font-bold text-[#1A1A1A]">4.9</span>
                      <StarRow className="h-3 w-3" />
                      <span>· 412 Google reviews</span>
                    </p>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFD] p-4 text-sm text-[#1A1A1A]">
                  <StarRow />
                  <p className="mt-2 leading-relaxed">
                    "Came out same day, fixed the boiler, tidied up after. Got a text the next morning, took 10
                    seconds to leave the review."
                  </p>
                  <p className="mt-3 text-xs text-[#6B7280]">(what your next review looks like)</p>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-2xl bg-[#E8F0FE] p-3 text-xs">
                  <span className="font-semibold text-[#4B5563]">This week</span>
                  <span className="font-extrabold text-[#1a73e8]">+27 new reviews</span>
                </div>
              </div>
              <div className="absolute -left-4 -top-5 hidden -rotate-3 rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-xl sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">SMS delivered</p>
                <p className="mt-0.5 text-sm font-bold">"Hi Sally, thanks for…"</p>
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
                <p className={`text-3xl text-[#1a73e8] ${DISPLAY}`}>{num}</p>
                <p className="mt-1 text-xs text-[#6B7280]">{text}<br /><span className="opacity-70">({src})</span></p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ── Pain ── */}
      <section className="px-4 py-20" style={{ backgroundColor: WASH }}>
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
                  <h3 className="mt-3 font-bold">{title}</h3>
                  <p className="mt-2 text-sm text-[#4B5563]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm font-bold">
              {['Win more jobs', 'Climb the Map Pack', 'Build instant trust', 'Stand out on Google'].map((b) => (
                <span key={b} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-[#1a73e8]" /> {b}</span>
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
                  <span className="absolute -top-3 left-5 rounded-full bg-[#1a73e8] px-3 py-0.5 text-xs font-extrabold text-white">{when}</span>
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-2 text-sm text-[#4B5563]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="px-4 py-20" style={{ backgroundColor: WASH }}>
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
                  <p className={`text-5xl text-[#BFD7F5] ${DISPLAY}`}>{n}</p>
                  <h3 className="mt-4 text-xl font-bold">{title}</h3>
                  <p className="mt-2 text-sm text-[#4B5563]">{body}</p>
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
              <span className="flex w-fit items-center gap-1.5 rounded-full border border-[#D6E4FB] bg-[#E8F0FE] px-3 py-1 text-xs font-extrabold text-[#1557b0]">
                <Sparkles className="h-3.5 w-3.5" /> The bit nobody else in the UK does
              </span>
              <h2 className={`mt-4 text-3xl sm:text-4xl ${DISPLAY}`}>A message with their name on your photo</h2>
              <p className="mt-3 text-[#4B5563]">
                "Hi Sally!" rendered onto a photo of your actual team. It feels personal because it is, and personal
                gets opened, clicked and acted on. Plain "please review us" texts get ignored; this doesn't.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {['Your photo, their name, generated automatically for every customer', 'Included with texts and emails', 'One upload, works forever'].map((b) => (
                  <li key={b} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#1a73e8]" /> {b}</li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={150}>
            {/* Phone mock (demo data) */}
            <div className={`mx-auto w-72 rounded-[36px] p-3 ${CARD}`}>
              <div className="mx-auto mb-2 h-1 w-16 rounded-full bg-[#E5E7EB]" />
              <div className="rounded-2xl bg-gradient-to-br from-[#1a73e8] to-[#1557b0] p-6 text-center text-white">
                <p className={`text-xl ${DISPLAY}`}>Hi Sally! 👋</p>
                <p className="mt-1 text-xs text-white/75">(The HeyElsie demo team)</p>
              </div>
              <div className="mt-2 rounded-2xl rounded-tl-sm bg-[#F8FAFD] p-3 text-[13px] leading-snug">
                Hey Sally, thanks for choosing us! Would you mind leaving a quick Google review? It only takes a
                minute and really helps: <span className="text-[#1a73e8] underline">go.heyelsie.com/r/x7k2q</span> Reply STOP to opt out.
              </div>
              <p className="mt-1 text-right text-[10px] text-[#6B7280]">09:41</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Feature grid ── */}
      <section id="features" className="px-4 py-20" style={{ backgroundColor: WASH }}>
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`text-center text-3xl sm:text-4xl ${DISPLAY}`}>Getting reviews has never been this hands-off</h2>
            <p className="mt-2 text-center text-[#6B7280]">The platform does the heavy lifting. All of it.</p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className={`h-full rounded-3xl p-6 ${CARD}`}>
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#E8F0FE] text-[#1a73e8]"><Icon className="h-5 w-5" /></div>
                  <h3 className="mt-4 font-bold">{title}</h3>
                  <p className="mt-2 text-sm text-[#4B5563]">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trades marquee ── */}
      <section className="px-4 py-14">
        <p className="text-center text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-[#6B7280]">Built for every UK trade</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {TRADES.map((t) => (
            <span key={t} className="rounded-full border border-[#E5E7EB] bg-white px-4 py-1.5 text-sm font-medium text-[#4B5563]">{t}</span>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="px-4 py-20" style={{ backgroundColor: WASH }}>
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className={`text-center text-3xl sm:text-4xl ${DISPLAY}`}>Simple pricing. Every feature, every plan.</h2>
            <p className="mt-2 text-center text-[#6B7280]">The only difference is how many customers you can ask each month. 10-day free trial on all plans.</p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PRICING.map((p, i) => (
              <Reveal key={p.name} delay={i * 80}>
                <div className={`relative flex h-full flex-col rounded-[2rem] bg-white p-7 ${p.popular
                  ? 'border-2 border-[#1a73e8] shadow-[0_16px_48px_rgba(26,115,232,0.18)]'
                  : 'border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_rgba(0,0,0,0.05)]'}`}>
                  {p.popular && (
                    <span className="absolute right-6 top-6 rounded-full bg-[#1a73e8] px-3 py-1 text-[11px] font-extrabold text-white">Most popular</span>
                  )}
                  <h3 className="text-sm font-bold text-[#6B7280]">{p.name}</h3>
                  <p className={`mt-3 text-5xl ${DISPLAY}`}>£{p.price}<span className="text-sm font-normal text-[#6B7280]">/mo</span></p>
                  <p className="mt-1 text-sm text-[#4B5563]">{p.requests}</p>
                  <a href={SIGNUP} className={`mt-6 px-4 py-3 text-center text-sm font-extrabold ${PILL_BLUE}`}>
                    Start 10-day free trial
                  </a>
                  <ul className="mt-6 flex-1 space-y-2">
                    {PLAN_BULLETS.map((b) => (
                      <li key={b} className="flex items-center gap-2 text-sm">
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#1a73e8]" />
                        <span className="text-[#4B5563]">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-[#6B7280]">
            Follow-up messages don't count towards your request limit. Multi-location? <a href="mailto:hello@heyelsie.com" className="underline">Email us</a> for a bundle.
          </p>
        </div>
      </section>

      {/* ── Compliance strip ── */}
      <section className="px-4 py-14">
        <div className={`mx-auto flex max-w-3xl items-start gap-4 rounded-3xl p-6 ${CARD}`}>
          <ShieldCheck className="h-8 w-8 shrink-0 text-[#1a73e8]" />
          <div>
            <h3 className="font-bold">Done properly, because your Google profile is worth protecting</h3>
            <p className="mt-1 text-sm text-[#4B5563]">
              No fake reviews, no cherry-picking happy customers, no spam. Every ask goes to real customers with a
              working opt-out, inside UK rules (PECR &amp; the DMCC Act) and Google's policies. Tools that "filter out
              bad reviews" put your profile at risk of suspension. We never will.
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="px-4 py-20" style={{ backgroundColor: WASH }}>
        <div className="mx-auto max-w-3xl">
          <h2 className={`text-center text-3xl sm:text-4xl ${DISPLAY}`}>Questions, answered</h2>
          <div className="mt-10 space-y-3">
            {FAQS.map(([q, a], i) => (
              <button key={q} onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className={`w-full rounded-2xl px-5 py-4 text-left transition hover:border-[#1a73e8] hover:shadow-md ${CARD}`}>
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold">{q}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-[#1a73e8] transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </span>
                {openFaq === i && <span className="mt-2 block text-sm text-[#4B5563]">{a}</span>}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA — the blue block, echoing the VSL's buy button ── */}
      <section className="px-4 py-20">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-[2.5rem] bg-[#1a73e8] p-10 text-center text-white shadow-[0_18px_50px_rgba(26,115,232,0.30)] sm:p-16">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.28),transparent)]" />
          <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 h-[320px] w-[320px] rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.16),transparent)]" />
          <div className="relative">
            <div className="mx-auto mb-5 flex w-fit gap-1">
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="h-6 w-6" style={{ fill: STAR, color: STAR }} />)}
            </div>
            <h2 className={`text-3xl sm:text-5xl ${DISPLAY}`}>Your next 25 reviews are on us</h2>
            <p className="mx-auto mt-4 max-w-lg text-white/80">
              Start the 10-day free trial, upload your customer list, and watch the first reviews arrive before you've
              paid a penny. If it doesn't work for your business, cancel in two clicks.
            </p>
            <a href={SIGNUP} className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-base font-extrabold text-[#1a73e8] shadow-[0_8px_32px_rgba(0,0,0,0.20)] transition hover:bg-[#F8FAFD]">
              Start getting reviews <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[#E5E7EB] px-4 py-12 pb-28 md:pb-12" style={{ backgroundColor: WASH }}>
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <div>
            <p className={`text-base ${DISPLAY}`}>HeyElsie <span className="font-light text-[#6B7280]">Reviews</span></p>
            <p className="mt-2 text-xs text-[#6B7280]">Google review automation for UK service businesses.</p>
          </div>
          <div className="text-sm">
            <p className="font-bold">Explore</p>
            <ul className="mt-2 space-y-1 text-[#4B5563]">
              <li><a href="#features" className="hover:text-[#1a73e8]">Features</a></li>
              <li><a href="#pricing" className="hover:text-[#1a73e8]">Pricing</a></li>
              <li><a href={GO} className="hover:text-[#1a73e8]">Log in</a></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-bold">Company</p>
            <ul className="mt-2 space-y-1 text-[#4B5563]">
              <li><a href="/terms" className="hover:text-[#1a73e8]">Terms</a></li>
              <li><a href="/privacy" className="hover:text-[#1a73e8]">Privacy</a></li>
              <li><a href="mailto:hello@heyelsie.com" className="hover:text-[#1a73e8]">hello@heyelsie.com</a></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-5xl text-[11px] leading-relaxed text-[#6B7280]">
          <p>
            Review requests are sent on behalf of our clients to their own customers only. Every message identifies
            the business and includes an opt-out: reply STOP to any text to unsubscribe instantly. Message and data
            rates may apply. We never solicit, write or filter reviews in breach of Google's policies or the UK
            Digital Markets, Competition and Consumers Act.
          </p>
          <p className="mt-2">© {new Date().getFullYear()} HeyElsie. All rights reserved.</p>
        </div>
      </footer>

      {/* ── Mobile sticky CTA — the VSL page's floating buy button, same idea:
             on a phone the offer should never be more than a thumb away ── */}
      <a
        href={SIGNUP}
        className="fixed inset-x-3 bottom-3 z-50 flex flex-col items-center rounded-[14px] bg-[#1a73e8] px-4 py-2.5 text-center text-white shadow-[0_6px_18px_rgba(26,115,232,0.45)] md:hidden"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <span className="text-[16px] font-extrabold">Start getting reviews</span>
        <span className="text-[11.5px] font-bold opacity-85">10-day free trial · no contract</span>
      </a>
    </div>
  )
}
