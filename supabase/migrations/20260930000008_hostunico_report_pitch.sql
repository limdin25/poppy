alter table public.sa_property_reports add column if not exists report_pitch jsonb;
comment on column public.sa_property_reports.report_pitch is 'Display-only earnings hook from the authenticated Hostunico report. Never used for billing.';
