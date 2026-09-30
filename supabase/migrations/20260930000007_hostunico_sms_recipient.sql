-- A confirmed report mobile belongs to the same lead. Calling stays on phone.
alter table public.sa_listings add column if not exists hostunico_call_eligible boolean not null default false;
alter table public.sa_listings add column if not exists hostunico_eligibility_note text;
alter table public.wk_contacts add column if not exists hostunico_sms_phone text;
create unique index if not exists wk_contacts_hostunico_sms_phone_unique
  on public.wk_contacts (hostunico_sms_phone) where hostunico_sms_phone is not null;
alter table public.wk_contacts add constraint wk_contacts_hostunico_sms_phone_e164
  check (hostunico_sms_phone is null or hostunico_sms_phone ~ '^\+[1-9][0-9]{7,14}$');

-- Claim and placeholder are atomic: a slow older request cannot replace a
-- newer caller turn after losing the generation lock.
create or replace function public.wk_hostunico_start_coach(p_call_id uuid, p_generation uuid, p_context text)
returns uuid language plpgsql security definer set search_path = public as $$
declare holder uuid; card_id uuid;
begin
  select generation_id into holder from wk_live_coach_locks where call_id = p_call_id for update;
  if holder is distinct from p_generation then return null; end if;
  delete from wk_live_coach_events where call_id = p_call_id and status = 'streaming';
  insert into wk_live_coach_events(call_id,generation_id,kind,status,body,script_section)
    values(p_call_id,p_generation,'suggestion','streaming','...',p_context) returning id into card_id;
  return card_id;
end $$;
revoke all on function public.wk_hostunico_start_coach(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.wk_hostunico_start_coach(uuid,uuid,text) to service_role;

create or replace function public.wk_hostunico_call_context(p_contact uuid, p_listing uuid, p_mode text, p_changed_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('spareroom','facebook','followup') then raise exception 'Invalid call script'; end if;
  if not exists(select 1 from sa_listings where id = p_listing and wk_contact_id = p_contact) then raise exception 'Wrong contact'; end if;
  update wk_contacts set custom_fields = coalesce(custom_fields,'{}'::jsonb) || jsonb_build_object(
    'hostunico_listing_id',p_listing,'hostunico_script_mode',p_mode,'hostunico_context_at',p_changed_at)
    where id = p_contact and desk = 'sa'
      and (custom_fields->>'hostunico_context_at' is null or (custom_fields->>'hostunico_context_at')::timestamptz <= p_changed_at);
end $$;
revoke all on function public.wk_hostunico_call_context(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.wk_hostunico_call_context(uuid,uuid,text,timestamptz) to service_role;
