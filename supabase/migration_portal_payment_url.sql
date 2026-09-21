alter table public.portal_accounts
  add column if not exists payment_url text;
notify pgrst, 'reload schema';
