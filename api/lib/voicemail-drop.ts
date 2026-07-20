// Voicemail-drop core for the CRM speed dialer (agent-pressed drop).
//
// The agent hears the voicemail greeting and taps "Drop VM": the contact
// (child) call leg gets its TwiML replaced with <Play>{recording}</Play>
// <Hangup/>, which pulls it out of the bridge, plays the campaign message
// into the voicemail box and hangs up. The agent leg is freed client-side.
//
// This module is the canonical, vitest-covered copy of the logic; the Deno
// edge function `supabase/functions/wk-voicemail-drop/index.ts` keeps a thin
// mirror (Deno deploy can't import from api/). If you change one, change the
// other — tests/voicemail-drop.test.ts pins the contract.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * TwiML that replaces the contact leg's executing document at drop time.
 * The url is XML-escaped — never interpolate it raw (ghost-dialer's bug).
 */
export function buildDropTwiml(recordingUrl: string): string {
  const url = recordingUrl.trim()
  if (!url) throw new Error('recordingUrl is required')
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`recordingUrl must be an http(s) URL: ${url}`)
  return `<Response><Play>${escapeXml(url)}</Play><Hangup/></Response>`
}
