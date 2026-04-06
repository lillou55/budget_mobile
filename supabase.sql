create table if not exists public.budget_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.budget_snapshots enable row level security;

create policy if not exists "Users can read own snapshot"
on public.budget_snapshots
for select
using (auth.uid() = user_id);

create policy if not exists "Users can insert own snapshot"
on public.budget_snapshots
for insert
with check (auth.uid() = user_id);

create policy if not exists "Users can update own snapshot"
on public.budget_snapshots
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "Users can delete own snapshot"
on public.budget_snapshots
for delete
using (auth.uid() = user_id);
