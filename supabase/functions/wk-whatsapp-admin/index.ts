// wk-whatsapp-admin: management of the ONE Meta-registered WhatsApp Business
// sender (Hugo 2026-08-03). Admin-only, except reading the template list.
//
// Two Twilio surfaces behind one function:
//   - Senders API v2 (messaging.twilio.com/v2/Channels/Senders/{sid}):
//     the business profile leads see when they tap the name in WhatsApp
//     (bio, description, website, email, address, vertical, logo).
//     Changing the DISPLAY NAME goes to Meta for review; the rest applies
//     within minutes.
//   - Content API (content.twilio.com/v1): Meta message templates. An
//     approved template is the ONLY thing that can open a conversation
//     outside the 24 hour reply window, so this is what unlocks
//     business-initiated WhatsApp.
//
// POST JSON { action, ... }. Caller must be a signed-in admin
// (admin_users by email), because the sender is shared by the whole
// workspace: one bad template or profile edit affects every agent.
//
// Actions:
//   profile_get                          -> sender status + profile
//   profile_update  { profile: {...} }   -> partial update, only sent keys
//   template_list                        -> templates + approval status
//   template_create { name, body, category, language?, samples? }
//                                        -> create + submit to Meta
//   template_status { content_sid }      -> one template's approval state
//   template_delete { content_sid }      -> remove a template

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
// The registered sender's Twilio sid (XE...). Public config, not a secret.
const WHATSAPP_SENDER_SID =
  Deno.env.get('WHATSAPP_SENDER_SID') || 'XE2daaab9bfd23a41bda35894a1d7ac86e';

const SENDER_URL = `https://messaging.twilio.com/v2/Channels/Senders/${WHATSAPP_SENDER_SID}`;
const CONTENT_BASE = 'https://content.twilio.com/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const twilioAuth = 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

async function twilio(
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: twilioAuth,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // 204 on delete has no body
  }
  return { ok: res.ok, status: res.status, data };
}

const twilioError = (data: Record<string, unknown>): string =>
  String(data.message ?? data.error ?? 'Twilio request failed');

// ---------- template validation (plain-words errors, Meta's real rules) ----

// House rule: no long dashes, curly quotes or ellipsis characters in any
// outbound copy. Rejected here so a template can never carry them to Meta.
// Built from CODE POINTS so this guard does not itself contain the characters
// it forbids: 2013 en dash, 2014 em dash, 2018/2019 curly single quotes,
// 201C/201D curly doubles, 2026 ellipsis.
const BANNED_PUNCTUATION = new RegExp(
  `[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026]
    .map((c) => String.fromCharCode(c))
    .join('')}]`,
);

const VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function validateTemplate(name: string, body: string, category: string): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    return 'Template name must be lowercase letters, numbers and underscores only (e.g. instagram_url_request).';
  }
  if (!body.trim()) return 'Template body is required.';
  if (body.length > 1024) return 'Template body is over WhatsApp\'s 1024 character limit.';
  if (BANNED_PUNCTUATION.test(body)) {
    return 'The body contains a long dash, curly quote or ellipsis character. Use straight punctuation.';
  }
  if (!['MARKETING', 'UTILITY'].includes(category)) {
    return 'Category must be MARKETING or UTILITY.';
  }
  const vars: string[] = [];
  for (const m of body.matchAll(VAR_RE)) vars.push(m[1]);
  for (const v of vars) {
    if (!/^\d+$/.test(v)) {
      return `Variables must be numbers: use {{1}}, {{2}}. Found {{${v}}}.`;
    }
  }
  const nums = [...new Set(vars.map(Number))].sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      return 'Variables must be numbered 1, 2, 3 with no gaps, starting at {{1}}.';
    }
  }
  const trimmed = body.trim();
  // Meta ignores trailing punctuation when it applies this rule: a body ending
  // "on {{3}}?" was rejected live on 2026-08-20 (subCode 2388299, "Variables
  // can't be at the start or end"). So the test strips punctuation first, and
  // the fix is a closing WORD ("Thanks."), not a question mark.
  const bare = trimmed.replace(/^[^\w{]+/, '').replace(/[^\w}]+$/, '');
  if (/^\{\{\s*\d+\s*\}\}/.test(bare) || /\{\{\s*\d+\s*\}\}$/.test(bare)) {
    return 'Meta rejects templates that start or end with a variable (punctuation after it does not count). Add a word around it.';
  }
  return null;
}

// ---------- actions ---------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Payload = Record<string, any>;

async function profileGet() {
  const { ok, data } = await twilio('GET', SENDER_URL);
  if (!ok) return json(502, { error: twilioError(data) });
  const p = (data.profile ?? {}) as Payload;
  const props = (data.properties ?? {}) as Payload;
  return json(200, {
    sender: String(data.sender_id ?? ''),
    status: String(data.status ?? ''),
    quality_rating: String(props.quality_rating ?? ''),
    messaging_limit: String(props.messaging_limit ?? ''),
    profile: {
      name: String(p.name ?? ''),
      about: String(p.about ?? ''),
      description: String(p.description ?? ''),
      address: String(p.address ?? ''),
      email: String(p.emails?.[0]?.email ?? ''),
      website: String(p.websites?.[0]?.website ?? ''),
      logo_url: String(p.logo_url ?? ''),
      vertical: String(p.vertical ?? ''),
    },
  });
}

async function profileUpdate(payload: Payload) {
  const input = (payload.profile ?? {}) as Payload;
  const profile: Payload = {};
  const setIf = (key: string, value: unknown) => {
    if (typeof value === 'string') profile[key] = value.trim();
  };
  setIf('name', input.name);
  setIf('about', input.about);
  setIf('description', input.description);
  setIf('address', input.address);
  setIf('logo_url', input.logo_url);
  setIf('vertical', input.vertical);
  if (typeof input.email === 'string') {
    profile.emails = input.email.trim()
      ? [{ email: input.email.trim(), label: 'Email' }]
      : [];
  }
  if (typeof input.website === 'string') {
    profile.websites = input.website.trim()
      ? [{ website: input.website.trim(), label: 'Website' }]
      : [];
  }
  if (Object.keys(profile).length === 0) {
    return json(400, { error: 'Nothing to update.' });
  }
  if (typeof profile.about === 'string' && profile.about.length > 139) {
    return json(400, { error: 'The about line (bio) is capped at 139 characters by WhatsApp.' });
  }
  if (typeof profile.description === 'string' && profile.description.length > 512) {
    return json(400, { error: 'The description is capped at 512 characters by WhatsApp.' });
  }
  const { ok, data } = await twilio('POST', SENDER_URL, { profile });
  if (!ok) return json(502, { error: twilioError(data) });
  const nameChanged = typeof profile.name === 'string' && profile.name.length > 0;
  return json(200, {
    ok: true,
    note: nameChanged
      ? 'Saved. A display name change is reviewed by Meta before it shows to leads.'
      : 'Saved.',
  });
}

// One list call that already carries each template's Meta approval state.
async function templateList() {
  const { ok, data } = await twilio(
    'GET',
    `${CONTENT_BASE}/ContentAndApprovals?PageSize=100`,
  );
  if (!ok) return json(502, { error: twilioError(data) });
  const rows = (data.contents ?? []) as Payload[];
  const templates = rows.map((c) => {
    const wa = (c.approval_requests ?? {}) as Payload;
    const types = (c.types ?? {}) as Payload;
    const body = String(
      types['twilio/text']?.body ?? types['twilio/quick-reply']?.body ?? '',
    );
    return {
      sid: String(c.sid ?? ''),
      name: String(c.friendly_name ?? ''),
      language: String(c.language ?? ''),
      body,
      date_created: String(c.date_created ?? ''),
      approval: {
        status: String(wa.status ?? 'unsubmitted'),
        category: String(wa.category ?? ''),
        rejection_reason: String(wa.rejection_reason ?? ''),
      },
    };
  });
  return json(200, { templates });
}

async function templateCreate(payload: Payload) {
  const name = String(payload.name ?? '').trim();
  const body = String(payload.body ?? '');
  const category = String(payload.category ?? 'MARKETING').toUpperCase();
  const language = String(payload.language ?? 'en');
  const samples = (payload.samples ?? {}) as Record<string, string>;

  const problem = validateTemplate(name, body, category);
  if (problem) return json(400, { error: problem });

  // Sample values for each {{n}}: Meta reviewers see these filled in.
  const variables: Record<string, string> = {};
  for (const m of body.matchAll(VAR_RE)) {
    const n = m[1];
    variables[n] = (samples[n] ?? '').trim() || 'John';
  }

  const created = await twilio('POST', `${CONTENT_BASE}/Content`, {
    friendly_name: name,
    language,
    ...(Object.keys(variables).length ? { variables } : {}),
    types: { 'twilio/text': { body } },
  });
  if (!created.ok) return json(502, { error: twilioError(created.data) });
  const sid = String(created.data.sid ?? '');

  const submitted = await twilio(
    'POST',
    `${CONTENT_BASE}/Content/${sid}/ApprovalRequests/whatsapp`,
    { name, category },
  );
  if (!submitted.ok) {
    // The template exists but never reached Meta. Surface that honestly so
    // the admin can delete it or retry, rather than a half-true failure.
    return json(502, {
      error: `Template was created (${sid}) but the Meta submission failed: ${twilioError(submitted.data)}`,
      content_sid: sid,
    });
  }
  const wa = (submitted.data.whatsapp ?? submitted.data) as Payload;
  return json(200, {
    content_sid: sid,
    approval_status: String(wa.status ?? 'received'),
  });
}

async function templateStatus(payload: Payload) {
  const sid = String(payload.content_sid ?? '').trim();
  if (!/^HX[0-9a-f]{32}$/i.test(sid)) return json(400, { error: 'content_sid required' });
  const { ok, data } = await twilio(
    'GET',
    `${CONTENT_BASE}/Content/${sid}/ApprovalRequests`,
  );
  if (!ok) return json(502, { error: twilioError(data) });
  const wa = (data.whatsapp ?? {}) as Payload;
  return json(200, {
    status: String(wa.status ?? 'unsubmitted'),
    category: String(wa.category ?? ''),
    rejection_reason: String(wa.rejection_reason ?? ''),
  });
}

async function templateDelete(payload: Payload) {
  const sid = String(payload.content_sid ?? '').trim();
  if (!/^HX[0-9a-f]{32}$/i.test(sid)) return json(400, { error: 'content_sid required' });
  const { ok, status, data } = await twilio('DELETE', `${CONTENT_BASE}/Content/${sid}`);
  if (!ok && status !== 404) return json(502, { error: twilioError(data) });
  return json(200, { ok: true });
}

// ---------- entry ------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });

    // Changing the sender is admin-only: it is shared workspace
    // infrastructure, one bad template or profile edit hits every agent.
    // READING the template list is not, because an agent has to pick an
    // approved template to send one (wk-sms-send does the send).
    const { data: adminRow } = await supa
      .from('admin_users')
      .select('email')
      .eq('email', userResp.user.email ?? '')
      .maybeSingle();
    const { data: senderProfile } = await supa
      .from('profiles')
      .select('workspace_role')
      .eq('id', userResp.user.id)
      .maybeSingle();
    const role = (senderProfile as { workspace_role?: string } | null)?.workspace_role ?? '';
    const isAdmin = !!adminRow || role === 'admin';
    if (!isAdmin && role !== 'agent') return json(403, { error: 'Staff only.' });

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return json(500, { error: 'Twilio credentials are not configured.' });
    }

    let payload: Payload;
    try {
      payload = await req.json() as Payload;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const action = String(payload.action ?? '');
    // Everything except reading the template list changes shared state.
    if (action !== 'template_list' && !isAdmin) {
      return json(403, { error: 'Admins only.' });
    }

    switch (action) {
      case 'profile_get': return await profileGet();
      case 'profile_update': return await profileUpdate(payload);
      case 'template_list': return await templateList();
      case 'template_create': return await templateCreate(payload);
      case 'template_status': return await templateStatus(payload);
      case 'template_delete': return await templateDelete(payload);
      default: return json(400, { error: 'Unknown action' });
    }
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
