import { useState } from 'react'
import { Link } from 'react-router-dom'

const CHECK_ICON = (
  <svg className="w-5 h-5 text-[#25D366] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

const WHATSAPP_ICON = (
  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.555 4.126 1.528 5.86L.06 23.644a.5.5 0 00.612.612l5.784-1.468A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22a9.95 9.95 0 01-5.332-1.538l-.382-.23-3.432.87.87-3.432-.23-.382A9.95 9.95 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
  </svg>
)

const FAQ_ITEMS = [
  {
    q: 'How does Elsie connect to my WhatsApp?',
    a: "You scan a QR code with your phone, just like you do with WhatsApp Web. It takes about 10 seconds. No technical setup, no API keys, no Meta verification needed.",
  },
  {
    q: "Will my customers know they're talking to AI?",
    a: "No. Elsie uses your business name, speaks in your tone, and responds naturally. She sounds like a helpful member of your team, not a bot.",
  },
  {
    q: 'Can I take over a conversation?',
    a: "Yes, anytime. If a customer asks to speak to a real person, or if you want to jump in, Elsie hands over seamlessly and notifies you. You're always in control.",
  },
  {
    q: 'Does it work with WhatsApp Business?',
    a: 'Yes. Elsie works with both regular WhatsApp and WhatsApp Business. Just scan your QR code and you\'re connected.',
  },
  {
    q: 'Is my data safe?',
    a: "Absolutely. Your messages are end-to-end encrypted by WhatsApp. We don't store your conversations. Elsie processes messages to reply, then the content is not retained.",
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. No contracts, no cancellation fees, no questions asked. Cancel from your dashboard in one click.',
  },
]

function FaqItem({ item, defaultOpen }: { item: typeof FAQ_ITEMS[0]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex justify-between items-center w-full cursor-pointer p-6 font-semibold text-gray-900 hover:bg-gray-50 transition text-left"
      >
        {item.q}
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ml-4 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <p className="px-6 pb-6 text-gray-600">{item.a}</p>}
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="font-sans text-gray-900 bg-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        .chat-bubble-left { border-radius: 0 12px 12px 12px; }
        .chat-bubble-right { border-radius: 12px 0 12px 12px; }
        .fade-in { animation: fadeIn 0.6s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .gradient-text { background: linear-gradient(135deg, #128C7E, #25D366); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      `}</style>

      {/* Nav */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-lg border-b border-gray-100 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center">
              {WHATSAPP_ICON}
            </div>
            <span className="text-xl font-bold text-gray-900">HeyElsie</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#how-it-works" className="hover:text-gray-900 transition">How it works</a>
            <a href="#features" className="hover:text-gray-900 transition">Features</a>
            <a href="#pricing" className="hover:text-gray-900 transition">Pricing</a>
            <a href="#faq" className="hover:text-gray-900 transition">FAQ</a>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="hidden md:inline text-sm font-medium text-gray-600 hover:text-gray-900 transition">
              Log in
            </Link>
            <Link
              to="/register"
              className="bg-[#25D366] hover:bg-[#128C7E] text-white text-sm font-semibold px-5 py-2.5 rounded-full transition-all hover:shadow-lg hover:shadow-green-200"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="fade-in">
              <div className="inline-flex items-center gap-2 bg-green-50 text-green-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
                <span className="w-2 h-2 bg-[#25D366] rounded-full animate-pulse" />
                Replying to customers right now
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-gray-900 mb-6">
                Your WhatsApp replies to customers
                <span className="gradient-text"> 24/7</span>
              </h1>
              <p className="text-lg sm:text-xl text-gray-600 leading-relaxed mb-8 max-w-xl">
                Elsie is your AI receptionist. She answers questions, books appointments, and qualifies leads on WhatsApp — while you focus on your business.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <Link
                  to="/register"
                  className="bg-[#25D366] hover:bg-[#128C7E] text-white text-base font-semibold px-8 py-4 rounded-full transition-all hover:shadow-xl hover:shadow-green-200 text-center"
                >
                  Start Free Trial
                </Link>
                <a
                  href="#how-it-works"
                  className="border-2 border-gray-200 hover:border-gray-300 text-gray-700 text-base font-semibold px-8 py-4 rounded-full transition-all text-center"
                >
                  See How It Works
                </a>
              </div>
              <div className="flex items-center gap-6 text-sm text-gray-500">
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  No credit card required
                </span>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  Setup in 30 seconds
                </span>
                <span className="hidden sm:flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  Cancel anytime
                </span>
              </div>
            </div>

            {/* Chat Demo */}
            <div className="fade-in">
              <div className="bg-gray-50 rounded-3xl p-6 shadow-2xl shadow-gray-200/50 border border-gray-100">
                <div className="bg-[#075E54] rounded-t-2xl px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#25D366] rounded-full flex items-center justify-center text-white font-bold text-sm">E</div>
                  <div>
                    <p className="text-white font-semibold text-sm">Elsie - AI Receptionist</p>
                    <p className="text-green-200 text-xs">Online — replies instantly</p>
                  </div>
                </div>
                <div className="bg-[#efeae2] rounded-b-2xl p-4 space-y-3 min-h-[320px]">
                  <div className="flex justify-start">
                    <div className="bg-white chat-bubble-left px-4 py-2.5 max-w-[280px] shadow-sm">
                      <p className="text-sm text-gray-800">Hi, I'd like to book a teeth cleaning for next week. Do you have any availability?</p>
                      <p className="text-[10px] text-gray-400 text-right mt-1">10:23 PM</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-[#dcf8c6] chat-bubble-right px-4 py-2.5 max-w-[280px] shadow-sm">
                      <p className="text-sm text-gray-800">Hi! Thanks for reaching out to Bright Smile Dental. We'd love to help you with a teeth cleaning.</p>
                      <p className="text-[10px] text-gray-400 text-right mt-1">10:23 PM <span className="text-blue-500">✓✓</span></p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-[#dcf8c6] chat-bubble-right px-4 py-2.5 max-w-[280px] shadow-sm">
                      <p className="text-sm text-gray-800">We have slots available on Tuesday at 2pm, Wednesday at 10am, and Thursday at 4pm. Which works best for you?</p>
                      <p className="text-[10px] text-gray-400 text-right mt-1">10:23 PM <span className="text-blue-500">✓✓</span></p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-white chat-bubble-left px-4 py-2.5 max-w-[280px] shadow-sm">
                      <p className="text-sm text-gray-800">Wednesday 10am would be perfect!</p>
                      <p className="text-[10px] text-gray-400 text-right mt-1">10:24 PM</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="bg-[#dcf8c6] chat-bubble-right px-4 py-2.5 max-w-[280px] shadow-sm">
                      <p className="text-sm text-gray-800">You're all booked in for Wednesday at 10am with Dr. Patel. We'll send you a reminder the day before. See you then! 😊</p>
                      <p className="text-[10px] text-gray-400 text-right mt-1">10:24 PM <span className="text-blue-500">✓✓</span></p>
                    </div>
                  </div>
                </div>
                <div className="text-center mt-3">
                  <span className="text-xs text-gray-400 font-medium">This entire conversation was handled by Elsie at 10:23 PM</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof Bar */}
      <section className="py-12 border-y border-gray-100 bg-gray-50/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl font-bold text-gray-900">3 sec</p>
              <p className="text-sm text-gray-500 mt-1">Average reply time</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">24/7</p>
              <p className="text-sm text-gray-500 mt-1">Always online</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">98%</p>
              <p className="text-sm text-gray-500 mt-1">Customer satisfaction</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">30 sec</p>
              <p className="text-sm text-gray-500 mt-1">Setup time</p>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">You're losing customers right now</h2>
          <p className="text-lg text-gray-600 leading-relaxed mb-12">
            Every WhatsApp message you don't reply to in 5 minutes is a customer going to your competitor.
            76% of people who don't get a quick reply will never message you again.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="bg-red-50 rounded-2xl p-6 text-left">
              <div className="text-3xl mb-3">😴</div>
              <h3 className="font-bold text-gray-900 mb-2">After hours</h3>
              <p className="text-sm text-gray-600">Customers message at 10pm. You reply at 9am. They've already booked someone else.</p>
            </div>
            <div className="bg-red-50 rounded-2xl p-6 text-left">
              <div className="text-3xl mb-3">🤯</div>
              <h3 className="font-bold text-gray-900 mb-2">Too busy</h3>
              <p className="text-sm text-gray-600">You're with a client. 8 messages come in. By the time you check, 5 have gone cold.</p>
            </div>
            <div className="bg-red-50 rounded-2xl p-6 text-left">
              <div className="text-3xl mb-3">💸</div>
              <h3 className="font-bold text-gray-900 mb-2">Lost revenue</h3>
              <p className="text-sm text-gray-600">Each missed message is £50-500 in lost business. Every single day.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-[#25D366] text-sm font-semibold uppercase tracking-wider">How it works</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-3">Live in 30 seconds. Seriously.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white rounded-2xl p-8 text-center shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
                </svg>
              </div>
              <div className="text-[#25D366] text-sm font-bold mb-2">Step 1</div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Scan your QR code</h3>
              <p className="text-gray-600">Open HeyElsie, scan the QR code with your phone — just like WhatsApp Web. Done in 10 seconds.</p>
            </div>
            <div className="bg-white rounded-2xl p-8 text-center shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <div className="text-[#25D366] text-sm font-bold mb-2">Step 2</div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Tell Elsie about your business</h3>
              <p className="text-gray-600">Your services, prices, opening hours, how you want her to sound. Takes 2 minutes.</p>
            </div>
            <div className="bg-white rounded-2xl p-8 text-center shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
              <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </div>
              <div className="text-[#25D366] text-sm font-bold mb-2">Step 3</div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Elsie goes live</h3>
              <p className="text-gray-600">She starts replying to your customers instantly. You get notified of every conversation and booking.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-[#25D366] text-sm font-semibold uppercase tracking-wider">Features</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-3">
              Everything a great receptionist does.<br />Without the salary.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'Sounds human',
                desc: "Your customers won't know they're talking to AI. Elsie uses your tone, your business name, and natural language.",
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />,
              },
              {
                title: 'Books appointments',
                desc: 'Elsie checks your availability and books customers in. No back and forth. No double bookings.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />,
              },
              {
                title: 'Replies in 3 seconds',
                desc: 'Day or night, weekday or weekend. Your customers get an instant reply every single time.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />,
              },
              {
                title: 'Qualifies leads',
                desc: 'Elsie asks the right questions — budget, timeline, what they need — so you only spend time on serious customers.',
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />,
              },
              {
                title: 'Handover to you',
                desc: "When a customer asks to speak to a human, Elsie notifies you and you take over seamlessly. You're always in control.",
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />,
              },
              {
                title: 'Private and secure',
                desc: "Your data stays yours. We don't store conversations. Elsie reads, replies, and forgets.",
                icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />,
              },
            ].map((f) => (
              <div key={f.title} className="group p-6 rounded-2xl border border-gray-100 hover:border-[#25D366]/30 hover:bg-green-50/50 transition-all">
                <div className="w-12 h-12 bg-green-50 group-hover:bg-green-100 rounded-xl flex items-center justify-center mb-4 transition-colors">
                  <svg className="w-6 h-6 text-[#25D366]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    {f.icon}
                  </svg>
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-[#25D366] text-sm font-semibold uppercase tracking-wider">Pricing</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-3">Less than one missed customer per month</h2>
            <p className="text-lg text-gray-500 mt-4">Start free. Upgrade when you're ready.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Solo */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 hover:border-gray-300 transition-all hover:shadow-lg">
              <h3 className="text-lg font-bold text-gray-900">Solo</h3>
              <p className="text-sm text-gray-500 mt-1">For solo business owners</p>
              <div className="mt-6 mb-6">
                <span className="text-4xl font-extrabold text-gray-900">£29</span>
                <span className="text-gray-500">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {['1 WhatsApp number', '200 conversations/month', 'AI auto-replies 24/7', 'Business hours setup', 'Conversation dashboard'].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-600">
                    {CHECK_ICON}
                    {item}
                  </li>
                ))}
              </ul>
              <Link to="/register" className="block w-full text-center bg-white border-2 border-gray-200 hover:border-[#25D366] text-gray-700 hover:text-[#128C7E] font-semibold py-3 rounded-full transition-all">
                Start Free Trial
              </Link>
            </div>

            {/* Business */}
            <div className="bg-white rounded-2xl p-8 border-2 border-[#25D366] shadow-xl shadow-green-100/50 relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#25D366] text-white text-xs font-bold px-4 py-1 rounded-full">
                Most Popular
              </div>
              <h3 className="text-lg font-bold text-gray-900">Business</h3>
              <p className="text-sm text-gray-500 mt-1">For growing businesses</p>
              <div className="mt-6 mb-6">
                <span className="text-4xl font-extrabold text-gray-900">£49</span>
                <span className="text-gray-500">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  '1 WhatsApp number',
                  { text: 'Unlimited', bold: true, rest: ' conversations' },
                  'AI auto-replies 24/7',
                  'Appointment booking',
                  'Lead qualification',
                  'Custom AI training',
                  'Priority support',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    {CHECK_ICON}
                    {typeof item === 'string' ? item : <><strong>{item.text}</strong>{item.rest}</>}
                  </li>
                ))}
              </ul>
              <Link to="/register" className="block w-full text-center bg-[#25D366] hover:bg-[#128C7E] text-white font-semibold py-3 rounded-full transition-all hover:shadow-lg hover:shadow-green-200">
                Start Free Trial
              </Link>
            </div>

            {/* Team */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 hover:border-gray-300 transition-all hover:shadow-lg">
              <h3 className="text-lg font-bold text-gray-900">Team</h3>
              <p className="text-sm text-gray-500 mt-1">For businesses with staff</p>
              <div className="mt-6 mb-6">
                <span className="text-4xl font-extrabold text-gray-900">£89</span>
                <span className="text-gray-500">/month</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  'Up to 3 WhatsApp numbers',
                  { text: 'Unlimited', bold: true, rest: ' conversations' },
                  'Everything in Business',
                  'Team dashboard',
                  'Conversation routing',
                  'Dedicated account manager',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    {CHECK_ICON}
                    {typeof item === 'string' ? item : <><strong>{item.text}</strong>{item.rest}</>}
                  </li>
                ))}
              </ul>
              <Link to="/register" className="block w-full text-center bg-white border-2 border-gray-200 hover:border-[#25D366] text-gray-700 hover:text-[#128C7E] font-semibold py-3 rounded-full transition-all">
                Start Free Trial
              </Link>
            </div>
          </div>
          <p className="text-center text-sm text-gray-400 mt-8">All plans include a 7-day free trial. No credit card required. Cancel anytime.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-[#25D366] text-sm font-semibold uppercase tracking-wider">FAQ</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-3">Common questions</h2>
          </div>
          <div className="space-y-4">
            {FAQ_ITEMS.map((item, i) => (
              <FaqItem key={i} item={item} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-[#075E54]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Stop losing customers to slow replies</h2>
          <p className="text-lg text-green-100 mb-8">Join hundreds of businesses that never miss a WhatsApp message. Start your free trial in 30 seconds.</p>
          <Link
            to="/register"
            className="inline-block bg-[#25D366] hover:bg-white hover:text-[#075E54] text-white text-lg font-bold px-10 py-4 rounded-full transition-all hover:shadow-xl"
          >
            Start Your Free Trial
          </Link>
          <p className="text-green-200/60 text-sm mt-4">No credit card required. Setup in 30 seconds. Cancel anytime.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-[#25D366] rounded-full flex items-center justify-center">
                  {WHATSAPP_ICON}
                </div>
                <span className="text-white font-bold">HeyElsie</span>
              </div>
              <p className="text-sm">Your AI receptionist on WhatsApp. Never miss a customer again.</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition">How it works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Industries</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">Dentists</a></li>
                <li><a href="#" className="hover:text-white transition">Salons</a></li>
                <li><a href="#" className="hover:text-white transition">Estate Agents</a></li>
                <li><a href="#" className="hover:text-white transition">Clinics</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/privacy" className="hover:text-white transition">Privacy Policy</Link></li>
                <li><Link to="/terms" className="hover:text-white transition">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-sm text-center">
            <p>&copy; 2026 HeyElsie. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
