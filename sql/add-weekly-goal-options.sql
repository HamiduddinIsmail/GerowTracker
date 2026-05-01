-- Rich weekly recurrence options:
-- 1) weekly by times per week
-- 2) weekly by specific weekdays (Mon/Wed/Fri etc)
--
-- Run once in Supabase SQL editor.

alter table public.habit_definitions
  add column if not exists weekly_goal_type text not null default 'sum';

alter table public.habit_definitions
  add column if not exists weekly_target_count integer;

alter table public.habit_definitions
  add column if not exists weekly_days smallint[];

alter table public.habit_definitions
  drop constraint if exists habit_definitions_weekly_goal_type_check;

alter table public.habit_definitions
  add constraint habit_definitions_weekly_goal_type_check
  check (weekly_goal_type in ('sum', 'times', 'days'));

alter table public.habit_definitions
  drop constraint if exists habit_definitions_weekly_target_count_check;

alter table public.habit_definitions
  add constraint habit_definitions_weekly_target_count_check
  check (weekly_target_count is null or weekly_target_count >= 1);

alter table public.habit_definitions
  drop constraint if exists habit_definitions_weekly_days_check;

alter table public.habit_definitions
  add constraint habit_definitions_weekly_days_check
  check (
    weekly_days is null
    or (
      coalesce(array_length(weekly_days, 1), 0) > 0
      and weekly_days <@ array[1,2,3,4,5,6,7]::smallint[]
    )
  );
