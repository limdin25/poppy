-- One person per normalized phone across all desks. No calls or messages are sent.
-- All changes, archives and history moves are atomic. Run the audit script first.
begin;
set local lock_timeout = '15s';
lock table public.wk_contacts, public.wk_dialer_queue in share row exclusive mode;

create or replace function public.wk_normalize_phone(p_phone text)
returns text language plpgsql immutable strict set search_path=public as $$
declare d text;
begin
  -- Email-only CRM identities are deliberately not dialable phone numbers.
  if p_phone ~ '[[:alpha:]@]' then return null; end if;
  d := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if left(d,2)='00' then d:=substr(d,3); end if;
  if left(d,3)='440' then d:='44'||substr(d,4); end if;
  if left(d,1)='0' then d:='44'||substr(d,2); end if;
  if d ~ '^7[0-9]{9}$' then d:='44'||d; end if;
  if d ~ '^[1-9][0-9]{7,14}$' then return '+'||d; end if;
  return null;
end $$;

alter table public.wk_contacts add column normalized_phone text
  generated always as (public.wk_normalize_phone(phone)) stored;
create table public.wk_contact_merge_archive (
  id bigint generated always as identity primary key,
  survivor_id uuid not null,
  original_contact_id uuid not null,
  source_table text not null,
  row_data jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.wk_contact_merge_archive enable row level security;
revoke all on public.wk_contact_merge_archive from anon, authenticated;

-- Snapshot every duplicate before changing any contact or foreign key.
create temporary table phone_merges on commit drop as
select id old_id, first_value(id) over(partition by normalized_phone order by created_at,id) keep_id
from public.wk_contacts where normalized_phone is not null;
delete from phone_merges where old_id=keep_id;
create temporary table phone_merge_calls_before on commit drop as
select k.id,md5((to_jsonb(k)-'contact_id')::text) fingerprint
from public.wk_calls k join phone_merges m on m.old_id=k.contact_id;
do $$ begin
  if exists(select 1 from public.wk_calls k join phone_merges m on m.old_id=k.contact_id
    where k.ended_at is null and k.started_at>now()-interval '1 hour') then
    raise exception 'A duplicate contact is on a current call; retry after it ends';
  end if;
end $$;

insert into public.wk_contact_merge_archive(survivor_id,original_contact_id,source_table,row_data)
select m.keep_id,c.id,'wk_contacts',to_jsonb(c) from public.wk_contacts c
join (select old_id,keep_id from phone_merges union select keep_id,keep_id from phone_merges) m on m.old_id=c.id;

-- Preserve every linked row, including one-row-per-contact workflow conflicts.
do $$
declare m record; r record; row_json jsonb; row_tid tid;
begin
  for m in select * from phone_merges loop
    for r in
      select distinct n.nspname schema_name,t.relname table_name,a.attname col
      from pg_constraint fk join pg_class t on t.oid=fk.conrelid
      join pg_namespace n on n.oid=t.relnamespace
      join pg_attribute a on a.attrelid=t.oid and a.attnum=fk.conkey[1]
      where fk.contype='f' and fk.confrelid='public.wk_contacts'::regclass
    loop
      -- A conflict on a contact-keyed state table cannot delete its evidence.
      for row_json,row_tid in execute format('select to_jsonb(t),ctid from %I.%I t where %I=$1',r.schema_name,r.table_name,r.col) using m.old_id loop
        insert into public.wk_contact_merge_archive(survivor_id,original_contact_id,source_table,row_data)
        values(m.keep_id,m.old_id,r.table_name,row_json);
        begin
          execute format('update %I.%I set %I=$1 where ctid=$2',r.schema_name,r.table_name,r.col) using m.keep_id,row_tid;
          if r.table_name in ('wk_calls','wk_notifications') and row_json ? 'desk' then
            execute format('update %I.%I set desk=$1 where id=$2',r.schema_name,r.table_name)
              using row_json->>'desk',(row_json->>'id')::uuid;
          end if;
        exception when unique_violation then
          -- Call records and scheduled call follow-ups must always move intact.
          if r.table_name in ('wk_calls','wk_contact_followups') then raise; end if;
          insert into public.wk_activities(contact_id,kind,title,body,meta)
          values(m.keep_id,'note','Merged contact history',row_json::text,
                 jsonb_build_object('source_table',r.table_name,'original_contact_id',m.old_id,'original',row_json));
          execute format('delete from %I.%I where ctid=$1',r.schema_name,r.table_name) using row_tid;
        end;
      end loop;
    end loop;
    insert into public.wk_activities(contact_id,kind,title,body,meta)
    select m.keep_id,'note','Merged duplicate contact',
      coalesce(c.custom_fields->>'notes','Additional contact and listing details preserved.'),
      jsonb_build_object('original_contact_id',c.id,'incoming',to_jsonb(c))
    from public.wk_contacts c where c.id=m.old_id;
    update public.wk_contacts keep set custom_fields=extra.custom_fields||keep.custom_fields,
      last_contact_at=greatest(keep.last_contact_at,extra.last_contact_at),
      do_not_call=keep.do_not_call or extra.do_not_call
    from public.wk_contacts extra where keep.id=m.keep_id and extra.id=m.old_id;
  end loop;
  -- Keep the most protective stage. Carry its desk too so its board still works.
  for m in select distinct keep_id from phone_merges loop
    select c.pipeline_column_id,c.desk,c.owner_agent_id into r
    from public.wk_contacts c left join public.wk_pipeline_columns p on p.id=c.pipeline_column_id
    where c.id=m.keep_id or c.id in(select old_id from phone_merges where keep_id=m.keep_id)
    order by (c.do_not_call or lower(coalesce(p.name,'')) in ('do not contact','do not call')) desc,
      coalesce(p.is_terminal or p.dialer_closed,false) desc,
      (c.pipeline_column_id is not null) desc,coalesce(c.stage_moved_at,c.updated_at) desc,c.created_at asc limit 1;
    update public.wk_contacts set pipeline_column_id=r.pipeline_column_id,desk=r.desk,
      owner_agent_id=coalesce(r.owner_agent_id,owner_agent_id) where id=m.keep_id;
  end loop;
end $$;
-- JSON jobs and loose references are not all backed by foreign keys.
do $$
declare r record;
begin
  for r in select table_schema,table_name,column_name from information_schema.columns
    where table_schema='public' and column_name in ('contact_id','wk_contact_id','builder_contact_id') and data_type='uuid'
    and table_name not like '%backup%' and table_name not in ('wk_contact_merge_archive')
    and not exists(select 1 from pg_constraint fk where fk.contype='f' and fk.confrelid='public.wk_contacts'::regclass
      and fk.conrelid=to_regclass(format('%I.%I',table_schema,table_name)))
  loop
    execute format('update %I.%I t set %I=m.keep_id from phone_merges m where t.%I=m.old_id',r.table_schema,r.table_name,r.column_name,r.column_name);
  end loop;
  if to_regclass('public.wk_jobs') is not null then
    update public.wk_jobs j set payload=jsonb_set(payload,'{contact_id}',to_jsonb(m.keep_id::text))
      from phone_merges m where j.payload->>'contact_id'=m.old_id::text;
  end if;
end $$;
-- Only redundant CONTACT records are removed, after every FK has moved.
delete from public.wk_contacts c using phone_merges m where c.id=m.old_id;
update public.wk_contacts set phone=normalized_phone where normalized_phone is not null and phone<>normalized_phone;
create unique index wk_contacts_normalized_phone_uniq on public.wk_contacts(normalized_phone) where normalized_phone is not null;

create table public.wk_phone_registry (
  normalized_phone text primary key,
  contact_id uuid,
  admitted_at timestamptz not null default now(),
  queued_at timestamptz,
  do_not_contact boolean not null default false
);
alter table public.wk_phone_registry enable row level security;
revoke all on public.wk_phone_registry from anon,authenticated;
insert into public.wk_phone_registry(normalized_phone,contact_id,admitted_at,queued_at,do_not_contact)
select c.normalized_phone,c.id,
  greatest(c.created_at,(select max((a.row_data->>'created_at')::timestamptz) from public.wk_contact_merge_archive a where a.survivor_id=c.id and a.source_table='wk_contacts')),
  (select max(q.created_at) from public.wk_dialer_queue q where q.contact_id=c.id),
  c.do_not_call or lower(coalesce(p.name,'')) in ('do not contact','do not call')
from public.wk_contacts c left join public.wk_pipeline_columns p on p.id=c.pipeline_column_id where c.normalized_phone is not null;
-- A report can record a second mobile for the same owner. It shares the identity.
insert into public.wk_phone_registry(normalized_phone,contact_id,admitted_at,queued_at,do_not_contact)
select wk_normalize_phone(c.hostunico_sms_phone),c.id,r.admitted_at,r.queued_at,r.do_not_contact
from public.wk_contacts c join public.wk_phone_registry r on r.contact_id=c.id
where c.hostunico_sms_phone is not null and wk_normalize_phone(c.hostunico_sms_phone)<>c.normalized_phone;


create or replace function public.wk_phone_stage_closed(p_contact uuid)
returns boolean language sql stable security definer set search_path=public as $$
select coalesce((select c.do_not_call or coalesce(p.is_terminal,false) or coalesce(p.dialer_closed,false)
  or lower(coalesce(p.name,'')) in ('not interested','do not contact','do not call','onboarded','signed up','cold')
  from wk_contacts c left join wk_pipeline_columns p on p.id=c.pipeline_column_id where c.id=p_contact),true);
$$;

create or replace function public.wk_guard_contact_phone()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_phone text; v_reg wk_phone_registry%rowtype; v_existing uuid; v_dnc boolean; v_mobile text; v_mobile_owner uuid;
begin
  v_phone:=wk_normalize_phone(new.phone);
  if v_phone is null then
    if (tg_op='INSERT' or new.phone is distinct from old.phone) and new.phone !~ '^(email:|$)' then raise exception 'Invalid phone number' using errcode='22023'; end if;
    return new;
  end if;
  new.phone:=v_phone;
  -- INSERT ON CONFLICT plus the row lock serialize even simultaneous imports.
  insert into wk_phone_registry(normalized_phone,contact_id) values(v_phone,null) on conflict do nothing;
  select * into v_reg from wk_phone_registry where normalized_phone=v_phone for update;
  select id into v_existing from wk_contacts where (normalized_phone=v_phone or id=v_reg.contact_id) and id<>new.id limit 1;
  if tg_op='UPDATE' and v_existing is not null then
    raise exception 'Phone number already belongs to another contact' using errcode='23505';
  end if;
  select new.do_not_call or lower(coalesce(name,'')) in ('do not contact','do not call') into v_dnc
    from wk_pipeline_columns where id=new.pipeline_column_id;
  v_dnc:=new.do_not_call or coalesce(v_dnc,false) or v_reg.do_not_contact;
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
create trigger aa_wk_contact_phone before insert or update of phone,hostunico_sms_phone,do_not_call,pipeline_column_id on public.wk_contacts
for each row execute function public.wk_guard_contact_phone();

-- RPC returns the canonical contact even when the BEFORE INSERT trigger merged
-- the input. This avoids PostgREST's zero-row .single() rollback for duplicates.
create or replace function public.wk_ingest_contacts(p_contacts jsonb)
returns setof public.wk_contacts language plpgsql security definer set search_path=public as $$
declare item jsonb; c wk_contacts%rowtype; v_id uuid; v_phone text;
begin
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(wk_is_agent_or_admin(),false) then raise exception 'forbidden'; end if;
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
end $$;
revoke all on function public.wk_ingest_contacts(jsonb) from public,anon;
grant execute on function public.wk_ingest_contacts(jsonb) to authenticated,service_role;

alter table public.wk_dialer_queue add column normalized_phone text;
update public.wk_dialer_queue q set normalized_phone=c.normalized_phone from public.wk_contacts c where c.id=q.contact_id;
-- Keep a call already in progress first, then the oldest reservation.
with ranked as (
 select id,row_number() over(partition by normalized_phone order by
  case status when 'connected' then 0 when 'dialing' then 1 else 2 end,created_at,id) rn
 from public.wk_dialer_queue where normalized_phone is not null and (status in ('pending','dialing','connected','review') or (status='skipped' and hostunico_uplift_hold))
)
update public.wk_dialer_queue q set status='done',hostunico_uplift_hold=false from ranked r where r.id=q.id and r.rn>1;
update public.wk_dialer_queue q set status='skipped',hostunico_uplift_hold=false from public.wk_phone_registry r
where r.normalized_phone=q.normalized_phone and r.do_not_contact and (q.status in ('pending','review') or q.hostunico_uplift_hold);
create unique index wk_queue_one_active_phone on public.wk_dialer_queue(normalized_phone)
where normalized_phone is not null and (status in ('pending','dialing','connected','review') or (status='skipped' and hostunico_uplift_hold));

create or replace function public.wk_guard_queue_phone()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_reg wk_phone_registry%rowtype; v_new_admission boolean; v_due boolean;
begin
  select normalized_phone into new.normalized_phone from wk_contacts where id=new.contact_id;
  if new.status not in ('pending','dialing','connected','review') and not (new.status='skipped' and new.hostunico_uplift_hold) then return new; end if;
  if new.normalized_phone is null then return null; end if;
  select * into v_reg from wk_phone_registry where normalized_phone=new.normalized_phone for update;
  if v_reg.do_not_contact then return null; end if;
  if exists(select 1 from wk_dialer_queue where normalized_phone=new.normalized_phone and id<>new.id and (status in ('pending','dialing','connected','review') or (status='skipped' and hostunico_uplift_hold))) then return null; end if;
  v_new_admission := tg_op='INSERT';
  if tg_op='UPDATE' then v_new_admission:=(old.status not in ('pending','dialing','connected','review','voicemail','missed') and not (old.status='skipped' and old.hostunico_uplift_hold)) or old.contact_id<>new.contact_id; end if;
  select exists(select 1 from wk_contact_followups where contact_id=new.contact_id and status='pending' and due_at<=now()) into v_due;
  if v_new_admission and not v_due then
    if wk_phone_stage_closed(new.contact_id) then return null; end if;
    if v_reg.queued_at is not null and v_reg.queued_at>=v_reg.admitted_at then
      if v_reg.admitted_at>now()-interval '30 days' then return null; end if;
      update wk_phone_registry set admitted_at=now() where normalized_phone=new.normalized_phone;
    end if;
  end if;
  if v_new_admission then update wk_phone_registry set queued_at=now() where normalized_phone=new.normalized_phone; end if;
  return new;
end $$;
-- Reserve once before the qualification trigger can put the same lead on hold.
create trigger aa_wk_queue_phone before insert or update on public.wk_dialer_queue
for each row execute function public.wk_guard_queue_phone();

create or replace function public.wk_sync_contact_phone_queue()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.do_not_call then update wk_dialer_queue set status='skipped',hostunico_uplift_hold=false where contact_id=new.id and (status in ('pending','review') or hostunico_uplift_hold); end if;
  if new.phone is distinct from old.phone then
    update wk_dialer_queue set normalized_phone=new.normalized_phone where contact_id=new.id;
  end if;
  return null;
end $$;
create trigger zz_wk_contact_phone_queue after update of phone,do_not_call on public.wk_contacts
for each row execute function public.wk_sync_contact_phone_queue();
revoke all on function public.wk_guard_contact_phone(),public.wk_guard_queue_phone(),public.wk_sync_contact_phone_queue() from public,anon,authenticated;
revoke all on function public.wk_phone_stage_closed(uuid) from public,anon;
grant execute on function public.wk_phone_stage_closed(uuid) to authenticated,service_role;
-- A merge may change a call's contact_id, never its recording, notes, desk or facts.
do $$ begin
  if exists(select 1 from phone_merge_calls_before b left join public.wk_calls k on k.id=b.id
    where k.id is null or md5((to_jsonb(k)-'contact_id')::text)<>b.fingerprint) then
    raise exception 'Call history changed during the merge';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
