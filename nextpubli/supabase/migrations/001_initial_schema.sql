-- NextPubli — Initial Schema
-- All 10 tables + RLS policies + seed data

-- 1. profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  whatsapp text,
  date_of_birth date,
  gender text check (gender in ('male', 'female', 'non_binary', 'undisclosed')),
  address_street text,
  address_city text,
  address_postal_code text,
  address_country text not null default 'BR',
  phone text,
  timezone text not null default 'America/Sao_Paulo',
  hotmart_url text,
  hotmart_affiliate_code text,
  onboarding_step integer not null default 1,
  onboarding_complete boolean not null default false,
  is_admin boolean not null default false,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Admins can read all profiles"
  on public.profiles for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "Admins can update all profiles"
  on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 2. sectors
create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

alter table public.sectors enable row level security;

create policy "Anyone can read sectors"
  on public.sectors for select
  using (true);

-- 3. influencer_sectors
create table public.influencer_sectors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  type text not null check (type in ('preferred', 'content')),
  created_at timestamptz not null default now()
);

alter table public.influencer_sectors enable row level security;

create policy "Users can read own sectors"
  on public.influencer_sectors for select
  using (auth.uid() = profile_id);

create policy "Users can insert own sectors"
  on public.influencer_sectors for insert
  with check (auth.uid() = profile_id);

create policy "Users can delete own sectors"
  on public.influencer_sectors for delete
  using (auth.uid() = profile_id);

create policy "Admins can read all influencer_sectors"
  on public.influencer_sectors for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 4. instagram_connections
create table public.instagram_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade unique,
  ig_user_id text not null,
  ig_username text not null,
  access_token text not null,
  token_expires_at timestamptz not null,
  token_refreshed_at timestamptz,
  is_connected boolean not null default true,
  followers_count integer,
  created_at timestamptz not null default now()
);

alter table public.instagram_connections enable row level security;

create policy "Users can read own instagram"
  on public.instagram_connections for select
  using (auth.uid() = profile_id);

create policy "Users can insert own instagram"
  on public.instagram_connections for insert
  with check (auth.uid() = profile_id);

create policy "Users can update own instagram"
  on public.instagram_connections for update
  using (auth.uid() = profile_id);

create policy "Admins can read all instagram_connections"
  on public.instagram_connections for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "Admins can update all instagram_connections"
  on public.instagram_connections for update
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 5. brands
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  description text,
  hotmart_product_id text,
  target_sectors text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.brands enable row level security;

create policy "Anyone can read brands"
  on public.brands for select
  using (true);

create policy "Admins can manage brands"
  on public.brands for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 6. brand_assignments
create table public.brand_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (profile_id, brand_id)
);

alter table public.brand_assignments enable row level security;

create policy "Users can read own assignments"
  on public.brand_assignments for select
  using (auth.uid() = profile_id);

create policy "Admins can manage assignments"
  on public.brand_assignments for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 7. scheduled_posts
create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  media_type text not null check (media_type in ('feed', 'story_image', 'story_video', 'reel', 'carousel')),
  media_url text not null,
  caption text not null default '',
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'failed')),
  ig_media_id text,
  published_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.scheduled_posts enable row level security;

create policy "Users can read own posts"
  on public.scheduled_posts for select
  using (auth.uid() = profile_id);

create policy "Admins can manage all posts"
  on public.scheduled_posts for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 8. messages_log
create table public.messages_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email')),
  direction text not null check (direction in ('outbound', 'inbound')),
  content text not null,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  sent_at timestamptz not null default now(),
  sent_by text not null default 'system'
);

alter table public.messages_log enable row level security;

create policy "Admins can manage messages"
  on public.messages_log for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 9. hotmart_sales
create table public.hotmart_sales (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  transaction_id text not null unique,
  product_name text not null,
  sale_amount numeric not null,
  commission_amount numeric not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'refunded', 'cancelled')),
  sold_at timestamptz not null default now()
);

alter table public.hotmart_sales enable row level security;

create policy "Users can read own sales"
  on public.hotmart_sales for select
  using (auth.uid() = profile_id);

create policy "Admins can manage all sales"
  on public.hotmart_sales for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- 10. admin_sessions
create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  impersonated_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  actions_taken jsonb not null default '{}'
);

alter table public.admin_sessions enable row level security;

create policy "Admins can manage sessions"
  on public.admin_sessions for all
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

-- Seed sectors
insert into public.sectors (name, slug, sort_order) values
  ('Saúde & Bem-estar', 'saude-bem-estar', 1),
  ('Esporte & Fitness', 'esporte-fitness', 2),
  ('Alimentação', 'alimentacao', 3),
  ('Beleza & Cosméticos', 'beleza-cosmeticos', 4),
  ('Apps & Serviços Online', 'apps-servicos-online', 5),
  ('Moda & Acessórios', 'moda-acessorios', 6),
  ('Tecnologia', 'tecnologia', 7),
  ('Entretenimento', 'entretenimento', 8),
  ('Casa & Decoração', 'casa-decoracao', 9),
  ('Finanças', 'financas', 10),
  ('Educação', 'educacao', 11),
  ('Viagem & Turismo', 'viagem-turismo', 12),
  ('Pets & Animais', 'pets-animais', 13),
  ('Maternidade', 'maternidade', 14),
  ('Games', 'games', 15),
  ('Comércio & E-commerce', 'comercio-ecommerce', 16);

-- Seed first brand: ScanPlates
insert into public.brands (name, description, target_sectors, is_active) values
  ('ScanPlates', 'App de nutrição — R$59,99/mês por assinante', '{saude-bem-estar,alimentacao,esporte-fitness}', true);

-- Create a trigger to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, first_name, last_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
