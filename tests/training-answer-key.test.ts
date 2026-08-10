// The answer key must never be reachable by the person being tested.
//
// Two training pages exist. /pedro-training gives a timed test; /hugo-training
// shows every answer. They are one mistake apart from being the same thing:
//
//   - if Hugo's PIN is ever bundled into the browser, Pedro can read it out of
//     the JavaScript and open the answer key;
//   - if the answer-key route ever accepts Pedro's PIN, he does not even need
//     to look;
//   - if anything under src/ imports the question bank, the answers are in the
//     bundle and neither PIN matters.
//
// Each of those is one careless import away and none of them would fail loudly
// at runtime, so they are pinned here instead.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/** Every source file under src/, which is exactly what vite bundles. */
function srcFiles(dir = resolve(root, 'src')): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...srcFiles(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

describe('the quiz answers never reach the browser', () => {
  const files = srcFiles()

  /** Real imports only. A file is allowed to NAME a server module in a comment
   *  (and Hugo's page does, to explain why the PIN is not in it); what it may
   *  not do is pull the module in. */
  const importsOf = (src: string): string[] =>
    [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

  it('nothing under src/ imports the question bank', () => {
    const offenders = files.filter((f) =>
      importsOf(readFileSync(f, 'utf8')).some((i) => /training-questions/.test(i)))
    expect(offenders).toEqual([])
  })

  it('nothing under src/ imports Hugo s PIN module', () => {
    // api/lib/training.ts IS imported by the page (it holds the video list and
    // Pedro's public PIN). training-hugo.ts must never be, because it resolves
    // the PIN that opens the answer key.
    const offenders = files.filter((f) =>
      importsOf(readFileSync(f, 'utf8')).some((i) => /training-hugo/.test(i)))
    expect(offenders).toEqual([])
  })

  it('Hugo s page never compares a PIN in the browser', () => {
    const page = read('src/features/training/HugoTrainingPage.tsx')
    // No literal to compare against, and no client-side equality check.
    expect(page).not.toMatch(/8642/)
    expect(page).not.toMatch(/HUGO_TRAINING_PIN/)
    expect(page).not.toMatch(/=== *(TRAINING_PIN|PIN)\b/)
    // It asks the server instead.
    expect(page).toMatch(/\/api\/hugo-training\/session/)
    expect(page).toMatch(/res\.status === 401/)
  })

  it('Pedro s page still gets its questions with the answers stripped', () => {
    const quiz = read('api/pedro-training/quiz.ts')
    // What is stored server-side carries the correct index; what is returned
    // to the browser is built separately and has no `correct` on it.
    expect(quiz).toMatch(/served\.push\(\{ id: q\.id, kind: 'mc', options: shuffled, correct: shuffled\.indexOf\(correctText\) \}\)/)
    expect(quiz).toMatch(/forClient\.push\(\{ kind: 'mc', prompt: q\.prompt, options: shuffled \}\)/)
    expect(quiz).toMatch(/questions: forClient/)
    expect(quiz).not.toMatch(/questions: served/)
  })
})

describe('the two PINs are separate, and only one opens the answers', () => {
  const hugo = read('api/lib/training-hugo.ts')

  it('the answer key and the practice run are gated on Hugo s PIN only', () => {
    for (const route of ['api/hugo-training/questions.ts', 'api/hugo-training/practice.ts', 'api/hugo-training/session.ts']) {
      const src = read(route)
      expect(src).toMatch(/hugoPinOk\(body\.pin\)/)
      // Pedro's gate must not appear anywhere in them.
      expect(src).not.toMatch(/\bpinOk\(/)
      expect(src).not.toMatch(/TRAINING_PIN/)
    }
  })

  it('Pedro s routes are gated on Pedro s PIN only', () => {
    for (const route of ['api/pedro-training/session.ts', 'api/pedro-training/progress.ts', 'api/pedro-training/quiz.ts']) {
      const src = read(route)
      expect(src).toMatch(/pinOk\(body\.pin\)/)
      expect(src).not.toMatch(/hugoPinOk/)
      expect(src).not.toMatch(/training-hugo/)
    }
  })

  it('Hugo s PIN comes from an env var, and is not Pedro s', () => {
    expect(hugo).toMatch(/process\.env\.HUGO_TRAINING_PIN/)
    // The fallback exists so the page works on day one, and it must differ from
    // Pedro's or the separation is cosmetic.
    const fallback = hugo.match(/const FALLBACK_PIN = '(\d+)'/)?.[1]
    expect(fallback).toBeTruthy()
    expect(fallback).not.toBe('1176')
    expect(read('api/lib/training.ts')).toMatch(/TRAINING_PIN = '1176'/)
  })

  it('Hugo s practice attempts are filed under his own trainee key', () => {
    // Or a practice run would show up in the admin view as one of Pedro's real
    // scores, which is worse than useless.
    expect(hugo).toMatch(/HUGO_TRAINEE_KEY = 'hugo'/)
    const practice = read('api/hugo-training/practice.ts')
    expect(practice).toMatch(/trainee_key: HUGO_TRAINEE_KEY/)
    expect(practice).not.toMatch(/(?<![_A-Z])TRAINEE_KEY/)
  })
})

describe('the video list is one config, and the gate follows it', () => {
  const cfg = read('api/lib/training.ts')

  it('every video declares its source, its reference and whether it is required', () => {
    for (const key of ['estate-agents', 'offer-without-offering', 'live-agent-call-harvey',
                       'live-call-vincent', 'bonus-sourcing', 'bonus-brrr-explained']) {
      expect(cfg).toContain(`key: '${key}'`)
    }
    // Four required, two optional. Comments are stripped first: the block above
    // the array explains the flag by quoting it, which would be counted.
    const entries = cfg.slice(cfg.indexOf('export const TRAINING_VIDEOS'))
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
    expect(entries.match(/required: true/g) ?? []).toHaveLength(4)
    expect(entries.match(/required: false/g) ?? []).toHaveLength(2)
  })

  it('the YouTube ones are embedded by id and never downloaded', () => {
    expect(cfg).toMatch(/source: 'youtube',\n\s*ref: '9CCqIEp5CvI'/)
    expect(cfg).toMatch(/source: 'youtube',\n\s*ref: '2ro3oOjQATI'/)
    // No storage object name, no signed URL, for a YouTube video.
    const session = read('api/pedro-training/session.ts')
    expect(session).toMatch(/v\.source === 'storage'/)
    expect(session).toMatch(/youtubeId: v\.source === 'youtube' \? v\.ref : null/)
  })

  it('the gate counts the required videos and ignores the optional ones', () => {
    expect(cfg).toMatch(/REQUIRED_VIDEOS = TRAINING_VIDEOS\.filter\(\(v\) => v\.required\)/)
    expect(cfg).toMatch(/return REQUIRED_VIDEOS\.every\(\(v\) => \(pct\[v\.key\] \?\? 0\) >= WATCHED_PCT\)/)
  })

  it('adding a video cannot wipe what has already been watched', () => {
    // Progress rows are keyed on video_key and the writer only ever raises the
    // stored figure, so a new entry in the list adds a row and touches nothing.
    const progress = read('api/pedro-training/progress.ts')
    expect(progress).toMatch(/\.eq\('video_key', video\.key\)/)
    expect(progress).toMatch(/const watched = Math\.max\(previous, watchedClaim\)/)
    expect(progress).not.toMatch(/\.delete\(\)/)
  })
})

describe('the new questions came from the new video', () => {
  const bank = read('api/lib/training-questions.ts')

  it('has a source of its own so Hugo can see them grouped', () => {
    expect(bank).toMatch(/\| 'live-call-vincent'/)
    expect(read('api/hugo-training/questions.ts')).toMatch(/'live-call-vincent': 'Video 4/)
  })

  it('tests the things that video actually teaches', () => {
    for (const id of ['vin_no_answer', 'vin_two_questions', 'vin_why_ask_first',
                      'vin_first_clue', 'vin_already_sold', 'vin_permission', 'vin_maths']) {
      expect(bank).toContain(id)
    }
  })

  it('has no questions from the optional video, which nobody has to watch', () => {
    expect(bank).not.toMatch(/bonus-brrr-explained/)
    expect(bank).not.toMatch(/Samuel Leeds/)
  })

  it('has no long dashes, curly quotes or ellipsis characters', () => {
    for (const ch of ['—', '–', '‘', '’', '“', '”', '…']) {
      expect(bank).not.toContain(ch)
    }
  })
})
