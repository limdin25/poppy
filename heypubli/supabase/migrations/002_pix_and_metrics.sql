-- Add PIX payment columns to profiles
alter table public.profiles add column if not exists pix_key_type text check (pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random'));
alter table public.profiles add column if not exists pix_key text;

-- Add post engagement metrics to scheduled_posts
alter table public.scheduled_posts add column if not exists reach integer;
alter table public.scheduled_posts add column if not exists likes integer;
alter table public.scheduled_posts add column if not exists comments integer;
alter table public.scheduled_posts add column if not exists shares integer;

-- Add hotmart_product_url to brands
alter table public.brands add column if not exists hotmart_product_url text;
