-- Pedro's clean property mailbox.
-- Hugo 2026-09-10: pedro.a@hostunico.com (hostunico, not unicohost) so he can
-- filter that inbox separately from pedro@hostunico.com.
-- Catch-all MX on hostunico.com already accepts any local part; this row lets
-- him SEND from it, and mailbox_owners lets inbound land on his profile.

insert into wk_numbers (
  e164,
  channel,
  provider,
  assigned_agent_id,
  is_active,
  label,
  sms_enabled,
  voice_enabled,
  recording_enabled
) values (
  'pedro.a@hostunico.com',
  'email',
  'resend',
  '6b26172e-d98d-4cc4-9e22-b3b4e24624ee',
  true,
  'Pedro Houses, clean property inbox (pedro.a@hostunico.com)',
  false,
  false,
  false
)
on conflict (e164) do update set
  assigned_agent_id = excluded.assigned_agent_id,
  is_active = true,
  channel = 'email',
  provider = 'resend',
  label = excluded.label;

-- Keep existing typo aliases; add pedro.a → Pedro's profile email.
insert into platform_settings (key, value, updated_at)
values (
  'mailbox_owners',
  '{"predro@hostunico.com":"pedro@hostunico.com","petro@hostunico.com":"pedro@hostunico.com","hello@hostunico.com":"pedro@hostunico.com","pedro.a@hostunico.com":"pedro@hostunico.com"}',
  now()
)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();
