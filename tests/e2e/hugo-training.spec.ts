import { test, expect, type Page, type Route } from '@playwright/test'

/**
 * /hugo-training, the owner's copy of the caller training.
 *
 * The single most important thing on this page is that PEDRO CANNOT OPEN IT.
 * He knows 1176, and behind this PIN is every answer to the timed test he sits
 * next door. So the first test here is the negative one.
 *
 * The PIN is checked by the server, never in the browser, so these tests drive
 * the gate through a mocked endpoint that behaves the way the real one does:
 * 8642 is accepted, anything else is a 401. tests/training-answer-key.test.ts
 * covers the other half, that the real routes are wired to Hugo's PIN only and
 * that neither the PIN nor the answers are ever bundled.
 */

const SESSION = '**/api/hugo-training/session'
const QUESTIONS = '**/api/hugo-training/questions'
const PRACTICE = '**/api/hugo-training/practice'

const HUGO_PIN = '8642'
const PEDRO_PIN = '1176'

function sessionBody() {
  return {
    ok: true,
    videos: [
      { key: 'estate-agents', title: 'Estate Agents', why: 'Why agents are the best source.', source: 'storage', durationLabel: '12m 51s', durationSec: 772, required: true, credit: null, url: 'about:blank', youtubeId: null, pct: 0 },
      { key: 'offer-without-offering', title: 'Offer Without Offering', why: 'The money technique.', source: 'storage', durationLabel: '4m 01s', durationSec: 241, required: true, credit: null, url: 'about:blank', youtubeId: null, pct: 0 },
      { key: 'live-agent-call-harvey', title: 'Live Agent Call With Harvey', why: 'A real recorded call.', source: 'storage', durationLabel: '9m 55s', durationSec: 595, required: true, credit: null, url: 'about:blank', youtubeId: null, pct: 0 },
      { key: 'live-call-vincent', title: 'Live BRRR Deal', why: 'A second live call.', source: 'youtube', durationLabel: '7m 35s', durationSec: 455, required: true, credit: 'Vincent Hovorka', url: null, youtubeId: 'e2e-not-a-real-id', pct: 0 },
      { key: 'bonus-sourcing', title: 'Bonus: what the job actually is', why: 'The role in two minutes.', source: 'storage', durationLabel: '1m 52s', durationSec: 112, required: false, credit: null, url: 'about:blank', youtubeId: null, pct: 0 },
      { key: 'bonus-brrr-explained', title: 'Bonus: what the buyer is trying to do', why: 'Background, not script.', source: 'youtube', durationLabel: '8m 09s', durationSec: 489, required: false, credit: 'Samuel Leeds', url: null, youtubeId: 'e2e-not-a-real-id-2', pct: 0 },
    ],
    counts: { required: 4, optional: 2, questionsInBank: 57 },
    quiz: { questionCount: 20, secondsPerQuestion: 30, passPct: 70, watchedThreshold: 95 },
  }
}

const ANSWER_KEY = {
  ok: true,
  total: 57,
  groups: [
    {
      source: 'offer-without-offering',
      label: 'Video 2: Offer Without Offering',
      questions: [
        {
          id: 'owo_exact_wording',
          kind: 'mc',
          prompt: 'Which of these is offering without offering?',
          answer: '"If we were to offer around 160, am I in the ballpark or a million miles off?"',
          distractors: ['"I would like to offer 160."', '"We are offering 160, take it or leave it."'],
          explanation: 'One word change. It floats the number without putting an offer on the table.',
        },
      ],
    },
    {
      source: 'live-call-vincent',
      label: 'Video 4: Live BRRR Deal (Vincent Hovorka)',
      questions: [
        {
          id: 'vin_two_questions',
          kind: 'mc',
          prompt: 'He says there are two questions he ALWAYS asks. What are they?',
          answer: 'What it would sell for once it is done up, and what rent it would achieve.',
          distractors: ['What the vendor paid for it, and whether they have a mortgage.'],
          explanation: 'Those two answers tell him whether the deal is worth driving to.',
        },
      ],
    },
    {
      source: 'script',
      label: 'The call script',
      questions: [
        {
          id: 'script_company_name',
          kind: 'short',
          prompt: 'What company do you say you are with? One word.',
          answer: 'unico',
          distractors: [],
          explanation: 'Unico. The legal name only if they press.',
        },
      ],
    },
  ],
}

async function mockApi(page: Page, submitted: Array<Record<string, unknown>> = []) {
  await page.route('https://www.youtube.com/**', (route: Route) => route.abort())

  const gate = (route: Route, ok: () => unknown) => {
    const body = JSON.parse(route.request().postData() || '{}')
    if (body.pin !== HUGO_PIN) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Wrong PIN' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ok()) })
  }

  await page.route(SESSION, (route) => gate(route, sessionBody))
  await page.route(QUESTIONS, (route) => gate(route, () => ANSWER_KEY))
  await page.route(PRACTICE, (route) =>
    gate(route, () => {
      const body = JSON.parse(route.request().postData() || '{}')
      if (body.action === 'start') {
        return {
          ok: true,
          attempt_id: 'hugo-attempt-1',
          // Zero is what turns the clock off.
          secondsPerQuestion: 0,
          passPct: 70,
          questions: [
            { kind: 'mc', prompt: 'Which of these is offering without offering?', options: ['"I would like to offer 160."', '"If we were to offer around 160?"'] },
          ],
        }
      }
      submitted.push(body)
      return {
        ok: true,
        score: 1,
        total: 1,
        pct: 100,
        passed: true,
        results: [{
          prompt: 'Which of these is offering without offering?',
          kind: 'mc',
          given: '"If we were to offer around 160?"',
          answered: true,
          correct: true,
          correctAnswer: '"If we were to offer around 160?"',
          explanation: 'One word change.',
        }],
      }
    }),
  )
}

async function unlock(page: Page, pin = HUGO_PIN) {
  await page.goto('/hugo-training')
  await expect(page.getByRole('heading', { name: /enter pin/i })).toBeVisible()
  await page.locator('input').fill(pin)
  await page.getByRole('button', { name: /unlock/i }).click()
}

test.describe('/hugo-training', () => {
  test('PEDRO S PIN DOES NOT OPEN IT', async ({ page }) => {
    // The whole point. If 1176 worked here, Pedro could read every answer and
    // the timed test next door would be theatre.
    await mockApi(page)
    await unlock(page, PEDRO_PIN)

    await expect(page.getByText(/wrong pin/i)).toBeVisible()
    await expect(page.getByTestId('hugo-answer-key')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: /enter pin/i })).toBeVisible()

    // And nothing about the answers leaked into the page while it was refused.
    const html = await page.content()
    expect(html).not.toContain('If we were to offer around 160')
  })

  test('the PIN is never compared in the browser', async ({ page }) => {
    // A wrong PIN must produce a REQUEST. If the page decided by itself, the
    // right PIN would be in the bundle for Pedro to read.
    await mockApi(page)
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/hugo-training/session')) posts.push(r.postData() || '')
    })
    await unlock(page, '0000')
    await expect(page.getByText(/wrong pin/i)).toBeVisible()
    expect(posts.some((p) => p.includes('0000'))).toBe(true)
  })

  test('8642 opens it, and lands on the answer key', async ({ page }) => {
    await mockApi(page)
    await unlock(page)

    await expect(page.getByRole('heading', { name: /what pedro is being taught/i })).toBeVisible()
    const key = page.getByTestId('hugo-answer-key')
    await expect(key).toBeVisible()

    // Every question, with the right answer, the wrong ones, and the why.
    await expect(key).toContainText('Which of these is offering without offering?')
    await expect(key).toContainText('Answer:')
    await expect(key).toContainText('If we were to offer around 160')
    await expect(key).toContainText('I would like to offer 160.')
    await expect(key).toContainText('One word change')

    // Grouped by where the question came from, including the new video.
    await expect(key).toContainText('Video 2: Offer Without Offering')
    await expect(key).toContainText('Video 4: Live BRRR Deal (Vincent Hovorka)')
    await expect(key).toContainText('The call script')

    // The whole bank, not the 20 Pedro is served.
    await expect(key).toContainText('All 57 questions')
    await expect(page.getByRole('button', { name: /^print$/i })).toBeVisible()
  })

  test('the header explains the split and the counts', async ({ page }) => {
    await mockApi(page)
    await unlock(page)
    const header = page.locator('header')
    await expect(header).toContainText('4 required')
    await expect(header).toContainText('2 optional')
    await expect(header).toContainText('57 questions')
    await expect(header).toContainText('30 seconds')
    // And the warning about not handing the PIN over.
    await expect(header).toContainText(/different PIN to Pedro/i)
  })

  test('no video gate: everything plays and nothing is tracked', async ({ page }) => {
    await mockApi(page)
    await unlock(page)
    await page.getByTestId('hugo-tab-videos').click()

    await expect(page.getByTestId('hugo-videos')).toBeVisible()
    for (const key of ['estate-agents', 'offer-without-offering', 'live-agent-call-harvey',
                       'live-call-vincent', 'bonus-sourcing', 'bonus-brrr-explained']) {
      await expect(page.getByTestId(`training-video-${key}`)).toBeVisible()
    }
    // None of Pedro's gate furniture exists here.
    await expect(page.getByTestId('training-progress')).toHaveCount(0)
    await expect(page.getByTestId('quiz-locked')).toHaveCount(0)
    await expect(page.getByText(/videos complete/i)).toHaveCount(0)
    // No watch bar, because nothing he does is recorded.
    await expect(page.getByTestId('training-pct-estate-agents')).toHaveCount(0)
  })

  test('the practice run is reachable with no gate and has no timer', async ({ page }) => {
    const submitted: Array<Record<string, unknown>> = []
    await mockApi(page, submitted)
    await unlock(page)
    await page.getByTestId('hugo-tab-practice').click()

    const warning = page.getByTestId('quiz-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText(/no timer on this one/i)
    await expect(warning).toContainText('30 seconds a question')

    await page.getByTestId('quiz-begin').click()
    await expect(page.getByTestId('quiz-running')).toBeVisible()
    // No countdown at all, and it does not move on by itself.
    await expect(page.getByTestId('quiz-timer')).toHaveCount(0)
    await expect(page.getByTestId('quiz-untimed')).toBeVisible()
    await page.waitForTimeout(3000)
    await expect(page.getByTestId('quiz-running')).toContainText('Question 1 of 1')

    await page.getByTestId('quiz-option').nth(1).click()
    await expect(page.getByTestId('quiz-result')).toContainText('100%')
    // It went to HIS route, not the one that holds Pedro's gate.
    expect(submitted).toHaveLength(1)
    expect(submitted[0].attempt_id).toBe('hugo-attempt-1')
  })

  test('the page is marked noindex', async ({ page }) => {
    await mockApi(page)
    await page.goto('/hugo-training')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
  })
})
