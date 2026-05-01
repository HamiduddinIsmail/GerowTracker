-- Run in Supabase SQL Editor (once) after initial schema.

alter table public.habit_definitions
  add column if not exists recurrence_period text not null default 'daily';

alter table public.habit_definitions
  drop constraint if exists habit_definitions_recurrence_period_check;

alter table public.habit_definitions
  add constraint habit_definitions_recurrence_period_check
  check (recurrence_period in ('daily', 'weekly', 'monthly', 'yearly'));
