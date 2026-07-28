-- Add 'booking' to the wk_site_events type CHECK.
--
-- The deep site has a "Book an expert" form, and its handler writes an event
-- of type 'booking'. Without this the insert fails with 23514 and the visitor
-- sees "that did not send" while nothing anywhere records that a real person
-- typed their real number into a lead's website. That exact failure went
-- unnoticed on the VSL funnel for weeks, which is why api/site-demo/book.ts
-- reads the insert result rather than firing and forgetting.
--
-- Idempotent: safe to run twice.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'wk_site_events_type_check'
      and conrelid = 'public.wk_site_events'::regclass
  ) then
    alter table public.wk_site_events drop constraint wk_site_events_type_check;
  end if;

  alter table public.wk_site_events
    add constraint wk_site_events_type_check
    check (type in (
      'sent','link_click','open','phone_tap','chat_message',
      'call_started','call_ended','followup_sent','outbound_call',
      'checkout_start','converted','booking'
    ));
end $$;
