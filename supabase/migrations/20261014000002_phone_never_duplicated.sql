-- A phone number is NEVER added twice (Hugo, 2026-10-14). Not on another desk,
-- not after a past call, not after do-not-call. Builds on the phone identity
-- migration 20261006000003 (normalized_phone, wk_phone_registry, the guard).
--
-- 1. Every past call's lead number goes into wk_phone_registry, and new calls
--    keep adding theirs, so a number we ever rang or that rang us is known.
-- 2. A direct INSERT of a known number (live contact, registry, past call)
--    fails. Only wk_ingest_contacts may still fold an incoming lead into its
--    existing contact, which every desk's import already relies on.
-- 3. wk_admit_new_contact: the strict import door. It returns null and adds
--    nothing when the number is known anywhere.
-- 4. New contacts with a phone must have a normalized E.164 phone.
begin;
set local lock_timeout = '15s';

create or replace function public.wk_call_lead_phone(p_direction text, p_from text, p_to text)
returns text language sql immutable set search_path=public as $$
  select wk_normalize_phone(case when p_direction='inbound' then p_from else p_to end)
$$;
create index if not exists wk_calls_lead_phone_idx on public.wk_calls(public.wk_call_lead_phone(direction,from_e164,to_e164));

create or replace function public.wk_phone_in_calls(p_phone text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from wk_calls where wk_call_lead_phone(direction,from_e164,to_e164)=wk_normalize_phone(p_phone))
$$;

insert into public.wk_phone_registry(normalized_phone,contact_id,admitted_at,queued_at)
select p,null,at,at from (
  select public.wk_call_lead_phone(direction,from_e164,to_e164) p,max(created_at) at
  from public.wk_calls group by 1) n
where p is not null
on conflict (normalized_phone) do nothing;

create or replace function public.wk_register_call_phone()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_phone text := wk_call_lead_phone(new.direction,new.from_e164,new.to_e164);
begin
  if v_phone is not null then
    insert into wk_phone_registry(normalized_phone,contact_id,admitted_at,queued_at)
    values(v_phone,new.contact_id,coalesce(new.created_at,now()),coalesce(new.created_at,now())) on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists zz_wk_calls_register_phone on public.wk_calls;
create trigger zz_wk_calls_register_phone after insert or update of from_e164,to_e164 on public.wk_calls
for each row execute function public.wk_register_call_phone();

-- True when the number is anywhere in the CRM: a contact (main or report
-- mobile), the registry (past and deleted contacts, do-not-call), or a call.
create or replace function public.wk_phone_known(p_phone text)
returns boolean language sql stable security definer set search_path=public as $$
  select wk_normalize_phone(p_phone) is null
    or exists(select 1 from wk_contacts where normalized_phone=wk_normalize_phone(p_phone) or hostunico_sms_phone=wk_normalize_phone(p_phone))
    or exists(select 1 from wk_phone_registry where normalized_phone=wk_normalize_phone(p_phone))
    or wk_phone_in_calls(p_phone)
$$;

create or replace function public.wk_guard_contact_phone()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_phone text; v_reg wk_phone_registry%rowtype; v_existing uuid; v_dnc boolean; v_mobile text; v_mobile_owner uuid; v_new_number boolean; v_merge boolean;
begin
  v_phone:=wk_normalize_phone(new.phone);
  if v_phone is null then
    if (tg_op='INSERT' or new.phone is distinct from old.phone) and new.phone !~ '^(email:|$)' then raise exception 'Invalid phone number' using errcode='22023'; end if;
    return new;
  end if;
  new.phone:=v_phone;
  -- INSERT ON CONFLICT plus the row lock serialize even simultaneous imports.
  insert into wk_phone_registry(normalized_phone,contact_id) values(v_phone,null) on conflict do nothing returning true into v_new_number;
  v_new_number:=coalesce(v_new_number,false);
  -- Only wk_ingest_contacts may fold an incoming lead into an existing contact.
  -- Every other insert of a number the CRM already knows is refused.
  v_merge:=coalesce(current_setting('wk.phone_merge',true),'')='on';
  select * into v_reg from wk_phone_registry where normalized_phone=v_phone for update;
  select id into v_existing from wk_contacts where (normalized_phone=v_phone or id=v_reg.contact_id) and id<>new.id limit 1;
  if tg_op='UPDATE' and v_existing is not null then
    raise exception 'Phone number already belongs to another contact' using errcode='23505';
  end if;
  select new.do_not_call or lower(coalesce(name,'')) in ('do not contact','do not call') into v_dnc
    from wk_pipeline_columns where id=new.pipeline_column_id;
  v_dnc:=new.do_not_call or coalesce(v_dnc,false) or v_reg.do_not_contact;
  if tg_op='INSERT' and v_existing is not null and not v_merge then
    raise exception 'Phone number already belongs to another contact' using errcode='23505';
  end if;
  if tg_op='INSERT' and v_existing is null and not v_merge and (not v_new_number or wk_phone_in_calls(v_phone)) then
    raise exception 'Phone number is already known to the CRM' using errcode='23505';
  end if;
  if tg_op='INSERT' and v_existing is not null then
    insert into wk_activities(contact_id,kind,title,body,meta)
    select v_existing,'note','Additional lead or listing received',
      concat_ws(E'\n',new.name,new.custom_fields->>'notes',new.custom_fields->>'property_address',
        new.custom_fields->>'property_url',new.custom_fields->>'listing_url',jsonb_pretty(new.custom_fields)),
      jsonb_build_object('incoming',to_jsonb(new),'blocked_until',v_reg.admitted_at+interval '30 days')
    where not exists(select 1 from wk_activities where contact_id=v_existing
      and title='Additional lead or listing received'
      and meta->'incoming'->'custom_fields'=new.custom_fields
      and meta->'incoming'->>'name'=new.name);
    if not v_dnc and not wk_phone_stage_closed(v_existing) and v_reg.admitted_at<=now()-interval '30 days' then
      update wk_phone_registry set admitted_at=now() where normalized_phone=v_phone;
    end if;
    if v_dnc then update wk_contacts set do_not_call=true where id=v_existing and not do_not_call; end if;
    return null;
  end if;
  if tg_op='INSERT' and v_reg.contact_id is not null and v_reg.contact_id<>new.id then
    -- Deleting a contact does not erase its cooldown or permanent suppression.
    if v_dnc or v_reg.admitted_at>now()-interval '30 days' then
      raise exception 'Phone number is suppressed or within its 30 day cooldown' using errcode='23514';
    end if;
  end if;
  update wk_phone_registry set contact_id=new.id,do_not_contact=v_dnc,
    admitted_at=case when contact_id is distinct from new.id then now() else admitted_at end
    where normalized_phone=v_phone;
  if new.hostunico_sms_phone is not null then
    v_mobile:=wk_normalize_phone(new.hostunico_sms_phone);
    if v_mobile is null then raise exception 'Invalid mobile number' using errcode='22023'; end if;
    new.hostunico_sms_phone:=v_mobile;
    insert into wk_phone_registry(normalized_phone,contact_id,do_not_contact) values(v_mobile,new.id,v_dnc) on conflict do nothing;
    select contact_id into v_mobile_owner from wk_phone_registry where normalized_phone=v_mobile for update;
    if v_mobile_owner is distinct from new.id then raise exception 'Mobile already belongs to another contact' using errcode='23505'; end if;
  end if;
  if v_dnc then update wk_phone_registry set do_not_contact=true where contact_id=new.id; end if;
  new.do_not_call:=v_dnc;
  return new;
end $$;
create or replace trigger aa_wk_contact_phone before insert or update of phone,hostunico_sms_phone,do_not_call,pipeline_column_id on public.wk_contacts
for each row execute function public.wk_guard_contact_phone();

create or replace function public.wk_ingest_contacts(p_contacts jsonb)
returns setof public.wk_contacts language plpgsql security definer set search_path=public as $$
declare item jsonb; c wk_contacts%rowtype; v_id uuid; v_phone text;
begin
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(wk_is_agent_or_admin(),false) then raise exception 'forbidden'; end if;
  perform set_config('wk.phone_merge','on',true);
  if jsonb_typeof(p_contacts)='object' then p_contacts:=jsonb_build_array(p_contacts); end if;
  if jsonb_typeof(p_contacts)<>'array' or jsonb_array_length(p_contacts)>1000 then raise exception 'Expected up to 1000 contacts'; end if;
  for item in select value from jsonb_array_elements(p_contacts) loop
    c:=jsonb_populate_record(null::wk_contacts,item);
    if coalesce(auth.role(),'')<>'service_role' and not wk_is_admin() and c.owner_agent_id is not null and c.owner_agent_id<>auth.uid() then raise exception 'forbidden'; end if;
    v_phone:=wk_normalize_phone(c.phone);
    insert into wk_contacts(name,phone,email,owner_agent_id,pipeline_column_id,custom_fields,is_hot,desk,ai_enabled,do_not_call,business_id,hostunico_sms_phone,hostunico_country,deal_value_pence)
      values(coalesce(c.name,''),coalesce(c.phone,''),nullif(c.email,''),c.owner_agent_id,c.pipeline_column_id,
      coalesce(c.custom_fields,'{}'),coalesce(c.is_hot,false),coalesce(c.desk,'houses'),coalesce(c.ai_enabled,false),coalesce(c.do_not_call,false),c.business_id,c.hostunico_sms_phone,c.hostunico_country,c.deal_value_pence)
      returning id into v_id;
    if v_id is null then select c2.id into v_id from wk_contacts c2 join wk_phone_registry r on r.contact_id=c2.id where r.normalized_phone=v_phone; end if;
    -- Preserve the existing RLS visibility boundary for staff callers.
    if coalesce(auth.role(),'')='service_role' or wk_is_admin() or exists(select 1 from wk_contacts where id=v_id and (owner_agent_id=auth.uid() or owner_agent_id is null)) then
      return query select * from wk_contacts where id=v_id;
    else
      c:=null; c.id:=v_id; c.phone:=v_phone;
      return next c;
    end if;
  end loop;
  perform set_config('wk.phone_merge','',true);
end $$;

-- The strict import door: adds the contact only when its number is new to the
-- CRM, else returns null and changes nothing.
create or replace function public.wk_admit_new_contact(p_contact jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c wk_contacts%rowtype; v_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(wk_is_admin(),false) then raise exception 'forbidden'; end if;
  c:=jsonb_populate_record(null::wk_contacts,p_contact);
  if wk_phone_known(c.phone) then return null; end if;
  begin
    insert into wk_contacts(name,phone,email,owner_agent_id,pipeline_column_id,custom_fields,is_hot,desk,ai_enabled,do_not_call,business_id,hostunico_sms_phone,hostunico_country,deal_value_pence)
      values(coalesce(c.name,''),c.phone,nullif(c.email,''),c.owner_agent_id,c.pipeline_column_id,
      coalesce(c.custom_fields,'{}'),coalesce(c.is_hot,false),coalesce(c.desk,'houses'),coalesce(c.ai_enabled,false),coalesce(c.do_not_call,false),c.business_id,c.hostunico_sms_phone,c.hostunico_country,c.deal_value_pence)
      returning id into v_id;
  exception when unique_violation then return null;
  end;
  return v_id;
end $$;
revoke all on function public.wk_admit_new_contact(jsonb) from public,anon,authenticated;
grant execute on function public.wk_admit_new_contact(jsonb) to service_role;
revoke all on function public.wk_phone_known(text),public.wk_phone_in_calls(text),public.wk_register_call_phone() from public,anon;
grant execute on function public.wk_phone_known(text) to authenticated,service_role;

alter table public.wk_contacts add constraint wk_contacts_phone_normalized_new
  check (normalized_phone is not null or phone ~ '^email:' or phone = '' or created_at < timestamptz '2026-10-14 00:00:00+00');

notify pgrst,'reload schema';
commit;
