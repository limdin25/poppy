-- AI cost log and price list. Hugo, 7 Oct 2026: "build a dashboard that shows all
-- costs ... by day, by hour, by model."
--
-- One row per AI call. Writers send TOKENS (or audio minutes); the price list in
-- ai_model_prices turns them into dollars inside this database, so the edge
-- functions and the Vercel routes can never disagree about a price. Costs are
-- recorded from the day this ships. Nothing before it recorded token counts.
begin;

create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  provider text not null,                  -- openai | anthropic | google | openrouter | xai | typesafe | assemblyai
  model text not null,                     -- the model that actually answered
  feature text not null default 'unlabelled',
  input_tokens integer not null default 0, -- ALL prompt tokens, cached ones included
  output_tokens integer not null default 0,-- answer plus thinking tokens (billed as output)
  cached_input_tokens integer not null default 0, -- the part of input_tokens served from cache
  units numeric(12,4) not null default 0,  -- audio minutes for speech services
  cost_usd numeric(14,6) not null default 0,
  priced boolean not null default false,   -- false = no price on the list, so cost_usd is 0 and wrong
  ok boolean not null default true,
  requested_model text,                    -- set when another model had to answer instead
  latency_ms integer,
  business_id uuid,
  ref text
);
create index if not exists ai_usage_log_created_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_model_idx on public.ai_usage_log (provider, model, created_at desc);
create index if not exists ai_usage_log_feature_idx on public.ai_usage_log (feature, created_at desc);
alter table public.ai_usage_log enable row level security;
revoke all on public.ai_usage_log from anon, authenticated;

create table if not exists public.ai_model_prices (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  match text not null default 'exact' check (match in ('exact', 'prefix')),
  input_per_mtok numeric(12,5),            -- USD per 1M input tokens
  output_per_mtok numeric(12,5),
  cached_input_per_mtok numeric(12,5),
  per_minute numeric(12,6),                -- USD per audio minute, for speech services
  effective_from date not null default '2000-01-01',
  note text,
  updated_at timestamptz not null default now(),
  unique (provider, model, effective_from)
);
alter table public.ai_model_prices enable row level security;
revoke all on public.ai_model_prices from anon, authenticated;

-- The price for one call. An exact model id beats a prefix, a longer prefix beats
-- a shorter one, and the newest price already in force at the time of the call wins.
create or replace function public.ai_compute_cost(
  p_provider text, p_model text, p_in integer, p_out integer, p_cached integer, p_units numeric, p_at timestamptz
) returns table (cost numeric, priced boolean)
language plpgsql stable set search_path = public as $$
declare r public.ai_model_prices%rowtype; c numeric := 0;
begin
  select * into r from public.ai_model_prices pr
   where pr.provider = p_provider
     and ((pr.match = 'exact' and pr.model = p_model) or (pr.match = 'prefix' and p_model like pr.model || '%'))
     and pr.effective_from <= (p_at at time zone 'UTC')::date
   order by (pr.match = 'exact') desc, length(pr.model) desc, pr.effective_from desc
   limit 1;
  if not found then return query select 0::numeric, false; return; end if;
  -- A row with no numbers in it is a placeholder: the price is still unknown.
  if r.input_per_mtok is null and r.output_per_mtok is null and r.per_minute is null then
    return query select 0::numeric, false; return;
  end if;
  if r.input_per_mtok is not null or r.output_per_mtok is not null then
    c := (greatest(p_in - p_cached, 0) * coalesce(r.input_per_mtok, 0)
        + least(p_cached, p_in) * coalesce(r.cached_input_per_mtok, r.input_per_mtok, 0)
        + p_out * coalesce(r.output_per_mtok, 0)) / 1000000.0;
  end if;
  if r.per_minute is not null then c := c + coalesce(p_units, 0) * r.per_minute; end if;
  return query select c, true;
end $$;

create or replace function public.ai_usage_price_row() returns trigger
language plpgsql set search_path = public as $$
declare v record;
begin
  -- A writer that already knows the real cost (a provider that reports it) keeps it.
  if new.cost_usd is null or new.cost_usd = 0 then
    select * into v from public.ai_compute_cost(new.provider, new.model, new.input_tokens, new.output_tokens, new.cached_input_tokens, new.units, new.created_at);
    new.cost_usd := coalesce(v.cost, 0);
    new.priced := coalesce(v.priced, false);
  else
    new.priced := true;
  end if;
  return new;
end $$;
drop trigger if exists ai_usage_price_row on public.ai_usage_log;
create trigger ai_usage_price_row before insert on public.ai_usage_log
  for each row execute function public.ai_usage_price_row();

-- After a price is edited: price every call from p_from onward again.
create or replace function public.ai_reprice_usage(p_from timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.ai_usage_log l set cost_usd = x.cost, priced = x.priced
    from (select u.id, (public.ai_compute_cost(u.provider, u.model, u.input_tokens, u.output_tokens, u.cached_input_tokens, u.units, u.created_at)).*
            from public.ai_usage_log u where u.created_at >= p_from) x
   where l.id = x.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ai_reprice_usage(timestamptz) from public, anon, authenticated;

-- The dashboard. Everything in one round trip, dates and hours in p_tz.
create or replace function public.ai_cost_overview(
  p_from date, p_to date, p_bucket text default 'day',
  p_providers text[] default null, p_models text[] default null, p_features text[] default null,
  p_tz text default 'Europe/London'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t_from timestamptz := p_from::timestamp at time zone p_tz;
  t_to timestamptz := (p_to + 1)::timestamp at time zone p_tz;
  today_start timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
  month_start timestamptz := date_trunc('month', now() at time zone p_tz) at time zone p_tz;
  days_in_month integer := extract(day from (date_trunc('month', now() at time zone p_tz) + interval '1 month - 1 day'));
  elapsed numeric := greatest(extract(epoch from (now() - month_start)) / 86400.0, 1);
  month_cost numeric;
  result jsonb;
begin
  if p_bucket not in ('hour', 'day') then raise exception 'bucket must be hour or day'; end if;
  select coalesce(sum(cost_usd), 0) into month_cost from public.ai_usage_log
   where created_at >= month_start
     and (p_providers is null or cardinality(p_providers) = 0 or provider = any(p_providers))
     and (p_models is null or cardinality(p_models) = 0 or model = any(p_models))
     and (p_features is null or cardinality(p_features) = 0 or feature = any(p_features));

  with f as (
    select * from public.ai_usage_log
     where created_at >= t_from and created_at < t_to
       and (p_providers is null or cardinality(p_providers) = 0 or provider = any(p_providers))
       and (p_models is null or cardinality(p_models) = 0 or model = any(p_models))
       and (p_features is null or cardinality(p_features) = 0 or feature = any(p_features))
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object('cost', coalesce(sum(cost_usd), 0), 'calls', count(*),
        'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
        'cached_tokens', coalesce(sum(cached_input_tokens), 0), 'units', coalesce(sum(units), 0),
        'errors', count(*) filter (where not ok), 'unpriced', count(*) filter (where not priced),
        'fallbacks', count(*) filter (where requested_model is not null)) from f),
    'series', (select coalesce(jsonb_agg(s order by s->>'bucket', s->>'model'), '[]'::jsonb) from (
        select jsonb_build_object('bucket', b, 'provider', provider, 'model', model, 'cost', sum(cost_usd), 'calls', count(*)) s
          from (select to_char(date_trunc(p_bucket, created_at at time zone p_tz), 'YYYY-MM-DD"T"HH24:MI') b, provider, model, cost_usd from f) q
         group by b, provider, model) z),
    'by_model', (select coalesce(jsonb_agg(m order by (m->>'cost')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('provider', provider, 'model', model, 'calls', count(*), 'input_tokens', sum(input_tokens),
               'output_tokens', sum(output_tokens), 'cached_tokens', sum(cached_input_tokens), 'units', sum(units), 'cost', sum(cost_usd),
               'errors', count(*) filter (where not ok), 'unpriced', count(*) filter (where not priced)) m
          from f group by provider, model) z),
    'by_feature', (select coalesce(jsonb_agg(m order by (m->>'cost')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('feature', feature, 'calls', count(*), 'input_tokens', sum(input_tokens),
               'output_tokens', sum(output_tokens), 'units', sum(units), 'cost', sum(cost_usd)) m
          from f group by feature) z),
    'by_provider', (select coalesce(jsonb_agg(m order by (m->>'cost')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('provider', provider, 'calls', count(*), 'cost', sum(cost_usd)) m
          from f group by provider) z),
    'recent', (select coalesce(jsonb_agg(r order by (r->>'at') desc), '[]'::jsonb) from (
        select jsonb_build_object('at', to_char(created_at at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI:SS'), 'provider', provider, 'model', model,
               'feature', feature, 'input_tokens', input_tokens, 'output_tokens', output_tokens, 'units', units, 'cost', cost_usd,
               'ok', ok, 'priced', priced, 'requested_model', requested_model, 'latency_ms', latency_ms) r
          from f order by created_at desc limit 50) z),
    'options', jsonb_build_object(
        'providers', (select coalesce(jsonb_agg(distinct provider order by provider), '[]'::jsonb) from public.ai_usage_log where created_at >= t_from and created_at < t_to),
        'models', (select coalesce(jsonb_agg(distinct model order by model), '[]'::jsonb) from public.ai_usage_log where created_at >= t_from and created_at < t_to),
        'features', (select coalesce(jsonb_agg(distinct feature order by feature), '[]'::jsonb) from public.ai_usage_log where created_at >= t_from and created_at < t_to)),
    'periods', jsonb_build_object(
        'today', (select coalesce(sum(cost_usd), 0) from public.ai_usage_log where created_at >= today_start
            and (p_providers is null or cardinality(p_providers) = 0 or provider = any(p_providers))
            and (p_models is null or cardinality(p_models) = 0 or model = any(p_models))
            and (p_features is null or cardinality(p_features) = 0 or feature = any(p_features))),
        'yesterday', (select coalesce(sum(cost_usd), 0) from public.ai_usage_log where created_at >= today_start - interval '1 day' and created_at < today_start
            and (p_providers is null or cardinality(p_providers) = 0 or provider = any(p_providers))
            and (p_models is null or cardinality(p_models) = 0 or model = any(p_models))
            and (p_features is null or cardinality(p_features) = 0 or feature = any(p_features))),
        'last7', (select coalesce(sum(cost_usd), 0) from public.ai_usage_log where created_at >= today_start - interval '6 days'
            and (p_providers is null or cardinality(p_providers) = 0 or provider = any(p_providers))
            and (p_models is null or cardinality(p_models) = 0 or model = any(p_models))
            and (p_features is null or cardinality(p_features) = 0 or feature = any(p_features))),
        'month', month_cost,
        'projected_month', round(month_cost / elapsed * days_in_month, 4)),
    'first_recorded', (select to_char(min(created_at) at time zone p_tz, 'YYYY-MM-DD"T"HH24:MI') from public.ai_usage_log),
    'usd_to_gbp', (select coalesce(nullif(value, '')::numeric, 0) from public.platform_settings where key = 'usd_to_gbp')
  ) into result;
  return result;
end $$;
revoke all on function public.ai_cost_overview(date, date, text, text[], text[], text[], text) from public, anon, authenticated;

-- Prices from each provider's own price list, read on 7 Oct 2026. Edit them in
-- Admin, AI Costs, Prices. Anthropic cache reads are assumed to be 10% of input.
insert into public.ai_model_prices (provider, model, match, input_per_mtok, output_per_mtok, cached_input_per_mtok, per_minute, effective_from, note) values
  ('openai', 'gpt-5.4-mini', 'exact', 0.75, 4.50, 0.075, null, '2000-01-01', 'OpenAI price list, 7 Oct 2026'),
  ('openai', 'gpt-5.4', 'exact', 2.50, 15.00, 0.25, null, '2000-01-01', 'OpenAI price list, 7 Oct 2026'),
  ('openai', 'gpt-5.4-nano', 'exact', 0.20, 1.25, 0.02, null, '2000-01-01', 'OpenAI price list, 7 Oct 2026'),
  ('openai', 'gpt-4o-mini', 'exact', 0.15, 0.60, 0.075, null, '2000-01-01', 'OpenAI price list, 7 Oct 2026'),
  ('openai', 'gpt-4o-mini-transcribe', 'exact', null, null, null, 0.003, '2000-01-01', 'OpenAI price list, 7 Oct 2026'),
  ('openai', 'whisper-1', 'exact', null, null, null, 0.006, '2000-01-01', 'OpenAI whisper-1 list price, not on the page read'),
  ('anthropic', 'claude-opus-4-8', 'prefix', 5.00, 25.00, 0.50, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-opus-5-5', 'prefix', 4.00, 20.00, 0.20, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-opus-5', 'prefix', 5.00, 25.00, 0.50, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-sonnet-5-5', 'prefix', 2.00, 10.00, 0.20, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-sonnet-5', 'prefix', 2.00, 10.00, 0.20, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-sonnet-4-6', 'prefix', 3.00, 15.00, 0.30, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-haiku-4-5', 'prefix', 1.00, 5.00, 0.10, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('anthropic', 'claude-fable-5', 'prefix', 10.00, 50.00, 1.00, null, '2000-01-01', 'Anthropic price list, 25 Sep 2026'),
  ('google', 'gemini-3.5-flash-lite', 'exact', 0.30, 2.50, 0.03, null, '2000-01-01', 'Google price list, 7 Oct 2026'),
  ('google', 'gemini-3.5-flash', 'exact', 1.50, 9.00, 0.15, null, '2000-01-01', 'Google price list, 7 Oct 2026'),
  ('google', 'gemini-3.6-flash', 'exact', 0.75, 3.75, 0.075, null, '2000-01-01', 'Google launch price until 31 Dec 2026'),
  ('google', 'gemini-3.6-flash', 'exact', 1.50, 7.50, 0.15, null, '2027-01-01', 'Google price from 1 Jan 2027'),
  ('google', 'gemini-3.7-flash', 'exact', 0.75, 3.75, 0.075, null, '2000-01-01', 'Google launch price until 31 Dec 2026'),
  ('google', 'gemini-3.7-flash', 'exact', 1.50, 7.50, 0.15, null, '2027-01-01', 'Google price from 1 Jan 2027'),
  ('google', 'gemini-3.8-flash', 'exact', 0.75, 3.75, 0.075, null, '2000-01-01', 'Google launch price until 31 Dec 2026'),
  ('google', 'gemini-3.8-flash', 'exact', 1.50, 7.50, 0.15, null, '2027-01-01', 'Google price from 1 Jan 2027'),
  ('google', 'gemini-3.1-pro-preview', 'exact', 2.00, 12.00, 0.20, null, '2000-01-01', 'Google price list, prompts up to 200k tokens'),
  ('google', 'gemini-2.5-pro', 'exact', 1.25, 10.00, 0.125, null, '2000-01-01', 'Google price list, prompts up to 200k tokens'),
  ('google', 'gemini-2.5-flash', 'exact', 0.30, 2.50, 0.03, null, '2000-01-01', 'Google price list, 7 Oct 2026'),
  ('openrouter', 'google/gemini-3.8-flash', 'exact', 0.75, 3.75, null, null, '2000-01-01', 'OpenRouter list price, 7 Oct 2026'),
  ('openrouter', 'google/gemini-3.7-flash', 'exact', 0.75, 3.75, null, null, '2000-01-01', 'OpenRouter list price, 7 Oct 2026'),
  ('openrouter', 'google/gemini-3.5-flash', 'exact', 1.50, 9.00, null, null, '2000-01-01', 'OpenRouter list price, 7 Oct 2026'),
  ('openrouter', 'google/gemini-3.1-pro-preview', 'exact', 2.00, 12.00, null, null, '2000-01-01', 'OpenRouter list price, 7 Oct 2026'),
  ('openrouter', 'deepseek/deepseek-v4-pro-0813', 'exact', 1.32, 3.96, 0.044, null, '2000-01-01', 'OpenRouter list price, 7 Oct 2026'),
  ('openrouter', 'qwen/qwen3.7-flash', 'exact', 0.03, 0.13, 0.006, null, '2000-01-01', 'OpenRouter list price, 7 Oct 2026'),
  ('assemblyai', 'universal-2', 'exact', null, null, null, 0.005, '2000-01-01', '$0.15 per hour per channel, calls are 2 channels'),
  ('typesafe', 'jev-1.13.0', 'exact', null, null, null, null, '2000-01-01', 'No public price found. Set it from the TypeSafe invoice.')
on conflict (provider, model, effective_from) do nothing;

-- USD to GBP, ECB rate for 6 Oct 2026. Only used to show a pound figure next to the dollars.
insert into public.platform_settings (key, value) values ('usd_to_gbp', '0.75322') on conflict (key) do nothing;

notify pgrst, 'reload schema';
commit;
