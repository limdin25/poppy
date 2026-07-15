// useContactPersistence — write-through helpers for wk_contacts mutations.
//
// The SmsV2Store reducer is purely local. Pages need to optimistically
// update the store AND persist to wk_contacts. This module owns that
// second half. It deliberately does not couple to the store — pages
// dispatch to the store first, then call these to persist.
//
// Mock contact IDs (anything that doesn't look like a UUID, e.g.
// `contact-1` from MOCK_CONTACTS) are no-ops so dev/Storybook keeps
// working without a Supabase round-trip.

import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRealContactId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Returns the value if it is a real UUID, otherwise null. */
function uuidOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return UUID_RE.test(value) ? value : null;
}

/**
 * Strips fields whose values look like mock IDs (non-UUID strings) so they
 * never land in a Supabase update against a uuid column. Operates on the
 * known UUID-typed wk_contacts columns: pipeline_column_id, owner_agent_id.
 */
const UUID_FIELDS = ['pipeline_column_id', 'owner_agent_id'] as const;

function sanitizeUuidFields<T extends Record<string, unknown>>(patch: T): T {
  const out: Record<string, unknown> = { ...patch };
  for (const key of UUID_FIELDS) {
    if (key in out) {
      const v = out[key];
      // null is valid (clears the FK). Strings must be UUIDs to survive.
      if (typeof v === 'string' && !UUID_RE.test(v)) {
        delete out[key];
      }
    }
  }
  return out as T;
}

export interface ContactPersistAPI {
  /** Move a contact to a pipeline column. Returns true on success. */
  moveToColumn: (contactId: string, columnId: string) => Promise<boolean>;
  /** Patch arbitrary fields. Skipped if the id is not a real UUID.
   *  Returns `true` on success, or an error string on failure. */
  patchContact: (
    contactId: string,
    patch: Partial<{
      name: string;
      phone: string;
      email: string | null;
      pipeline_column_id: string | null;
      owner_agent_id: string | null;
      deal_value_pence: number | null;
      is_hot: boolean;
      custom_fields: Record<string, string>;
      last_contact_at: string;
    }>
  ) => Promise<true | string>;
  /**
   * Replace the full tag set for a contact. Wipes wk_contact_tags rows
   * for the contact, then inserts the new list. Skipped for mock IDs.
   */
  replaceTags: (contactId: string, tags: string[]) => Promise<boolean>;
  /** Insert a new contact. Returns { id, existed } on success, null on
   *  fail. `existed=true` means a contact with this phone already
   *  existed and we're returning that row's id (idempotent — caller
   *  should toast "Contact already exists" rather than "Created"). */
  createContact: (input: {
    name: string;
    phone: string;
    email?: string;
    pipelineColumnId?: string | null;
    ownerAgentId?: string | null;
    customFields?: Record<string, string>;
  }) => Promise<{ id: string; existed: boolean } | null>;
}

export function useContactPersistence(): ContactPersistAPI {
  const moveToColumn = useCallback(async (contactId: string, columnId: string) => {
    if (!isRealContactId(contactId)) return true;
    // Mock column ID (e.g. "col-interested" from MOCK_PIPELINES) — no-op.
    // The store will keep the optimistic local move; persistence skipped.
    if (!isRealContactId(columnId)) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_contacts' as any) as any)
      .update({ pipeline_column_id: columnId, last_contact_at: new Date().toISOString() })
      .eq('id', contactId);
    if (error) {
      console.warn('[contact-persist] moveToColumn failed:', error.message);
      return false;
    }
    return true;
  }, []);

  const patchContact = useCallback<ContactPersistAPI['patchContact']>(
    async (contactId, patch) => {
      if (!isRealContactId(contactId)) return true;
      const cleaned = sanitizeUuidFields(patch);
      if ('email' in cleaned) {
        (cleaned as Record<string, unknown>).email =
          (cleaned as Record<string, unknown>).email || null;
      }
      if (Object.keys(cleaned).length === 0) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('wk_contacts' as any) as any)
        .update(cleaned)
        .eq('id', contactId);
      if (error) {
        console.warn('[contact-persist] patchContact failed:', error.message);
        if (error.message?.includes('wk_contacts_email_uniq'))
          return 'This email is already used by another contact';
        if (error.message?.includes('wk_contacts_phone_uniq'))
          return 'This phone number is already used by another contact';
        return 'Save failed';
      }
      return true;
    },
    []
  );

  const replaceTags = useCallback(async (contactId: string, tags: string[]) => {
    if (!isRealContactId(contactId)) return true;
    // Wipe + insert. Cheap because tag count is always small (<10 typical).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delErr } = await (supabase.from('wk_contact_tags' as any) as any)
      .delete()
      .eq('contact_id', contactId);
    if (delErr) {
      console.warn('[contact-persist] replaceTags delete failed:', delErr.message);
      return false;
    }
    if (tags.length === 0) return true;
    const rows = tags.map((tag) => ({ contact_id: contactId, tag }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabase.from('wk_contact_tags' as any) as any).insert(rows);
    if (insErr) {
      console.warn('[contact-persist] replaceTags insert failed:', insErr.message);
      return false;
    }
    return true;
  }, []);

  const createContact = useCallback<ContactPersistAPI['createContact']>(async (input) => {
    // Owner must be a real UUID (FK to profiles.id). Reject mock IDs like
    // "a-hugo" from MOCK_AGENTS — Postgres throws "invalid input syntax for type uuid".
    let owner: string | null = uuidOrNull(input.ownerAgentId ?? null);
    if (!owner) {
      const { data } = await supabase.auth.getUser();
      owner = uuidOrNull(data.user?.id ?? null);
    }
    // Same guard for pipeline_column_id (FK to wk_pipeline_columns.id).
    // Mock id "col-interested" from MOCK_PIPELINES → null.
    const pipelineColumnId = uuidOrNull(input.pipelineColumnId ?? null);

    // PR 119 (Hugo 2026-04-28): wk_contacts.phone is UNIQUE (PR 118
    // promoted the partial index to full). A plain INSERT throws a 409
    // "duplicate key value violates unique constraint" the moment the
    // agent types a phone that already exists — even when the existing
    // row is filtered out of view by stage/owner/search filters. Make
    // creation idempotent: look up first; if a contact already exists
    // for this phone, return its id (agent goes straight to the
    // existing record); otherwise insert.
    if (input.phone) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase.from('wk_contacts' as any) as any)
        .select('id')
        .eq('phone', input.phone)
        .maybeSingle();
      const existingId = (existing as { id: string } | null)?.id ?? null;
      if (existingId) return { id: existingId, existed: true };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_contacts' as any) as any)
      .insert({
        name: input.name,
        phone: input.phone,
        email: input.email || null,
        owner_agent_id: owner,
        pipeline_column_id: pipelineColumnId,
        custom_fields: input.customFields ?? {},
        is_hot: false,
      })
      .select('id')
      .single();
    if (error) {
      // Race: another tab/agent inserted the same phone between our
      // SELECT and INSERT. Re-query and return that row's id so the
      // agent doesn't see a confusing "Could not create contact".
      if (error.code === '23505' && input.phone) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: raced } = await (supabase.from('wk_contacts' as any) as any)
          .select('id')
          .eq('phone', input.phone)
          .maybeSingle();
        const racedId = (raced as { id: string } | null)?.id ?? null;
        if (racedId) return { id: racedId, existed: true };
      }
      console.warn('[contact-persist] createContact failed:', error.message);
      return null;
    }
    const newId = (data as { id: string } | null)?.id ?? null;
    return newId ? { id: newId, existed: false } : null;
  }, []);

  return { moveToColumn, patchContact, replaceTags, createContact };
}
