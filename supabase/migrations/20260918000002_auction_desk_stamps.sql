-- The desk follows the contact, whoever writes the row.
--
-- 20260918000001 put a desk on wk_contacts and wk_calls. Calls are written by
-- at least four paths (the dialer's wk-calls-create, the inbound TwiML, the
-- status callback, voicemail drop), and notifications by several more, so
-- stamping the desk in each of them would be one missed path away from a Houses
-- call showing up on Auction. A trigger stamps it from the contact instead:
-- when the row knows its contact, the contact's desk wins. When it does not
-- (an inbound call from a number nobody has seen), whatever the writer chose
-- stands, which for the inbound TwiML is the desk the agent is on.

create or replace function public.wk_desk_from_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_desk text;
begin
  if new.contact_id is not null then
    select desk into v_desk from wk_contacts where id = new.contact_id;
    if v_desk is not null then
      new.desk := v_desk;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wk_calls_desk_from_contact on public.wk_calls;
create trigger wk_calls_desk_from_contact
  before insert or update of contact_id on public.wk_calls
  for each row execute function public.wk_desk_from_contact();

alter table public.wk_notifications add column if not exists desk text not null default 'houses';
alter table public.wk_notifications drop constraint if exists wk_notifications_desk_chk;
alter table public.wk_notifications add constraint wk_notifications_desk_chk check (desk in ('houses', 'auction'));

drop trigger if exists wk_notifications_desk_from_contact on public.wk_notifications;
create trigger wk_notifications_desk_from_contact
  before insert or update of contact_id on public.wk_notifications
  for each row execute function public.wk_desk_from_contact();

-- REVERT (run by hand):
--   drop trigger if exists wk_calls_desk_from_contact on public.wk_calls;
--   drop trigger if exists wk_notifications_desk_from_contact on public.wk_notifications;
--   drop function if exists public.wk_desk_from_contact();
--   alter table public.wk_notifications drop column if exists desk;
