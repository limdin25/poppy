import { useEffect, useMemo, useState } from 'react'
import { Lock, Check, Copy, CopyCheck } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import {
  BLUE,
  BLUE_DARK,
  BLUE_WASH,
  INK,
  GREY,
  GREY_DARK,
  BORDER,
  DISPLAY,
  CARD,
  BTN_BLUE,
  FIELD,
  LABEL,
} from '@/core/ui/brand'

// Same PIN as /script (heyelsie.com/script) — one code for both internal pages.
const PIN = '1176'
const UNLOCK_COOKIE = 'elsie_blueprint_unlocked'
const PROGRESS_COOKIE = 'elsie_blueprint_progress'
const COOKIE_DAYS = 400 // longest a cookie is allowed to live — keeps progress across the whole build

function setCookie(name: string, value: string, days: number) {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString()
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
  } catch {
    // cookies blocked — page still works, progress just won't persist
  }
}

function getCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

// "do" = something only a human can click (an installer, an extension button).
// "ask" = you don't do this yourself, you hand the exact sentence to Claude.
type Step = { id: string; title: string; body: string; tip: string; ask?: string }
type Section = { title: string; steps: Step[] }

const SECTIONS: Section[] = [
  {
    title: '1. Get Claude working on your computer',
    steps: [
      {
        id: 'cursor',
        title: 'Download Cursor',
        body: 'Go to cursor.com, click Download, open the file, click Install. Exactly like installing any normal app.',
        tip: 'Cursor is the program you will type into. It is free.',
      },
      {
        id: 'claude-extension',
        title: 'Install Claude inside Cursor',
        body: "Open Cursor. Click the four-squares icon on the left edge. Type 'Claude Code' in the search box. Click Install, then Sign In (a free account takes a minute at claude.com).",
        tip: 'This turns Cursor into a chat window where Claude can read, write and run things on your computer for you.',
      },
      {
        id: 'kimi',
        title: 'Install Chrome and Kimi WebBridge',
        body: "If you don't already have it, download Chrome from google.com/chrome. Then add the Kimi WebBridge extension the same way, download, click Add to Chrome.",
        tip: 'This lets Claude click and type inside your real browser, so it can create your accounts for you instead of you doing it by hand.',
      },
    ],
  },
  {
    title: '2. From here, just ask Claude',
    steps: [
      {
        id: 'supabase',
        title: 'Get a database',
        body: 'Supabase is where your app remembers things, like a filing cabinet. You never touch it yourself.',
        ask: 'Please create me a free Supabase account and set up a database for this project.',
        tip: 'Claude does the clicking through your browser, you just approve anything it asks you to confirm.',
      },
      {
        id: 'vercel',
        title: 'Get your site hosted',
        body: 'Vercel is what turns your code into a real website anyone can visit.',
        ask: 'Please create me a free Vercel account so we can publish this project.',
        tip: 'Free to start. Claude publishes every update from here for the rest of the project.',
      },
      {
        id: 'domain',
        title: 'Get a domain name',
        body: 'The web address people will type to find you, for example yourbusiness.com. You only buy one, ever.',
        ask: 'Please help me buy a domain name for this project and connect it.',
        tip: 'Claude tells you exactly which button to press to buy it, then connects it for you. Every new app you build later lives on a free subdomain of this same one, like app.yourbusiness.com, you never buy a second domain.',
      },
      {
        id: 'ai-key',
        title: "Give your app its own AI",
        body: 'Separate from the Claude helping you build, this is the AI your finished app uses once it is live.',
        ask: 'Please set up an Anthropic or OpenAI account so my app has its own AI to use.',
        tip: 'Either provider works. Claude uses whichever one gets set up.',
      },
      {
        id: 'resend',
        title: 'Get your app sending emails',
        body: 'Handles confirmations, receipts and password resets, so they land in the inbox, not spam.',
        ask: 'Please set up a free Resend account so my app can send emails.',
        tip: 'Free for thousands of emails a month.',
      },
      {
        id: 'stripe',
        title: 'Get paid (Stripe)',
        body: 'Stripe is how your app takes payments from customers, cards, subscriptions, all of it.',
        ask: 'Please set up a free Stripe account so my app can take payments.',
        tip: 'Only needed once your app charges people. Free to set up, Stripe takes a small cut per payment.',
      },
      {
        id: 'give-keys',
        title: 'Hand Claude everything at once',
        body: 'Every account above, paste the details in together, in your own words, this is the one big handover.',
        ask: 'Here are my logins for Supabase, Vercel, my domain, my AI account, Resend and Stripe, please remember all of them so I never have to repeat myself.',
        tip: 'Claude stores these safely and reuses them for the rest of the project, you are never asked twice.',
      },
      {
        id: 'claude-md',
        title: 'Set up your rules file',
        body: "A plain-English instruction manual so every conversation with Claude starts knowing how you like to work. This is also where you set the subdomain rule below.",
        ask: 'Please create a CLAUDE.md file with the rules for how you want me to work with you. Add a rule that every new app or big new feature gets its own subdomain, its own Supabase project, and everything else it needs to run, never sharing with an existing app unless I ask.',
        tip: 'One domain and one set of accounts covers everything you will ever build, each new app just gets its own subdomain and its own Supabase project underneath. Writing the rule down here means Claude follows it automatically from now on.',
      },
    ],
  },
  {
    title: '3. Start building',
    steps: [
      {
        id: 'explain-first',
        title: 'Ask Claude to explain first',
        body: 'Get the tour before you touch anything, this is how you learn.',
        ask: 'Before you change anything, explain how this part works in plain English.',
        tip: 'You pick up the patterns just by reading Claude’s answer, not by guessing.',
      },
      {
        id: 'first-feature',
        title: 'Ask for one small thing',
        body: 'Pick something small and real, a button, a form, one page, and ask for it start to finish.',
        ask: 'Please build me one small thing, for example a single button or a simple page.',
        tip: 'Small wins first. Once one thing works, bigger things use the exact same process.',
      },
      {
        id: 'new-page',
        title: 'Ask for a whole new page or subdomain',
        body: 'Once the basics work, stretch further, a new page, or a whole new app living on its own subdomain of the domain you already own.',
        ask: 'Please build me a brand new page, or a whole new app on its own subdomain, that does what I describe.',
        tip: 'Same process as before, just bigger. Because the subdomain rule is already in your CLAUDE.md, Claude sets this up correctly without being reminded.',
      },
    ],
  },
]

const TOTAL_STEPS = SECTIONS.reduce((n, s) => n + s.steps.length, 0)

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="What is this for?"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="w-[18px] h-[18px] rounded-full grid place-items-center text-[10.5px] font-bold shrink-0"
        style={{ background: BLUE_WASH, color: BLUE }}
      >
        !
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className="absolute z-50 left-1/2 -translate-x-1/2 top-[calc(100%+8px)] w-56 rounded-xl bg-white p-3 text-[12px] leading-snug text-left shadow-lg"
          style={{ color: GREY_DARK, border: `1px solid ${BORDER}` }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

function AskChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="mt-2 w-full flex items-start gap-2 rounded-xl px-3 py-2 text-left transition"
      style={{ background: BLUE_WASH }}
    >
      <span className="flex-1 text-[12.5px] italic leading-snug" style={{ color: BLUE_DARK }}>
        Ask Claude: &ldquo;{text}&rdquo;
      </span>
      <span
        className="shrink-0 flex items-center gap-1 text-[11px] font-bold not-italic mt-0.5"
        style={{ color: copied ? '#1a8f4c' : BLUE }}
      >
        {copied ? <CopyCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  )
}

export default function BlueprintPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  useEffect(() => {
    document.title = 'Dev Environment Blueprint'
    if (getCookie(UNLOCK_COOKIE) === '1') setUnlocked(true)
    const saved = getCookie(PROGRESS_COOKIE)
    if (saved) {
      try {
        setChecked(new Set(JSON.parse(saved)))
      } catch {
        // corrupt cookie — start fresh
      }
    }
  }, [])

  const doneCount = checked.size
  const percent = useMemo(() => Math.round((doneCount / TOTAL_STEPS) * 100), [doneCount])

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setCookie(PROGRESS_COOKIE, JSON.stringify([...next]), COOKIE_DAYS)
      return next
    })
  }

  const reset = () => {
    setChecked(new Set())
    setCookie(PROGRESS_COOKIE, JSON.stringify([]), COOKIE_DAYS)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.trim() === PIN) {
      setUnlocked(true)
      setCookie(UNLOCK_COOKIE, '1', COOKIE_DAYS)
    } else {
      setError(true)
      setPin('')
    }
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <form onSubmit={submit} className={cn('w-full max-w-xs rounded-2xl p-7 text-center', CARD)}>
          <div
            className="w-11 h-11 rounded-xl grid place-items-center mx-auto mb-4"
            style={{ background: BLUE_WASH, color: BLUE }}
          >
            <Lock className="w-5 h-5" />
          </div>
          <h1 className={cn(DISPLAY, 'text-[17px] mb-1')} style={{ color: INK }}>
            Enter PIN
          </h1>
          <p className="text-[13px] mb-5" style={{ color: GREY }}>
            This page is protected.
          </p>
          <input
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''))
              setError(false)
            }}
            inputMode="numeric"
            autoFocus
            placeholder="••••"
            className={cn(FIELD, 'text-center tracking-[8px] font-mono mb-3 pl-4')}
          />
          {error && (
            <p className="text-[13px] mb-3" style={{ color: '#B42318' }}>
              Wrong PIN, try again.
            </p>
          )}
          <button type="submit" className={cn(BTN_BLUE, 'w-full h-11 text-[15px]')}>
            Unlock
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white" style={{ color: INK }}>
      <div className="max-w-2xl mx-auto px-5 py-12">
        <header className="mb-6">
          <p className={LABEL} style={{ color: BLUE }}>
            Dev environment blueprint
          </p>
          <h1 className={cn(DISPLAY, 'text-[30px] sm:text-[36px] mt-1 mb-3')}>
            Set up your coding environment
          </h1>
          <p className="text-[15px] leading-relaxed" style={{ color: GREY_DARK }}>
            The exact steps, in order, to start coding the way we do. Tick each one off as you go,
            your progress is saved in this browser.
          </p>
        </header>

        <div
          className="mb-8 rounded-2xl p-4 text-[13px] leading-relaxed"
          style={{ background: BLUE_WASH, color: GREY_DARK }}
        >
          <strong style={{ color: INK }}>New to this? </strong>
          You do not need to know how to do any of it yourself. Only the first three steps are
          things you click through by hand, everything after that, you hand to Claude, tap Copy
          and paste it into the chat. Stuck on any step? Just ask Claude &ldquo;how do I do this
          next step?&rdquo; and it will walk you through it.
        </div>

        <div className="flex items-center gap-4 mb-9">
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: BLUE_WASH }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${percent}%`, background: BLUE }}
            />
          </div>
          <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: GREY }}>
            {doneCount} / {TOTAL_STEPS} done
          </span>
        </div>

        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className={LABEL} style={{ marginBottom: 12 }}>
                {section.title}
              </h2>
              <div className="space-y-3">
                {section.steps.map((step) => {
                  const done = checked.has(step.id)
                  return (
                    <div
                      key={step.id}
                      onClick={() => toggle(step.id)}
                      className={cn('flex items-start gap-3 p-4 rounded-2xl cursor-pointer transition', CARD)}
                      style={done ? { background: BLUE_WASH } : undefined}
                    >
                      <span
                        className="mt-0.5 w-5 h-5 rounded-full grid place-items-center shrink-0 border-2 transition"
                        style={done ? { background: BLUE, borderColor: BLUE } : { borderColor: BORDER }}
                      >
                        {done && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3
                            className="text-[15px] font-bold"
                            style={done ? { color: GREY, textDecoration: 'line-through' } : { color: INK }}
                          >
                            {step.title}
                          </h3>
                          <InfoTip text={step.tip} />
                        </div>
                        <p className="text-[13px] mt-0.5" style={{ color: GREY }}>
                          {step.body}
                        </p>
                        {step.ask && <AskChip text={step.ask} />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 text-center">
          <button onClick={reset} className="text-[12px] font-semibold" style={{ color: GREY }}>
            Reset progress
          </button>
        </div>
      </div>
    </div>
  )
}
