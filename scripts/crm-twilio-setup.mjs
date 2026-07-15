#!/usr/bin/env node
/**
 * One-time Twilio setup for the Elsie CRM (softphone + dialer).
 * Runs against the ELSIE Twilio account only. Never touches the two
 * UK Retell-trunk lines' VOICE config.
 *
 * Creates: API Key pair (browser Voice SDK tokens), TwiML App
 * (Voice URL → wk-voice-twiml-outgoing). Configures the two US
 * toll-free numbers for CRM inbound voice + SMS. Fixes the main UK
 * line's dead sms_url → Elsie's own handler.
 *
 * Idempotent where possible. API Key secret can only be read at
 * creation, so the key is created once and written to
 * scripts/.crm-twilio-output.json (gitignored) + printed.
 *
 * Env required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.
 * Usage: node scripts/crm-twilio-setup.mjs
 */
import { writeFileSync } from 'fs'

const SID = process.env.TWILIO_ACCOUNT_SID
const TOKEN = process.env.TWILIO_AUTH_TOKEN
if (!SID || !TOKEN) {
  console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in env')
  process.exit(1)
}

const FN_BASE = 'https://loggyxryrhqsbtqpteog.supabase.co/functions/v1'
const OUTGOING_URL = `${FN_BASE}/wk-voice-twiml-outgoing`
const INCOMING_URL = `${FN_BASE}/wk-voice-twiml-incoming`
const SMS_INCOMING_URL = `${FN_BASE}/wk-sms-incoming`
const ELSIE_SMS_URL = 'https://app.heyelsie.com/api/webhooks/twilio-sms'

const RETELL_TRUNK = 'TK6634fb175ebebc312bb6683327cb0ee6' // never repoint these numbers' voice
const US_TOLLFREE = ['+18774194389', '+18333706994'] // full CRM use
const MAIN_UK_LINE = '+447426495169' // fix dead sms_url only; voice stays on Retell

const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')
const base = `https://api.twilio.com/2010-04-01/Accounts/${SID}`

async function twilio(path, method = 'GET', form) {
  const opts = { method, headers: { Authorization: auth } }
  if (form) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    opts.body = new URLSearchParams(form).toString()
  }
  const res = await fetch(`${base}${path}`, opts)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`Twilio ${method} ${path} → ${res.status}: ${text}`)
  return json
}

async function main() {
  const out = {}

  // 1. API Key pair (secret only visible now → create fresh, persist)
  console.log('Creating API Key "elsie-crm-voice"…')
  const key = await twilio('/Keys.json', 'POST', { FriendlyName: 'elsie-crm-voice' })
  out.TWILIO_API_KEY_SID = key.sid
  out.TWILIO_API_KEY_SECRET = key.secret
  console.log(`  API Key SID:    ${key.sid}`)
  console.log(`  API Key SECRET: ${key.secret}  (store now — not retrievable later)`)

  // 2. TwiML App (idempotent by friendly name)
  console.log('Ensuring TwiML App "Elsie CRM Softphone"…')
  const apps = await twilio('/Applications.json?FriendlyName=Elsie%20CRM%20Softphone&PageSize=5')
  let app = (apps.applications || [])[0]
  if (app) {
    app = await twilio(`/Applications/${app.sid}.json`, 'POST', {
      VoiceUrl: OUTGOING_URL, VoiceMethod: 'POST',
    })
    console.log(`  reused + updated TwiML App: ${app.sid}`)
  } else {
    app = await twilio('/Applications.json', 'POST', {
      FriendlyName: 'Elsie CRM Softphone', VoiceUrl: OUTGOING_URL, VoiceMethod: 'POST',
    })
    console.log(`  created TwiML App: ${app.sid}`)
  }
  out.TWILIO_TWIML_APP_SID = app.sid

  // 3. Configure numbers
  const nums = await twilio('/IncomingPhoneNumbers.json?PageSize=100')
  const byE164 = Object.fromEntries((nums.incoming_phone_numbers || []).map((n) => [n.phone_number, n]))

  for (const e164 of US_TOLLFREE) {
    const n = byE164[e164]
    if (!n) { console.log(`  US TF ${e164} not found — skip`); continue }
    await twilio(`/IncomingPhoneNumbers/${n.sid}.json`, 'POST', {
      VoiceUrl: INCOMING_URL, VoiceMethod: 'POST',
      SmsUrl: SMS_INCOMING_URL, SmsMethod: 'POST',
    })
    console.log(`  ${e164}: voice→wk-voice-twiml-incoming, sms→wk-sms-incoming`)
  }

  // 4. Fix main UK line's dead sms_url (voice untouched — Retell trunk)
  const uk = byE164[MAIN_UK_LINE]
  if (uk) {
    if (uk.trunk_sid && uk.trunk_sid !== RETELL_TRUNK) {
      console.log(`  ${MAIN_UK_LINE}: unexpected trunk ${uk.trunk_sid} — skipping sms fix for safety`)
    } else {
      await twilio(`/IncomingPhoneNumbers/${uk.sid}.json`, 'POST', {
        SmsUrl: ELSIE_SMS_URL, SmsMethod: 'POST',
      })
      console.log(`  ${MAIN_UK_LINE}: sms_url → Elsie handler (voice left on Retell trunk)`)
    }
  }

  writeFileSync(
    new URL('./.crm-twilio-output.json', import.meta.url),
    JSON.stringify(out, null, 2),
  )
  console.log('\nWrote scripts/.crm-twilio-output.json')
  console.log('\nSet these as Supabase edge secrets:')
  for (const k of ['TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_TWIML_APP_SID']) {
    console.log(`  ${k}=${out[k]}`)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
