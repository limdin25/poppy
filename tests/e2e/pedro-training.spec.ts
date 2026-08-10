import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * /pedro-training, the PIN-gated property cold-calling training page.
 *
 * The API side (api/pedro-training/*) is a set of Vercel functions, which the vite
 * dev server does not run, so the four endpoints are intercepted here. That is
 * deliberate rather than a shortcut: it makes the test deterministic (no live
 * Supabase, no real 43 MB mp4 download on every run) and it lets the locked and
 * unlocked states both be exercised in the same run, which a real account
 * cannot do because watching a video is a one-way door.
 *
 * What is genuinely under test is everything that lives in the browser: the PIN
 * gate, the videos rendering, the quiz staying locked until the three required
 * videos are watched, the real 30 second countdown, the auto-advance when it
 * expires, and the submitted payload plus the score screen.
 */

const SESSION = '**/api/pedro-training/session'
const QUIZ = '**/api/pedro-training/quiz'
const PROGRESS = '**/api/pedro-training/progress'

interface SessionOpts {
  watched: boolean
  secondsPerQuestion?: number
}

function sessionBody({ watched, secondsPerQuestion = 30 }: SessionOpts) {
  const pct = watched ? 100 : 0
  return {
    ok: true,
    videos: [
      { key: 'estate-agents', title: 'Estate Agents', why: 'Why agents are the best source.', source: 'storage', durationLabel: '12m 51s', durationSec: 772, required: true, credit: null, url: 'about:blank', youtubeId: null, pct, watchedSec: 0, completed: watched },
      { key: 'offer-without-offering', title: 'Offer Without Offering', why: 'The technique the money section is built on.', source: 'storage', durationLabel: '4m 01s', durationSec: 241, required: true, credit: null, url: 'about:blank', youtubeId: null, pct, watchedSec: 0, completed: watched },
      { key: 'live-agent-call-harvey', title: 'Live Agent Call With Harvey', why: 'A real recorded cold call.', source: 'storage', durationLabel: '9m 55s', durationSec: 595, required: true, credit: null, url: 'about:blank', youtubeId: null, pct, watchedSec: 0, completed: watched },
      // The YouTube one. Deliberately given a bad id so the player fails fast
      // and the run needs no network: what is under test here is the gate
      // counting it, not YouTube itself.
      { key: 'live-call-vincent', title: 'Live BRRR Deal: how to talk to estate agents on the phone', why: 'A second live call, different person.', source: 'youtube', durationLabel: '7m 35s', durationSec: 455, required: true, credit: 'Vincent Hovorka', url: null, youtubeId: 'e2e-not-a-real-id', pct, watchedSec: 0, completed: watched },
      { key: 'bonus-sourcing', title: 'Bonus: what the job actually is', why: 'The whole role in two minutes.', source: 'storage', durationLabel: '1m 52s', durationSec: 112, required: false, credit: null, url: 'about:blank', youtubeId: null, pct: 0, watchedSec: 0, completed: false },
      { key: 'bonus-brrr-explained', title: 'Bonus: what the buyer is actually trying to do', why: 'Background, not script.', source: 'youtube', durationLabel: '8m 09s', durationSec: 489, required: false, credit: 'Samuel Leeds', url: null, youtubeId: 'e2e-not-a-real-id-2', pct: 0, watchedSec: 0, completed: false },
    ],
    quiz: {
      unlocked: watched,
      watchedThreshold: 95,
      questionCount: 20,
      secondsPerQuestion,
      passPct: 70,
      lastAttempt: null,
    },
  }
}

/** Two questions, so a full run is short. */
const QUESTIONS = [
  {
    kind: 'mc',
    prompt: 'Which of these is offering without offering?',
    options: [
      '"I would like to offer 160."',
      '"If we were to offer around 160, am I in the ballpark or a million miles off?"',
    ],
  },
  {
    kind: 'mc',
    prompt: 'They ask who is calling. What do you say?',
    options: [
      'Your name, that you work with the director Hugo at Unico, and that you buy with cash.',
      'That you would rather not say.',
    ],
  },
]

/** Captured submit payloads, so the test can prove what was actually sent. */
async function mockApi(page: Page, opts: SessionOpts, submitted: Array<Record<string, unknown>>) {
  // The two YouTube cards are embedded for real in production. Here the player
  // script is blocked so the suite needs no network and cannot be made flaky by
  // somebody else's CDN. The component is expected to survive that and show its
  // own fallback, which is asserted below: a player that cannot load must never
  // take the page down with it.
  await page.route('https://www.youtube.com/**', (route: Route) => route.abort())
  await page.route(SESSION, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionBody(opts)) }),
  )
  await page.route(PROGRESS, (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pct: 0 }) }),
  )
  await page.route(QUIZ, async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.action === 'start') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          attempt_id: 'attempt-e2e-1',
          secondsPerQuestion: opts.secondsPerQuestion ?? 30,
          passPct: 70,
          questions: QUESTIONS,
        }),
      })
    }
    submitted.push(body)
    // Grade exactly as the real route would for the answers this test gives.
    const answers = (body.answers ?? []) as Array<number | null>
    const correctIdx = [1, 0]
    const results = QUESTIONS.map((q, i) => ({
      prompt: q.prompt,
      kind: 'mc',
      given: typeof answers[i] === 'number' ? q.options[answers[i] as number] : '',
      answered: answers[i] !== null && answers[i] !== undefined,
      correct: answers[i] === correctIdx[i],
      correctAnswer: q.options[correctIdx[i]],
      explanation: 'Explanation shown at the end, because this is training.',
    }))
    const score = results.filter((r) => r.correct).length
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        score,
        total: results.length,
        pct: Math.round((score / results.length) * 100),
        passed: score === results.length,
        results,
      }),
    })
  })
}

async function unlock(page: Page) {
  await page.goto('/pedro-training')
  await expect(page.getByRole('heading', { name: /enter pin/i })).toBeVisible()
  await page.locator('input').fill('1176')
  await page.getByRole('button', { name: /unlock/i }).click()
}

test.describe('/pedro-training', () => {
  test('the PIN gate blocks the page, and 1176 opens it', async ({ page }) => {
    await mockApi(page, { watched: false }, [])
    await page.goto('/pedro-training')

    // Locked: gate only, nothing behind it.
    await expect(page.getByRole('heading', { name: /enter pin/i })).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)
    await expect(page.getByTestId('training-progress')).toHaveCount(0)

    // A wrong PIN is refused and stays refused.
    await page.locator('input').fill('9999')
    await page.getByRole('button', { name: /unlock/i }).click()
    await expect(page.getByText(/wrong pin/i)).toBeVisible()
    await expect(page.locator('video')).toHaveCount(0)

    // The right one opens it.
    await page.locator('input').fill('1176')
    await page.getByRole('button', { name: /unlock/i }).click()
    await expect(page.getByRole('heading', { name: /ringing estate agents about houses/i })).toBeVisible()
  })

  test('the page is marked noindex', async ({ page }) => {
    await mockApi(page, { watched: false }, [])
    await page.goto('/pedro-training')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content', /noindex/i,
    )
  })

  test('all six videos render, and the quiz is locked until the four required are watched', async ({ page }) => {
    await mockApi(page, { watched: false }, [])
    await unlock(page)

    for (const key of ['estate-agents', 'offer-without-offering', 'live-agent-call-harvey',
                       'live-call-vincent', 'bonus-sourcing', 'bonus-brrr-explained']) {
      await expect(page.getByTestId(`training-video-${key}`)).toBeVisible()
    }
    // Four self-hosted mp4s render as <video>; the two YouTube ones do not.
    await expect(page.locator('video')).toHaveCount(4)

    // A YouTube card that cannot load says so, and the rest of the page lives.
    await expect(page.getByTestId('youtube-failed').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /ringing estate agents about houses/i })).toBeVisible()

    // The two optional ones are marked as extra and do not count to the gate.
    await expect(page.getByText(/extra, not required/i).first()).toBeVisible()
    await expect(page.getByText(/extra, not required/i)).toHaveCount(2)
    await expect(page.getByTestId('training-progress')).toContainText('0 of 4 videos complete')
    await expect(page.getByTestId('quiz-locked')).toBeVisible()
    await expect(page.getByTestId('quiz-warning')).toHaveCount(0)
  })

  test('watching the four required unlocks the quiz, behind a warning screen', async ({ page }) => {
    await mockApi(page, { watched: true }, [])
    await unlock(page)

    await expect(page.getByTestId('training-progress')).toContainText('4 of 4 videos complete')
    await expect(page.getByTestId('quiz-locked')).toHaveCount(0)

    // He is told the rules before the clock starts.
    const warning = page.getByTestId('quiz-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('30 seconds per question')
    await expect(warning).toContainText(/cannot go back/i)
    // No question is on the page until he presses the button.
    await expect(page.getByTestId('quiz-running')).toHaveCount(0)
  })

  test('the timer counts down and only one question is ever in the DOM', async ({ page }) => {
    await mockApi(page, { watched: true }, [])
    await unlock(page)
    await page.getByTestId('quiz-begin').click()

    await expect(page.getByTestId('quiz-running')).toBeVisible()
    await expect(page.getByTestId('quiz-timer')).toHaveText('30s')
    await expect(page.getByTestId('quiz-running')).toContainText('Question 1 of 2')

    // Question two is not rendered anywhere yet.
    await expect(page.getByTestId('quiz-prompt')).toHaveCount(1)
    await expect(page.getByTestId('quiz-option')).toHaveCount(2)
    const first = await page.getByTestId('quiz-prompt').innerText()

    // It really ticks.
    await expect(page.getByTestId('quiz-timer')).toHaveText(/2[0-7]s/, { timeout: 12_000 })

    // Answering moves on and resets the clock.
    await page.getByTestId('quiz-option').first().click()
    await expect(page.getByTestId('quiz-running')).toContainText('Question 2 of 2')
    await expect(page.getByTestId('quiz-prompt')).not.toHaveText(first)
    await expect(page.getByTestId('quiz-timer')).toHaveText(/2[89]s|30s/)
  })

  test('running out of time auto-advances and the question counts as unanswered', async ({ page }) => {
    // The real 30 seconds, waited out, because that is the rule being tested.
    test.setTimeout(120_000)
    const submitted: Array<Record<string, unknown>> = []
    await mockApi(page, { watched: true }, submitted)
    await unlock(page)
    await page.getByTestId('quiz-begin').click()

    await expect(page.getByTestId('quiz-running')).toContainText('Question 1 of 2')
    // Touch nothing. It should move on by itself.
    await expect(page.getByTestId('quiz-running')).toContainText('Question 2 of 2', { timeout: 45_000 })

    // Answer the second one so the attempt submits.
    await page.getByTestId('quiz-option').first().click()
    await expect(page.getByTestId('quiz-result')).toBeVisible()

    // The skipped question went up as null, i.e. unanswered.
    expect(submitted).toHaveLength(1)
    expect(submitted[0].answers).toEqual([null, 0])
    await expect(page.getByTestId('quiz-result')).toContainText(/ran out of time/i)
  })

  test('the score is submitted, persisted and shown with the right answers', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockApi(page, { watched: true }, submitted)
    await unlock(page)
    await page.getByTestId('quiz-begin').click()

    // Get the first one right, the second one wrong.
    await page.getByTestId('quiz-option').nth(1).click()
    await expect(page.getByTestId('quiz-running')).toContainText('Question 2 of 2')
    await page.getByTestId('quiz-option').nth(1).click()

    // It went to the server, tied to the attempt the server issued.
    expect(submitted).toHaveLength(1)
    expect(submitted[0].attempt_id).toBe('attempt-e2e-1')
    expect(submitted[0].answers).toEqual([1, 1])
    expect(typeof submitted[0].duration_sec).toBe('number')

    // And he is shown the score, what he got wrong, and why.
    const result = page.getByTestId('quiz-result')
    await expect(result).toBeVisible()
    await expect(result).toContainText('50%')
    await expect(result).toContainText('1 out of 2 right')
    await expect(result).toContainText(/right answer:/i)
    await expect(result).toContainText(/because this is training/i)
  })
})
