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

let emailContactId: string | null = null
let emailConvoId: string | null = null
let whatsappContactId: string | null = null
let whatsappConvoId: string | null = null
let emailContact2Id: string | null = null
let emailConvo2Id: string | null = null

test.beforeAll(async () => {
  // ─── Email contact 1: Jane ───
  const { data: eContact } = await supabase
    .from('contacts')
    .insert({ business_id: BUSINESS_ID, email: 'test-jane@example.com', name: 'Jane Email Test' })
    .select('id')
    .single()
  emailContactId = eContact!.id

  const { data: eConvo } = await supabase
    .from('conversations')
    .insert({
      business_id: BUSINESS_ID,
      contact_id: emailContactId,
      channel: 'email',
      status: 'open',
      ai_handling: true,
      subject: 'booking enquiry',
      last_message_at: new Date().toISOString(),
      last_message_preview: 'Hi, I need to book a service',
      unread_count: 1,
    })
    .select('id')
    .single()
  emailConvoId = eConvo!.id

  await supabase.from('messages').insert({
    conversation_id: emailConvoId,
    direction: 'inbound',
    sender: 'contact',
    content_type: 'text',
    body: 'Hi, I need to book a service please. Could you let me know your availability?',
    metadata: {
      sender_email: 'test-jane@example.com',
      sender_name: 'Jane Email Test',
      subject: 'Booking enquiry',
      external_id: 'email-001',
      has_attachments: true,
      attachments: [
        { id: 'att-001', name: 'invoice', extension: 'pdf', size: 12345, mime_type: 'application/pdf' },
      ],
    },
  })

  // ─── Email contact 2: Sarah ───
  const { data: eContact2 } = await supabase
    .from('contacts')
    .insert({ business_id: BUSINESS_ID, email: 'test-sarah@example.com', name: 'Sarah Email Test' })
    .select('id')
    .single()
  emailContact2Id = eContact2!.id

  const { data: eConvo2 } = await supabase
    .from('conversations')
    .insert({
      business_id: BUSINESS_ID,
      contact_id: emailContact2Id,
      channel: 'email',
      status: 'open',
      ai_handling: false,
      subject: 'price query',
      last_message_at: new Date(Date.now() - 30_000).toISOString(),
      last_message_preview: 'How much for a full service?',
      unread_count: 2,
    })
    .select('id')
    .single()
  emailConvo2Id = eConvo2!.id

  await supabase.from('messages').insert({
    conversation_id: emailConvo2Id,
    direction: 'inbound',
    sender: 'contact',
    content_type: 'text',
    body: 'How much for a full service?',
    metadata: { sender_email: 'test-sarah@example.com', subject: 'Price query', external_id: 'email-002' },
  })

  // ─── WhatsApp: Bob ───
  const { data: wContact } = await supabase
    .from('contacts')
    .insert({ business_id: BUSINESS_ID, phone: '+447700900111', whatsapp: '+447700900111', name: 'Bob WhatsApp Test' })
    .select('id')
    .single()
  whatsappContactId = wContact!.id

  const { data: wConvo } = await supabase
    .from('conversations')
    .insert({
      business_id: BUSINESS_ID,
      contact_id: whatsappContactId,
      channel: 'whatsapp',
      status: 'open',
      ai_handling: true,
      last_message_at: new Date(Date.now() - 60_000).toISOString(),
      last_message_preview: 'How much for a haircut?',
      unread_count: 1,
    })
    .select('id')
    .single()
  whatsappConvoId = wConvo!.id

  await supabase.from('messages').insert({
    conversation_id: whatsappConvoId,
    direction: 'inbound',
    sender: 'contact',
    content_type: 'text',
    body: 'How much for a haircut?',
    metadata: { sender_phone: '+447700900111' },
  })
})

test.afterAll(async () => {
  if (emailConvoId) {
    await supabase.from('messages').delete().eq('conversation_id', emailConvoId)
    await supabase.from('conversations').delete().eq('id', emailConvoId)
  }
  if (emailConvo2Id) {
    await supabase.from('messages').delete().eq('conversation_id', emailConvo2Id)
    await supabase.from('conversations').delete().eq('id', emailConvo2Id)
  }
  if (whatsappConvoId) {
    await supabase.from('messages').delete().eq('conversation_id', whatsappConvoId)
    await supabase.from('conversations').delete().eq('id', whatsappConvoId)
  }
  if (emailContactId) await supabase.from('contacts').delete().eq('id', emailContactId)
  if (emailContact2Id) await supabase.from('contacts').delete().eq('id', emailContact2Id)
  if (whatsappContactId) await supabase.from('contacts').delete().eq('id', whatsappContactId)
})

// 1: All conversations appear as separate cards
test('inbox shows all conversations as separate cards', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await expect(page.getByText('Jane Email Test')).toBeVisible()
  await expect(page.getByText('Sarah Email Test')).toBeVisible()
  await expect(page.getByText('Bob WhatsApp Test')).toBeVisible()
})

// 2: Sidebar shows email + subject
test('sidebar shows email address and subject', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await expect(page.getByText('test-jane@example.com')).toBeVisible()
  await expect(page.getByText('booking enquiry')).toBeVisible()
})

// 3: Email thread shows WhatsApp-style bubbles with reply area visible
test('email thread shows messages as bubbles with reply area', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await page.getByText('Jane Email Test').click()
  await page.waitForTimeout(1000)

  // Message body in a bubble
  await expect(page.getByText('Hi, I need to book a service please')).toBeVisible()

  // Reply area always visible
  await expect(page.getByPlaceholder('Type an email reply...')).toBeVisible()
  await expect(page.getByText('Replying via email', { exact: false })).toBeVisible()
})

// 4: Attachment shows
test('email message shows attachment', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await page.getByText('Jane Email Test').click()
  await page.waitForTimeout(1000)

  await expect(page.getByText('invoice.pdf')).toBeVisible()
})

// 5: WhatsApp thread
test('whatsapp thread shows messages as bubbles', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await page.getByText('Bob WhatsApp Test').click()
  await page.waitForTimeout(1000)

  await expect(page.getByText('How much for a haircut?').nth(1)).toBeVisible()
  await expect(page.getByPlaceholder('Type a reply...')).toBeVisible()
})

// 6: Send button state
test('send button disabled when empty, enabled when typing', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await page.getByText('Jane Email Test').click()
  await page.waitForTimeout(1000)

  const sendBtn = page.getByRole('button', { name: 'Send', exact: true })
  await expect(sendBtn).toBeDisabled()

  await page.getByPlaceholder('Type an email reply...').fill('Thanks!')
  await expect(sendBtn).toBeEnabled()
})

// 7: Compose button exists
test('compose new email button is visible', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  const composeBtn = page.getByRole('button', { name: 'Compose' })
  await expect(composeBtn).toBeVisible()

  // Click it to open compose modal
  await composeBtn.click()
  await expect(page.getByText('New Email')).toBeVisible()
  await expect(page.getByPlaceholder('To (email address)')).toBeVisible()
  await expect(page.getByPlaceholder('Subject')).toBeVisible()
})

// 8: Date divider shows at top of messages
test('date divider appears above messages', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await page.getByText('Jane Email Test').click()
  await page.waitForTimeout(1000)

  await expect(page.getByText('Today')).toBeVisible()
})

// 9: Different senders = independent threads
test('different senders have independent threads', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await page.waitForTimeout(2000)

  await page.getByText('Jane Email Test').click()
  await page.waitForTimeout(1000)
  await expect(page.getByText('Hi, I need to book a service please')).toBeVisible()

  await page.getByText('Sarah Email Test').click()
  await page.waitForTimeout(1000)
  await expect(page.getByText('How much for a full service?', { exact: true }).nth(1)).toBeVisible()
})
