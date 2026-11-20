-- Supabase 建表脚本（在 SQL Editor 里整段执行）
-- 前端只用 anon key 访问，配合下面的行级策略做到「只能读写自己那一行」。

create table if not exists public.phonics_user_state (
  user_key text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.phonics_user_state enable row level security;

drop policy if exists "phonics_own_row" on public.phonics_user_state;

create policy "phonics_own_row"
  on public.phonics_user_state
  for all
  to anon, authenticated
  using (
    user_key = (
      coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb)
      ->> 'x-phonics-key'
    )
  )
  with check (
    user_key = (
      coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb)
      ->> 'x-phonics-key'
    )
  );
