import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Play, Check, ChevronDown, Phone, Mail, Sparkles, Mic,
  FileText, Image as ImageIcon, Calendar, Clock, ShieldCheck, Search, Menu, X,
} from 'lucide-react'

const NAV_LINKS: [string, string][] = [
  ['Product', '#features'],
  ['Pricing', '#pricing'],
  ['How it works', '#how'],
  ['Use cases', '#use-cases'],
  ['FAQ', '#faq'],
]

/* ──────────────────────────────────────────────────────────────────────────
   Elsie landing — a faithful clone of the waslo.io homepage design language,
   re-skinned with Elsie's copy (AI receptionist for UK service businesses).
   Palette: warm paper #fafaf7, ink #0a0a0a, mint #00e37a, rust #ff5c2e.
   Type: Geist (sans/display) + Geist Mono. Radius 14px. Scoped under `.wl`.
   ────────────────────────────────────────────────────────────────────────── */

const WhatsApp = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.644a.5.5 0 00.612.612l5.784-1.468A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.332-1.538l-.382-.23-3.432.87.87-3.432-.23-.382A9.95 9.95 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
)

/* Scroll-reveal wrapper — mirrors waslo's translate/opacity entrance. Fails safe to visible. */
function Reveal({
  children, delay = 0, from = 'up', className = '',
}: { children: ReactNode; delay?: number; from?: 'up' | 'left' | 'scale'; className?: string }) {
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
  const hidden = from === 'left' ? 'opacity-0 -translate-x-6' : from === 'scale' ? 'opacity-0 scale-95' : 'opacity-0 translate-y-6'
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${shown ? 'opacity-100 translate-x-0 translate-y-0 scale-100' : hidden} ${className}`}
    >
      {children}
    </div>
  )
}

const FAQS = [
  {
    q: 'Will my customers know they’re talking to AI?',
    a: 'Your call. Most businesses don’t disclose it — Elsie replies in your business’s name and tone, like a member of your team. If you’d rather say so, add it to your welcome message. Elsie never pretends to be human if asked directly (you can configure this).',
  },
  {
    q: 'How does Elsie connect to my WhatsApp?',
    a: 'You scan a QR code with your phone, just like WhatsApp Web — about 30 seconds. No API keys, no Meta verification, no technical setup.',
  },
  {
    q: 'Can Elsie actually answer the phone?',
    a: 'Yes. On Professional, Elsie answers inbound calls with a natural voice, books appointments, takes messages, and logs every call. Your number simply forwards to her.',
  },
  {
    q: 'Can I take over a conversation?',
    a: 'Anytime. If a customer asks for a person, or you want to step in, Elsie hands over and notifies you. You’re always in control.',
  },
  {
    q: 'What if Elsie doesn’t know the answer?',
    a: 'She says so, takes a message, and flags it for you — she never makes up prices or details. Upload your price list, menu and FAQs and she’ll quote them back exactly, citing the source.',
  },
  {
    q: 'Will my WhatsApp number get banned?',
    a: 'No. Elsie replies at a human pace and only to people who message you first — the same as a member of staff using WhatsApp Web.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes — no contracts, no cancellation fees. Cancel from your dashboard in one click.',
  },
]

function FaqItem({ q, a, defaultOpen = false, delay = 0 }: { q: string; a: string; defaultOpen?: boolean; delay?: number }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Reveal delay={delay}>
      <div className="py-7 border-b border-line">
        <button onClick={() => setOpen((o) => !o)} className="w-full flex justify-between items-start gap-8 text-start" aria-expanded={open}>
          <span className="text-[22px] font-medium tracking-tight2 leading-tight flex-1">{q}</span>
          <span className="flex-shrink-0 mt-1.5">
            <ChevronDown className={`w-5 h-5 text-mute transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {open && <div className="text-base text-mute mt-3.5 max-w-[60ch] leading-relaxed">{a}</div>}
      </div>
    </Reveal>
  )
}

const FEATURE_CHANNELS = [
  { label: 'Phone', icon: <Phone className="w-3 h-3" /> },
  { label: 'WhatsApp', icon: <WhatsApp className="w-3 h-3" /> },
  { label: 'Email', icon: <Mail className="w-3 h-3" /> },
]

const USE_CASES = [
  { t: 'Salons & Spas', d: 'Booking, prices and last-minute reschedules — answered across WhatsApp and calls.' },
  { t: 'Dental & Clinics', d: 'Appointment booking, FAQs and opening hours — straight from your knowledge base.' },
  { t: 'Trades & Home services', d: 'Quotes, callouts and availability. Book the job while the lead is still hot.' },
  { t: 'Restaurants', d: 'Reservations, menus and opening hours. Even on a Sunday lunch rush.' },
  { t: 'Estate agents', d: 'Qualify by budget and area. Book viewings overnight from any channel.' },
  { t: 'Vets', d: 'Appointment booking, repeat prescriptions and out-of-hours triage.' },
  { t: 'Driving schools', d: 'Lesson bookings, availability and test-prep questions answered instantly.' },
  { t: 'Garages & MOT', d: 'MOT and service bookings, quotes and courtesy-car requests.' },
]

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="wl min-h-screen bg-paper text-ink antialiased font-sans">
      <style>{CSS}</style>

      {/* ── Announcement bar ── */}
      <div className="bg-ink text-paper py-2.5 text-[13px]">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8 flex items-center justify-center gap-3 sm:gap-4 flex-wrap text-center">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-mint animate-pulse-mint" />
            <span className="font-mono uppercase text-[11px] tracking-wider2 text-mint">New</span>
            <span className="text-paper/90">Simple monthly pricing from £49 — no per-message fees.</span>
          </span>
          <a className="text-mint font-medium inline-flex items-center gap-1 hover:underline" href="#pricing">
            See pricing <ArrowRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 bg-paper/85 backdrop-blur-xl border-b border-line">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8 flex items-center justify-between py-4 sm:py-5">
          <a className="flex items-center gap-2.5 font-display font-bold text-[22px] tracking-tighter" href="#top" onClick={() => setMenuOpen(false)}>
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink text-mint">
              <WhatsApp className="w-4 h-4" />
            </span>
            <span>elsie<span className="text-mint">.</span></span>
          </a>
          <div className="hidden lg:flex items-center gap-8 text-[14.5px] font-medium">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} className="text-ink hover:text-mute transition-colors" href={href}>{label}</a>
            ))}
          </div>
          <div className="hidden lg:flex items-center gap-3">
            <Link to="/login" className="px-4 py-2 text-sm font-medium hover:text-mute transition-colors">Log in</Link>
            <Link to="/register" className="px-4 py-2 rounded-full bg-ink text-paper text-sm font-medium hover:bg-ink-soft transition-colors inline-flex items-center gap-1">
              Start free <span aria-hidden>→</span>
            </Link>
          </div>
          <button className="lg:hidden -mr-2 p-2 text-ink" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden border-t border-line bg-paper px-6 py-3">
            <div className="flex flex-col">
              {NAV_LINKS.map(([label, href]) => (
                <a key={href} className="py-3 text-[15px] font-medium text-ink border-b border-line" href={href} onClick={() => setMenuOpen(false)}>{label}</a>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 pt-4 pb-1">
              <Link to="/login" onClick={() => setMenuOpen(false)} className="w-full text-center px-4 py-3 rounded-full border border-line-strong text-ink text-[15px] font-medium">Log in</Link>
              <Link to="/register" onClick={() => setMenuOpen(false)} className="w-full text-center px-4 py-3 rounded-full bg-ink text-paper text-[15px] font-medium inline-flex items-center justify-center gap-1">Start free <span aria-hidden>→</span></Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section id="top" className="relative overflow-hidden pt-16 pb-0">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <div className="max-w-5xl">
            <Reveal>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-line text-[13px] font-medium mb-7">
                <span className="inline-block w-2 h-2 rounded-full bg-mint animate-pulse-mint" />
                <span>Phone · WhatsApp · Email — one AI receptionist</span>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="font-semibold text-ink leading-[0.92]" style={{ fontSize: 'clamp(36px, 8vw, 116px)', letterSpacing: '-0.04em' }}>
                <span className="block">Replace</span>
                <span className="block">your front</span>
                <span className="block">desk.</span>
                <span className="block relative w-fit text-mute-2 mt-2">
                  For £2,000/mo.
                  <span className="absolute left-[-2%] right-[-2%] top-1/2 bg-rust pointer-events-none -rotate-1 origin-center" style={{ height: 'clamp(4px, 0.6vw, 8px)' }} />
                </span>
                <span className="inline-block bg-mint text-ink px-3 py-1 rounded-[14px] mt-2 w-fit">For £49.</span>
              </h1>
            </Reveal>
          </div>
          <Reveal delay={250}>
            <p className="lead text-ink-soft max-w-[58ch] mt-7">
              An AI receptionist that answers your calls, replies on WhatsApp and email, books appointments, and follows up — 24/7, in your business’s own voice. Trained on your services. So you never miss a customer again.
            </p>
          </Reveal>
          <Reveal delay={400}>
            <div className="flex flex-wrap items-center gap-3 mt-9">
              <Link className="inline-flex items-center gap-2 px-7 py-4 rounded-full bg-mint text-ink font-semibold text-base hover:bg-mint-glow transition-colors" to="/register">
                Start free <ArrowRight className="w-[18px] h-[18px]" />
              </Link>
              <a className="inline-flex items-center gap-2 px-7 py-4 rounded-full border border-line-strong text-ink font-medium text-base hover:bg-surface-2 hover:border-ink transition-colors" href="#demo">
                <Play className="w-[18px] h-[18px]" /> See it work
              </a>
            </div>
          </Reveal>
          <Reveal delay={550}>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-6 text-[13.5px] text-mute">
              <span className="inline-flex items-center gap-1.5"><Check className="w-4 h-4 text-mint" />No card required</span>
              <span className="inline-flex items-center gap-1.5"><Check className="w-4 h-4 text-mint" />5-minute setup</span>
              <span className="inline-flex items-center gap-1.5"><Check className="w-4 h-4 text-mint" />Cancel anytime</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Trust marquee ── */}
      <div className="mt-16 py-10 border-y border-line bg-paper overflow-hidden">
        <div className="flex items-center gap-12 px-6 sm:px-8">
          <span className="font-mono text-[11px] uppercase tracking-wider2 text-mute whitespace-nowrap flex-shrink-0 hidden sm:block">Trusted by UK service businesses</span>
          <div className="flex-1 overflow-hidden relative">
            <div className="absolute start-0 top-0 bottom-0 w-20 bg-gradient-to-r from-paper to-transparent z-10 pointer-events-none" />
            <div className="absolute end-0 top-0 bottom-0 w-20 bg-gradient-to-l from-paper to-transparent z-10 pointer-events-none" />
            <div className="flex gap-14 animate-marquee" style={{ width: 'max-content' }}>
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={i} className="text-[18px] font-semibold tracking-tight text-mute whitespace-nowrap">{m}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── The math ── */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <Reveal>
            <div className="max-w-[720px] mb-12 sm:mb-16">
              <div className="eyebrow mb-4">The math</div>
              <h2 className="h-hero">A 24/7 receptionist that never takes a sick day, a holiday, or a lunch break.</h2>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 border-y border-line">
            <Reveal>
              <div className="p-10 sm:p-14 sm:px-8 border-b md:border-b-0 md:border-e border-line">
                <div className="font-mono text-[11px] uppercase tracking-wider2 text-mute mb-5">A receptionist · monthly</div>
                <div className="relative inline-block">
                  <div className="metric text-mute-2"><span>£2,000</span></div>
                  <span className="absolute left-0 right-0 top-[48%] h-1 bg-rust pointer-events-none" />
                </div>
                <div className="text-[15px] text-mute mt-4 max-w-[30ch]">Salary, NI, pension, holiday and sick cover. They clock off at 5pm. Your customers don’t.</div>
              </div>
            </Reveal>
            <Reveal delay={150}>
              <div className="p-10 sm:p-14 sm:px-8 bg-ink text-paper md:border-x md:border-ink">
                <div className="font-mono text-[11px] uppercase tracking-wider2 text-mute-2 mb-5">Elsie · same work</div>
                <div className="metric text-mint"><span>£49</span><span className="text-[0.4em] text-mute-2 ms-1">/mo</span></div>
                <div className="text-[15px] text-paper/80 mt-4 max-w-[30ch]">One AI receptionist. Phone, WhatsApp and email. 24/7, 365 days a year. Trained on your business.</div>
              </div>
            </Reveal>
            <Reveal delay={300}>
              <div className="p-10 sm:p-14 sm:px-8 border-t md:border-t-0 md:border-s border-line">
                <div className="font-mono text-[11px] uppercase tracking-wider2 text-mute mb-5">You keep</div>
                <div className="metric text-mint-deep"><span>100%</span></div>
                <div className="text-[15px] text-mute mt-4 max-w-[30ch]">Of the enquiries you used to lose after hours. Answered, qualified and booked while you sleep.</div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Live demo ── */}
      <section id="demo" className="py-24 sm:py-32 bg-ink text-paper spotlight-dark relative overflow-hidden">
        <div className="absolute inset-0 grid-bg-dark opacity-50 pointer-events-none" />
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8 relative">
          <Reveal>
            <div className="flex justify-between items-end gap-12 flex-wrap">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider2 text-mint mb-4">// Live demo</div>
                <h2 className="display-2 max-w-[16ch]">Watch an enquiry become a booking. While you sleep.</h2>
              </div>
              <div className="flex-shrink-0">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-surface-2 border border-[#2E2E2C] text-[13px] text-paper">
                  <span className="w-1.5 h-1.5 rounded-full bg-mint inline-block animate-pulse-mint" />
                  Real conversation · 1.2s reply
                </div>
              </div>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-10 sm:gap-16 lg:gap-20 items-center mt-12 sm:mt-16">
            <div className="flex flex-col gap-8">
              {DEMO_POINTS.map((p, i) => (
                <Reveal key={i} from="left" delay={i * 100}>
                  <div className="flex gap-5">
                    <div className="font-mono text-mint text-sm flex-shrink-0 pt-1">{String(i + 1).padStart(2, '0')}</div>
                    <div>
                      <h3 className="h-card text-paper">{p.t}</h3>
                      <p className="text-paper/80 mt-2">{p.d}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal from="scale" delay={200}>
              <PhoneMock />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-28 sm:py-36">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <Reveal>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-20 items-end mb-16 sm:mb-20">
              <div>
                <div className="eyebrow mb-4">One receptionist, every channel</div>
                <h2 className="display-2">An AI receptionist.<br />Not a chatbot.</h2>
              </div>
              <p className="lead">
                Chatbots follow scripts. Elsie understands context, learns from your knowledge base, books appointments by herself, and works across phone, WhatsApp and email — one brain, one inbox, full transparency.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
            {/* 01 — big dark feature */}
            <Reveal className="lg:col-span-12">
              <div className="bg-ink text-paper spotlight-dark rounded-[28px] p-8 sm:p-10 flex flex-col lg:flex-row items-stretch gap-10 lg:gap-12 min-h-[280px]">
                <div className="flex-1 flex flex-col justify-center">
                  <div className="font-mono text-[11px] uppercase tracking-wider2 text-mute-2">// 01</div>
                  <h3 className="text-[32px] sm:text-[44px] font-semibold tracking-tight2 leading-[1.1] mt-3.5 max-w-[16ch]">She reads voice notes, photos and PDFs. Out of the box.</h3>
                  <p className="text-paper/80 text-[15px] mt-3.5 max-w-[60ch]">A customer sends a photo of a leaking boiler. Elsie reads it, works out the job, and books an engineer. No human in the loop. No keywords. Just understanding.</p>
                </div>
                <div className="hidden md:flex w-full lg:w-80 bg-dark-surface-2 rounded-[18px] items-center justify-center relative overflow-hidden">
                  <div className="flex flex-col gap-2 p-6 w-full">
                    <div className="bg-dark-surface rounded-lg px-3 py-3 text-xs font-mono text-mute-2 inline-flex items-center gap-2"><ImageIcon className="w-3.5 h-3.5" /> photo.jpg</div>
                    <div className="bg-dark-surface rounded-lg px-3 py-3 text-xs font-mono text-mute-2 inline-flex items-center gap-2"><Mic className="w-3.5 h-3.5" /> voice-note.opus</div>
                    <div className="bg-dark-surface rounded-lg px-3 py-3 text-xs font-mono text-mute-2 inline-flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> invoice.pdf</div>
                    <div className="text-center py-2 text-mute-2">↓</div>
                    <div className="bg-mint text-ink rounded-lg px-3 py-3 text-[13px] font-semibold">→ understood, replied, logged</div>
                  </div>
                </div>
              </div>
            </Reveal>

            {/* 02 */}
            <FeatureCard span={4} delay={80} num="02" title="HOT / WARM / COLD leads" body="Every enquiry scored after each message. HOT leads ping your phone at 3am. Cold ones get auto-followups.">
              <div className="flex gap-2 mt-4 flex-wrap">
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#FFE5DE] text-rust font-semibold text-xs">HOT 23</span>
                <span className="px-3 py-1.5 rounded-full bg-[#FFF6D6] text-[#B8860B] font-semibold text-xs">WARM 41</span>
                <span className="px-3 py-1.5 rounded-full bg-[#E6F3FF] text-[#3B82F6] font-semibold text-xs">COLD 156</span>
              </div>
            </FeatureCard>

            {/* 03 */}
            <FeatureCard span={4} delay={160} num="03" title="Sounds like your business" body="Set Elsie’s name, tone and rules. A friendly salon or a formal clinic — she replies the way your team would, every single time." />

            {/* 04 */}
            <FeatureCard span={4} delay={80} num="04" title="Human handoff in one word" body={'“Speak to a person” → Elsie pauses, you get a WhatsApp alert, and the conversation lands in your dashboard’s Needs Attention queue.'} />

            {/* 05 */}
            <FeatureCard span={4} delay={160} num="05" title="Auto follow-up cadence" body="Quiet leads get nudged at 24h, 72h, 7d — with messages you control. Most customers book on the second or third touch, not the first." />

            {/* 06 */}
            <FeatureCard span={4} delay={240} num="06" title="Works with the tools you use" body="Google Calendar, Google Sheets, webhooks and WhatsApp alerts. Elsie plugs into what you already run — no new software to learn." />

            {/* 07 — wide with template chips */}
            <FeatureCard span={8} delay={0} num="07" title="Trained on your business in 60 seconds" body="Pick a template (Salon, Dental, Trades, Restaurant, Clinic, General), fill in 4 fields about your business, done. Refine later, or write your own from scratch.">
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {['Salon', 'Dental', 'Trades', 'Restaurant', 'Clinic', 'Custom'].map((t) => (
                  <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-line text-[13px] font-medium justify-center">{t}</span>
                ))}
              </div>
            </FeatureCard>

            {/* 08 */}
            <FeatureCard span={4} delay={100} num="08" title="Real-time dashboard" body="Every call, message, booking and handoff — live in one inbox. No refresh." />

            {/* 09 — channels */}
            <FeatureCard span={6} delay={0} num="09" title="One receptionist. Every channel." body="Phone calls, WhatsApp and email all run through the same brain. Same knowledge, same tone, same memory of the customer across every channel.">
              <div className="mt-5 flex flex-wrap gap-1.5">
                {FEATURE_CHANNELS.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-mute bg-surface border border-line px-2 py-1 rounded">{c.icon}{c.label}</span>
                ))}
              </div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-mute-2 mt-4">3 channels live, 1 conversation</p>
            </FeatureCard>

            {/* 10 */}
            <FeatureCard span={6} delay={100} num="10" title="Trained on YOUR documents" body="Upload your price list, service menu and FAQs. Elsie quotes the exact answer when she replies — citing the source. No made-up prices. No generic answers.">
              <p className="text-[12px] font-mono uppercase tracking-wider text-mute-2 mt-5">Knowledge base · cited answers</p>
            </FeatureCard>

            {/* 11 */}
            <FeatureCard span={7} delay={0} num="11" title="See how Elsie thought" body="Tap ✨ on any reply to see what she understood, the knowledge she used, the tools she called, and why she scored the lead the way she did. Full transparency.">
              <p className="text-[12px] font-mono uppercase tracking-wider text-mute-2 mt-5">intent · knowledge · classification</p>
            </FeatureCard>

            {/* 12 */}
            <FeatureCard span={5} delay={100} num="12" title="Books appointments by herself" body="Connect Google Calendar. Elsie checks your availability, suggests slots, books the appointment, and sends a 24-hour reminder. Without a single tap from you." />
          </div>
        </div>
      </section>

      {/* ── Setup ── */}
      <section id="how" className="py-28 sm:py-36 bg-surface-2">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <Reveal>
            <div className="max-w-[720px]">
              <div className="eyebrow mb-4">Setup</div>
              <h2 className="display-2">From zero to “answering on her own” in 5 minutes.</h2>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16">
            <Reveal delay={0}>
              <div>
                <div className="font-mono text-[13px] text-mute tracking-wider2 uppercase">Step 01</div>
                <h3 className="text-[28px] font-semibold tracking-tight2 mt-4 leading-[1.05]">Connect your channels — phone, WhatsApp, email.</h3>
                <p className="text-mute mt-3 max-w-[34ch]">WhatsApp connects with a QR code in 30 seconds. Email is a Google login. Your phone number forwards to Elsie. Add more channels anytime.</p>
                <div className="mt-8 aspect-[4/3] bg-surface border border-line rounded-[20px] flex items-center justify-center p-6">
                  <div className="p-5 bg-paper rounded-2xl shadow-sm border border-line">
                    <QrGlyph />
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={150}>
              <div>
                <div className="font-mono text-[13px] text-mute tracking-wider2 uppercase">Step 02</div>
                <h3 className="text-[28px] font-semibold tracking-tight2 mt-4 leading-[1.05]">Pick a template, tell Elsie about your business.</h3>
                <p className="text-mute mt-3 max-w-[34ch]">4 fields: what you do, your name, your location, your tone. We pre-fill the rest. Edit anytime in plain English.</p>
                <div className="mt-8 aspect-[4/3] bg-surface border border-line rounded-[20px] p-5 flex flex-col gap-2 font-mono text-[11px]">
                  <div className="bg-surface-2 px-3 py-2 rounded-md"><span className="text-mute">business:</span> Glow Beauty Studio</div>
                  <div className="bg-surface-2 px-3 py-2 rounded-md"><span className="text-mute">role:</span> Salon receptionist</div>
                  <div className="bg-surface-2 px-3 py-2 rounded-md"><span className="text-mute">tone:</span> Friendly, professional</div>
                  <div className="bg-mint text-ink font-semibold px-3 py-2 rounded-md">→ Generating prompt…</div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={300}>
              <div>
                <div className="font-mono text-[13px] text-mute tracking-wider2 uppercase">Step 03</div>
                <h3 className="text-[28px] font-semibold tracking-tight2 mt-4 leading-[1.05]">Walk away. Check your phone for the hot ones.</h3>
                <p className="text-mute mt-3 max-w-[34ch]">Elsie answers, qualifies, books and follows up. You only step in when a HOT lead comes through or someone asks for a human.</p>
                <div className="mt-8 aspect-[4/3] bg-surface border border-line rounded-[20px] p-5 flex flex-col gap-2 justify-center">
                  <div className="bg-ink text-paper px-3 py-2.5 rounded-lg text-xs flex gap-2 items-center">
                    <span className="bg-rust text-white px-2 py-0.5 rounded font-bold text-[10px]">HOT</span>
                    <span>New booking enquiry — ready to book</span>
                  </div>
                  <div className="bg-surface border border-line px-3 py-2.5 rounded-lg text-xs flex gap-2 items-center">
                    <span className="bg-ink text-mint px-2 py-0.5 rounded font-bold text-[10px]">AI</span>
                    <span>Auto-replied to 47 customers today</span>
                  </div>
                  <div className="bg-surface border border-line px-3 py-2.5 rounded-lg text-xs flex gap-2 items-center">
                    <span className="bg-ink text-paper px-2 py-0.5 rounded font-bold text-[10px] inline-flex items-center"><Calendar className="w-3 h-3" /></span>
                    <span>6 appointments booked overnight</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-28 sm:py-36">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <Reveal>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-end">
              <div>
                <div className="eyebrow mb-4">Pricing, finally honest</div>
                <h2 className="display-2">Pay one simple price.<br />No per-message fees.</h2>
              </div>
              <p className="lead">No “seats.” No per-message charges. No tiers stacked with features you don’t need. Pick a plan, connect your channels, and Elsie answers everything.</p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-16">
            {/* Starter */}
            <Reveal delay={0}>
              <div className="p-10 sm:p-12 sm:px-10 rounded-[28px] border border-line bg-surface h-full flex flex-col">
                <h3 className="text-[32px] font-semibold tracking-tight2">Starter</h3>
                <p className="text-mute mt-3.5">For solo owners and small teams getting started. One location, fully covered.</p>
                <div className="flex items-baseline gap-2 mt-6">
                  <span className="text-[64px] font-semibold tracking-tighter leading-none tabular">£49</span>
                  <span className="text-mute text-base">/ month</span>
                </div>
                <div className="mt-2 text-[13px] text-mute">Everything one location needs — calls, WhatsApp &amp; email, all answered.</div>
                <ul className="mt-8 flex flex-col gap-3.5 flex-1">
                  {STARTER.map((f) => <PriceLi key={f}>{f}</PriceLi>)}
                </ul>
                <Link className="mt-9 w-full inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full border border-line-strong text-ink font-medium text-base hover:bg-surface-2 hover:border-ink transition-colors" to="/register">
                  Start free <ArrowRight className="w-[18px] h-[18px]" />
                </Link>
              </div>
            </Reveal>

            {/* Professional — recommended */}
            <Reveal delay={180}>
              <div className="relative p-10 sm:p-12 sm:px-10 rounded-[28px] bg-ink text-paper h-full flex flex-col">
                <div className="absolute -top-3 end-8 bg-mint text-ink px-3 py-1 rounded-full text-xs font-bold font-mono uppercase tracking-wide2">Recommended</div>
                <h3 className="text-[32px] font-semibold tracking-tight2">Professional</h3>
                <p className="text-paper/80 mt-3.5">For busy teams that never want to miss an enquiry. Everything unlocked — including voice.</p>
                <div className="flex items-baseline gap-2 mt-6">
                  <span className="text-[64px] font-semibold tracking-tighter leading-none tabular">£99</span>
                  <span className="text-mute-2 text-base">/ month</span>
                </div>
                <div className="mt-2 text-[13px] text-mute-2">or £79/mo billed annually · cancel anytime</div>
                <ul className="mt-8 flex flex-col gap-3.5 flex-1">
                  {PRO.map((f) => <PriceLi key={f} light>{f}</PriceLi>)}
                </ul>
                <Link className="mt-9 w-full inline-flex items-center justify-center gap-2 px-7 py-4 rounded-full bg-mint text-ink font-semibold text-base hover:bg-mint-glow transition-colors" to="/register?plan=professional">
                  Get Professional <ArrowRight className="w-[18px] h-[18px]" />
                </Link>
              </div>
            </Reveal>
          </div>
          <div className="text-center mt-12">
            <Link className="inline-block text-[15px] font-medium border-b border-ink pb-0.5" to="/register">See full pricing — including Business at £199/mo →</Link>
          </div>
        </div>
      </section>

      {/* ── Built for ── */}
      <section id="use-cases" className="py-24 sm:py-32 bg-ink text-paper spotlight-dark">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <Reveal>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-end">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-wider2 text-mute-2 mb-4">Built for</div>
                <h2 className="display-2">Any business that talks to customers.</h2>
              </div>
              <div>
                <p className="lead text-paper/80">Phone, WhatsApp, email — wherever your customers reach you, Elsie answers. 24/7, every day of the year.</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {FEATURE_CHANNELS.map((c) => (
                    <span key={c.label} className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-paper/70 bg-white/[0.04] border border-white/10 rounded px-2 py-1">{c.icon}{c.label}</span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-16">
            {USE_CASES.map((u, i) => (
              <Reveal key={u.t} delay={(i % 4) * 60}>
                <div className="bg-dark-surface border border-[#1f1f1e] rounded-[20px] p-7 min-h-[200px] flex flex-col justify-between transition-all hover:border-mint hover:bg-dark-surface-2 h-full">
                  <span className="w-9 h-9 rounded-full bg-white/[0.05] border border-white/10 inline-flex items-center justify-center text-mint">{USE_CASE_ICONS[i]}</span>
                  <div>
                    <h4 className="text-lg font-semibold tracking-tight2 text-paper">{u.t}</h4>
                    <p className="text-[13px] text-mute-2 mt-1.5 leading-relaxed">{u.d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-28 sm:py-36">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-12 lg:gap-20 items-start">
            <Reveal>
              <div>
                <div className="eyebrow mb-4">FAQ</div>
                <h2 className="h-hero">Questions, answered before you ask.</h2>
              </div>
            </Reveal>
            <div className="max-w-[880px] w-full">
              {FAQS.map((f, i) => (
                <FaqItem key={i} q={f.q} a={f.a} defaultOpen={i === 0} delay={i * 50} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-32 sm:py-40 bg-mint text-ink relative overflow-hidden">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <Reveal>
            <h2 className="font-semibold leading-[0.9] max-w-[14ch]" style={{ fontSize: 'clamp(48px, 8vw, 132px)', letterSpacing: '-0.045em' }}>Stop missing calls and messages at 2 AM.</h2>
          </Reveal>
          <Reveal delay={200}>
            <div className="flex flex-wrap gap-4 mt-12">
              <Link className="inline-flex items-center gap-2 px-8 py-5 rounded-full bg-ink text-paper font-semibold text-[17px] hover:bg-ink-soft transition-colors" to="/register">
                Start free <ArrowRight className="w-5 h-5" />
              </Link>
              <Link className="inline-flex items-center gap-2 px-8 py-5 rounded-full bg-black/10 text-ink font-medium text-[17px] hover:bg-black/[0.15] transition-colors" to="/register">
                Talk to us →
              </Link>
            </div>
          </Reveal>
          <Reveal delay={300}>
            <p className="mt-8 text-sm text-ink/80">No card required · No setup fee · 5-minute setup</p>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-ink text-paper pt-20 pb-8">
        <div className="mx-auto max-w-[1320px] px-6 sm:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-10 sm:gap-12">
            <div className="sm:col-span-2 lg:col-span-1">
              <a className="inline-flex items-center gap-3" href="#top">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-paper text-ink"><WhatsApp className="w-5 h-5" /></span>
                <span className="text-4xl font-bold tracking-tighter leading-none">elsie<span className="text-mint">.</span></span>
              </a>
              <p className="text-paper/80 text-sm max-w-[32ch] mt-6">Your AI receptionist. Built for businesses that refuse to miss a single call, message or booking.</p>
            </div>
            <FooterCol title="Product" links={[['Features', '#features'], ['Pricing', '#pricing'], ['Use cases', '#use-cases'], ['How it works', '#how']]} />
            <FooterCol title="Company" links={[['About', '#top'], ['Contact', '/register'], ['Log in', '/login'], ['Start free', '/register']]} />
            <FooterCol title="Legal" links={[['Privacy', '/privacy'], ['Terms', '/terms'], ['DPA', '/dpa']]} />
          </div>
          <div className="mt-20 pt-8 border-t border-[#1F1F1E] flex flex-wrap justify-between items-center gap-4 text-[13px] text-mute-2">
            <span>© 2026 Elsie. All rights reserved.</span>
            <div className="flex flex-wrap gap-6">
              <Link className="hover:text-mint" to="/privacy">Privacy</Link>
              <Link className="hover:text-mint" to="/terms">Terms</Link>
              <Link className="hover:text-mint" to="/dpa">DPA</Link>
            </div>
          </div>
        </div>
      </footer>

      {/* Floating contact */}
      <Link to="/register" aria-label="Start free" className="fixed bottom-6 right-6 z-40 group flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200">
        <WhatsApp className="w-7 h-7" />
      </Link>
    </div>
  )
}

/* ── Small building blocks ── */

function FeatureCard({
  span, num, title, body, delay = 0, children,
}: { span: 4 | 5 | 6 | 7 | 8; num: string; title: string; body: ReactNode; delay?: number; children?: ReactNode }) {
  const col = { 4: 'lg:col-span-4', 5: 'lg:col-span-5', 6: 'lg:col-span-6', 7: 'lg:col-span-7', 8: 'lg:col-span-8' }[span]
  return (
    <Reveal delay={delay} className={col}>
      <div className="h-full p-9 bg-surface rounded-[28px] border border-line min-h-[320px] flex flex-col justify-between transition-all duration-300 hover:border-ink hover:-translate-y-1">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider2 text-mute">// {num}</div>
          <h3 className="text-[26px] font-semibold tracking-tight2 leading-[1.1] mt-3.5">{title}</h3>
          <p className="text-[15px] text-mute leading-relaxed mt-3.5">{body}</p>
        </div>
        {children}
      </div>
    </Reveal>
  )
}

function PriceLi({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <li className={`flex items-start gap-3 text-[15px] ${light ? 'text-paper' : ''}`}>
      <span className="flex-shrink-0 w-[18px] h-[18px] rounded-full bg-mint inline-flex items-center justify-center mt-0.5">
        <Check className="w-3 h-3 text-ink" strokeWidth={3} />
      </span>
      {children}
    </li>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h5 className="font-mono text-xs uppercase tracking-wider2 text-mute-2 mb-5">{title}</h5>
      <ul className="flex flex-col gap-3 text-[14.5px]">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith('#') ? (
              <a className="text-paper/80 hover:text-mint transition-colors" href={href}>{label}</a>
            ) : (
              <Link className="text-paper/80 hover:text-mint transition-colors" to={href}>{label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function QrGlyph() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="text-ink" aria-hidden="true">
      <rect x="2" y="2" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="58" y="2" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="2" y="58" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="11" y="11" width="6" height="6" fill="currentColor" />
      <rect x="67" y="11" width="6" height="6" fill="currentColor" />
      <rect x="11" y="67" width="6" height="6" fill="currentColor" />
      <rect x="36" y="2" width="6" height="6" fill="currentColor" />
      <rect x="48" y="2" width="6" height="6" fill="currentColor" />
      <rect x="36" y="14" width="6" height="6" fill="currentColor" />
      <rect x="36" y="36" width="6" height="6" fill="currentColor" />
      <rect x="48" y="36" width="6" height="6" fill="currentColor" />
      <rect x="60" y="36" width="6" height="6" fill="currentColor" />
      <rect x="72" y="36" width="6" height="6" fill="currentColor" />
      <rect x="36" y="48" width="6" height="6" fill="currentColor" />
      <rect x="58" y="48" width="6" height="6" fill="currentColor" />
      <rect x="72" y="48" width="6" height="6" fill="currentColor" />
      <rect x="48" y="60" width="6" height="6" fill="currentColor" />
      <rect x="36" y="72" width="6" height="6" fill="currentColor" />
      <rect x="60" y="60" width="6" height="6" fill="currentColor" />
      <rect x="72" y="72" width="6" height="6" fill="currentColor" />
    </svg>
  )
}

function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <div className="relative bg-[#0a0a0a] rounded-[54px] p-[10px] shadow-[0_70px_120px_-50px_rgba(0,0,0,0.7)] border border-[#1a1a1a]">
        <span className="absolute -start-0.5 top-[110px] w-[3px] h-10 bg-[#1a1a1a] rounded-s-sm" />
        <span className="absolute -start-0.5 top-[170px] w-[3px] h-16 bg-[#1a1a1a] rounded-s-sm" />
        <span className="absolute -start-0.5 top-[250px] w-[3px] h-16 bg-[#1a1a1a] rounded-s-sm" />
        <span className="absolute -end-0.5 top-[200px] w-[3px] h-24 bg-[#1a1a1a] rounded-e-sm" />
        <div className="bg-[#0F1714] rounded-[44px] overflow-hidden">
          {/* status bar */}
          <div className="relative px-7 pt-3 pb-1.5 flex items-center justify-between text-white text-[13px] font-semibold tabular-nums">
            <span>9:41</span>
            <div className="absolute left-1/2 -translate-x-1/2 top-2 w-[105px] h-[28px] bg-black rounded-full" />
            <div className="flex items-center gap-1 text-white/90">
              <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="6" width="3" height="5" rx="1" /><rect x="4.5" y="4" width="3" height="7" rx="1" /><rect x="9" y="2" width="3" height="9" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
              <svg width="22" height="11" viewBox="0 0 22 11" fill="none"><rect x="0.5" y="0.5" width="18" height="10" rx="2.5" stroke="currentColor" opacity="0.5" /><rect x="2" y="2" width="14" height="7" rx="1.5" fill="currentColor" /><rect x="20" y="3.5" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.5" /></svg>
            </div>
          </div>
          {/* chat header */}
          <div className="flex items-center gap-3 px-3 py-2.5 bg-[#0F1714] border-b border-white/[0.08]">
            <ChevronDown className="w-4 h-4 text-[#8696A0] rotate-90" />
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-mint to-mint-deep flex items-center justify-center font-bold text-ink text-sm">G</div>
            <div className="flex-1 min-w-0">
              <div className="text-[14.5px] font-semibold text-[#E9EDEF] truncate">Glow Beauty Studio</div>
              <div className="text-[11px] text-[#8696A0] inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-mint inline-block" />online · Elsie active
              </div>
            </div>
            <Phone className="w-[18px] h-[18px] text-[#8696A0]" />
          </div>
          {/* messages */}
          <div className="px-3 py-4 flex flex-col gap-1.5 min-h-[520px] max-h-[560px] overflow-hidden bg-[#0B141A] relative">
            <div className="absolute inset-0 opacity-[0.06] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
            <div className="relative flex flex-col gap-1.5">
              {CHAT.map((m, i) => (
                <div key={i} className="contents">
                  <div className={`bubble ${m.from === 'them' ? 'bubble-them' : 'bubble-ai'} max-w-[80%] ${i ? 'mt-1' : ''}`}>{m.text}</div>
                  <div className={`text-[10px] text-white/40 ${m.from === 'them' ? 'self-start ms-1' : 'self-end me-1'}`}>{m.time}{m.from === 'ai' ? ' ✓✓' : ''}</div>
                </div>
              ))}
            </div>
          </div>
          {/* input */}
          <div className="bg-[#0F1714] px-3 py-2 flex items-center gap-2 border-t border-white/[0.08]">
            <div className="flex-1 bg-[#1F2C33] rounded-full px-4 py-2 text-[12px] text-white/40">Message</div>
            <div className="w-9 h-9 rounded-full bg-mint flex items-center justify-center text-ink"><ArrowRight className="w-4 h-4" /></div>
          </div>
        </div>
      </div>
    </div>
  )
}

const MARQUEE = ['Hair & beauty salons', 'Dental practices', 'Plumbers & trades', 'Restaurants', 'Estate agents', 'Vets & clinics', 'Driving instructors', 'Garages & MOT']

const DEMO_POINTS = [
  { t: 'Understands intent', d: '“Any appointments for a cut this week?” → checks the diary, offers real slots, books it.' },
  { t: 'Replies instantly, 24/7', d: '2am or 2pm, in seconds — even voice notes get transcribed and answered.' },
  { t: 'Hands off to a human', d: '“Can I speak to the owner?” triggers a handoff + WhatsApp alert. Elsie pauses automatically.' },
  { t: 'Follows up. Forever.', d: 'No reply? Auto-followup at 24h, 72h, 7d. Until they book or opt out.' },
]

const CHAT: { from: 'them' | 'ai'; text: string; time: string }[] = [
  { from: 'them', text: 'Hi! Do you have any appointments for a haircut this week?', time: '2:14 AM' },
  { from: 'ai', text: 'Hi! 👋 Yes — I’ve got Thursday 2pm or Friday 11am with Sarah. Which works best for you?', time: '2:14 AM' },
  { from: 'them', text: 'Friday 11am please', time: '2:15 AM' },
  { from: 'ai', text: 'Perfect — booked you in for Friday 11am with Sarah. I’ll send a reminder the day before. Anything else?', time: '2:15 AM' },
  { from: 'them', text: 'No that’s great, thanks!', time: '2:16 AM' },
  { from: 'ai', text: 'Lovely — see you Friday! 💫', time: '2:16 AM' },
]

const STARTER = [
  '1 WhatsApp number + email inbox',
  'Unlimited AI replies — no per-message fees',
  'Phone, WhatsApp & email in one inbox',
  'HOT / WARM / COLD lead scoring',
  'Google Calendar booking + reminders',
  'Cancel anytime — no contract',
]
const PRO = [
  'Everything in Starter',
  'Up to 3 numbers + multiple mailboxes',
  'Voice AI — Elsie answers the phone',
  'Auto follow-up sequences',
  'Custom knowledge base + cited answers',
  'Priority support · 4-hour response',
  'Team members + roles',
]

const USE_CASE_ICONS = [
  <Sparkles key="0" className="w-5 h-5" />, <ShieldCheck key="1" className="w-5 h-5" />, <Phone key="2" className="w-5 h-5" />,
  <Calendar key="3" className="w-5 h-5" />, <Search key="4" className="w-5 h-5" />, <Clock key="5" className="w-5 h-5" />,
  <Check key="6" className="w-5 h-5" />, <FileText key="7" className="w-5 h-5" />,
]

/* ── Scoped design tokens + component classes (waslo design language) ── */
const CSS = `
.wl{
  --paper:#fafaf7; --ink:#0a0a0a; --ink-soft:#1a1a1a; --surface:#fff; --surface-2:#f2f1ea;
  --line:#e5e4dc; --line-strong:#d6d5cc; --mute:#6b6b66; --mute-2:#9a9a92;
  --mint:#00e37a; --mint-glow:#00ff8c; --mint-deep:#00b864; --rust:#ff5c2e;
  --dark-surface:#131313; --dark-surface-2:#1e1e1d;
  font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:var(--paper); color:var(--ink); -webkit-font-smoothing:antialiased;
}
.wl ::selection{ background:rgba(0,227,122,.25); color:var(--ink); }
.wl .font-sans{ font-family:'Geist',-apple-system,sans-serif; }
.wl .font-display{ font-family:'Geist',-apple-system,sans-serif; }
.wl .font-mono{ font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace; }

/* solid colours */
.wl .bg-paper{background-color:var(--paper)} .wl .bg-ink{background-color:var(--ink)}
.wl .bg-surface{background-color:var(--surface)} .wl .bg-surface-2{background-color:var(--surface-2)}
.wl .bg-mint{background-color:var(--mint)} .wl .bg-mint-deep{background-color:var(--mint-deep)}
.wl .bg-rust{background-color:var(--rust)}
.wl .bg-dark-surface{background-color:var(--dark-surface)} .wl .bg-dark-surface-2{background-color:var(--dark-surface-2)}
.wl .text-paper{color:var(--paper)} .wl .text-ink{color:var(--ink)} .wl .text-ink-soft{color:var(--ink-soft)}
.wl .text-mute{color:var(--mute)} .wl .text-mute-2{color:var(--mute-2)}
.wl .text-mint{color:var(--mint)} .wl .text-mint-deep{color:var(--mint-deep)} .wl .text-rust{color:var(--rust)}
.wl .border-line{border-color:var(--line)} .wl .border-line-strong{border-color:var(--line-strong)}
.wl .border-ink{border-color:var(--ink)} .wl .border-mint{border-color:var(--mint)}
.wl .from-paper{--tw-gradient-from:var(--paper) var(--tw-gradient-from-position);--tw-gradient-to:rgba(250,250,247,0) var(--tw-gradient-to-position);--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)}

/* opacity variants */
.wl .bg-paper\\/85{background-color:rgba(250,250,247,.85)}
.wl .text-paper\\/90{color:rgba(250,250,247,.9)} .wl .text-paper\\/80{color:rgba(250,250,247,.8)} .wl .text-paper\\/70{color:rgba(250,250,247,.7)}
.wl .text-ink\\/80{color:rgba(10,10,10,.8)}

/* hovers */
.wl .hover\\:bg-mint-glow:hover{background-color:var(--mint-glow)}
.wl .hover\\:bg-surface-2:hover{background-color:var(--surface-2)}
.wl .hover\\:bg-ink-soft:hover{background-color:#1f1f1f}
.wl .hover\\:bg-dark-surface-2:hover{background-color:var(--dark-surface-2)}
.wl .hover\\:border-ink:hover{border-color:var(--ink)}
.wl .hover\\:border-mint:hover{border-color:var(--mint)}
.wl .hover\\:text-mint:hover{color:var(--mint)}
.wl .hover\\:text-mute:hover{color:var(--mute)}

/* tracking */
.wl .tracking-wider2{letter-spacing:.12em} .wl .tracking-tight2{letter-spacing:-.025em}
.wl .tracking-wide2{letter-spacing:.1em} .wl .tracking-tighter{letter-spacing:-.035em}
.wl .tabular{font-variant-numeric:tabular-nums}

/* type components */
.wl .eyebrow{font-family:'Geist Mono',ui-monospace,monospace;text-transform:uppercase;font-size:12px;letter-spacing:.12em;font-weight:500;color:var(--mute)}
.wl .lead{font-size:clamp(18px,1.6vw,22px);line-height:1.45;letter-spacing:-.01em;color:var(--ink-soft)}
.wl .h-hero{font-size:clamp(40px,5vw,72px);line-height:.95;letter-spacing:-.035em;font-weight:600}
.wl .display-2{font-size:clamp(48px,7vw,120px);line-height:.9;letter-spacing:-.04em;font-weight:600}
.wl .h-card{font-size:clamp(22px,2vw,30px);line-height:1.1;letter-spacing:-.02em;font-weight:600}
.wl .metric{font-size:clamp(56px,8vw,116px);font-weight:600;line-height:.92;letter-spacing:-.04em}

/* dark sections re-light muted greys so text stays legible on #0a0a0a */
.wl .spotlight-dark .text-mute{color:#a8a8a0}
.wl .spotlight-dark .text-mute-2{color:#9a9a92}
.wl .grid-bg-dark{background-image:linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 0),linear-gradient(180deg,rgba(255,255,255,.04) 1px,transparent 0);background-size:48px 48px}

/* chat bubbles */
.wl .bubble{padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.4;max-width:280px;word-wrap:break-word}
.wl .bubble-them{background:#fff;color:#0a0a0a;border-bottom-left-radius:4px;box-shadow:0 1px .5px rgba(0,0,0,.13);align-self:flex-start}
.wl .bubble-ai{background:#d9fdd3;color:#0a0a0a;border-bottom-right-radius:4px;align-self:flex-end;position:relative}
.wl .bubble-ai:before{content:"AI";position:absolute;top:-8px;right:-8px;background:#0a0a0a;color:var(--mint);font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;font-family:'Geist Mono',monospace;letter-spacing:.1em}

/* animations */
@keyframes wl-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
.wl .animate-marquee{animation:wl-marquee 38s linear infinite}
@keyframes wl-pulse-mint{0%{box-shadow:0 0 0 0 rgba(0,227,122,.55)}70%{box-shadow:0 0 0 8px rgba(0,227,122,0)}100%{box-shadow:0 0 0 0 rgba(0,227,122,0)}}
.wl .animate-pulse-mint{animation:wl-pulse-mint 2s infinite}

@media (prefers-reduced-motion: reduce){
  .wl .animate-marquee{animation:none}
  .wl .animate-pulse-mint{animation:none}
}
`
