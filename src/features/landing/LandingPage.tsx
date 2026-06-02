import { useState } from 'react'
import { Link } from 'react-router-dom'

/* Waslo-style minimal aesthetic, WhatsApp-first. Black primary, green accent. */

const WHATSAPP_ICON = (
  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.644a.5.5 0 00.612.612l5.784-1.468A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.332-1.538l-.382-.23-3.432.87.87-3.432-.23-.382A9.95 9.95 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
)

const Check = () => (
  <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

const FAQ_ITEMS = [
  { q: 'How does Elsie connect to my WhatsApp?', a: 'You scan a QR code with your phone, just like WhatsApp Web — about 30 seconds. No API keys, no Meta verification, no technical setup.' },
  { q: "Will my customers know they're talking to AI?", a: 'No. Elsie uses your business name, your tone, and replies naturally — she reads like a helpful member of your team.' },
  { q: 'Can I take over a conversation?', a: "Anytime. If a customer asks for a human, or you want to step in, Elsie hands over and notifies you. You're always in control." },
  { q: 'Does it work with WhatsApp Business?', a: "Yes — regular WhatsApp and WhatsApp Business both work. Just scan your QR code and you're live." },
  { q: 'Is my data safe?', a: "Your messages stay yours. Conversations are processed to reply and are not sold or shared. You can disconnect at any time." },
  { q: 'Can I cancel anytime?', a: 'Yes — no contracts, no cancellation fees. Cancel from your dashboard in one click.' },
]

function FaqItem({ item, defaultOpen }: { item: typeof FAQ_ITEMS[0]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border-b border-gray-100">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-5 text-left text-[15px] font-medium text-gray-900">
        {item.q}
        <svg className={`h-5 w-5 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <p className="pb-5 pr-8 text-[14px] leading-relaxed text-gray-500">{item.a}</p>}
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Nav */}
      <nav className="fixed top-0 z-50 w-full border-b border-gray-100 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-white">{WHATSAPP_ICON}</div>
            <span className="text-[17px] font-semibold tracking-tight">Elsie</span>
          </div>
          <div className="hidden items-center gap-8 text-[14px] text-gray-500 md:flex">
            <a href="#how" className="transition hover:text-gray-900">How it works</a>
            <a href="#features" className="transition hover:text-gray-900">Features</a>
            <a href="#pricing" className="transition hover:text-gray-900">Pricing</a>
            <a href="#faq" className="transition hover:text-gray-900">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="hidden text-[14px] font-medium text-gray-600 transition hover:text-gray-900 sm:inline">Log in</Link>
            <Link to="/register" className="rounded-full bg-gray-900 px-4 py-2 text-[14px] font-medium text-white transition hover:bg-gray-800">
              Start free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-5 pt-32 pb-16 sm:px-8 sm:pt-40">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-[13px] text-gray-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#25D366]" />
              Live — answering customers right now
            </div>
            <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-[56px]">
              Your AI receptionist,<br />on WhatsApp.
            </h1>
            <p className="mt-6 max-w-md text-[17px] leading-relaxed text-gray-500">
              Elsie answers questions, books appointments and qualifies leads on WhatsApp — instantly, 24/7 — so you never lose a customer to a slow reply.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/register" className="rounded-full bg-gray-900 px-7 py-3.5 text-center text-[15px] font-medium text-white transition hover:bg-gray-800">
                Start free
              </Link>
              <a href="#how" className="rounded-full border border-gray-200 px-7 py-3.5 text-center text-[15px] font-medium text-gray-700 transition hover:border-gray-300">
                See how it works
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-gray-500">
              <span className="flex items-center gap-1.5"><Check /> No credit card</span>
              <span className="flex items-center gap-1.5"><Check /> 30-second setup</span>
              <span className="flex items-center gap-1.5"><Check /> Cancel anytime</span>
            </div>
          </div>

          {/* Chat demo */}
          <div className="relative">
            <div className="rounded-3xl border border-gray-100 bg-white p-3 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.18)]">
              <div className="flex items-center gap-3 rounded-t-2xl bg-[#075E54] px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-[13px] font-bold text-white">E</div>
                <div>
                  <p className="text-[13px] font-semibold text-white">Elsie</p>
                  <p className="text-[11px] text-green-200">online · replies instantly</p>
                </div>
              </div>
              <div className="space-y-2.5 rounded-b-2xl bg-[#efeae2] p-4">
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-[13px] text-gray-800 shadow-sm">
                    Hi, do you have any space for a cut & colour this Saturday?
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] px-3.5 py-2 text-[13px] text-gray-800 shadow-sm">
                    Hi! Yes — we've got 11:00 or 2:30 on Saturday. Which suits you best? 😊
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-[13px] text-gray-800 shadow-sm">
                    2:30 please!
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] px-3.5 py-2 text-[13px] text-gray-800 shadow-sm">
                    Booked you in for Saturday 2:30 ✨ We'll text a reminder the day before. See you then!
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-[12px] text-gray-400">Handled entirely by Elsie — no staff involved</p>
          </div>
        </div>
      </section>

      {/* Trust stats */}
      <section className="border-y border-gray-100 bg-gray-50/60 py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-8 text-center md:grid-cols-4">
          {[['3 sec', 'Avg reply time'], ['24/7', 'Always online'], ['98%', 'Reply rate'], ['30 sec', 'To set up']].map(([n, l]) => (
            <div key={l}>
              <p className="text-[26px] font-semibold tracking-tight">{n}</p>
              <p className="mt-1 text-[13px] text-gray-500">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-[13px] font-medium uppercase tracking-wider text-[#25D366]">How it works</p>
          <h2 className="mt-3 text-center text-[32px] font-semibold tracking-tight sm:text-[40px]">Live in 30 seconds</h2>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              { n: '01', t: 'Connect WhatsApp', d: 'Scan a QR code with your phone, just like WhatsApp Web. No setup, no API keys.' },
              { n: '02', t: 'Train Elsie', d: 'Tell her your services, prices and hours — or let her learn from your website automatically.' },
              { n: '03', t: 'She goes live', d: 'Elsie replies to every customer instantly. You get notified of every chat and booking.' },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-gray-100 p-7 transition hover:border-gray-200">
                <span className="text-[13px] font-semibold text-[#25D366]">{s.n}</span>
                <h3 className="mt-3 text-[18px] font-semibold">{s.t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-gray-500">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-gray-50/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-[13px] font-medium uppercase tracking-wider text-[#25D366]">Features</p>
          <h2 className="mt-3 text-center text-[32px] font-semibold tracking-tight sm:text-[40px]">Everything a great receptionist does</h2>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { t: 'Sounds human', d: "Your tone, your business name, natural language. Customers can't tell it's AI." },
              { t: 'Books appointments', d: 'Checks your availability and books customers in — no back-and-forth, no double bookings.' },
              { t: 'Replies in seconds', d: 'Day or night, weekday or weekend. Every customer gets an instant reply.' },
              { t: 'Qualifies leads', d: 'Asks the right questions and scores every enquiry hot, warm or cold so you focus on the best ones.' },
              { t: 'Hands over to you', d: "When someone wants a human, Elsie notifies you and steps aside. You're always in control." },
              { t: 'Runs campaigns', d: 'Send a WhatsApp broadcast to your customers in a couple of clicks.' },
            ].map((f) => (
              <div key={f.t} className="rounded-2xl border border-gray-100 bg-white p-6">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#25D366]/10">
                  <span className="h-2 w-2 rounded-full bg-[#25D366]" />
                </div>
                <h3 className="mt-4 text-[16px] font-semibold">{f.t}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-gray-500">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-center text-[13px] font-medium uppercase tracking-wider text-[#25D366]">Pricing</p>
          <h2 className="mt-3 text-center text-[32px] font-semibold tracking-tight sm:text-[40px]">Less than one missed customer</h2>
          <p className="mt-3 text-center text-[15px] text-gray-500">Start free. Upgrade when you're ready.</p>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              { name: 'Solo', price: '£29', tag: 'For solo owners', feats: ['1 WhatsApp number', '200 conversations/mo', 'AI replies 24/7', 'Bookings & reminders'], highlight: false },
              { name: 'Business', price: '£49', tag: 'For growing teams', feats: ['1 WhatsApp number', 'Unlimited conversations', 'Lead scoring & campaigns', 'Custom AI training', 'Priority support'], highlight: true },
              { name: 'Team', price: '£89', tag: 'For multi-site', feats: ['Up to 3 numbers', 'Unlimited conversations', 'Everything in Business', 'Team inbox & routing'], highlight: false },
            ].map((p) => (
              <div key={p.name} className={`relative rounded-2xl border p-7 ${p.highlight ? 'border-gray-900 shadow-[0_20px_60px_-25px_rgba(0,0,0,0.25)]' : 'border-gray-200'}`}>
                {p.highlight && <div className="absolute -top-3 left-7 rounded-full bg-gray-900 px-3 py-1 text-[11px] font-medium text-white">Most popular</div>}
                <h3 className="text-[16px] font-semibold">{p.name}</h3>
                <p className="mt-1 text-[13px] text-gray-500">{p.tag}</p>
                <p className="mt-5"><span className="text-[34px] font-semibold tracking-tight">{p.price}</span><span className="text-gray-400">/mo</span></p>
                <ul className="mt-6 space-y-2.5">
                  {p.feats.map((f) => <li key={f} className="flex items-start gap-2 text-[14px] text-gray-600"><Check />{f}</li>)}
                </ul>
                <Link to="/register" className={`mt-7 block rounded-full py-3 text-center text-[14px] font-medium transition ${p.highlight ? 'bg-gray-900 text-white hover:bg-gray-800' : 'border border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                  Start free
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-[13px] text-gray-400">7-day free trial on every plan. No credit card required.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-gray-50/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-center text-[13px] font-medium uppercase tracking-wider text-[#25D366]">FAQ</p>
          <h2 className="mt-3 text-center text-[32px] font-semibold tracking-tight sm:text-[40px]">Common questions</h2>
          <div className="mt-10">
            {FAQ_ITEMS.map((item, i) => <FaqItem key={i} item={item} defaultOpen={i === 0} />)}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl bg-gray-900 px-8 py-16 text-center text-white">
          <h2 className="text-[30px] font-semibold tracking-tight sm:text-[38px]">Never miss a customer again</h2>
          <p className="mx-auto mt-3 max-w-md text-[16px] text-gray-300">Connect WhatsApp and let Elsie reply for you — set up in under a minute.</p>
          <Link to="/register" className="mt-8 inline-block rounded-full bg-[#25D366] px-8 py-3.5 text-[15px] font-medium text-white transition hover:bg-[#1da851]">
            Start free
          </Link>
          <p className="mt-4 text-[13px] text-gray-400">No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-5 py-12 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-white">{WHATSAPP_ICON}</div>
            <span className="text-[15px] font-semibold">Elsie</span>
          </div>
          <div className="flex items-center gap-6 text-[13px] text-gray-500">
            <Link to="/privacy" className="hover:text-gray-900">Privacy</Link>
            <Link to="/terms" className="hover:text-gray-900">Terms</Link>
            <Link to="/login" className="hover:text-gray-900">Log in</Link>
          </div>
          <p className="text-[13px] text-gray-400">© 2026 Elsie</p>
        </div>
      </footer>
    </div>
  )
}
