// useResolvedFromLine — resolves the "From: …" caption for the CRM send box so
// the number/address shown is the one the message will ACTUALLY go from.
//
// Before this hook (Hugo 2026-07-23): the send box just showed the FIRST active
// wk_numbers row for the channel — the workspace default US toll-free line —
// while the server (wk-sms-send) really sent from the agent's own assigned UK
// number. The caption lied. This hook mirrors each channel's server-side
// precedence exactly:
//
//   sms (wk-sms-send):
//     1. campaign pinned (wk_campaign_numbers, priority ASC, sms_enabled)
//     2. agent's assigned numbers (wk_number_agents) — country-matched to the
//        contact → primary → first
//     3. workspace default — first sms_enabled number, country-matched
//
//   email (wk-email-send — note: agent row wins BEFORE campaign here):
//     1. agent's assigned email row (wk_numbers.assigned_agent_id = me)
//     2. campaign pinned email row
//     3. first UNASSIGNED active email row (never another agent's box)
//
//   whatsapp: unchanged legacy behaviour — first active whatsapp row (usually
//   none → caption hidden).

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type FromChannel = 'sms' | 'whatsapp' | 'email';

export interface NumberLike {
  e164: string;
  label: string | null;
}

export interface AssignedNumber extends NumberLike {
  is_primary: boolean;
}

/** Rough country class for from/to matching: GB (+44) vs North America (+1). */
export const countryClass = (e164: string): 'gb' | 'na' | 'other' =>
  e164.startsWith('+44') ? 'gb' : e164.startsWith('+1') ? 'na' : 'other';

/** Loosely normalise a typed/pasted phone to E.164. UK national (07…) defaults
 *  to +44, mirroring the server-side normaliser in wk-sms-send. */
export function normalizeE164(raw: string): string {
  const s = (raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+44' + s.slice(1);
  return '+' + s;
}

/** Agent-number precedence: country match → primary → first.
 *  Mirrors wk-sms-send step 2.5 exactly. */
export function pickAgentNumber<T extends AssignedNumber>(
  rows: T[],
  destE164: string
): T | null {
  if (rows.length === 0) return null;
  const dest = countryClass(destE164);
  return (
    rows.find((r) => countryClass(r.e164) === dest) ??
    rows.find((r) => r.is_primary) ??
    rows[0]
  );
}

/** Workspace-default precedence: country match → first. */
export function pickCountryMatch<T extends NumberLike>(
  rows: T[],
  destE164: string
): T | null {
  if (rows.length === 0) return null;
  const dest = countryClass(destE164);
  return rows.find((r) => countryClass(r.e164) === dest) ?? rows[0];
}

/** Display string for the caption. Agent-number labels carry the agent's name
 *  in prod ("UK — Marr (CRM)"); when an assigned line has no label, fall back
 *  to "<Name>'s line" so the agent always sees it's THEIR number. */
export function formatFromLine(
  n: NumberLike,
  mine: boolean,
  agentFirstName?: string
): string {
  if (n.label) return `${n.e164} · ${n.label}`;
  if (mine && agentFirstName) return `${n.e164} · ${agentFirstName}'s line`;
  return n.e164;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (name: string) => supabase.from(name as any) as any;

interface EmbeddedNumber {
  e164: string;
  label: string | null;
  channel: string;
  provider?: string | null;
  sms_enabled?: boolean | null;
  is_active: boolean | null;
}

/** PostgREST many-to-one embeds come back as an object; tolerate arrays too. */
function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface ResolveOptions {
  contactPhone?: string | null;
  campaignId?: string | null;
  agentFirstName?: string;
}

async function resolveFromLine(
  channel: FromChannel,
  { contactPhone = null, campaignId = null, agentFirstName = '' }: ResolveOptions
): Promise<string | null> {
  const dest = normalizeE164(contactPhone ?? '');
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id ?? null;

  if (channel === 'sms') {
    // 1. Campaign pinned (priority ASC) — first sms_enabled active number.
    if (campaignId) {
      const { data } = await tbl('wk_campaign_numbers')
        .select('priority, wk_numbers(e164, label, channel, sms_enabled, is_active)')
        .eq('campaign_id', campaignId)
        .order('priority', { ascending: true });
      const pinned = ((data ?? []) as Array<{ wk_numbers: EmbeddedNumber | EmbeddedNumber[] | null }>)
        .map((r) => unwrap(r.wk_numbers))
        .filter(
          (n): n is EmbeddedNumber =>
            !!n && n.channel === 'sms' && !!n.sms_enabled && !!n.is_active
        );
      if (pinned[0]) return formatFromLine(pinned[0], false);
    }

    // 2. The sending agent's assigned number(s) — country match → primary → first.
    if (uid) {
      const { data } = await tbl('wk_number_agents')
        .select('is_primary, wk_numbers(e164, label, channel, sms_enabled, is_active)')
        .eq('agent_id', uid);
      const rows = ((data ?? []) as Array<{
        is_primary: boolean;
        wk_numbers: EmbeddedNumber | EmbeddedNumber[] | null;
      }>)
        .map((r) => {
          const n = unwrap(r.wk_numbers);
          return n && n.channel === 'sms' && n.sms_enabled && n.is_active
            ? { e164: n.e164, label: n.label, is_primary: r.is_primary }
            : null;
        })
        .filter((r): r is AssignedNumber => r !== null);
      const mine = pickAgentNumber(rows, dest);
      if (mine) return formatFromLine(mine, true, agentFirstName);
    }

    // 3. Workspace default — first sms_enabled number, country-matched.
    const { data } = await tbl('wk_numbers')
      .select('e164, label')
      .eq('sms_enabled', true)
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    const fallback = pickCountryMatch((data ?? []) as NumberLike[], dest);
    return fallback ? formatFromLine(fallback, false) : null;
  }

  if (channel === 'email') {
    // 1. Agent's own email row (server checks this BEFORE campaign for email).
    if (uid) {
      const { data } = await tbl('wk_numbers')
        .select('e164, label')
        .eq('channel', 'email')
        .eq('provider', 'resend')
        .eq('is_active', true)
        .eq('assigned_agent_id', uid)
        .maybeSingle();
      if ((data as NumberLike | null)?.e164) {
        return formatFromLine(data as NumberLike, true, agentFirstName);
      }
    }

    // 2. Campaign pinned email row.
    if (campaignId) {
      const { data } = await tbl('wk_campaign_numbers')
        .select('priority, wk_numbers(e164, label, channel, provider, is_active)')
        .eq('campaign_id', campaignId)
        .order('priority', { ascending: true });
      const pinned = ((data ?? []) as Array<{ wk_numbers: EmbeddedNumber | EmbeddedNumber[] | null }>)
        .map((r) => unwrap(r.wk_numbers))
        .filter(
          (n): n is EmbeddedNumber =>
            !!n && n.channel === 'email' && n.provider === 'resend' && !!n.is_active
        );
      if (pinned[0]) return formatFromLine(pinned[0], false);
    }

    // 3. First UNASSIGNED active email row — never another agent's box.
    const { data } = await tbl('wk_numbers')
      .select('e164, label')
      .eq('channel', 'email')
      .eq('provider', 'resend')
      .eq('is_active', true)
      .is('assigned_agent_id', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as NumberLike | null)?.e164
      ? formatFromLine(data as NumberLike, false)
      : null;
  }

  // whatsapp — legacy: first active row for the channel.
  const { data } = await tbl('wk_numbers')
    .select('e164, label')
    .eq('channel', channel)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as NumberLike | null)?.e164
    ? formatFromLine(data as NumberLike, false)
    : null;
}

export function useResolvedFromLine(
  channel: FromChannel | null,
  opts: ResolveOptions = {}
): string | null {
  const { contactPhone = null, campaignId = null, agentFirstName = '' } = opts;
  const [fromLine, setFromLine] = useState<string | null>(null);

  useEffect(() => {
    if (!channel) {
      setFromLine(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const line = await resolveFromLine(channel, {
          contactPhone,
          campaignId,
          agentFirstName,
        });
        if (!cancelled) setFromLine(line);
      } catch {
        // RLS / missing table — the caption just hides.
        if (!cancelled) setFromLine(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel, contactPhone, campaignId, agentFirstName]);

  return fromLine;
}
