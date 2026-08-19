// wk-sms-incoming — inbound SMS webhook for /crm. PR 50.
//
// This function does ONE thing:
//
//   1. Validate Twilio HMAC-SHA1 signature (fail closed)
//   2. Find or create a wk_contacts row for the From number
//   3. Insert a wk_sms_messages row (idempotent on twilio_sid)
//   4. Return empty TwiML
//
// No opt-out logic, no automation triggers, no conversation table.
// Those concerns can be added back as separate, independent features
// once the receive path is rock-solid.
//
// Twilio Console config:
//   Phone Number → Messaging → A MESSAGE COMES IN
//   Webhook: https://loggyxryrhqsbtqpteog.supabase.co/functions/v1/wk-sms-incoming
//   Method: HTTP POST
//
// Authentication:
//   Twilio signs every webhook with HMAC-SHA1 of (URL + sorted form
//   params) keyed on Account Auth Token. Validation is FAIL-CLOSED:
//   if TWILIO_AUTH_TOKEN is unset, or the X-Twilio-Signature header
//   is missing or invalid, the request is rejected with 403.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Site demo hand-off (step 3d). Same shape wk-jobs-worker uses to reach the
// app: CRM_JOBS_KEY if it is set, service role otherwise.
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.heyelsie.com';
const SITE_REPLY_KEY = Deno.env.get('CRM_JOBS_KEY') || SUPABASE_SERVICE_KEY;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-twilio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TWIML_OK = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

// Build the canonical phone variants Twilio might send vs what we
// might already have in wk_contacts.phone. We INSERT into wk_contacts
// using strict E.164 (with leading +). Lookup is by either format.
function phoneVariants(raw: string): { e164: string; digits: string; variants: string[] } {
  const trimmed = raw.replace(/^whatsapp:/, '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  const e164 = trimmed.startsWith('+') ? trimmed : `+${digits}`;
  const variants = Array.from(new Set([trimmed, e164, digits].filter(Boolean)));
  return { e164, digits, variants };
}

// Facebook lead-ad form, read out of the lead's very first WhatsApp message.
//
// A lead ad composes that first message for them out of the form they filled
// in, so the person's name arrives in the body and nothing ever read it. Every
// one of those leads sat in the CRM inbox as its own phone number, because the
// insert below names a new contact after the number it came from.
//
// MIRROR of src/core/heypubli/lead-form.ts (Deno cannot import from src/), the
// same arrangement uk-places.ts has with the scraper. tests/heypubli-lead-form
// .test.ts reads both files and fails the build if they drift apart.
//
// Two things about the shape, both from real rows:
//   - the field ORDER varies, so never parse by line number
//   - the greeting is translated into the lead's own locale (we have Bengali
//     ones) while the field LABELS stay English, so anchor on the labels
const MAX_LEAD_NAME = 60;
const FIRST_NAME_RE = /^[^\S\n]*First\s*name[^\S\n]*:[^\S\n]*(.*)$/im;
const LEAD_EMAIL_RE = /^[^\S\n]*Email[^\S\n]*:[^\S\n]*(.*)$/im;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

// What people put in the name box that is not a name. Both of these are real:
// contact +919495068152 was named "Hi", contact +917989848576 was named
// "RISHVANTH RAM KOUSHIK| REEL CREATOR| BGMS |". This function is the live
// path that wrote them, so the rule has to be here and not only in the shared
// module. Mirror of usableName() in src/core/heypubli/lead-form.ts.
const GREETING_WORDS = new Set([
  'hello', 'helo', 'hlo', 'hallo', 'halo', 'namaste', 'salam', 'assalamualaikum',
  'ok', 'okay', 'okk', 'k', 'yes', 'ya', 'yeah', 'yep', 'no', 'nope', 'na', 'nil', 'none',
  'sir', 'madam', 'mam', 'maam', 'bro', 'boss',
  'thanks', 'thankyou', 'ty', 'please', 'plz',
  'test', 'testing', 'asdf', 'abc', 'xyz', 'nan', 'null', 'undefined',
  'gm', 'ge', 'goodmorning', 'goodevening', 'goodafternoon', 'goodnight',
]);
const GREETING_RE = /^h+[iey]+$/;

function usableName(raw: string): string | null {
  const cut = raw.split('|')[0].trim().replace(/\s+/g, ' ');
  if (!cut || cut.length > MAX_LEAD_NAME) return null;
  if (!/\p{L}/u.test(cut)) return null;
  const bare = cut.toLowerCase().replace(/[^a-z]/g, '');
  if (bare && (GREETING_WORDS.has(bare) || GREETING_RE.test(bare))) return null;
  return cut;
}

function parseLeadForm(body: string): { firstName: string | null; email: string | null } {
  const text = String(body ?? '');
  const rawName = (text.match(FIRST_NAME_RE)?.[1] ?? '').trim();
  const rawEmail = (text.match(LEAD_EMAIL_RE)?.[1] ?? '').trim().toLowerCase();
  return {
    firstName: rawName ? usableName(rawName) : null,
    email: EMAIL_SHAPE.test(rawEmail) ? rawEmail : null,
  };
}

/** Facebook sends "lakshmi" and "LAXMAN". Only re-case a word that is
 *  entirely one case, so "McDonald" and non-Latin scripts survive untouched. */
function displayName(raw: string): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s
    .split(' ')
    .map((w) => {
      const oneCase = /[A-Za-z]/.test(w) && (w === w.toLowerCase() || w === w.toUpperCase());
      return oneCase ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
    })
    .join(' ');
}

/** Only the phone-number name this function itself invents may be replaced.
 *  Hugo's rule: a name a human actually chose is never overwritten. */
function isPlaceholderName(name: string | null, phone: string | null): boolean {
  const n = String(name ?? '').trim();
  if (!n) return true;
  const bare = n.replace(/^whatsapp:/i, '').replace(/[\s()+-]/g, '');
  if (/^\d{5,}$/.test(bare)) return true;
  const p = String(phone ?? '').replace(/^whatsapp:/i, '').replace(/[\s()+-]/g, '');
  return Boolean(p) && bare === p;
}

// Voicemail-drop callback attribution (VM drop B8). Canonical decision
// logic + tests: api/lib/callback-attribution.ts (mirrored here — Deno
// can't import api/). Same constants + column resolution as the voice
// mirror in wk-voice-twiml-incoming.
const CALLBACK_TAG = 'called-back';
const CALLBACK_WINDOW_DAYS = 30;

// deno-lint-ignore no-explicit-any
async function resolveCallbackColumnId(supa: any, currentColumnId: string | null): Promise<string | null> {
  if (currentColumnId) {
    const { data: cur } = await supa
      .from('wk_pipeline_columns')
      .select('pipeline_id')
      .eq('id', currentColumnId)
      .maybeSingle();
    if (cur?.pipeline_id) {
      const { data: vm } = await supa
        .from('wk_pipeline_columns')
        .select('id')
        .eq('pipeline_id', cur.pipeline_id)
        .ilike('name', 'voicemail')
        .limit(1)
        .maybeSingle();
      if (vm?.id) return vm.id as string;
    }
  }
  const { data: anyVm } = await supa
    .from('wk_pipeline_columns')
    .select('id')
    .ilike('name', 'voicemail')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (anyVm?.id as string | undefined) ?? null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // --- Pre-auth: parse the form + validate the signature BEFORE any
  // other early-return. Failures on this path must never return 200 —
  // an unauthenticated POST (malformed body, missing header, bad
  // signature) gets 400/403, fail closed.
  const params: Record<string, string> = {};
  try {
    const formData = await req.formData();
    formData.forEach((v, k) => { params[k] = v.toString(); });
  } catch {
    console.warn('[wk-sms-incoming] unparseable body — rejecting (400)');
    return new Response('Bad request', { status: 400, headers: corsHeaders });
  }

  // Signature validation — FAIL CLOSED. We use the canonical public
  // URL Twilio computed against — req.url returns the proxied internal
  // URL inside Edge Functions, which won't match the signature.
  const sig = req.headers.get('x-twilio-signature') ?? '';
  const publicUrl = `${SUPABASE_URL}/functions/v1/wk-sms-incoming`;

  if (!TWILIO_AUTH_TOKEN) {
    console.error(
      '[wk-sms-incoming] TWILIO_AUTH_TOKEN is NOT SET — rejecting all requests (fail closed). Set the secret in Supabase Edge Function secrets.',
    );
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }
  if (!sig) {
    console.error('[wk-sms-incoming] missing x-twilio-signature header — rejecting (403)');
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }
  const ok = await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, publicUrl, params);
  if (!ok) {
    console.error(
      `[wk-sms-incoming] INVALID SIGNATURE — rejecting (403). url=${publicUrl} authTokenLen=${TWILIO_AUTH_TOKEN.length}. Cause: env TWILIO_AUTH_TOKEN doesn't match the Twilio account that signed the request. Check Supabase Edge Function secrets vs Twilio Console > Account > Auth Token.`,
    );
    return new Response('Forbidden', { status: 403, headers: corsHeaders });
  }

  // --- Post-auth processing: exceptions from here on return 200 TwiML
  // so Twilio doesn't retry-spam a signed event we failed to process.
  try {
    const messageSid = params.MessageSid ?? '';
    const rawFrom = params.From ?? '';
    const rawTo = params.To ?? '';
    const body = params.Body ?? '';
    const numMedia = parseInt(params.NumMedia ?? '0', 10) || 0;

    // Diagnostic log on every entry — the historic pain point is silent
    // failure. If this log doesn't show up in Supabase Functions logs
    // when an SMS arrives, the webhook URL on Twilio Console is wrong.
    console.log(
      `[wk-sms-incoming] inbound sid=${messageSid} from=${rawFrom} to=${rawTo} bodyLen=${body.length} media=${numMedia}`,
    );

    if (!rawFrom || !messageSid) {
      console.warn('[wk-sms-incoming] missing From or MessageSid — dropping (signed request)');
      return new Response(TWIML_OK, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // WhatsApp arrives on this same webhook with a `whatsapp:` prefix on
    // From/To (the Twilio WhatsApp sender's callback points here). Detect
    // BEFORE phoneVariants strips it, or the channel identity is lost and
    // every WhatsApp message masquerades as an SMS in the inbox.
    const isWhatsApp = rawFrom.startsWith('whatsapp:');
    const channel = isWhatsApp ? 'whatsapp' : 'sms';

    const { e164: fromE164, variants: fromVariants } = phoneVariants(rawFrom);
    const { e164: toE164 } = phoneVariants(rawTo);

    // ---- Collect media URLs ----
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const u = params[`MediaUrl${i}`];
      if (u) mediaUrls.push(u);
    }

    // Does this message carry a Facebook lead-ad form? Parsed once, used both
    // when creating the contact and when filling in an existing placeholder.
    const leadForm = parseLeadForm(body);
    const leadName = leadForm.firstName ? displayName(leadForm.firstName) : '';

    // 1. Find or create wk_contacts row for this caller.
    const { data: wkContactRow } = await supa
      .from('wk_contacts')
      .select('id, pipeline_column_id, name, phone, email, custom_fields')
      .in('phone', fromVariants)
      .limit(1)
      .maybeSingle();

    let contactId: string | null = wkContactRow?.id ?? null;
    // VM drop B8: attribution only applies to contacts that existed BEFORE
    // this message — a brand-new inbound number can't be a dropped lead.
    const preExistingColumnId: string | null = wkContactRow?.id
      ? ((wkContactRow.pipeline_column_id as string | null) ?? null)
      : null;
    const preExisting = Boolean(wkContactRow?.id);

    if (!contactId) {
      const { data: inserted, error: insErr } = await supa
        .from('wk_contacts')
        .insert({
          // The lead's own name when the form carried one, the number
          // otherwise. Naming a contact after its phone number is what made
          // the whole inbox unreadable.
          name: leadName || fromE164,
          phone: fromE164,
          email: leadForm.email,
          owner_agent_id: null,
          pipeline_column_id: null,
          custom_fields: {
            source: isWhatsApp ? 'inbound_whatsapp' : 'inbound_sms',
            first_message_sid: messageSid,
            ...(leadName ? { owner_name: leadName } : {}),
          },
          is_hot: false,
        })
        .select('id')
        .single();

      if (inserted?.id) {
        contactId = inserted.id as string;
        console.log(`[wk-sms-incoming] created wk_contact ${contactId} for ${fromE164}`);
      } else {
        // Insert failed. The common cause is a concurrent inbound from the
        // same new number winning the UNIQUE(phone) race (code 23505) between
        // the SELECT above and this INSERT. Recover the winner's id by
        // re-selecting so this message still lands instead of being dropped.
        const { data: raced } = await supa
          .from('wk_contacts')
          .select('id')
          .in('phone', fromVariants)
          .limit(1)
          .maybeSingle();
        if (raced?.id) {
          contactId = raced.id as string;
          console.log(`[wk-sms-incoming] recovered raced wk_contact ${contactId} for ${fromE164}`);
        } else {
          console.error('[wk-sms-incoming] wk_contacts insert failed', insErr);
        }
      }
    } else if (leadName || leadForm.email) {
      // The contact already existed (an outbound campaign created it, or an
      // earlier inbound did) and this message brings the lead's real details.
      // Fill the GAPS only. A name somebody chose is never overwritten, and
      // neither is an email we already hold.
      try {
        const patch: Record<string, unknown> = {};
        const cf = (wkContactRow?.custom_fields ?? {}) as Record<string, unknown>;
        if (leadName && isPlaceholderName(wkContactRow?.name ?? null, wkContactRow?.phone ?? fromE164)) {
          patch.name = leadName;
        }
        if (leadForm.email && !wkContactRow?.email) patch.email = leadForm.email;
        if (leadName && !String(cf.owner_name ?? '').trim()) {
          patch.custom_fields = { ...cf, owner_name: leadName };
        }
        if (Object.keys(patch).length > 0) {
          const { error: fillErr } = await supa.from('wk_contacts').update(patch).eq('id', contactId);
          if (fillErr) console.error('[wk-sms-incoming] lead-form fill failed', fillErr);
          else console.log(`[wk-sms-incoming] filled ${Object.keys(patch).join('+')} on ${contactId}`);
        }
      } catch (e) {
        // Never fatal. A name is worth less than the message itself.
        console.error('[wk-sms-incoming] lead-form fill threw (non-fatal)', e);
      }
    }

    // 2. Insert wk_sms_messages — idempotent on twilio_sid (UNIQUE).
    if (contactId) {
      const { error: msgErr } = await supa
        .from('wk_sms_messages')
        .insert({
          contact_id: contactId,
          direction: 'inbound',
          channel,
          body,
          twilio_sid: messageSid,
          from_e164: fromE164,
          to_e164: toE164 || null,
          media_urls: mediaUrls,
          status: 'received',
        });

      if (msgErr) {
        const code = (msgErr as { code?: string }).code;
        if (code === '23505') {
          console.log(`[wk-sms-incoming] duplicate sid=${messageSid} — idempotent skip`);
        } else {
          console.error('[wk-sms-incoming] wk_sms_messages insert failed', msgErr);
        }
      } else {
        console.log(
          `[wk-sms-incoming] saved contact=${contactId} sid=${messageSid} bodyLen=${body.length}`,
        );
      }

      // 3. Bump wk_contacts.last_contact_at.
      await supa
        .from('wk_contacts')
        .update({ last_contact_at: new Date().toISOString() })
        .eq('id', contactId);

      // 3b. Opt-out: a STOP-keyword reply tags the contact 'do-not-text' so
      //     wk-sms-broadcast excludes them from every future blast. Twilio
      //     also blocks at carrier level for toll-free; this keeps our own
      //     lists clean and visible in the CRM.
      const optOut = /^(stop|stopall|unsubscribe|quit|cancel|end)[.!]*$/i.test(body.trim());

      // 3b-ii. A REFUSAL is not the word STOP, and it must still stop the
      //     machines. Hugo, 2026-08-06, watching a HeyPubli lead answer "Not
      //     interested" and get pitched anyway 70 minutes later: "they said
      //     not interested and you still pitched". The keyword list above
      //     would never have caught it.
      //
      //     Deliberately NARROW: unambiguous refusals only, no "not now" and
      //     no bare "no" (both are common mid-conversation answers to a
      //     question we asked, like "did you find the email?"). And NOT
      //     tagged do-not-text: that tag is the STOP contract and it locks a
      //     human agent out of the thread too. This flag only travels to
      //     HeyPubli, where it parks the automated nudges.
      //     Kept in step with the outreach script's list on purpose: two
      //     refusal lists that disagree means the weaker one guards the
      //     automation. "please stop messaging me" passed the optOut test
      //     above (it demands the WHOLE body be "stop") and passed this one
      //     too, until it was added here.
      //     The gap between the words is NOT \s+. A real lead wrote
      //     "No..thanks" on 07 Aug and every pattern here missed it, because
      //     they all demanded whitespace. People punctuate how they like:
      //     "No, thanks", "no.thanks", "No -- thanks". Anything that is not a
      //     letter or a digit is a word gap. G is that gap.
      const G = '[^a-z0-9]*';
      const re = (s: string) => new RegExp(s, 'i').test(body);
      const refused =
        re(`\\b(not|no|never)${G}(really${G}|very${G})?(interested|intrested|intersted|interseted)\\b`) ||
        re(`\\bno${G}thanks?\\b`) ||
        re(`\\b(stop|quit)${G}(messaging|texting|contacting|calling|sending)\\b`) ||
        re(`\\b(don'?t|do${G}not|dont)${G}(message|msg|text|contact|call)${G}me\\b`) ||
        re(`\\b(remove|delete)${G}(me|my${G}number)\\b`) ||
        re(`\\bleave${G}me${G}alone\\b`) ||
        re(`\\bnot${G}want(ed|ing)?${G}(this|it|any)\\b`);
      if (optOut) {
        const { error: dntErr } = await supa
          .from('wk_contact_tags')
          .upsert(
            { contact_id: contactId, tag: 'do-not-text' },
            { onConflict: 'contact_id,tag', ignoreDuplicates: true },
          );
        if (dntErr) console.error('[wk-sms-incoming] do-not-text tag failed', dntErr);
        else console.log(`[wk-sms-incoming] contact ${contactId} opted out (STOP) — tagged do-not-text`);
      }

      // A refusal is recorded HERE too, not only relayed to heypubli. It was
      // computed and thrown away, so Elsie's own surfaces had no idea the
      // person had said no. The tag is 'not-interested', deliberately NOT
      // 'do-not-text': the STOP contract blocks a human agent as well, and a
      // refusal should only park the robots. It shows in the CRM and is one
      // query away for any future send path.
      if (refused && !optOut) {
        const { error: niErr } = await supa
          .from('wk_contact_tags')
          .upsert(
            { contact_id: contactId, tag: 'not-interested' },
            { onConflict: 'contact_id,tag', ignoreDuplicates: true },
          );
        if (niErr) console.error('[wk-sms-incoming] not-interested tag failed', niErr);
        else console.log(`[wk-sms-incoming] contact ${contactId} said no — tagged not-interested`);
      }

      // 3c. Voicemail-drop callback attribution (VM drop B8): a contact we
      //     voicemail-dropped in the last 30 days texting back gets the
      //     permanent 'called-back' tag + a move to the Callback/Voicemail
      //     column — fires on ANY inbound text (even a STOP), because the
      //     point is "they came back", not what they said. Canonical logic
      //     + tests: api/lib/callback-attribution.ts.
      if (preExisting) {
        try {
          const since = new Date(Date.now() - CALLBACK_WINDOW_DAYS * 86_400_000).toISOString();
          const { data: droppedCall } = await supa
            .from('wk_calls')
            .select('id')
            .eq('contact_id', contactId)
            .eq('direction', 'outbound')
            .eq('voicemail_dropped', true)
            .gte('started_at', since)
            .limit(1)
            .maybeSingle();
          if (droppedCall) {
            // .select() makes the upsert report whether it actually inserted:
            // [] = tag already existed. The column move runs only on the
            // FIRST callback — later inbound texts (or webhook retries) must
            // not clobber manual pipeline moves.
            const { data: tagIns, error: cbErr } = await supa
              .from('wk_contact_tags')
              .upsert(
                { contact_id: contactId, tag: CALLBACK_TAG },
                { onConflict: 'contact_id,tag', ignoreDuplicates: true },
              )
              .select('contact_id');
            if (cbErr) console.warn('[wk-sms-incoming] called-back tag failed', cbErr);
            const isFirstCallback = Boolean(tagIns && tagIns.length > 0);
            if (isFirstCallback) {
              const columnId = await resolveCallbackColumnId(supa, preExistingColumnId);
              if (columnId && columnId !== preExistingColumnId) {
                const { error: moveErr } = await supa
                  .from('wk_contacts')
                  .update({ pipeline_column_id: columnId })
                  .eq('id', contactId);
                if (moveErr) console.warn('[wk-sms-incoming] callback column move failed', moveErr);
              }
              console.log(`[wk-sms-incoming] dropped contact ${contactId} texted back — tagged + moved`);
            }
          }
        } catch (e) {
          console.warn('[wk-sms-incoming] callback attribution failed (continuing):', e);
        }
      }

      // 3d. Site demo: did they just say yes to the website we offered them?
      //
      //     PRE-GATED HERE, CLASSIFIED THERE. The gate is one indexed lookup
      //     (does this lead already have a site?) so the vast majority of the
      //     CRM's inbound traffic costs nothing extra and never reaches the
      //     classifier. Everything past the gate is decided by
      //     /api/site-demo/reply, which owns the word list and the offer check,
      //     because that logic is shared code with tests behind it and a Deno
      //     edge function cannot import from src/.
      //
      //     Awaited on purpose: generation is sub-second and we need the answer
      //     before deciding whether to also queue an AI reply. A lead must never
      //     get a site link AND a chatbot reply to the same message.
      let siteHandled = false;
      if (!msgErr && !optOut && APP_URL && SITE_REPLY_KEY) {
        try {
          const { data: hasPage } = await supa
            .from('wk_site_pages')
            .select('id')
            .eq('contact_id', contactId)
            .maybeSingle();

          if (!hasPage) {
            const res = await fetch(`${APP_URL}/api/site-demo/reply`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${SITE_REPLY_KEY}`,
              },
              body: JSON.stringify({ contact_id: contactId, body }),
            });
            if (res.ok) {
              const out = await res.json().catch(() => null);
              siteHandled = Boolean(out?.generated);
              if (siteHandled) {
                console.log(`[wk-sms-incoming] site demo generated for contact=${contactId}`);
              }
            } else {
              console.error('[wk-sms-incoming] site-demo reply failed', res.status);
            }
          }
        } catch (e) {
          // Never fatal. A failed site generation must not stop the inbound
          // message being saved or the normal AI reply running.
          console.error('[wk-sms-incoming] site-demo reply threw (non-fatal)', e);
        }
      }

      // 3e-0. The number STOPPED being the funnel's on 2026-08-19 (Hugo: the
      //     WhatsApp becomes the business line for builders and estate
      //     agents; the Instagram method is retired). The old rule "every
      //     inbound WhatsApp on +447460035763 is heypubli" would stamp every
      //     BUILDER as a creator, so it is gone. What remains is the lead-form
      //     regex net: an actual Meta form-fill still gets stamped and owned,
      //     because those forms exist independently of which number relays
      //     them. Old creator numbers messaging in keep their existing stamp
      //     (nothing un-stamps), stay hidden by the inbox filter, and are
      //     do-not-text tagged by scripts/heypubli-shutoff.mjs, so the answer
      //     is deliberate silence, not a builder pitch.
      const HEYPUBLI_AGENT_ID = '79c01385-a4d7-463d-b0b4-1d348c68a737';
      const isLeadFormMsg =
        Boolean(leadForm.firstName || leadForm.email) || /filled\s+(in|out)\s+your\s+form/i.test(body);
      if (!msgErr && channel === 'whatsapp' && isLeadFormMsg) {
        try {
          const { data: st } = await supa
            .from('wk_contacts')
            .select('custom_fields, owner_agent_id')
            .eq('id', contactId)
            .maybeSingle();
          const cf = (st?.custom_fields ?? {}) as Record<string, unknown>;
          const patch: Record<string, unknown> = {};
          if (cf.product !== 'heypubli') patch.custom_fields = { ...cf, product: 'heypubli' };
          if (!st?.owner_agent_id) patch.owner_agent_id = HEYPUBLI_AGENT_ID;
          if (Object.keys(patch).length > 0) {
            await supa.from('wk_contacts').update(patch).eq('id', contactId);
            console.log(
              `[wk-sms-incoming] heypubli thread ${contactId}: ${Object.keys(patch).join('+')}`,
            );
          }
        } catch (e) {
          console.error('[wk-sms-incoming] lead-form stamp threw (non-fatal)', e);
        }
      }

      // 3e. The heypubli funnel fan-out lived here until 2026-08-19 (an HMAC
      //     relay to HEYPUBLI_URL that TRIGGERED its reply brain per message).
      //     Removed on purpose with the Instagram method: the reply brain must
      //     never answer on this number again. The envs stay set and the
      //     heypubli app is untouched; only the pipe is cut.

      // 3f. A builder answering the viewing invite (2026-08-19). Flip their
      //     outreach rows to replied and ring every admin's bell. RAW inserts:
      //     this edge fn cannot import api/lib, so the kind string
      //     'builder_reply' must stay identical to api/lib/builder-notify.ts.
      if (!msgErr && channel === 'whatsapp') {
        try {
          const { data: bRow } = await supa
            .from('wk_contacts')
            .select('custom_fields, name')
            .eq('id', contactId)
            .maybeSingle();
          const bcf = (bRow?.custom_fields ?? {}) as Record<string, unknown>;
          if (bcf.lead_type === 'builder') {
            const nowIso = new Date().toISOString();
            await supa
              .from('brrr_builder_outreach')
              .update({ status: 'replied', replied_at: nowIso, updated_at: nowIso })
              .eq('contact_id', contactId)
              .eq('status', 'sent');
            // Admin PROFILE ids: admin_users.id is its own random uuid, so the
            // allowlist joins to profiles by email (the cockpit rule).
            const ids = new Set<string>();
            const { data: byRole } = await supa
              .from('profiles').select('id').eq('workspace_role', 'admin');
            for (const r of (byRole ?? []) as Array<{ id?: string }>) if (r.id) ids.add(r.id);
            const { data: adminRows } = await supa
              .from('admin_users').select('email').limit(50);
            const emails = ((adminRows ?? []) as Array<{ email?: string }>)
              .map((r) => String(r.email ?? '').trim()).filter(Boolean);
            if (emails.length) {
              const { data: byEmail } = await supa
                .from('profiles').select('id').in('email', emails);
              for (const r of (byEmail ?? []) as Array<{ id?: string }>) if (r.id) ids.add(r.id);
            }
            if (ids.size) {
              await supa.from('wk_notifications').insert([...ids].map((agentId) => ({
                agent_id: agentId,
                contact_id: contactId,
                kind: 'builder_reply',
                title: `Builder replied: ${String(bRow?.name ?? 'a builder')}`.slice(0, 160),
                body: `Answer the builder. They said: "${body.slice(0, 240)}"`,
                link: `/admin/crm/contacts/${contactId}`,
              })));
            }
          }
        } catch (e) {
          console.error('[wk-sms-incoming] builder reply hook threw (non-fatal)', e);
        }
      }

      // 4. Maybe enqueue an AI warm-up reply. Light guard here (global enabled,
      //    contact enabled, under the per-contact cap); the generator re-checks
      //    the full guards (hours, human-replied-since, booking) at run time.
      //    Skipped for duplicate inbound (idempotent path above set msgErr),
      //    for opt-out keywords (never AI-reply to a STOP), for a plain
      //    refusal (the AI would cheerfully pitch someone who just said no,
      //    which is the exact mistake of 2026-08-06), and when the site demo
      //    already answered this message with the link they asked for.
      if (!msgErr && !optOut && !refused && !siteHandled) {
        try {
          // heypubli contacts have their OWN reply brain (heypubli's /api/funnel/reply,
          // deterministic + tested). Enqueueing Elsie's AI here as well means two brains
          // answering one thread: one lead, two different replies. The fan-out above
          // already read custom_fields for this contact; re-read is cheap and correct.
          const { data: gateRow } = await supa
            .from('wk_contacts')
            .select('custom_fields')
            .eq('id', contactId)
            .maybeSingle();
          const gateCf = (gateRow?.custom_fields ?? {}) as Record<string, unknown>;
          if (gateCf.product === 'heypubli') {
            return new Response(TWIML_OK, {
              status: 200,
              headers: { 'Content-Type': 'text/xml' },
            });
          }
          const { data: s } = await supa
            .from('wk_ai_reply_settings')
            .select('enabled, reply_delay_seconds, max_replies_per_contact')
            .eq('id', 'default')
            .maybeSingle();
          const settings = s as { enabled?: boolean; reply_delay_seconds?: number; max_replies_per_contact?: number } | null;
          if (settings?.enabled) {
            const { data: c } = await supa
              .from('wk_contacts')
              .select('ai_enabled, ai_reply_count')
              .eq('id', contactId)
              .maybeSingle();
            const contact = c as { ai_enabled?: boolean; ai_reply_count?: number } | null;
            const maxReplies = settings.max_replies_per_contact ?? 5;
            if (contact?.ai_enabled !== false && (contact?.ai_reply_count ?? 0) < maxReplies) {
              const delay = Math.max(0, settings.reply_delay_seconds ?? 45);
              await supa.from('wk_jobs').insert({
                kind: 'ai_reply',
                status: 'pending',
                scheduled_for: new Date(Date.now() + delay * 1000).toISOString(),
                // channel rides along so the reply goes back on the SAME
                // channel the lead used (a WhatsApp thread must not be
                // answered by a paid SMS to the same person).
                payload: { contact_id: contactId, to_e164: toE164 || null, from_e164: fromE164, channel },
              });
            }
          }
        } catch (e) {
          console.error('[wk-sms-incoming] ai_reply enqueue failed (non-fatal)', e);
        }
      }
    }

    // Empty TwiML — no auto-reply.
    return new Response(TWIML_OK, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('[wk-sms-incoming] threw', e);
    // Always 200 so Twilio doesn't retry an event we can't process.
    return new Response(TWIML_OK, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
    });
  }
});
