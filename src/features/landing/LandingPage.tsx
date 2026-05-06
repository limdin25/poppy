import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'

const ALICE_FEATURES = [
  { icon: 'phone', label: 'Answers customer calls instantly, day or night' },
  { icon: 'wrench', label: 'Books appointments and manages your calendar' },
  { icon: 'money', label: 'Sends quotes and follows up on enquiries' },
  { icon: 'check', label: 'Confirms bookings via WhatsApp automatically' },
  { icon: 'doc', label: 'Learns your services, prices, and FAQs' },
  { icon: 'scale', label: 'Handles urgent calls and escalations' },
  { icon: 'alert', label: 'Captures every lead, even after hours' },
  { icon: 'mail', label: 'Sends updates directly to your inbox' },
]

const FEATURE_ICONS: Record<string, React.ReactNode> = {
  phone: <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8a19.79 19.79 0 01-3.07-8.62 2 2 0 011.99-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />,
  wrench: <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />,
  money: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.94 1.64h1.71c-.05-1.34-.87-2.57-2.49-2.97V5H10.9v1.69c-1.51.32-2.72 1.3-2.72 2.81 0 1.79 1.49 2.69 3.66 3.21 1.95.46 2.34 1.15 2.34 1.86 0 .53-.39 1.39-2.1 1.39-1.6 0-2.23-.72-2.32-1.64H8.04c.1 1.7 1.36 2.66 2.86 2.97V19h2.34v-1.67c1.52-.29 2.72-1.16 2.73-2.77-.01-2.2-1.9-2.96-3.66-3.42z" />,
  check: <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
  doc: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  scale: <path d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />,
  alert: <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
  mail: <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
}

const PARTNERS = [
  'Clarke Plumbing',
  'Swift Electrical',
  'Premier Salons',
  'Bright Dental',
  'Green Gardens',
]

function FeatureIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as React.CSSProperties}>
      {FEATURE_ICONS[name]}
    </svg>
  )
}

export default function LandingPage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [currentSlide, setCurrentSlide] = useState(0)
  const [stickyVisible, setStickyVisible] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)
  const touchStartX = useRef(0)

  // Scroll reveal
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            obs.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 }
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  // Sticky bar
  useEffect(() => {
    const handler = () => setStickyVisible(window.scrollY >= 200)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  // Auto-advance slider
  useEffect(() => {
    const iv = setInterval(() => setCurrentSlide((s) => (s + 1) % 4), 4000)
    return () => clearInterval(iv)
  }, [])

  const slideChange = useCallback(
    (dir: number) => setCurrentSlide((s) => (s + dir + 4) % 4),
    []
  )

  // Touch swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 40) slideChange(diff > 0 ? 1 : -1)
  }

  // Close mobile nav on outside click
  useEffect(() => {
    if (!mobileNavOpen) return
    const handler = (e: MouseEvent) => {
      const nav = document.getElementById('mobileNav')
      const btn = document.getElementById('hamburgerBtn')
      if (nav && btn && !nav.contains(e.target as Node) && !btn.contains(e.target as Node)) {
        setMobileNavOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [mobileNavOpen])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Merriweather:ital,wght@0,400;0,600;0,700;1,400&display=swap');

        :root {
          --color-primary: #283348;
          --color-primary-foreground: #F2EBD4;
          --color-foreground: #111827;
          --color-muted-foreground: #374151;
          --color-cta: #FAC114;
          --color-cta-foreground: #1A212E;
          --color-trust-cream: #FFFCF5;
          --color-trust-stone: #E5E7EB;
          --color-trust-success: #10B981;
          --radius: 0.75rem;
          --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
          --font-serif: 'Merriweather', ui-serif, Georgia, serif;
        }

        .landing-page * { box-sizing: border-box; margin: 0; padding: 0; }
        .landing-page { font-family: var(--font-sans); font-size: 16px; color: var(--color-foreground); background: #fff; overflow-x: hidden; line-height: 1.5; padding-bottom: 72px; }
        .landing-page img { max-width: 100%; height: auto; display: block; }
        .landing-page a { text-decoration: none; color: inherit; }
        .landing-page button { cursor: pointer; font-family: inherit; border: none; }
        .landing-page ul { list-style: none; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeInDelay { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }

        .animate-fade-in { animation: fadeIn 0.7s ease forwards; }
        .animate-fade-in-delay { animation: fadeIn 0.7s ease 0.2s forwards; opacity: 0; }
        .animate-fade-in-delay-2 { animation: fadeIn 0.7s ease 0.4s forwards; opacity: 0; }
        .animate-fade-in-delay-3 { animation: fadeIn 0.7s ease 0.6s forwards; opacity: 0; }
        .animate-float { animation: float 3s ease-in-out infinite; }

        .landing-container { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

        .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
        .reveal.visible { opacity: 1; transform: translateY(0); }

        .partners-track-wrapper { position: relative; overflow: hidden; }
        .partners-track-wrapper::before, .partners-track-wrapper::after { content: ''; position: absolute; top: 0; bottom: 0; width: 80px; z-index: 10; pointer-events: none; }
        .partners-track-wrapper::before { left: 0; background: linear-gradient(to right, var(--color-trust-cream), transparent); }
        .partners-track-wrapper::after { right: 0; background: linear-gradient(to left, var(--color-trust-cream), transparent); }
        .partners-track { display: flex; gap: 48px; align-items: center; animation: scroll 20s linear infinite; width: max-content; }
        .partners-track:hover { animation-play-state: paused; }

        .slider-track { display: flex; transition: transform 0.4s cubic-bezier(0.4,0,0.2,1); }
        .slide { min-width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; padding: 8px; }

        .chat-bubbles { display: flex; flex-direction: column; }
        .chat-bubble { padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.5; margin-bottom: 10px; max-width: 80%; }
        .chat-bubble.customer { background: rgba(40,51,72,0.08); align-self: flex-start; }
        .chat-bubble.elsie { background: var(--color-primary); color: #fff; margin-left: auto; }

        @media (max-width: 900px) {
          .alice-content-grid { grid-template-columns: 1fr !important; }
          .alice-left { margin-bottom: 32px; }
          .step-card { grid-template-columns: auto 1fr !important; }
          .step-card .step-mockup { display: none !important; }
          .mgmt-cards-grid { grid-template-columns: 1fr !important; }
          .why-grid { grid-template-columns: 1fr !important; }
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-hamburger { display: flex !important; }
          .slide { grid-template-columns: 1fr !important; }
          .slide .slide-right { display: none !important; }
          .footer-grid { grid-template-columns: 1fr !important; }
          .footer-bottom-inner { flex-direction: column !important; align-items: flex-start !important; }
        }
        @media (max-width: 640px) {
          .stats-grid-inner { flex-wrap: wrap !important; }
          .stat-card-inner { min-width: calc(50% - 6px) !important; }
          .cta-buttons-inner { flex-direction: column !important; }
          .cta-buttons-inner a, .cta-buttons-inner button { width: 100% !important; text-align: center !important; justify-content: center !important; }
        }
      `}</style>

      <div className="landing-page">
        {/* ===== NAV ===== */}
        <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--color-trust-stone)', height: 77, display: 'flex', alignItems: 'center' }}>
          <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', width: '100%', maxWidth: 1280, margin: '0 auto' }}>
            <Link to="/welcome" style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary)', transition: 'opacity 0.2s' }}>
              Hey Elsie
            </Link>
            <div className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <a href="#meet-elsie" style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-foreground)', transition: 'opacity 0.2s' }}>Features</a>
              <a href="#how-it-works" style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-foreground)', transition: 'opacity 0.2s' }}>How it works</a>
              <Link to="/login" style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-foreground)', transition: 'opacity 0.2s' }}>Log in</Link>
              <Link to="/register" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 500, transition: 'background 0.2s, transform 0.1s', display: 'inline-flex', alignItems: 'center' }}>
                Get Started Free
              </Link>
            </div>
            <button id="hamburgerBtn" className="nav-hamburger" aria-label="Toggle menu" onClick={() => setMobileNavOpen(!mobileNavOpen)} style={{ display: 'none', flexDirection: 'column', gap: 5, padding: 8, background: 'transparent' }}>
              <span style={{ width: 22, height: 2, background: 'var(--color-foreground)', borderRadius: 2 }} />
              <span style={{ width: 22, height: 2, background: 'var(--color-foreground)', borderRadius: 2 }} />
              <span style={{ width: 22, height: 2, background: 'var(--color-foreground)', borderRadius: 2 }} />
            </button>
          </nav>
        </header>

        {/* Mobile nav */}
        <div id="mobileNav" style={{ display: mobileNavOpen ? 'flex' : 'none', position: 'fixed', top: 77, left: 0, right: 0, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(16px)', padding: '20px 24px', borderBottom: '1px solid var(--color-trust-stone)', zIndex: 49, flexDirection: 'column', gap: 16 }}>
          <a href="#meet-elsie" onClick={() => setMobileNavOpen(false)} style={{ fontSize: 16, fontWeight: 500, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>Features</a>
          <a href="#how-it-works" onClick={() => setMobileNavOpen(false)} style={{ fontSize: 16, fontWeight: 500, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>How it works</a>
          <Link to="/login" onClick={() => setMobileNavOpen(false)} style={{ fontSize: 16, fontWeight: 500, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>Log in</Link>
          <Link to="/register" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', borderRadius: 10, padding: '14px 16px', fontSize: 16, fontWeight: 500, textAlign: 'center', marginTop: 8 }}>
            Get Started Free
          </Link>
        </div>

        <main>
          {/* ===== HERO ===== */}
          <section id="hero" style={{ background: 'linear-gradient(180deg, var(--color-trust-cream) 0%, #fff 100%)', padding: '80px 24px 60px', textAlign: 'center', overflow: 'hidden', position: 'relative' }}>
            <div style={{ content: "''", position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)', width: 800, height: 500, background: 'radial-gradient(circle, rgba(250,193,20,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div className="landing-container" style={{ position: 'relative' }}>
              <h1 className="animate-fade-in" style={{ fontSize: 'clamp(42px, 7vw, 72px)', fontWeight: 700, color: 'var(--color-foreground)', lineHeight: 1.1, marginBottom: 24, maxWidth: 900, marginLeft: 'auto', marginRight: 'auto' }}>
                Your 24/7 AI Receptionist
              </h1>
              <p className="animate-fade-in-delay" style={{ fontSize: 'clamp(16px, 2.2vw, 20px)', color: 'rgba(17,24,39,0.75)', maxWidth: 680, margin: '0 auto 36px', lineHeight: 1.6 }}>
                Automatically handle customer calls, book appointments, and send confirmations with AI that never sleeps, helping service businesses run smoother operations across the UK.
              </p>
              <div className="animate-fade-in-delay-2">
                <Link to="/register" style={{ background: '#fff', color: '#1F2937', border: '2px solid #1F2937', borderRadius: 12, padding: '12px 32px', fontSize: 20, fontWeight: 600, height: 56, display: 'inline-flex', alignItems: 'center', transition: 'background 0.2s, color 0.2s, transform 0.1s', marginBottom: 12 }}>
                  Try for free
                </Link>
                <p style={{ fontSize: 14, color: 'rgba(17,24,39,0.55)', marginTop: 8 }}>No sign up required</p>
              </div>

              {/* Partner marquee */}
              <div className="animate-fade-in-delay-3" style={{ marginTop: 48, overflow: 'hidden', position: 'relative' }}>
                <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'rgba(17,24,39,0.7)', textAlign: 'center', marginBottom: 20, letterSpacing: '0.05em' }}>
                  Trusted by 500+ service businesses across the UK
                </p>
                <div className="partners-track-wrapper">
                  <div className="partners-track">
                    {[...PARTNERS, ...PARTNERS].map((name, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--color-foreground)', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===== MEET ELSIE ===== */}
          <section id="meet-elsie" style={{ background: 'var(--color-trust-cream)', padding: '80px 24px', overflow: 'hidden' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div className="reveal" style={{ textAlign: 'center', marginBottom: 60 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 16 }}>
                  Meet Elsie: Your AI Receptionist
                </h2>
                <p style={{ fontSize: 18, color: 'rgba(17,24,39,0.7)', maxWidth: 600, margin: '0 auto', lineHeight: 1.6 }}>
                  Elsie doesn't just take messages, she takes action, handling customer calls and keeping your business running smoothly 24/7.
                </p>
              </div>
              <div className="alice-content-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start' }}>
                {/* Left: Avatar + Stats */}
                <div className="alice-left reveal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ position: 'relative', marginBottom: 32 }}>
                    <div style={{ width: 220, height: 220, borderRadius: '50%', background: 'linear-gradient(135deg, #FAC114 0%, #F59E0B 100%)', border: '3px solid var(--color-trust-stone)', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 80, fontWeight: 800, color: 'var(--color-primary)' }}>E</span>
                    </div>
                    <span style={{ position: 'absolute', top: 12, right: 12, width: 20, height: 20, background: 'var(--color-trust-success)', borderRadius: '50%', border: '2px solid #fff', animation: 'pulse-dot 2s infinite' }} />
                  </div>
                  <div className="stats-grid-inner" style={{ display: 'flex', gap: 12, width: '100%' }}>
                    {[
                      { value: '24/7', label: 'Always Available' },
                      { value: '98%', label: 'Satisfaction Rate' },
                      { value: '<1s', label: 'Answer Time' },
                    ].map((s) => (
                      <div key={s.label} className="stat-card-inner" style={{ flex: 1, background: '#fff', border: '1px solid var(--color-trust-stone)', borderRadius: 12, padding: '16px 12px', textAlign: 'center' }}>
                        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-foreground)', display: 'block' }}>{s.value}</span>
                        <span style={{ fontSize: 12, color: 'rgba(17,24,39,0.6)', lineHeight: 1.3, marginTop: 4, display: 'block' }}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Features list */}
                <div className="reveal" style={{ background: '#fff', borderRadius: 20, padding: 32, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.05)' }}>
                  <h3 style={{ fontSize: 24, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 20 }}>What Elsie does for you:</h3>
                  <ul>
                    {ALICE_FEATURES.map((f) => (
                      <li key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 16, color: 'var(--color-foreground)' }}>
                        <span style={{ width: 32, height: 32, flexShrink: 0, color: 'var(--color-trust-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FeatureIcon name={f.icon} />
                        </span>
                        {f.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* ===== HOW SHE WORKS ===== */}
          <section id="how-it-works" style={{ background: '#fff', padding: '80px 24px' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div className="reveal" style={{ textAlign: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, color: '#1A212E', marginBottom: 16 }}>How she works</h2>
              </div>
              <p className="reveal" style={{ fontSize: 18, color: 'rgba(26,33,45,0.6)', textAlign: 'center', marginBottom: 56 }}>
                Completely hands-free call handling
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                {/* Step 1 */}
                <div className="step-card reveal" style={{ background: 'rgba(250,250,250,0.7)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 20, padding: '28px 32px', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 24, alignItems: 'start', transition: 'box-shadow 0.2s' }}>
                  <div>
                    <span style={{ width: 48, height: 48, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>1</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 28, fontWeight: 700, color: '#1A212E', marginBottom: 12 }}>Instant call handling</h3>
                    <p style={{ fontSize: 15, color: 'rgba(26,33,45,0.65)', lineHeight: 1.65, maxWidth: 420 }}>
                      A customer calls your number. Elsie answers instantly, understands their needs, and checks your availability, all in natural conversation.
                    </p>
                  </div>
                  <div className="step-mockup" style={{ background: '#fff', borderRadius: 16, border: '1px solid var(--color-trust-stone)', padding: 20, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', animation: 'float 4s ease-in-out infinite' }}>
                    <span style={{ background: 'rgba(239,68,68,0.1)', color: '#DC2626', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100, display: 'inline-block', marginBottom: 12 }}>Incoming Call</span>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 4 }}>+44 7700 900 123</div>
                    <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.5)', marginBottom: 12 }}>New enquiry - boiler repair</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: 13 }}>
                      <span style={{ fontSize: 12, color: 'rgba(17,24,39,0.5)' }}>Response time</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1A212E' }}>&lt; 1s</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', fontSize: 13 }}>
                      <span style={{ fontSize: 12, color: 'rgba(17,24,39,0.5)' }}>Status</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-trust-success)' }}>&#10003; Answered</span>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="step-card reveal" style={{ background: 'rgba(250,250,250,0.7)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 20, padding: '28px 32px', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 24, alignItems: 'start', transition: 'box-shadow 0.2s' }}>
                  <div>
                    <span style={{ width: 48, height: 48, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>2</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 28, fontWeight: 700, color: '#1A212E', marginBottom: 12 }}>Books the appointment</h3>
                    <p style={{ fontSize: 15, color: 'rgba(26,33,45,0.65)', lineHeight: 1.65, maxWidth: 420 }}>
                      Elsie checks your calendar, finds the best slot, and books the job, confirming with the customer on the spot. No back-and-forth needed.
                    </p>
                  </div>
                  <div className="step-mockup" style={{ background: '#fff', borderRadius: 16, border: '1px solid var(--color-trust-stone)', padding: 20, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', animation: 'float 4s ease-in-out infinite', animationDelay: '0.5s' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 14 }}>Available Slots Found</div>
                    {[
                      { time: 'Thu 2-4pm', status: 'Booked', statusColor: '#059669', bgColor: 'rgba(16,185,129,0.1)' },
                      { time: 'Fri 10-12pm', status: 'Available', statusColor: '#D97706', bgColor: 'rgba(245,158,11,0.2)' },
                      { time: 'Mon 9-11am', status: 'Available', statusColor: '#D97706', bgColor: 'rgba(245,158,11,0.2)' },
                    ].map((slot) => (
                      <div key={slot.time} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: 13 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-trust-stone)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>&#128197;</div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{slot.time}</span>
                        </div>
                        <span style={{ background: slot.bgColor, color: slot.statusColor, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100 }}>{slot.status}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 3 */}
                <div className="step-card reveal" style={{ background: 'rgba(250,250,250,0.7)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 20, padding: '28px 32px', display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 24, alignItems: 'start', transition: 'box-shadow 0.2s' }}>
                  <div>
                    <span style={{ width: 48, height: 48, background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>3</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 28, fontWeight: 700, color: '#1A212E', marginBottom: 12 }}>Follow-up & confirmation</h3>
                    <p style={{ fontSize: 15, color: 'rgba(26,33,45,0.65)', lineHeight: 1.65, maxWidth: 420 }}>
                      Elsie sends a WhatsApp confirmation with the appointment details, your address, and any prep instructions. You get a summary in your dashboard.
                    </p>
                  </div>
                  <div className="step-mockup" style={{ background: '#fff', borderRadius: 16, border: '1px solid var(--color-trust-stone)', padding: 20, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', animation: 'float 4s ease-in-out infinite', animationDelay: '1s' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 14 }}>Elsie's Actions (4)</div>
                    {[
                      { time: '10:52', label: 'Call answered' },
                      { time: '10:54', label: 'Appointment booked' },
                      { time: '10:55', label: 'WhatsApp sent' },
                      { time: '10:55', label: 'Dashboard updated' },
                    ].map((a, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < 3 ? '1px solid rgba(0,0,0,0.06)' : 'none', fontSize: 12 }}>
                        <span style={{ color: 'rgba(17,24,39,0.5)', minWidth: 32 }}>{a.time}</span>
                        <span style={{ color: 'rgba(17,24,39,0.3)', fontSize: 14 }}>&#9993;</span>
                        <span style={{ color: 'var(--color-trust-success)', fontWeight: 700 }}>&#10003;</span>
                        <span style={{ color: 'var(--color-foreground)' }}>{a.label}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(17,24,39,0.45)', textAlign: 'center', paddingTop: 8, borderTop: '1px dashed rgba(0,0,0,0.1)' }}>
                      Completed in under 3 minutes
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===== COMPLETE SERVICE MANAGEMENT ===== */}
          <section style={{ background: 'var(--color-trust-cream)', padding: '80px 24px' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div className="reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 16 }}>
                  Complete Business Management
                </h2>
                <p style={{ fontSize: 18, color: 'rgba(17,24,39,0.7)', maxWidth: 600, margin: '0 auto' }}>
                  Elsie handles calls, bookings, and follow-ups in one place, helping you manage and grow your business effortlessly.
                </p>
              </div>
              <div className="mgmt-cards-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div className="reveal" style={{ background: '#fff', borderRadius: 20, padding: 32, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', transition: 'box-shadow 0.2s, transform 0.2s' }}>
                  <h3 style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 16 }}>Call Handling & Appointments</h3>
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                    {['Answers every call instantly, 24/7', 'Books appointments directly into your calendar', 'Sends WhatsApp confirmations automatically'].map((t) => (
                      <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, color: 'rgba(17,24,39,0.8)', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--color-trust-success)', fontSize: 16, marginTop: 1, flexShrink: 0 }}>&#10003;</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                  <Link to="/register" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 500, display: 'inline-block', transition: 'background 0.2s' }}>
                    Learn More
                  </Link>
                </div>
                <div className="reveal" style={{ background: '#fff', borderRadius: 20, padding: 32, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', transition: 'box-shadow 0.2s, transform 0.2s' }}>
                  <h3 style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 16 }}>Lead Capture & Follow-ups</h3>
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                    {['Captures every enquiry, even after hours', 'Sends follow-up messages to warm leads', 'Full call transcripts and analytics dashboard'].map((t) => (
                      <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, color: 'rgba(17,24,39,0.8)', lineHeight: 1.5 }}>
                        <span style={{ color: 'var(--color-trust-success)', fontSize: 16, marginTop: 1, flexShrink: 0 }}>&#10003;</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                  <Link to="/register" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 500, display: 'inline-block', transition: 'background 0.2s' }}>
                    Learn More
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* ===== MULTI-CHANNEL SECTION ===== */}
          <section id="channels" style={{ background: '#fff', padding: '80px 24px' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div className="reveal" style={{ textAlign: 'center', marginBottom: 48 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, color: 'var(--color-foreground)' }}>
                  Multiple Communication Channels
                </h2>
              </div>

              <div className="reveal" style={{ position: 'relative', overflow: 'hidden' }} ref={sliderRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                <div className="slider-track" style={{ transform: `translateX(-${currentSlide * 100}%)` }}>
                  {/* Voice slide */}
                  <div className="slide">
                    <div className="slide-left">
                      <h3 style={{ fontSize: 30, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 12 }}>Voice</h3>
                      <p style={{ fontSize: 16, color: 'rgba(17,24,39,0.65)', lineHeight: 1.6 }}>Answers calls 24/7 with no hold time, your customers always reach someone.</p>
                    </div>
                    <div className="slide-right" style={{ background: 'linear-gradient(135deg, #FAFAFA 0%, #F2EBD4 100%)', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                      <div style={{ background: 'var(--color-primary)', borderRadius: 12, padding: '14px 16px', color: '#fff', marginBottom: 16 }}>
                        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>Incoming call from</div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>+44 7700 900 123</div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 100, padding: '4px 10px', fontSize: 11, marginTop: 8 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse-dot 1.5s infinite' }} />
                          Active call
                        </div>
                      </div>
                      <div className="chat-bubbles">
                        <div className="chat-bubble customer">Hi, I've got a leaking tap. Are you available this week?</div>
                        <div className="chat-bubble elsie">Of course! We can fit you in Thursday 2-4pm. Shall I book that in?</div>
                        <div className="chat-bubble customer">Perfect, yes please!</div>
                      </div>
                    </div>
                  </div>

                  {/* SMS slide */}
                  <div className="slide">
                    <div className="slide-left">
                      <h3 style={{ fontSize: 30, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 12 }}>Text</h3>
                      <p style={{ fontSize: 16, color: 'rgba(17,24,39,0.65)', lineHeight: 1.6 }}>Sends appointment confirmations and reminders via SMS automatically.</p>
                    </div>
                    <div className="slide-right" style={{ background: 'linear-gradient(135deg, #FAFAFA 0%, #F2EBD4 100%)', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                      <div style={{ fontSize: 11, color: 'rgba(17,24,39,0.4)', marginBottom: 12 }}>10:55 AM</div>
                      <div style={{ fontSize: 11, color: 'rgba(17,24,39,0.55)', marginBottom: 2 }}>From: Elsie @ Smith Plumbing</div>
                      <div style={{ fontSize: 11, color: 'rgba(17,24,39,0.55)', marginBottom: 16 }}>To: +44 7700 900 123</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 8 }}>Appointment Confirmed &#10003;</div>
                      <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.7)', lineHeight: 1.6 }}>
                        Hi there,<br /><br />
                        Your appointment with Smith Plumbing is confirmed for Thursday 2-4pm.<br /><br />
                        Address: 14 High Street, Manchester M1 1AA<br /><br />
                        See you then!<br />
                        <strong>Elsie</strong>
                      </div>
                    </div>
                  </div>

                  {/* Email slide */}
                  <div className="slide">
                    <div className="slide-left">
                      <h3 style={{ fontSize: 30, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 12 }}>Email</h3>
                      <p style={{ fontSize: 16, color: 'rgba(17,24,39,0.65)', lineHeight: 1.6 }}>Manages follow-ups and sends booking details straight to your customer's inbox.</p>
                    </div>
                    <div className="slide-right" style={{ background: 'linear-gradient(135deg, #FAFAFA 0%, #F2EBD4 100%)', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                        <div style={{ background: '#f1f5f9', padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <div style={{ fontSize: 11, color: '#64748b' }}>elsie@smithplumbing.com</div>
                        </div>
                        <div style={{ padding: 16 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Booking Confirmation &#10003;</div>
                          <div style={{ fontSize: 12, color: 'rgba(17,24,39,0.6)', lineHeight: 1.6 }}>
                            Hi there,<br /><br />
                            Your appointment is confirmed for Thursday between 2pm and 4pm.<br /><br />
                            Please ensure access to the kitchen area.<br /><br />
                            Best regards,<br />
                            <strong>Elsie</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* WhatsApp slide */}
                  <div className="slide">
                    <div className="slide-left">
                      <h3 style={{ fontSize: 30, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 12 }}>WhatsApp</h3>
                      <p style={{ fontSize: 16, color: 'rgba(17,24,39,0.65)', lineHeight: 1.6 }}>Responds to enquiries and sends confirmations on WhatsApp instantly.</p>
                    </div>
                    <div className="slide-right" style={{ background: 'linear-gradient(135deg, #FAFAFA 0%, #F2EBD4 100%)', borderRadius: 20, padding: 24, border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '1px solid rgba(0,0,0,0.06)', marginBottom: 16 }}>
                        <div style={{ width: 36, height: 36, background: 'var(--color-primary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>E</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>Elsie - Smith Plumbing</div>
                          <div style={{ fontSize: 11, color: 'var(--color-trust-success)' }}>&#9679; online</div>
                        </div>
                      </div>
                      <div className="chat-bubbles">
                        <div className="chat-bubble customer" style={{ background: 'rgba(40,51,72,0.07)' }}>Hi, can I book a plumber for a leaking tap?</div>
                        <div className="chat-bubble elsie">Of course! When works best for you?</div>
                        <div className="chat-bubble customer" style={{ background: 'rgba(40,51,72,0.07)' }}>Thursday afternoon would be great.</div>
                      </div>
                      <div style={{ background: '#f1f5f9', borderRadius: 100, padding: '10px 14px', fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 12, border: '1px solid rgba(0,0,0,0.06)' }}>
                        Type a message...
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Slider nav */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 32 }}>
                <button onClick={() => slideChange(-1)} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--color-trust-stone)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }} aria-label="Previous slide">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <button key={i} onClick={() => setCurrentSlide(i)} style={{ width: 8, height: 8, borderRadius: '50%', background: i === currentSlide ? 'var(--color-primary)' : 'var(--color-trust-stone)', transform: i === currentSlide ? 'scale(1.3)' : 'scale(1)', transition: 'background 0.2s, transform 0.2s', border: 'none', padding: 0 }} aria-label={`Go to slide ${i + 1}`} />
                  ))}
                </div>
                <button onClick={() => slideChange(1)} style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--color-trust-stone)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }} aria-label="Next slide">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>
              <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(17,24,39,0.4)', marginTop: 12 }}>Swipe to see more</p>
            </div>
          </section>

          {/* ===== WHY CHOOSE ELSIE ===== */}
          <section style={{ background: 'var(--color-trust-cream)', padding: '80px 24px' }}>
            <div style={{ maxWidth: 1200, margin: '0 auto' }}>
              <div className="reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
                <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 12 }}>
                  Why businesses choose Elsie
                </h2>
                <p style={{ fontSize: 18, color: 'rgba(17,24,39,0.65)' }}>
                  Transform your business with AI that never sleeps
                </p>
              </div>
              <div className="why-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                {/* Card 1 */}
                <div className="reveal" style={{ borderRadius: 20, padding: 28, border: '1px solid rgba(245,158,11,0.2)', transition: 'transform 0.2s, box-shadow 0.2s', overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg, #fffbeb 0%, #fff 100%)' }}>
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: '#D97706', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100, display: 'inline-block', marginBottom: 20 }}>Zero missed calls</span>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#D97706' }}>
                    <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1A212E', marginBottom: 10 }}>Smart Automation</h3>
                  <p style={{ fontSize: 14, color: 'rgba(17,24,39,0.7)', lineHeight: 1.6 }}>AI-powered workflows that handle calls, bookings, and follow-ups automatically.</p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 20, alignItems: 'center' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />
                    <div style={{ width: 20, height: 2, background: 'rgba(245,158,11,0.4)' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />
                    <div style={{ width: 20, height: 2, background: 'rgba(245,158,11,0.4)' }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />
                  </div>
                </div>

                {/* Card 2 */}
                <div className="reveal" style={{ borderRadius: 20, padding: 28, border: '1px solid rgba(245,158,11,0.2)', transition: 'transform 0.2s, box-shadow 0.2s', overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg, #fff7ed 0%, #fff 100%)' }}>
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: '#D97706', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100, display: 'inline-block', marginBottom: 20 }}>4 channels, 1 platform</span>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#D97706' }}>
                    <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 700, color: '#D97706', marginBottom: 10 }}>Multi-Channel Hub</h3>
                  <p style={{ fontSize: 14, color: 'rgba(17,24,39,0.7)', lineHeight: 1.6 }}>Phone, SMS, email, and WhatsApp, Elsie speaks every customer's language.</p>
                  <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: '#FEF3C7' }}>&#128222;</div>
                    <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: '#FEF9C3' }}>&#128172;</div>
                    <div style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: '#FEE2E2' }}>&#9993;&#65039;</div>
                  </div>
                </div>

                {/* Card 3 */}
                <div className="reveal" style={{ borderRadius: 20, padding: 28, border: '1px solid rgba(245,158,11,0.2)', transition: 'transform 0.2s, box-shadow 0.2s', overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg, #fefce8 0%, #fff 100%)' }}>
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: '#D97706', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100, display: 'inline-block', marginBottom: 20 }}>0 missed requests</span>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#D97706' }}>
                    <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1A212E', marginBottom: 10 }}>Always Available</h3>
                  <p style={{ fontSize: 14, color: 'rgba(17,24,39,0.7)', lineHeight: 1.6 }}>24/7 call handling ensures no customer enquiry goes unanswered, ever.</p>
                </div>

                {/* Card 4 */}
                <div className="reveal" style={{ borderRadius: 20, padding: 28, border: '1px solid rgba(245,158,11,0.2)', transition: 'transform 0.2s, box-shadow 0.2s', overflow: 'hidden', position: 'relative', background: 'linear-gradient(135deg, #fff1f2 0%, #fff 100%)' }}>
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: '#D97706', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 100, display: 'inline-block', marginBottom: 20 }}>Real-time data</span>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: '#DC2626' }}>
                    <svg viewBox="0 0 24 24" style={{ width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1A212E', marginBottom: 10 }}>Live Analytics</h3>
                  <p style={{ fontSize: 14, color: 'rgba(17,24,39,0.7)', lineHeight: 1.6 }}>Real-time insights into call volume, bookings, and customer satisfaction.</p>
                </div>
              </div>
            </div>
          </section>

          {/* ===== CTA ===== */}
          <section id="cta" style={{ background: 'var(--color-primary)', padding: '80px 24px', textAlign: 'center' }}>
            <div className="reveal" style={{ maxWidth: 800, margin: '0 auto' }}>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, color: '#fff', marginBottom: 16, lineHeight: 1.2 }}>
                Stop missing calls. Start booking more jobs.
              </h2>
              <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.75)', marginBottom: 36, lineHeight: 1.6 }}>
                Join hundreds of UK service businesses who trust Elsie to handle their calls, book appointments, and keep customers happy, 24/7.
              </p>
              <div className="cta-buttons-inner" style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link to="/register" style={{ background: '#fff', color: 'var(--color-primary)', border: '2px solid #fff', borderRadius: 12, padding: '14px 36px', fontSize: 16, fontWeight: 600, transition: 'background 0.2s, transform 0.1s', display: 'inline-block' }}>
                  Try for free
                </Link>
                <a href="mailto:hello@heyelsie.com" style={{ background: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,0.7)', borderRadius: 12, padding: '14px 36px', fontSize: 16, fontWeight: 600, transition: 'border-color 0.2s, background 0.2s, transform 0.1s', display: 'inline-block' }}>
                  Talk to our team
                </a>
              </div>
            </div>
          </section>
        </main>

        {/* ===== FOOTER ===== */}
        <footer style={{ background: '#fff', borderTop: '1px solid var(--color-trust-stone)', padding: '48px 24px 32px' }}>
          <div style={{ maxWidth: 1280, margin: '0 auto' }}>
            <div className="footer-grid" style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1.2fr', gap: 32, marginBottom: 40 }}>
              <div>
                <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-foreground)', marginBottom: 12 }}>Hey Elsie</h3>
                <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', lineHeight: 1.6 }}>
                  AI-powered receptionist that handles calls, books appointments, and manages customer communications for UK service businesses.
                </p>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Product</h4>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {['Voice Handling', 'Appointment Booking', 'WhatsApp Integration', 'Analytics Dashboard'].map((l) => (
                    <li key={l}><a href="#meet-elsie" style={{ fontSize: 13, color: 'rgba(17,24,39,0.55)', transition: 'color 0.2s' }}>{l}</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Industries</h4>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {['Plumbers', 'Electricians', 'Salons & Barbers', 'Dental Practices', 'Cleaning Services'].map((l) => (
                    <li key={l}><a href="#meet-elsie" style={{ fontSize: 13, color: 'rgba(17,24,39,0.55)', transition: 'color 0.2s' }}>{l}</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company</h4>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {['About Us', 'Blog', 'Careers', 'Contact'].map((l) => (
                    <li key={l}><a href="#" style={{ fontSize: 13, color: 'rgba(17,24,39,0.55)', transition: 'color 0.2s' }}>{l}</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(17,24,39,0.55)', marginBottom: 10 }}>
                  <svg style={{ width: 16, height: 16, opacity: 0.6 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  <a href="mailto:hello@heyelsie.com" style={{ transition: 'color 0.2s' }}>hello@heyelsie.com</a>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(17,24,39,0.55)', marginBottom: 10 }}>
                  <svg style={{ width: 16, height: 16, opacity: 0.6 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></svg>
                  <a href="mailto:support@heyelsie.com" style={{ transition: 'color 0.2s' }}>support@heyelsie.com</a>
                </div>
              </div>
            </div>
            <div className="footer-bottom-inner" style={{ borderTop: '1px solid var(--color-trust-stone)', paddingTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <p style={{ fontSize: 12, color: 'rgba(17,24,39,0.45)' }}>&copy; 2026 Hey Elsie. All rights reserved.</p>
              <div style={{ display: 'flex', gap: 20 }}>
                <a href="#" style={{ fontSize: 12, color: 'rgba(17,24,39,0.45)', transition: 'color 0.2s' }}>Privacy Policy</a>
                <a href="#" style={{ fontSize: 12, color: 'rgba(17,24,39,0.45)', transition: 'color 0.2s' }}>Terms of Service</a>
                <a href="#" style={{ fontSize: 12, color: 'rgba(17,24,39,0.45)', transition: 'color 0.2s' }}>Cookie Policy</a>
              </div>
            </div>
          </div>
        </footer>

        {/* ===== STICKY BOTTOM BAR ===== */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid var(--color-trust-stone)', boxShadow: '0 -4px 20px rgba(0,0,0,0.08)', zIndex: 50, padding: '12px 24px', display: stickyVisible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 16, color: 'var(--color-foreground)', maxWidth: 600 }}>
            Try Elsie free for 7 days, no credit card required.
          </p>
          <Link to="/register" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-foreground)', borderRadius: 12, padding: '14px 32px', fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', transition: 'background 0.2s, transform 0.1s', display: 'inline-block' }}>
            Try for Free
          </Link>
        </div>
      </div>
    </>
  )
}
