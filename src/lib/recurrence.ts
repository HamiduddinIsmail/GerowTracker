export type RecurrencePeriod = "daily" | "weekly" | "monthly" | "yearly";

export type HabitLike = {
  target_type: "binary" | "count" | "duration" | "pages";
  target_value: number;
  recurrence_period?: string | null;
  weekly_goal_type?: "sum" | "times" | "days" | null;
  weekly_target_count?: number | null;
  weekly_days?: number[] | null;
  unit?: string | null;
};

export type LogRow = {
  habit_id: string;
  log_date: string;
  value: number;
  completed: boolean;
};

export type HabitWithId = HabitLike & {
  id: string;
  name: string;
  category: string;
};

export function normalizeRecurrencePeriod(
  value: string | null | undefined
): RecurrencePeriod {
  if (value === "weekly" || value === "monthly" || value === "yearly") {
    return value;
  }
  return "daily";
}

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

export function startOfWeekMonday(ref: Date): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function endOfWeekSunday(ref: Date): Date {
  const start = startOfWeekMonday(ref);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return end;
}

export function periodStartDate(
  period: RecurrencePeriod,
  ref: Date
): Date {
  switch (period) {
    case "weekly":
      return startOfWeekMonday(ref);
    case "monthly":
      return new Date(ref.getFullYear(), ref.getMonth(), 1, 12, 0, 0, 0);
    case "yearly":
      return new Date(ref.getFullYear(), 0, 1, 12, 0, 0, 0);
    default:
      return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12, 0, 0, 0);
  }
}

export function currentPeriodEndYmd(
  period: RecurrencePeriod,
  ref: Date = new Date()
): string {
  switch (period) {
    case "weekly":
      return toYmd(endOfWeekSunday(ref));
    case "monthly":
      return toYmd(
        new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 12, 0, 0, 0)
      );
    case "yearly":
      return toYmd(new Date(ref.getFullYear(), 11, 31, 12, 0, 0, 0));
    default:
      return toYmd(ref);
  }
}

export function currentPeriodBoundsYmd(
  habit: HabitLike,
  ref: Date = new Date()
): { start: string; end: string } {
  const p = normalizeRecurrencePeriod(habit.recurrence_period);
  const start = toYmd(periodStartDate(p, ref));
  const end = currentPeriodEndYmd(p, ref);
  return { start, end };
}

export function recurrenceShortLabel(period: RecurrencePeriod): string {
  switch (period) {
    case "weekly":
      return "per week";
    case "monthly":
      return "per month";
    case "yearly":
      return "per year";
    default:
      return "per day";
  }
}

export function earliestPeriodStartYmd(
  habits: { recurrence_period?: string | null }[],
  ref: Date = new Date()
): string {
  if (habits.length === 0) {
    return toYmd(ref);
  }
  let minS = toYmd(
    periodStartDate(normalizeRecurrencePeriod(habits[0].recurrence_period), ref)
  );
  for (let i = 1; i < habits.length; i++) {
    const s = toYmd(
      periodStartDate(
        normalizeRecurrencePeriod(habits[i].recurrence_period),
        ref
      )
    );
    if (s < minS) {
      minS = s;
    }
  }
  return minS;
}

export function periodBucketKey(habit: HabitLike, logDateYmd: string): string {
  const p = normalizeRecurrencePeriod(habit.recurrence_period);
  if (p === "daily") {
    return logDateYmd;
  }
  const d = parseYmd(logDateYmd);
  if (p === "weekly") {
    return `w:${toYmd(startOfWeekMonday(d))}`;
  }
  if (p === "monthly") {
    return `m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return `y:${d.getFullYear()}`;
}

export function habitPeriodMet(habit: HabitLike, rows: LogRow[]): boolean {
  const recurrence = normalizeRecurrencePeriod(habit.recurrence_period);
  const weeklyMode = habit.weekly_goal_type ?? "sum";
  const activeRows = rows.filter(
    (r) => r.completed || Number(r.value ?? 0) > 0
  );
  if (recurrence === "weekly" && weeklyMode === "times") {
    const target = Number(habit.weekly_target_count ?? 1);
    return activeRows.length >= target;
  }
  if (recurrence === "weekly" && weeklyMode === "days") {
    const days = new Set<number>(
      activeRows.map((row) => parseYmd(row.log_date).getDay())
    );
    const expectedDays = (habit.weekly_days ?? []).map((d) =>
      d === 7 ? 0 : d
    );
    if (expectedDays.length === 0) {
      return false;
    }
    return expectedDays.every((day) => days.has(day));
  }
  if (rows.length === 0) {
    return false;
  }
  const target = Number(habit.target_value);
  if (habit.target_type === "binary") {
    const completions = rows.filter((r) => r.completed).length;
    return completions >= target;
  }
  const sum = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
  return sum >= target;
}

export function habitPeriodProgress(
  habit: HabitLike,
  rows: LogRow[]
): { current: number; label: string; target: number } {
  const recurrence = normalizeRecurrencePeriod(habit.recurrence_period);
  const weeklyMode = habit.weekly_goal_type ?? "sum";
  const activeRows = rows.filter(
    (r) => r.completed || Number(r.value ?? 0) > 0
  );
  if (recurrence === "weekly" && weeklyMode === "times") {
    return {
      current: activeRows.length,
      label: "times",
      target: Number(habit.weekly_target_count ?? 1),
    };
  }
  if (recurrence === "weekly" && weeklyMode === "days") {
    const expectedDays = (habit.weekly_days ?? []).length;
    const currentDays = new Set(
      activeRows.map((row) => parseYmd(row.log_date).getDay())
    ).size;
    return {
      current: currentDays,
      label: "days",
      target: Number(expectedDays),
    };
  }
  const target = Number(habit.target_value);
  if (habit.target_type === "binary") {
    const completions = rows.filter((r) => r.completed).length;
    return {
      current: completions,
      label: "days",
      target,
    };
  }
  const sum = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
  return {
    current: sum,
    label: habit.unit ?? "total",
    target,
  };
}

export function calendarMonthBoundsYmd(ref: Date = new Date()): {
  monthStart: string;
  monthEnd: string;
} {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const first = new Date(y, m, 1, 12, 0, 0, 0);
  const last = new Date(y, m + 1, 0, 12, 0, 0, 0);
  return { monthStart: toYmd(first), monthEnd: toYmd(last) };
}

export function getDashboardLogRange(
  habits: { recurrence_period?: string | null }[],
  ref: Date = new Date()
): { fetchStart: string; fetchEnd: string; monthStart: string; monthEnd: string } {
  const { monthStart, monthEnd } = calendarMonthBoundsYmd(ref);
  const first = parseYmd(monthStart);
  const last = parseYmd(monthEnd);
  let fetchStart = toYmd(startOfWeekMonday(first));
  let fetchEnd = toYmd(endOfWeekSunday(last));

  const hasYearly = habits.some(
    (h) => normalizeRecurrencePeriod(h.recurrence_period) === "yearly"
  );
  if (hasYearly) {
    fetchStart = minYmd(fetchStart, `${ref.getFullYear()}-01-01`);
  }
  fetchEnd = maxYmd(fetchEnd, monthEnd);
  return { fetchStart, fetchEnd, monthStart, monthEnd };
}

export type DashboardBucket = {
  habitId: string;
  key: string;
  rows: LogRow[];
  touchesMonth: boolean;
};

export function buildDashboardBuckets(
  habits: HabitWithId[],
  logs: LogRow[],
  monthStart: string,
  monthEnd: string
): DashboardBucket[] {
  const byHabit = new Map(habits.map((h) => [h.id, h]));
  const habitIds = new Set(habits.map((h) => h.id));

  const raw = new Map<string, LogRow[]>();
  for (const row of logs) {
    if (!habitIds.has(row.habit_id)) {
      continue;
    }
    const habit = byHabit.get(row.habit_id);
    if (!habit) {
      continue;
    }
    const periodKey = periodBucketKey(habit, row.log_date);
    const compound = `${row.habit_id}::${periodKey}`;
    const list = raw.get(compound) ?? [];
    list.push(row);
    raw.set(compound, list);
  }

  const buckets: DashboardBucket[] = [];
  for (const [compound, rows] of raw) {
    const sep = compound.indexOf("::");
    const habitId = compound.slice(0, sep);
    const periodKey = compound.slice(sep + 2);
    const habit = byHabit.get(habitId);
    if (!habit) {
      continue;
    }
    const touchesMonth = rows.some(
      (r) => r.log_date >= monthStart && r.log_date <= monthEnd
    );
    buckets.push({
      habitId,
      key: periodKey,
      rows,
      touchesMonth,
    });
  }
  return buckets;
}

export function summarizeBucketsByCategory(
  habits: HabitWithId[],
  buckets: DashboardBucket[]
): Record<string, { total: number; completed: number }> {
  const habitMap = new Map(habits.map((h) => [h.id, h]));
  const acc: Record<string, { total: number; completed: number }> = {};

  for (const b of buckets) {
    if (!b.touchesMonth) {
      continue;
    }
    const habit = habitMap.get(b.habitId);
    if (!habit) {
      continue;
    }
    const category = habit.category;
    if (!acc[category]) {
      acc[category] = { total: 0, completed: 0 };
    }
    acc[category].total += 1;
    if (habitPeriodMet(habit, b.rows)) {
      acc[category].completed += 1;
    }
  }
  return acc;
}
