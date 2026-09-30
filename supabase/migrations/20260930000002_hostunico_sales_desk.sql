begin;
alter table public.wk_sms_templates add column if not exists desk text not null default 'houses';
alter table public.sa_listings add column if not exists source text not null default 'rightmove';
alter table public.sa_listings add column if not exists source_price text;
alter table public.sa_listings add column if not exists report_property jsonb;

-- Capability tokens and send claims are server-only, never exposed through PostgREST.
create table if not exists public.sa_property_reports (
  listing_id uuid primary key references public.sa_listings(id),
  remote_id uuid not null unique default gen_random_uuid(),
  access_token text not null,
  property jsonb not null,
  state text not null default 'queued',
  message text,
  report_url text,
  sms_state text not null default 'unsent',
  sms_message_id uuid references public.wk_sms_messages(id),
  sms_sid text,
  sms_requested_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sa_property_reports enable row level security;
revoke all on public.sa_property_reports from anon, authenticated;
grant all on public.sa_property_reports to service_role;

insert into public.wk_pipelines(id,name,scope,desk,is_active)
values ('dadce4ac-90b5-4320-9291-ff6bb1cf89f0','Hostunico owners','sa','sa',true)
on conflict (id) do nothing;
insert into public.wk_pipeline_columns(pipeline_id,name,colour,position,sort_order,requires_followup,is_terminal,is_default_on_timeout)
select 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0',name,colour,n,n,followup,terminal,timeout from (values
 (0,'New lead','#64748B',false,false,false),
 (1,'Report requested','#3B82F6',true,false,false),
 (2,'Report sent','#2563EB',true,false,false),
 (3,'Review call booked','#8B5CF6',true,false,false),
 (4,'Preparing to onboard','#059669',true,false,false),
 (5,'Onboarded','#15803D',false,true,false),
 (6,'Not interested','#9CA3AF',false,true,false),
 (7,'Do not contact','#DC2626',false,true,false),
 (8,'Voicemail','#D97706',true,false,false),
 (9,'No pickup','#64748B',false,false,true)
) as stages(n,name,colour,followup,terminal,timeout)
where not exists (select 1 from public.wk_pipeline_columns c where c.pipeline_id='dadce4ac-90b5-4320-9291-ff6bb1cf89f0' and c.name=stages.name);

insert into public.wk_dialer_campaigns(id,name,pipeline_id,desk,parallel_lines,auto_advance_seconds,is_active,ai_coach_enabled)
values ('5d9657f9-d9b4-4e27-a2d1-83db80867f92','Hostunico - Pedro','dadce4ac-90b5-4320-9291-ff6bb1cf89f0','sa',1,10,true,true)
on conflict (id) do nothing;
insert into public.wk_campaign_agents(campaign_id,agent_id)
values ('5d9657f9-d9b4-4e27-a2d1-83db80867f92','6b26172e-d98d-4cc4-9e22-b3b4e24624ee') on conflict do nothing;
insert into public.wk_campaign_numbers(campaign_id,number_id,priority)
select '5d9657f9-d9b4-4e27-a2d1-83db80867f92',number_id,priority from public.wk_campaign_numbers
where campaign_id='ba59aee7-8461-4d81-a305-ed3405fc96a6' on conflict do nothing;

insert into public.wk_sms_templates(name,body_md,channel,subject,is_global,desk)
select name,replace(body,'\n',chr(10)),channel,subject,true,'sa' from (values
 ('Hostunico: arrange a report','Hi {first_name}, it is {agent_first_name} from Hostunico. To prepare your property report, please confirm the full postcode, bedrooms and bathrooms, and whether it is the whole property. Thank you.','sms',null),
 ('Hostunico: report follow-up','Hi {first_name}, it is {agent_first_name} from Hostunico. Have you had a chance to read your property report? When would suit you for a quick call to go through the numbers?','sms',null),
 ('Hostunico: property report follow-up','Hi {first_name},\n\nHave you had a chance to read your property report? We can go through the estimated earnings, costs and assumptions together. The figures are estimates, not guaranteed income.\n\nOur management fee is 9% of booking revenue, including guest-paid cleaning fees. Actual cleaning, platform fees and property costs are separate. There is no onboarding or separate software fee and no VAT added on the current offer.\n\nWhen would suit you for a quick call?\n\n{agent_first_name}\nHostunico','email','Your Hostunico property report'),
 ('Hostunico: setup checklist','Hi {first_name},\n\nHere is the checklist for preparing your property:\n\n- Confirm when the whole property is available.\n- Check ownership authority, lease, mortgage, building and local permissions.\n- Prepare furniture, linen and guest essentials.\n- Provide current photos.\n- Confirm guest access and keys.\n- Tell us about any existing cleaner.\n- Prepare your own Airbnb account; we start with Airbnb.\n\nPlease reply with what is already done, what is missing, your setup budget and the expected completion dates. We will confirm the agreement, owner login and launch steps with you. Elsie and the operations team handle the ongoing arrangements.\n\n{agent_first_name}\nHostunico','email','Your Hostunico property setup checklist')
) as templates(name,body,channel,subject)
where not exists (select 1 from public.wk_sms_templates t where t.desk='sa' and t.name=templates.name);
commit;
