-- Custom category management for habits.
-- Run once in Supabase SQL editor.

-- 1) Allow flexible category names on habits.
alter table public.habit_definitions
  drop constraint if exists habit_definitions_category_check;

alter table public.habit_definitions
  alter column category type text using trim(category);

alter table public.habit_definitions
  alter column category set not null;

alter table public.habit_definitions
  drop constraint if exists habit_definitions_category_not_blank;

alter table public.habit_definitions
  add constraint habit_definitions_category_not_blank
  check (char_length(trim(category)) > 0);

-- 2) User-managed categories table.
create table if not exists public.habit_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  name_normalized text generated always as (lower(trim(name))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name_normalized)
);

create index if not exists habit_categories_user_id_idx
  on public.habit_categories (user_id);

-- 3) Keep updated_at fresh.
create or replace function public.set_habit_categories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists habit_categories_set_updated_at on public.habit_categories;
create trigger habit_categories_set_updated_at
before update on public.habit_categories
for each row execute function public.set_habit_categories_updated_at();

-- 4) RLS.
alter table public.habit_categories enable row level security;

drop policy if exists "Users can view own habit categories" on public.habit_categories;
create policy "Users can view own habit categories"
on public.habit_categories for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own habit categories" on public.habit_categories;
create policy "Users can insert own habit categories"
on public.habit_categories for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own habit categories" on public.habit_categories;
create policy "Users can update own habit categories"
on public.habit_categories for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own habit categories" on public.habit_categories;
create policy "Users can delete own habit categories"
on public.habit_categories for delete
using (auth.uid() = user_id);
