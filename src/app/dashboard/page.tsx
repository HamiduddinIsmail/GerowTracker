"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  buildDashboardBuckets,
  calendarMonthBoundsYmd,
  getDashboardLogRange,
  habitPeriodMet,
  minYmd,
  normalizeRecurrencePeriod,
  periodBucketKey,
  startOfWeekMonday,
  summarizeBucketsByCategory,
  toYmd,
  type DashboardBucket,
  type HabitWithId,
  type LogRow,
} from "@/lib/recurrence";

function DashboardPageInner() {
  const dashboardTabs = ["overview", "trends", "history"] as const;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [themeMode, setThemeMode] = useState<"light" | "navy">("light");
  const [userId, setUserId] = useState<string | null>(null);
  const [habits, setHabits] = useState<HabitWithId[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [selectedHeatmapDate, setSelectedHeatmapDate] = useState<string | null>(null);
  const [selectedTrendHabitId, setSelectedTrendHabitId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyRows, setHistoryRows] = useState<LogRow[]>([]);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<(typeof dashboardTabs)[number]>("overview");
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [pulseTab, setPulseTab] = useState<(typeof dashboardTabs)[number] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedTheme =
      typeof window !== "undefined" ? localStorage.getItem("tracker_theme_mode") : null;
    const nextTheme = storedTheme === "navy" ? "navy" : "light";
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", nextTheme);
    }
    queueMicrotask(() => {
      setThemeMode(nextTheme);
    });

    const init = async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    };
    void init();
  }, []);

  useEffect(() => {
    const fromQuery = searchParams.get("tab");
    if (fromQuery === "overview" || fromQuery === "trends" || fromQuery === "history") {
      setDashboardTab(fromQuery);
    }
  }, [searchParams]);

  const syncTabToUrl = useCallback(
    (tab: (typeof dashboardTabs)[number]) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tab);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const toggleTheme = () => {
    const nextTheme = themeMode === "light" ? "navy" : "light";
    setThemeMode(nextTheme);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", nextTheme);
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("tracker_theme_mode", nextTheme);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const seen = window.localStorage.getItem("dashboard_swipe_hint_seen");
    if (!seen) {
      setShowSwipeHint(true);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!userId) {
        return;
      }

      const { data: habitData, error: habitError } = await supabase
        .from("habit_definitions")
        .select(
          "id, name, category, target_type, target_value, recurrence_period"
        )
        .eq("user_id", userId)
        .eq("is_active", true);

      if (habitError) {
        setError(habitError.message);
        return;
      }

      const nextHabits = (habitData ?? []).map((row) => ({
        ...row,
        recurrence_period: normalizeRecurrencePeriod(
          (row as { recurrence_period?: string | null }).recurrence_period
        ),
      })) as HabitWithId[];

      setHabits(nextHabits);

      const { fetchStart, fetchEnd } = getDashboardLogRange(nextHabits);
      const eightWeeksAgo = new Date();
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 7);
      const trendStart = toYmd(startOfWeekMonday(eightWeeksAgo));
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const sixMonthStart = toYmd(new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth(), 1));
      const finalFetchStart = minYmd(minYmd(fetchStart, trendStart), sixMonthStart);

      const { data: logData, error: logError } = await supabase
        .from("habit_logs")
        .select("habit_id, log_date, value, completed")
        .eq("user_id", userId)
        .gte("log_date", finalFetchStart)
        .lte("log_date", fetchEnd);

      if (logError) {
        setError(logError.message);
        return;
      }
      setLogs(
        (logData ?? []).map((row) => ({
          habit_id: row.habit_id,
          log_date: row.log_date,
          value: Number(row.value ?? 0),
          completed: Boolean(row.completed),
        }))
      );
    };

    void load();
  }, [userId]);
  useEffect(() => {
    if (!selectedTrendHabitId && habits.length > 0) {
      queueMicrotask(() => {
        setSelectedTrendHabitId(habits[0].id);
      });
    }
  }, [habits, selectedTrendHabitId]);

  useEffect(() => {
    const loadHistory = async () => {
      if (!userId) {
        setHistoryRows([]);
        setHistoryHasNext(false);
        return;
      }
      const pageSize = 20;
      const start = historyPage * pageSize;
      const end = start + pageSize;
      const { data, error: historyError } = await supabase
        .from("habit_logs")
        .select("habit_id, log_date, value, completed")
        .eq("user_id", userId)
        .order("log_date", { ascending: false })
        .range(start, end);
      if (historyError) {
        setError(historyError.message);
        return;
      }
      const rows = (data ?? []).map((row) => ({
        habit_id: row.habit_id,
        log_date: row.log_date,
        value: Number(row.value ?? 0),
        completed: Boolean(row.completed),
      }));
      setHistoryRows(rows.slice(0, pageSize));
      setHistoryHasNext(rows.length > pageSize);
    };
    void loadHistory();
  }, [historyPage, userId]);

  const summary = useMemo(() => {
    const { monthStart, monthEnd } = calendarMonthBoundsYmd();
    const buckets = buildDashboardBuckets(habits, logs, monthStart, monthEnd);
    const fallbackByHabit = new Set(
      buckets.filter((bucket) => bucket.touchesMonth).map((bucket) => bucket.habitId)
    );
    const todayKey = toYmd(new Date());
    const fallbackBuckets: DashboardBucket[] = habits
      .filter((habit) => !fallbackByHabit.has(habit.id))
      .map((habit) => ({
        habitId: habit.id,
        key: periodBucketKey(habit, todayKey),
        rows: [],
        touchesMonth: true,
      }));
    const bucketsWithFallback = [...buckets, ...fallbackBuckets];
    const byCategory = summarizeBucketsByCategory(habits, bucketsWithFallback);

    const daysTracked = new Set(
      logs
        .filter((log) => log.log_date >= monthStart && log.log_date <= monthEnd)
        .map((log) => log.log_date)
    ).size;

    const habitMap = new Map(habits.map((h) => [h.id, h]));
    const inMonth = bucketsWithFallback.filter((b) => b.touchesMonth);
    const periodsTotal = inMonth.length;
    const periodsCompleted = inMonth.filter((b) => {
      const habit = habitMap.get(b.habitId);
      return habit ? habitPeriodMet(habit, b.rows) : false;
    }).length;

    const totalCompleted = Object.values(byCategory).reduce(
      (sum, current) => sum + current.completed,
      0
    );
    const totalPeriods = Object.values(byCategory).reduce(
      (sum, current) => sum + current.total,
      0
    );

    return {
      byCategory,
      daysTracked,
      periodsTotal,
      periodsCompleted,
      totalCompleted,
      totalPeriods,
      completionRate:
        totalPeriods === 0
          ? 0
          : Math.round((totalCompleted / totalPeriods) * 100),
    };
  }, [habits, logs]);
  const consistency = useMemo(() => {
    const { monthStart, monthEnd } = calendarMonthBoundsYmd();
    const start = new Date(`${monthStart}T12:00:00`);
    const end = new Date(`${monthEnd}T12:00:00`);
    const monthDates: string[] = [];
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0, 0)
    ) {
      monthDates.push(toYmd(d));
    }

    const activityByDate: Record<string, number> = {};
    for (const log of logs) {
      if (log.log_date < monthStart || log.log_date > monthEnd) {
        continue;
      }
      const score = Number(log.value ?? 0) + (log.completed ? 1 : 0);
      activityByDate[log.log_date] = (activityByDate[log.log_date] ?? 0) + score;
    }

    const activityDates = new Set(
      Object.entries(activityByDate)
        .filter(([, score]) => score > 0)
        .map(([date]) => date)
    );

    let currentStreak = 0;
    for (
      let d = new Date();
      currentStreak < 366;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12, 0, 0, 0)
    ) {
      const key = toYmd(d);
      if (activityDates.has(key)) {
        currentStreak += 1;
      } else {
        break;
      }
    }

    let longestStreak = 0;
    let running = 0;
    for (const date of monthDates) {
      if (activityDates.has(date)) {
        running += 1;
        if (running > longestStreak) {
          longestStreak = running;
        }
      } else {
        running = 0;
      }
    }

    const heatmap = monthDates.map((date) => ({
      date,
      score: activityByDate[date] ?? 0,
    }));

    return {
      currentStreak,
      longestStreak,
      heatmap,
    };
  }, [logs]);
  const dayLogDetails = useMemo(() => {
    const pickedDate = selectedHeatmapDate ?? consistency.heatmap.at(-1)?.date ?? null;
    if (!pickedDate) {
      return { pickedDate: null, rows: [] as Array<LogRow & { habitName: string }> };
    }
    const habitMap = new Map(habits.map((habit) => [habit.id, habit.name]));
    const rows = logs
      .filter((row) => row.log_date === pickedDate)
      .map((row) => ({
        ...row,
        habitName: habitMap.get(row.habit_id) ?? "Unknown habit",
      }))
      .sort((a, b) => a.habitName.localeCompare(b.habitName));

    return { pickedDate, rows };
  }, [consistency.heatmap, habits, logs, selectedHeatmapDate]);
  const weeklyTrend = useMemo(() => {
    const weekStarts: string[] = [];
    const now = new Date();
    const currentWeekStart = startOfWeekMonday(now);
    for (let i = 7; i >= 0; i--) {
      const d = new Date(currentWeekStart);
      d.setDate(currentWeekStart.getDate() - i * 7);
      weekStarts.push(toYmd(d));
    }

    const points = weekStarts.map((startYmd) => {
      const start = new Date(`${startYmd}T12:00:00`);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const endYmd = toYmd(end);
      const activeDates = new Set(
        logs
          .filter(
            (row) =>
              row.log_date >= startYmd &&
              row.log_date <= endYmd &&
              (row.completed || Number(row.value) > 0)
          )
          .map((row) => row.log_date)
      );
      const activeDays = activeDates.size;
      const percentage = Math.round((activeDays / 7) * 100);
      return {
        label: startYmd.slice(5),
        activeDays,
        percentage,
      };
    });

    return points;
  }, [logs]);
  const perHabitTrend = useMemo(() => {
    const targetHabit = habits.find((habit) => habit.id === selectedTrendHabitId);
    if (!targetHabit) {
      return { targetHabit: null, points: [] as Array<{ label: string; total: number }> };
    }
    const points: Array<{ label: string; total: number }> = [];
    const now = new Date();
    const currentWeek = startOfWeekMonday(now);
    for (let i = 7; i >= 0; i--) {
      const start = new Date(currentWeek);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startYmd = toYmd(start);
      const endYmd = toYmd(end);
      const total = logs
        .filter(
          (row) =>
            row.habit_id === targetHabit.id &&
            row.log_date >= startYmd &&
            row.log_date <= endYmd
        )
        .reduce((sum, row) => sum + Number(row.value ?? 0), 0);
      points.push({ label: startYmd.slice(5), total });
    }
    return { targetHabit, points };
  }, [habits, logs, selectedTrendHabitId]);
  const targetVsActual = useMemo(() => {
    const { monthStart, monthEnd } = calendarMonthBoundsYmd();
    const monthLogs = logs.filter(
      (row) => row.log_date >= monthStart && row.log_date <= monthEnd
    );
    const actual = monthLogs.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
    const daysInMonth = Number(monthEnd.slice(-2));
    const target = habits.reduce((sum, habit) => {
      const p = normalizeRecurrencePeriod(habit.recurrence_period);
      if (p === "daily") {
        return sum + Number(habit.target_value) * daysInMonth;
      }
      if (p === "weekly") {
        return sum + Number(habit.target_value) * Math.max(1, Math.ceil(daysInMonth / 7));
      }
      if (p === "monthly") {
        return sum + Number(habit.target_value);
      }
      return sum + Number(habit.target_value) / 12;
    }, 0);
    const percent = target > 0 ? Math.round((actual / target) * 100) : 0;
    return { actual, target: Math.round(target), percent };
  }, [habits, logs]);
  const categoryBreakdown = useMemo(() => {
    const now = new Date();
    const months = [6, 3].map((span) =>
      Array.from({ length: span }).map((_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (span - 1 - i), 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      })
    );
    const categories = Array.from(
      new Set(habits.map((habit) => habit.category).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    const make = (labels: string[]) =>
      labels.map((label) => {
        const row: Record<string, string | number> = { month: label };
        for (const category of categories) {
          const monthLogs = logs.filter(
            (log) =>
              log.log_date.startsWith(label) &&
              habits.find((h) => h.id === log.habit_id)?.category === category
          );
          const total = monthLogs.length;
          const done = monthLogs.filter((log) => log.completed || log.value > 0).length;
          row[category] = total === 0 ? "-" : `${Math.round((done / total) * 100)}%`;
        }
        return row;
      });
    return {
      categories,
      last6: make(months[0]),
      last3: make(months[1]),
    };
  }, [habits, logs]);
  const statCardClass =
    "rounded-3xl border border-white/10 bg-white/95 p-5 text-slate-900 shadow-lg max-md:rounded-[1.65rem] max-md:border-sky-100/50 max-md:shadow-md";
  const hasAnyMonthlyData = summary.totalPeriods > 0;
  const hasTrendData = logs.some((row) => row.completed || Number(row.value) > 0);
  const switchTabBySwipe = (direction: "left" | "right") => {
    const currentIndex = dashboardTabs.indexOf(dashboardTab);
    if (currentIndex < 0) {
      return;
    }
    if (direction === "left" && currentIndex < dashboardTabs.length - 1) {
      const nextTab = dashboardTabs[currentIndex + 1];
      setDashboardTab(nextTab);
      setPulseTab(nextTab);
      syncTabToUrl(nextTab);
      return;
    }
    if (direction === "right" && currentIndex > 0) {
      const nextTab = dashboardTabs[currentIndex - 1];
      setDashboardTab(nextTab);
      setPulseTab(nextTab);
      syncTabToUrl(nextTab);
    }
  };
  const activateTab = (tab: (typeof dashboardTabs)[number]) => {
    setDashboardTab(tab);
    setPulseTab(tab);
    syncTabToUrl(tab);
  };
  const dismissSwipeHint = () => {
    setShowSwipeHint(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dashboard_swipe_hint_seen", "1");
    }
  };

  useEffect(() => {
    if (!pulseTab) {
      return;
    }
    const timeout = window.setTimeout(() => setPulseTab(null), 240);
    return () => window.clearTimeout(timeout);
  }, [pulseTab]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 max-md:px-5 max-md:pt-6 md:px-8 md:py-12">
      <div className="theme-card mb-8 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl max-md:mb-6">
        <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="min-w-0 md:max-w-[min(100%,28rem)] md:pr-2">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
              Insight tracker
            </p>
            <h1 className="mt-2 text-2xl font-bold md:text-3xl">Monthly Dashboard</h1>
            <p className="mt-2 text-sm text-slate-500">
              Your progress overview in a cleaner card-style layout.
            </p>
          </div>
          <div className="flex w-full min-w-0 gap-2 md:w-auto md:shrink-0 md:flex-nowrap">
            <button
              type="button"
              className="theme-btn-secondary inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-2xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 md:flex-initial md:px-4"
              onClick={toggleTheme}
            >
              Theme: {themeMode === "light" ? "Light" : "Navy"}
            </button>
            <Link
              href="/"
              className="theme-btn-primary inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-2xl bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-slate-700 md:flex-initial md:px-4"
            >
              Back
            </Link>
          </div>
        </div>
      </div>

      {!userId && (
        <div className="theme-card rounded-3xl border border-white/15 bg-white/90 p-6 text-sm text-slate-600 shadow-xl md:p-8">
          Sign in on the home page first to view your dashboard.
        </div>
      )}

      {userId && (
        <>
          <div className="theme-subcard sticky top-2 z-20 mb-6 flex gap-1.5 rounded-2xl border border-slate-200/80 bg-white/90 p-1.5 backdrop-blur max-md:rounded-full max-md:border-sky-100/70 max-md:bg-sky-50/85 max-md:p-1 max-md:shadow-md max-md:ring-1 max-md:ring-sky-100/60">
            {[
              { id: "overview", label: "Overview" },
              { id: "trends", label: "Trends" },
              { id: "history", label: "History" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold max-md:rounded-full max-md:py-2.5 ${
                  dashboardTab === tab.id
                    ? `bg-white text-slate-900 shadow ${pulseTab === tab.id ? "tab-pulse" : ""}`
                    : "text-slate-500 max-md:text-slate-600"
                }`}
                onClick={() => {
                  activateTab(tab.id as (typeof dashboardTabs)[number]);
                  if (showSwipeHint) {
                    dismissSwipeHint();
                  }
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {showSwipeHint && (
            <div className="mb-4 flex justify-center md:hidden">
              <button
                type="button"
                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600"
                onClick={dismissSwipeHint}
              >
                Swipe left/right to switch tabs
              </button>
            </div>
          )}

          {dashboardTab === "overview" && (
            <section className="mb-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-500 to-violet-500 p-5 text-white shadow-lg">
                <p className="text-xs font-medium uppercase tracking-wider text-indigo-100">
                  Completion
                </p>
                <p className="mt-2 text-4xl font-bold tabular-nums">
                  {summary.completionRate}
                  <span className="text-2xl text-indigo-100">%</span>
                </p>
              </div>
              <div className={`theme-card ${statCardClass}`}>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Tracked days
                </p>
                <p className="mt-2 text-4xl font-bold tabular-nums">
                  {summary.daysTracked}
                </p>
              </div>
              <div
                className={`theme-card ${statCardClass}`}
                title="Each habit is scored for the current day, week, month, or year—depending on how often it repeats. This shows how many of those scores hit the target in the calendar month."
              >
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Checks passed
                </p>
                <p className="mt-2 text-4xl font-bold tabular-nums">
                  {summary.periodsCompleted}
                  <span className="text-lg font-semibold text-slate-400">
                    /{summary.periodsTotal}
                  </span>
                </p>
              </div>
            </section>
          )}

          <div
            key={dashboardTab}
            className="tab-fade-in"
            onTouchStart={(e) => setTouchStartX(e.changedTouches[0]?.clientX ?? null)}
            onTouchEnd={(e) => {
              if (touchStartX == null) {
                return;
              }
              const endX = e.changedTouches[0]?.clientX ?? touchStartX;
              const deltaX = endX - touchStartX;
              setTouchStartX(null);
              if (Math.abs(deltaX) < 50) {
                return;
              }
              if (showSwipeHint) {
                dismissSwipeHint();
              }
              switchTabBySwipe(deltaX < 0 ? "left" : "right");
            }}
          >
            {dashboardTab === "overview" && (
              <>
              <section className="mb-6 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
                <h2 className="text-xl font-semibold">How you&apos;re doing this month</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Snapshot of habits that had activity in the current calendar month.
                </p>
                <div className="mt-5 rounded-3xl bg-gradient-to-r from-indigo-500 to-sky-400 p-5 text-white">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-indigo-100">Your monthly report</p>
                      <p className="mt-1 text-2xl font-bold">
                        {summary.periodsCompleted} of {summary.periodsTotal} checks passed
                      </p>
                    </div>
                    <div
                      className="grid size-20 place-items-center rounded-full bg-white/20 text-xl font-bold"
                      style={{
                        backgroundImage: `conic-gradient(#ffffff ${summary.completionRate}%, rgba(255,255,255,0.2) 0%)`,
                      }}
                    >
                      <span className="grid size-14 place-items-center rounded-full bg-indigo-500 text-sm">
                        {summary.completionRate}%
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {!hasAnyMonthlyData && (
                <section className="mb-6 rounded-3xl border border-dashed border-slate-300 bg-white/95 p-6 text-slate-900 shadow-xl">
                  <h3 className="text-base font-semibold">No monthly data yet</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Start by logging one habit today from the home page. Overview cards will fill
                    automatically once your first entry is saved.
                  </p>
                </section>
              )}

              <section className="mb-6 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
                <h2 className="text-xl font-semibold">Target vs actual (this month)</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Actual</p>
                <p className="mt-1 text-3xl font-bold text-indigo-600">
                  {Math.round(targetVsActual.actual)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Target</p>
                <p className="mt-1 text-3xl font-bold text-indigo-600">{targetVsActual.target}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Achieved</p>
                <p className="mt-1 text-3xl font-bold text-indigo-600">{targetVsActual.percent}%</p>
              </div>
                </div>
              </section>

              <section className="rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
                <h2 className="text-xl font-semibold">By Category</h2>
                <p className="mt-1 text-sm text-slate-500">Completion share per category</p>
                <div className="mt-5 space-y-4">
                  {Object.entries(summary.byCategory).map(([category, stats]) => {
                    const percentage =
                      stats.total === 0
                        ? 0
                        : Math.round((stats.completed / stats.total) * 100);
                    return (
                      <div
                        key={category}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="mb-3 flex justify-between text-sm">
                          <span className="font-semibold capitalize text-slate-700">{category}</span>
                          <span className="tabular-nums text-slate-500">
                            {stats.completed}/{stats.total}{" "}
                            <span className="text-indigo-500">({percentage}%)</span>
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-500"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {Object.keys(summary.byCategory).length === 0 && (
                    <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500">
                      No monthly logs yet. Start tracking from the home page.
                    </p>
                  )}
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-slate-700">3-month breakdown</p>
                    <div className="space-y-1 text-xs text-slate-600">
                      {categoryBreakdown.last3.map((row) => (
                        <div key={`m3-${row.month as string}`} className="space-y-1">
                          <span>{row.month as string}</span>
                          <div className="flex flex-wrap gap-2">
                            {categoryBreakdown.categories.map((category) => (
                              <span key={`${row.month as string}-${category}`}>
                                {category.slice(0, 1).toUpperCase()}
                                {category.slice(1)} {row[category] as string}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-slate-700">6-month breakdown</p>
                    <div className="space-y-1 text-xs text-slate-600">
                      {categoryBreakdown.last6.map((row) => (
                        <div key={`m6-${row.month as string}`} className="space-y-1">
                          <span>{row.month as string}</span>
                          <div className="flex flex-wrap gap-2">
                            {categoryBreakdown.categories.map((category) => (
                              <span key={`${row.month as string}-${category}`}>
                                {category.slice(0, 1).toUpperCase()}
                                {category.slice(1)} {row[category] as string}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
              </>
            )}

            {dashboardTab === "trends" && (
              <>
              <section className="mb-6 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
                <h2 className="text-xl font-semibold">Weekly trend (last 8 weeks)</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Percentage of active days per week based on any logged progress.
                </p>
                <div className="-mx-1 mt-5 overflow-x-auto pb-1 md:mx-0 md:overflow-x-visible">
                  <div
                    className="grid min-w-[520px] grid-cols-8 gap-2 md:min-w-0"
                    role="img"
                    aria-label="Weekly active-day trend for the last eight weeks"
                  >
                    {weeklyTrend.map((point) => (
                      <div key={point.label} className="flex flex-col items-center gap-2">
                        <div className="flex h-28 w-full items-end rounded-lg bg-slate-100 px-1.5 py-1">
                          <div
                            className="w-full rounded-md bg-gradient-to-t from-indigo-500 to-sky-400"
                            style={{ height: `${Math.max(8, point.percentage)}%` }}
                            aria-hidden
                            title={`${point.activeDays}/7 active days (${point.percentage}%)`}
                          />
                        </div>
                        <p className="text-[10px] font-medium text-slate-500">{point.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {!hasTrendData && (
                <section className="mb-6 rounded-3xl border border-dashed border-slate-300 bg-white/95 p-6 text-slate-900 shadow-xl">
                  <h3 className="text-base font-semibold">Trends will appear after first logs</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Add progress on a few days to unlock weekly and per-habit trend charts.
                  </p>
                </section>
              )}

              <section className="mb-6 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
                <h2 className="text-xl font-semibold">Per-habit trend</h2>
                <div className="mt-3">
                  <select
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={selectedTrendHabitId ?? ""}
                    onChange={(e) => setSelectedTrendHabitId(e.target.value)}
                  >
                    {habits.map((habit) => (
                      <option key={habit.id} value={habit.id}>
                        {habit.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="-mx-1 mt-4 overflow-x-auto pb-1 md:mx-0 md:overflow-x-visible">
                  <div
                    className="grid min-w-[520px] grid-cols-8 gap-2 md:min-w-0"
                    role="img"
                    aria-label={`Weekly totals for ${perHabitTrend.targetHabit?.name ?? "selected habit"}`}
                  >
                    {perHabitTrend.points.map((point) => (
                      <div key={point.label} className="flex flex-col items-center gap-2">
                        <div className="flex h-24 w-full items-end rounded-lg bg-slate-100 px-1.5 py-1">
                          <div
                            className="w-full rounded-md bg-gradient-to-t from-violet-500 to-indigo-400"
                            style={{
                              height: `${Math.max(
                                6,
                                Math.round(
                                  (point.total /
                                    Math.max(...perHabitTrend.points.map((p) => p.total), 1)) *
                                    100
                                )
                              )}%`,
                            }}
                            aria-hidden
                            title={`${point.label}: ${point.total}`}
                          />
                        </div>
                        <p className="text-[10px] font-medium text-slate-500">{point.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mb-6 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
                <h2 className="text-xl font-semibold">Consistency</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Current streak</p>
                    <p className="mt-1 text-3xl font-bold text-indigo-600">
                      {consistency.currentStreak} days
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Longest this month</p>
                    <p className="mt-1 text-3xl font-bold text-indigo-600">
                      {consistency.longestStreak} days
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                  <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">Monthly heatmap</p>
                  <div className="grid grid-cols-7 gap-2">
                    {consistency.heatmap.map((cell) => {
                      const band =
                        cell.score <= 0
                          ? { bg: "bg-slate-200", text: "text-slate-600" }
                          : cell.score < 25
                            ? { bg: "bg-indigo-200", text: "text-slate-800" }
                            : cell.score < 75
                              ? { bg: "bg-indigo-400", text: "text-white" }
                              : { bg: "bg-indigo-600", text: "text-white" };
                      return (
                        <button
                          key={cell.date}
                          type="button"
                          onClick={() => setSelectedHeatmapDate(cell.date)}
                          className={`flex h-8 items-center justify-center rounded-md text-[10px] font-semibold transition ${band.bg} ${band.text} ${selectedHeatmapDate === cell.date ? "ring-2 ring-slate-800 ring-offset-2 ring-offset-slate-50" : ""}`}
                          title={`${cell.date}: ${cell.score.toFixed(0)} activity`}
                          aria-label={`${cell.date}, activity score ${Math.round(cell.score)}`}
                        >
                          {Number(cell.date.slice(-2))}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                    <span className="font-semibold uppercase tracking-wide">Legend</span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-3 rounded bg-slate-200" />
                      No activity
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-3 rounded bg-indigo-200" />
                      Low
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-3 rounded bg-indigo-400" />
                      Medium
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-3 rounded bg-indigo-600" />
                      High
                    </span>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                  <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    Logs on {dayLogDetails.pickedDate ?? "-"}
                  </p>
                  {dayLogDetails.rows.length === 0 ? (
                    <p className="text-sm text-slate-500">No logs on selected date.</p>
                  ) : (
                    <div className="space-y-2">
                      {dayLogDetails.rows.map((row) => (
                        <div
                          key={`${row.habit_id}-${row.log_date}`}
                          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-slate-700">{row.habitName}</span>
                          <span className="text-slate-500">
                            value {row.value} • {row.completed ? "done" : "not done"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
              </>
            )}

            {dashboardTab === "history" && (
              <section className="mb-6 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl">
              <h2 className="text-xl font-semibold">Recent logs (paginated)</h2>
              <div className="mt-4 space-y-2">
                {historyRows.map((row, idx) => {
                  const habitName =
                    habits.find((habit) => habit.id === row.habit_id)?.name ?? "Unknown";
                  return (
                    <div
                      key={`${row.habit_id}-${row.log_date}-${idx}`}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-700">
                        {row.log_date} · {habitName}
                      </span>
                      <span className="text-slate-500">
                        {row.value} • {row.completed ? "done" : "not done"}
                      </span>
                    </div>
                  );
                })}
                {historyRows.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                    No history yet. Save your first progress entry on the home page.
                  </p>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                  disabled={historyPage === 0}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  onClick={() => setHistoryPage((p) => p + 1)}
                  disabled={!historyHasNext}
                >
                  Next
                </button>
                <span className="self-center text-xs text-slate-500">Page {historyPage + 1}</span>
              </div>
              </section>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}

function DashboardLoadingFallback() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <div className="theme-card rounded-3xl border border-white/15 bg-white/95 p-10 text-center text-sm text-slate-500 shadow-xl">
        Loading dashboard…
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoadingFallback />}>
      <DashboardPageInner />
    </Suspense>
  );
}
