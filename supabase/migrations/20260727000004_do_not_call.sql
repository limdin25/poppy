-- Do-not-call suppression.
--
-- Audit finding, Hugo 2026-07-26: there was no way to record "never ring this
-- number again" anywhere in the CRM. ~830 outbound cold calls a month to UK
-- trades businesses with no suppression list at all.
--
-- Under PECR reg 21 a business that has told you not to call, or that is
-- registered with CTPS, must not be called again. This gives the agent a
-- one-tap way to honour that on the call, and takes the lead out of every
-- queue immediately.
--
-- NOTE: this covers "they asked us not to" and any CTPS matches you import.
-- Bulk CTPS screening itself needs a paid CTPS licence and their file — that
-- is a commercial step, not a code one. Import matches into these columns with
-- source = 'ctps' once you have it.
--
-- Re-run safe.

alter table wk_contacts
  add column if not exists do_not_call boolean not null default false,
  add column if not exists do_not_call_at timestamptz,
  add column if not exists do_not_call_reason text,
  add column if not exists do_not_call_source text; -- 'agent' | 'ctps' | 'reply_stop' | 'import'

-- Partial index: the queue filters on `do_not_call = false` on every load, and
-- the suppressed set stays small.
create index if not exists wk_contacts_dnc_idx
  on wk_contacts (do_not_call) where do_not_call;

-- Stamp the audit fields automatically so an agent tapping a button (or any
-- future importer) can't forget to record WHEN and WHY.
create or replace function wk_stamp_do_not_call()
returns trigger language plpgsql as $$
begin
  if new.do_not_call and not coalesce(old.do_not_call, false) then
    new.do_not_call_at := coalesce(new.do_not_call_at, now());
    new.do_not_call_source := coalesce(new.do_not_call_source, 'agent');
  elsif not new.do_not_call and coalesce(old.do_not_call, false) then
    -- Un-suppressing clears the record rather than leaving a stale timestamp.
    new.do_not_call_at := null;
    new.do_not_call_reason := null;
    new.do_not_call_source := null;
  end if;
  return new;
end $$;

drop trigger if exists wk_contacts_stamp_dnc on wk_contacts;
create trigger wk_contacts_stamp_dnc
  before update on wk_contacts
  for each row execute function wk_stamp_do_not_call();

-- Take suppressed leads out of every pending queue the moment they're flagged.
create or replace function wk_purge_dnc_from_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.do_not_call and not coalesce(old.do_not_call, false) then
    update wk_dialer_queue
       set status = 'skipped'
     where contact_id = new.id
       and status = 'pending';
  end if;
  return new;
end $$;

drop trigger if exists wk_contacts_purge_dnc on wk_contacts;
create trigger wk_contacts_purge_dnc
  after update on wk_contacts
  for each row execute function wk_purge_dnc_from_queue();

comment on column wk_contacts.do_not_call is
  'Never call or text this lead again. Set by an agent on the call, by a STOP reply, or by a CTPS import. Enforced in the dialer queue and by a trigger that skips pending queue rows.';
