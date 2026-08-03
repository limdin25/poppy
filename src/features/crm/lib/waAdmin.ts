// Client access to the WhatsApp sender (Hugo 2026-08-03).
// One door: the wk-whatsapp-admin edge function. Reading the template list
// is open to any staff member (an agent has to pick a template to send one);
// every write is refused there unless the caller is an admin.

import { supabase } from '@/integrations/supabase/browser';

export interface MetaTemplate {
  sid: string;
  name: string;
  language: string;
  body: string;
  date_created: string;
  approval: { status: string; category: string; rejection_reason: string };
}

export interface SenderProfile {
  name: string;
  about: string;
  description: string;
  address: string;
  email: string;
  website: string;
  logo_url: string;
  vertical: string;
}

export const EMPTY_PROFILE: SenderProfile = {
  name: '', about: '', description: '', address: '',
  email: '', website: '', logo_url: '', vertical: '',
};

/** supabase-js puts the fixed "non-2xx" string in error.message and hides the
 *  real JSON body in error.context, so every failure reads the same without
 *  this. The 24h-window and approval refusals are only useful if they arrive. */
export async function fnErrorText(
  error: { message?: string; context?: Response } | null,
  data: { error?: string } | null,
): Promise<string | null> {
  if (data?.error) return data.error;
  if (!error) return null;
  try {
    const body = await error.context?.clone().json() as { error?: unknown } | undefined;
    if (body?.error) return String(body.error);
  } catch { /* body was not JSON, fall through */ }
  return error.message ?? 'unknown';
}

export async function callWaAdmin<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('wk-whatsapp-admin', {
    body: payload,
  });
  if (error || (data as { error?: string } | null)?.error) {
    throw new Error(
      (await fnErrorText(error, data as { error?: string } | null)) ?? 'request failed',
    );
  }
  return data as T;
}

export const isApproved = (t: MetaTemplate): boolean =>
  t.approval.status.toLowerCase() === 'approved';

/** Fill {{1}}, {{2}} ... for the preview. The server renders it again from
 *  Twilio's own copy of the template before storing the sent row, so this is
 *  a preview only and can never be what decides the wording. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => vars[n] ?? `{{${n}}}`);
}

/** Is the free-reply window open? WhatsApp allows free-form messages only
 *  within 24 hours of the lead's last inbound WhatsApp; outside it, only an
 *  approved template gets through. */
export function waWindowOpen(
  messages: Array<{ direction: string; channel: string; createdAt: string }>,
  now: number = Date.now(),
): boolean {
  const cutoff = now - 24 * 3600 * 1000;
  return messages.some(
    (m) =>
      m.direction === 'inbound' &&
      m.channel === 'whatsapp' &&
      new Date(m.createdAt).getTime() >= cutoff,
  );
}
