-- The opener names the site the advert is actually on (Hugo, 2026-10-14).
-- The script row hardcoded "on SpareRoom"; it now reads [sa_source], filled
-- with Rightmove or SpareRoom from the lead's sa_listings.source. The call
-- script mode is renamed spareroom -> listing; spareroom is still accepted
-- so an open tab from before the change keeps working.

update public.wk_sa_call_script
   set html = replace(html, 'on SpareRoom. Is it still available?', 'on [sa_source]. Is it still available?'),
       updated_at = now()
 where id = 1 and html like '%on SpareRoom. Is it still available?%';

create or replace function public.wk_hostunico_call_context(p_contact uuid, p_listing uuid, p_mode text, p_changed_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('listing','spareroom','facebook','followup') then raise exception 'Invalid call script'; end if;
  if not exists(select 1 from sa_listings where id = p_listing and wk_contact_id = p_contact) then raise exception 'Wrong contact'; end if;
  update wk_contacts set custom_fields = coalesce(custom_fields,'{}'::jsonb) || jsonb_build_object(
    'hostunico_listing_id',p_listing,'hostunico_script_mode',case when p_mode = 'spareroom' then 'listing' else p_mode end,'hostunico_context_at',p_changed_at)
    where id = p_contact and desk = 'sa'
      and (custom_fields->>'hostunico_context_at' is null or (custom_fields->>'hostunico_context_at')::timestamptz <= p_changed_at);
end $$;
