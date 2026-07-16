import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://loggyxryrhqsbtqpteog.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUSINESS_ID = '8867c609-1686-4c09-82b1-3c55fb09c431'

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByText('Try demo account').click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('/', { timeout: 10_000 })
}

let contactId: string | null = null
let convoId: string | null = null
let imageMessageId: string | null = null
let audioMessageId: string | null = null
let videoMessageId: string | null = null
let reactionMessageId: string | null = null

test.beforeAll(async () => {
  const { data: contact } = await supabase
    .from('contacts')
    .insert({ business_id: BUSINESS_ID, phone: '+15551234567', name: 'Media Test User' })
    .select('id')
    .single()
  contactId = contact!.id

  const { data: convo } = await supabase
    .from('conversations')
    .insert({
      business_id: BUSINESS_ID,
      contact_id: contactId,
      channel: 'whatsapp',
      status: 'open',
      ai_handling: false,
      last_message_at: new Date().toISOString(),
      last_message_preview: 'Media test',
    })
    .select('id')
    .single()
  convoId = convo!.id

  // Image message
  const { data: imgMsg } = await supabase
    .from('messages')
    .insert({
      conversation_id: convoId,
      direction: 'inbound',
      sender: 'contact',
      content_type: 'image',
      body: 'Check this photo',
      media_url: 'https://loggyxryrhqsbtqpteog.supabase.co/storage/v1/object/public/media/attachments/backfill_3ABBDDD5EC30B0DB1B1F.jpg',
      metadata: { external_id: 'test-img-001' },
    })
    .select('id')
    .single()
  imageMessageId = imgMsg!.id

  // Audio message
  const { data: audMsg } = await supabase
    .from('messages')
    .insert({
      conversation_id: convoId,
      direction: 'inbound',
      sender: 'contact',
      content_type: 'audio',
      body: '',
      media_url: 'https://loggyxryrhqsbtqpteog.supabase.co/storage/v1/object/public/media/attachments/backfill_3A65EBC449E15424FE57.ogg',
      metadata: { external_id: 'test-aud-001' },
    })
    .select('id')
    .single()
  audioMessageId = audMsg!.id

  // Video message
  const { data: vidMsg } = await supabase
    .from('messages')
    .insert({
      conversation_id: convoId,
      direction: 'inbound',
      sender: 'contact',
      content_type: 'video',
      body: 'Watch this',
      media_url: 'https://loggyxryrhqsbtqpteog.supabase.co/storage/v1/object/public/media/attachments/backfill_3A252E28CD6563335D53.mp4',
      metadata: { external_id: 'test-vid-001' },
    })
    .select('id')
    .single()
  videoMessageId = vidMsg!.id

  // Message with reaction
  const { data: reactMsg } = await supabase
    .from('messages')
    .insert({
      conversation_id: convoId,
      direction: 'outbound',
      sender: 'human',
      content_type: 'text',
      body: 'Sounds good!',
      metadata: { external_id: 'test-react-001', reactions: [{ emoji: '👍', sender_id: '' }] },
    })
    .select('id')
    .single()
  reactionMessageId = reactMsg!.id
})

test.afterAll(async () => {
  if (convoId) {
    await supabase.from('messages').delete().eq('conversation_id', convoId)
    await supabase.from('conversations').delete().eq('id', convoId)
  }
  if (contactId) {
    await supabase.from('contacts').delete().eq('id', contactId)
  }
})

test('image message renders an img tag', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.getByText('Media Test User').click()
  await page.waitForTimeout(1000)

  const img = page.locator('img[alt="Shared image"]').first()
  await expect(img).toBeVisible({ timeout: 5000 })
  const src = await img.getAttribute('src')
  expect(src).toContain('backfill_3ABBDDD5EC30B0DB1B1F.jpg')
})

test('audio message renders an audio player', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.getByText('Media Test User').click()
  await page.waitForTimeout(1000)

  const audio = page.locator('audio').first()
  await expect(audio).toBeVisible({ timeout: 5000 })
  await expect(audio).toHaveAttribute('controls', '')
})

test('video message renders a video player', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.getByText('Media Test User').click()
  await page.waitForTimeout(1000)

  const video = page.locator('video').first()
  await expect(video).toBeVisible({ timeout: 5000 })
  await expect(video).toHaveAttribute('controls', '')
})

test('reaction emoji is displayed on the message', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.getByText('Media Test User').click()
  await page.waitForTimeout(1000)

  const reactionBubble = page.locator('text=👍').first()
  await expect(reactionBubble).toBeVisible({ timeout: 5000 })
})

test('sidebar does not show @s.whatsapp.net identifiers', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(1000)

  const sidebar = page.locator('.mt-2.flex-1.overflow-y-auto')
  const sidebarText = await sidebar.textContent()
  expect(sidebarText).not.toContain('@s.whatsapp.net')
  expect(sidebarText).not.toContain('@lid')
})
