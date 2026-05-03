"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import {
  currentPeriodBoundsYmd,
  earliestPeriodStartYmd,
  habitPeriodMet,
  habitPeriodProgress,
  normalizeRecurrencePeriod,
  recurrenceShortLabel,
  toYmd,
  type LogRow,
  type RecurrencePeriod,
} from "@/lib/recurrence";

type Habit = {
  id: string;
  name: string;
  category: string;
  target_type: "binary" | "count" | "duration" | "pages";
  target_value: number;
  unit: string | null;
  is_active: boolean;
  recurrence_period: RecurrencePeriod | null;
  weekly_goal_type: "sum" | "times" | "days";
  weekly_target_count: number | null;
  weekly_days: number[] | null;
};

const defaultCategoryOptions = ["workout", "ibadah", "personal"] as const;
const normalizeCategoryName = (value: string) => value.trim().toLowerCase();

/** Shown only when "Repeat" is enabled (otherwise habit is saved as daily). */
const repeatRecurrenceOptions: Exclude<RecurrencePeriod, "daily">[] = [
  "weekly",
  "monthly",
  "yearly",
];
const recurrenceOptions: RecurrencePeriod[] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];
const weekdayOptions = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 7, label: "Sun" },
] as const;

const today = toYmd(new Date());

type ToastVariant = "success" | "error" | "info";

type ToastPayload = {
  text: string;
  variant: ToastVariant;
  onUndo?: () => void;
};

export default function Home() {
  const [themeMode, setThemeMode] = useState<"light" | "navy">("light");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [archivedHabits, setArchivedHabits] = useState<Habit[]>([]);
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([
    ...defaultCategoryOptions,
  ]);
  const [newCategoryDraft, setNewCategoryDraft] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState("");
  const [newHabit, setNewHabit] = useState({
    name: "",
    category: "workout",
    target_value: 1,
    unit: "",
    recurrence_period: "weekly" as RecurrencePeriod,
    weekly_goal_type: "sum" as "sum" | "times" | "days",
    weekly_target_count: 3,
    weekly_days: [1, 3, 5] as number[],
  });
  const [repeatSchedule, setRepeatSchedule] = useState(false);
  const [incrementDrafts, setIncrementDrafts] = useState<Record<string, string>>({});
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [dirtyHabits, setDirtyHabits] = useState<Record<string, true>>({});
  const [savingByHabit, setSavingByHabit] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [openActionMenuHabitId, setOpenActionMenuHabitId] = useState<string | null>(null);
  const [editHabitDraft, setEditHabitDraft] = useState<{
    name: string;
    category: string;
    target_value: number;
    unit: string;
    recurrence_period: RecurrencePeriod;
    weekly_goal_type: "sum" | "times" | "days";
    weekly_target_count: number;
    weekly_days: number[];
  }>({
    name: "",
    category: "workout",
    target_value: 1,
    unit: "",
    recurrence_period: "daily",
    weekly_goal_type: "sum",
    weekly_target_count: 3,
    weekly_days: [1, 3, 5],
  });
  const [deleteConfirmHabit, setDeleteConfirmHabit] = useState<Habit | null>(null);
  const [saveStateByHabit, setSaveStateByHabit] = useState<
    Record<string, "dirty" | "saving" | "saved" | "error">
  >({});
  const [lastSavedAtByHabit, setLastSavedAtByHabit] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const [marketingHeroOpen, setMarketingHeroOpen] = useState(true);
  const [showNewHabitForm, setShowNewHabitForm] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [habitsInitialLoading, setHabitsInitialLoading] = useState(false);
  const [habitSearch, setHabitSearch] = useState("");
  const [habitCategoryFilter, setHabitCategoryFilter] = useState("all");
  const [habitStatusFilter, setHabitStatusFilter] = useState<"all" | "remaining" | "met">(
    "all"
  );
  const [visibleHabitCount, setVisibleHabitCount] = useState(8);
  const [pinnedHabitIds, setPinnedHabitIds] = useState<string[]>([]);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [mobileFilterTouchStartY, setMobileFilterTouchStartY] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const autosaveInFlight = useRef(false);
  const marketingHeroSectionRef = useRef<HTMLElement | null>(null);
  const progressSectionRef = useRef<HTMLElement | null>(null);
  const newHabitSectionRef = useRef<HTMLElement | null>(null);
  const trackerSectionRef = useRef<HTMLElement | null>(null);
  const actionsButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const returnFocusAfterDeleteRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogOpenPrev = useRef(false);
  const deleteDialogPanelRef = useRef<HTMLDivElement | null>(null);
  const deleteDialogCancelRef = useRef<HTMLButtonElement | null>(null);

  const showToast = useCallback(
    (text: string, variant: ToastVariant = "success", onUndo?: () => void) => {
      setToast(onUndo ? { text, variant, onUndo } : { text, variant });
    },
    []
  );

  const scrollToHomeSection = useCallback((el: HTMLElement | null) => {
    queueMicrotask(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  useEffect(() => {
    if (!userId) {
      setMarketingHeroOpen(true);
      return;
    }
    if (habitsInitialLoading) {
      return;
    }
    if (habits.length === 0) {
      setMarketingHeroOpen(true);
    } else {
      setMarketingHeroOpen(false);
    }
  }, [userId, habits.length, habitsInitialLoading]);

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
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUserId(session?.user?.id ?? null);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const setOnline = () => setIsOnline(window.navigator.onLine);
    setOnline();
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOnline);
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOnline);
    };
  }, []);

  useEffect(() => {
    if (!userId || typeof window === "undefined") {
      setPinnedHabitIds([]);
      return;
    }
    const raw = window.localStorage.getItem(`tracker_pinned_habits_${userId}`);
    if (!raw) {
      setPinnedHabitIds([]);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as string[];
      setPinnedHabitIds(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPinnedHabitIds([]);
    }
  }, [userId]);

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
    if (!toast) {
      return;
    }
    const ms = toast.onUndo
      ? 9000
      : toast.variant === "error"
        ? 5200
        : toast.variant === "info"
          ? 2200
          : 2800;
    const timeout = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      if (deleteConfirmHabit) {
        setDeleteConfirmHabit(null);
      } else if (mobileFilterOpen) {
        setMobileFilterOpen(false);
      } else if (openActionMenuHabitId) {
        setOpenActionMenuHabitId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteConfirmHabit, mobileFilterOpen, openActionMenuHabitId]);

  useLayoutEffect(() => {
    const isOpen = Boolean(deleteConfirmHabit);
    if (isOpen) {
      queueMicrotask(() => {
        deleteDialogCancelRef.current?.focus();
      });
    } else if (deleteDialogOpenPrev.current) {
      const el = returnFocusAfterDeleteRef.current;
      queueMicrotask(() => {
        if (el && document.body.contains(el)) {
          el.focus();
        } else {
          trackerSectionRef.current?.focus();
        }
      });
      returnFocusAfterDeleteRef.current = null;
    }
    deleteDialogOpenPrev.current = isOpen;
  }, [deleteConfirmHabit]);

  useEffect(() => {
    if (!deleteConfirmHabit) {
      return;
    }
    const panel = deleteDialogPanelRef.current;
    if (!panel) {
      return;
    }
    const focusableButtons = () =>
      Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).filter(
        (b) => !b.disabled
      );
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") {
        return;
      }
      const list = focusableButtons();
      if (list.length === 0) {
        return;
      }
      const active = document.activeElement;
      if (!panel.contains(active)) {
        return;
      }
      const ix = list.indexOf(active as HTMLButtonElement);
      if (ix < 0) {
        return;
      }
      if (e.shiftKey) {
        if (ix === 0) {
          e.preventDefault();
          list[list.length - 1]?.focus();
        }
      } else if (ix === list.length - 1) {
        e.preventDefault();
        list[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmHabit]);

  useEffect(() => {
    if (!openActionMenuHabitId) {
      return;
    }
    const onPointer = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-habit-action-menu]")) {
        return;
      }
      setOpenActionMenuHabitId(null);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [openActionMenuHabitId]);

  const loadHabitsAndLogs = useCallback(async (currentUserId: string) => {
    const { data: habitData, error: habitError } = await supabase
      .from("habit_definitions")
      .select(
        "id, name, category, target_type, target_value, unit, is_active, recurrence_period, weekly_goal_type, weekly_target_count, weekly_days"
      )
      .eq("user_id", currentUserId)
      .order("created_at");

    if (habitError) {
      showToast(habitError.message, "error");
      return;
    }

    const allHabits = (habitData ?? []).map((row) => ({
      ...row,
      recurrence_period: normalizeRecurrencePeriod(
        (row as { recurrence_period?: string | null }).recurrence_period
      ),
      weekly_goal_type:
        (row as { weekly_goal_type?: "sum" | "times" | "days" | null })
          .weekly_goal_type ?? "sum",
      weekly_target_count: Number(
        (row as { weekly_target_count?: number | null }).weekly_target_count ?? 0
      ),
      weekly_days:
        ((row as { weekly_days?: number[] | null }).weekly_days ?? null)?.map(
          Number
        ) ?? null,
    })) as Habit[];
    const nextHabits = allHabits.filter((habit) => habit.is_active);
    const nextArchivedHabits = allHabits.filter((habit) => !habit.is_active);
    const existingHabitCategories = Array.from(
      new Set(
        [...allHabits]
          .map((habit) => normalizeCategoryName(habit.category))
          .filter(Boolean)
      )
    );

    setHabits(nextHabits);
    setArchivedHabits(nextArchivedHabits);

    const { data: categoryData, error: categoryError } = await supabase
      .from("habit_categories")
      .select("name")
      .eq("user_id", currentUserId)
      .order("name");

    if (categoryError && categoryError.code !== "42P01") {
      showToast(categoryError.message, "error");
    }
    const mergedCategories = Array.from(
      new Set([
        ...defaultCategoryOptions,
        ...existingHabitCategories,
        ...((categoryData ?? []).map((row) => normalizeCategoryName(row.name)) ?? []),
      ])
    );
    const nextCategoryOptions = mergedCategories.length
      ? mergedCategories
      : [...defaultCategoryOptions];
    setCategoryOptions(nextCategoryOptions);
    setNewHabit((prev) => ({
      ...prev,
      category: nextCategoryOptions.includes(prev.category)
        ? prev.category
        : nextCategoryOptions[0],
    }));
    setEditHabitDraft((prev) => ({
      ...prev,
      category: nextCategoryOptions.includes(prev.category)
        ? prev.category
        : nextCategoryOptions[0],
    }));

    if (nextHabits.length === 0) {
      setLogRows([]);
      return;
    }

    const earliest = earliestPeriodStartYmd(nextHabits);
    const { data: logData, error: logError } = await supabase
      .from("habit_logs")
      .select("habit_id, log_date, value, completed")
      .eq("user_id", currentUserId)
      .gte("log_date", earliest)
      .lte("log_date", today);

    if (logError) {
      showToast(logError.message, "error");
      return;
    }

    setLogRows(
      (logData ?? []).map((row) => ({
        habit_id: row.habit_id,
        log_date: row.log_date,
        value: Number(row.value ?? 0),
        completed: Boolean(row.completed),
      }))
    );
  }, [showToast]);

  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => {
        setHabits([]);
        setLogRows([]);
      });
      setHabitsInitialLoading(false);
      return;
    }
    setHabitsInitialLoading(true);
    queueMicrotask(() => {
      void loadHabitsAndLogs(userId).finally(() => {
        setHabitsInitialLoading(false);
      });
    });
  }, [userId, loadHabitsAndLogs]);

  const todayByHabit = useMemo(() => {
    const map: Record<
      string,
      { habit_id: string; value: number; completed: boolean }
    > = {};
    for (const row of logRows) {
      if (row.log_date === today) {
        map[row.habit_id] = {
          habit_id: row.habit_id,
          value: row.value,
          completed: row.completed,
        };
      }
    }
    return map;
  }, [logRows]);

  const periodRowsByHabit = useMemo(() => {
    const ref = new Date();
    const out: Record<string, LogRow[]> = {};
    for (const habit of habits) {
      const { start, end } = currentPeriodBoundsYmd(habit, ref);
      out[habit.id] = logRows.filter(
        (row) =>
          row.habit_id === habit.id && row.log_date >= start && row.log_date <= end
      );
    }
    return out;
  }, [habits, logRows]);

  const summary = useMemo(() => {
    const total = habits.length;
    const met = habits.filter((habit) =>
      habitPeriodMet(habit, periodRowsByHabit[habit.id] ?? [])
    ).length;

    return { total, met, percent: total === 0 ? 0 : Math.round((met / total) * 100) };
  }, [habits, periodRowsByHabit]);
  const todayScorecard = useMemo(() => {
    const remaining = habits.filter((habit) => {
      const row = todayByHabit[habit.id];
      if (!row) {
        return true;
      }
      return !(row.completed || row.value >= habit.target_value);
    });
    return {
      completed: Math.max(0, habits.length - remaining.length),
      remaining: remaining.length,
      nextHabit: remaining[0] ?? null,
    };
  }, [habits, todayByHabit]);
  const filteredHabits = useMemo(() => {
    const pinnedSet = new Set(pinnedHabitIds);
    const q = habitSearch.trim().toLowerCase();
    const indexed = habits
      .map((habit, index) => ({ habit, index }))
      .filter(({ habit }) => {
        if (habitCategoryFilter !== "all" && habit.category !== habitCategoryFilter) {
          return false;
        }
        if (q) {
          const hay = `${habit.name} ${habit.category} ${habit.unit ?? ""}`.toLowerCase();
          if (!hay.includes(q)) {
            return false;
          }
        }
        if (habitStatusFilter === "all") {
          return true;
        }
        const periodRows = periodRowsByHabit[habit.id] ?? [];
        const isMet = habitPeriodMet(habit, periodRows);
        return habitStatusFilter === "met" ? isMet : !isMet;
      });
    indexed.sort((a, b) => {
      const aPinned = pinnedSet.has(a.habit.id) ? 1 : 0;
      const bPinned = pinnedSet.has(b.habit.id) ? 1 : 0;
      if (aPinned !== bPinned) {
        return bPinned - aPinned;
      }
      return a.index - b.index;
    });
    return indexed.map((row) => row.habit);
  }, [
    habitCategoryFilter,
    habitSearch,
    habitStatusFilter,
    habits,
    pinnedHabitIds,
    periodRowsByHabit,
  ]);
  const visibleHabits = useMemo(
    () => filteredHabits.slice(0, visibleHabitCount),
    [filteredHabits, visibleHabitCount]
  );
  const hasMoreHabits = filteredHabits.length > visibleHabitCount;
  const dirtyCount = Object.keys(dirtyHabits).length;
  const isSyncing = savingAll || Object.values(savingByHabit).some(Boolean);
  const syncStatusText = !isOnline
    ? "Offline"
    : isSyncing
      ? "Saving..."
      : dirtyCount > 0
        ? autosaveEnabled
          ? "Autosave pending"
          : "Unsaved changes"
        : "All changes saved";
  const syncStatusClass = !isOnline
    ? "text-amber-700"
    : isSyncing
      ? "text-indigo-700"
      : dirtyCount > 0
        ? "text-orange-700"
        : "text-emerald-700";

  useEffect(() => {
    setVisibleHabitCount(8);
  }, [habitCategoryFilter, habitSearch, habitStatusFilter]);

  const sendMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setToast(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) {
      showToast(error.message, "error");
    } else {
      showToast("Check your email for the login link.", "success");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    showToast("Signed out.", "info");
  };

  const addHabit = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId) {
      showToast("Please sign in first.", "error");
      return;
    }
    if (!newHabit.name.trim()) {
      showToast("Habit name is required.", "error");
      return;
    }
    if (!newHabit.category.trim()) {
      showToast("Category is required.", "error");
      return;
    }

    const recurrence_period = repeatSchedule
      ? newHabit.recurrence_period
      : "daily";
    const weekly_goal_type =
      recurrence_period === "weekly" ? newHabit.weekly_goal_type : "sum";
    const weekly_target_count =
      recurrence_period === "weekly" && weekly_goal_type === "times"
        ? Number(newHabit.weekly_target_count)
        : null;
    const weekly_days =
      recurrence_period === "weekly" && weekly_goal_type === "days"
        ? newHabit.weekly_days
        : null;

    const { error } = await supabase.from("habit_definitions").insert({
      user_id: userId,
      name: newHabit.name.trim(),
      category: normalizeCategoryName(newHabit.category),
      target_type: "count",
      target_value: newHabit.target_value,
      unit: newHabit.unit.trim() || null,
      recurrence_period,
      weekly_goal_type,
      weekly_target_count,
      weekly_days,
    });

    if (error) {
      showToast(error.message, "error");
      return;
    }

    setRepeatSchedule(false);
    setNewHabit({
      name: "",
      category: "workout",
      target_value: 1,
      unit: "",
      recurrence_period: "weekly",
      weekly_goal_type: "sum",
      weekly_target_count: 3,
      weekly_days: [1, 3, 5],
    });
    showToast("Habit created.", "success");
    await loadHabitsAndLogs(userId);
  };

  const patchTodayRow = (
    habitId: string,
    partial: Partial<Pick<LogRow, "value" | "completed">>
  ) => {
    setLogRows((prev) => {
      const next = [...prev];
      const index = next.findIndex(
        (row) => row.habit_id === habitId && row.log_date === today
      );
      if (index >= 0) {
        next[index] = {
          ...next[index],
          ...partial,
        };
        return next;
      }
      return [
        ...next,
        {
          habit_id: habitId,
          log_date: today,
          value: partial.value ?? 0,
          completed: partial.completed ?? false,
        },
      ];
    });
    setDirtyHabits((prev) => ({ ...prev, [habitId]: true }));
    setSaveStateByHabit((prev) => ({ ...prev, [habitId]: "dirty" }));
  };

  const addProgress = (habit: Habit) => {
    const raw = incrementDrafts[habit.id] ?? "";
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta <= 0) {
      showToast("Enter a positive number in Add progress.", "error");
      return;
    }
    const current = todayByHabit[habit.id]?.value ?? 0;
    patchTodayRow(habit.id, { value: current + delta });
    setIncrementDrafts((prev) => ({ ...prev, [habit.id]: "" }));
    showToast(`${habit.name}: added ${delta}.`, "success");
  };

  const saveProgress = useCallback(async (habit: Habit, silent = false) => {
    if (!userId) {
      showToast("Please sign in first.", "error");
      return;
    }
    const currentLog = todayByHabit[habit.id] ?? {
      habit_id: habit.id,
      value: 0,
      completed: false,
    };
    const completed = currentLog.completed;

    setSavingByHabit((prev) => ({ ...prev, [habit.id]: true }));
    setSaveStateByHabit((prev) => ({ ...prev, [habit.id]: "saving" }));
    const { error } = await supabase.from("habit_logs").upsert(
      {
        user_id: userId,
        habit_id: habit.id,
        log_date: today,
        value: currentLog.value,
        completed,
      },
      { onConflict: "habit_id,log_date" }
    );
    setSavingByHabit((prev) => ({ ...prev, [habit.id]: false }));

    if (!silent) {
      if (error) {
        showToast(error.message, "error");
      } else {
        showToast(`${habit.name} saved.`, "success");
      }
    }
    if (!error) {
      setDirtyHabits((prev) => {
        const next = { ...prev };
        delete next[habit.id];
        return next;
      });
      setSaveStateByHabit((prev) => ({ ...prev, [habit.id]: "saved" }));
      setLastSavedAtByHabit((prev) => ({
        ...prev,
        [habit.id]: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      }));
      await loadHabitsAndLogs(userId);
    } else {
      setSaveStateByHabit((prev) => ({ ...prev, [habit.id]: "error" }));
    }
  }, [loadHabitsAndLogs, showToast, todayByHabit, userId]);

  const saveAllProgress = async () => {
    if (!userId || habits.length === 0) {
      return;
    }
    setSavingAll(true);
    for (const habit of habits) {
      await saveProgress(habit, true);
    }
    setSavingAll(false);
    showToast("All habits saved.", "success");
  };

  const startEditHabit = (habit: Habit) => {
    setEditingHabitId(habit.id);
    setEditHabitDraft({
      name: habit.name,
      category: habit.category,
      target_value: habit.target_value,
      unit: habit.unit ?? "",
      recurrence_period: normalizeRecurrencePeriod(habit.recurrence_period),
      weekly_goal_type: habit.weekly_goal_type ?? "sum",
      weekly_target_count: Number(habit.weekly_target_count ?? 3),
      weekly_days: habit.weekly_days ?? [1, 3, 5],
    });
  };

  const saveHabitDetails = async (habitId: string) => {
    if (!userId) {
      return;
    }
    if (!editHabitDraft.category.trim()) {
      showToast("Category is required.", "error");
      return;
    }
    const { error } = await supabase
      .from("habit_definitions")
      .update({
        name: editHabitDraft.name.trim(),
        category: normalizeCategoryName(editHabitDraft.category),
        target_value: editHabitDraft.target_value,
        unit: editHabitDraft.unit.trim() || null,
        recurrence_period: editHabitDraft.recurrence_period,
        weekly_goal_type:
          editHabitDraft.recurrence_period === "weekly"
            ? editHabitDraft.weekly_goal_type
            : "sum",
        weekly_target_count:
          editHabitDraft.recurrence_period === "weekly" &&
          editHabitDraft.weekly_goal_type === "times"
            ? Number(editHabitDraft.weekly_target_count)
            : null,
        weekly_days:
          editHabitDraft.recurrence_period === "weekly" &&
          editHabitDraft.weekly_goal_type === "days"
            ? editHabitDraft.weekly_days
            : null,
      })
      .eq("id", habitId)
      .eq("user_id", userId);

    if (error) {
      showToast(error.message, "error");
      return;
    }
    setEditingHabitId(null);
    showToast("Habit updated.", "success");
    await loadHabitsAndLogs(userId);
  };

  const archiveHabit = async (habitId: string) => {
    if (!userId) {
      return;
    }
    const { error } = await supabase
      .from("habit_definitions")
      .update({ is_active: false })
      .eq("id", habitId)
      .eq("user_id", userId);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Habit archived.", "success");
    await loadHabitsAndLogs(userId);
  };

  const restoreHabit = async (habitId: string) => {
    if (!userId) {
      return;
    }
    const { error } = await supabase
      .from("habit_definitions")
      .update({ is_active: true })
      .eq("id", habitId)
      .eq("user_id", userId);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Habit restored.", "success");
    await loadHabitsAndLogs(userId);
  };

  const pauseHabit = async (habitId: string) => {
    if (!userId) {
      return;
    }
    const { error } = await supabase
      .from("habit_definitions")
      .update({ is_active: false })
      .eq("id", habitId)
      .eq("user_id", userId);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Habit paused.", "success");
    await loadHabitsAndLogs(userId);
  };

  const confirmArchiveHabit = async () => {
    if (!deleteConfirmHabit) {
      return;
    }
    await archiveHabit(deleteConfirmHabit.id);
    setDeleteConfirmHabit(null);
  };

  const applyTemplatePack = async (pack: "ibadah" | "workout") => {
    if (!userId) {
      showToast("Please sign in first.", "error");
      return;
    }
    const ibadahTemplates = [
      { name: "Fajr", target_value: 1, unit: "time", category: "ibadah" },
      { name: "Dhuhr", target_value: 1, unit: "time", category: "ibadah" },
      { name: "Asr", target_value: 1, unit: "time", category: "ibadah" },
      { name: "Maghrib", target_value: 1, unit: "time", category: "ibadah" },
      { name: "Isha", target_value: 1, unit: "time", category: "ibadah" },
      { name: "Quran", target_value: 2, unit: "pages", category: "ibadah" },
      { name: "Dzikir", target_value: 100, unit: "count", category: "ibadah" },
    ] as const;
    const workoutTemplates = [
      { name: "Push Ups", target_value: 100, unit: "reps", category: "workout" },
      { name: "Sit Ups", target_value: 50, unit: "reps", category: "workout" },
      { name: "Run", target_value: 20, unit: "minutes", category: "workout" },
    ] as const;
    const source = pack === "ibadah" ? ibadahTemplates : workoutTemplates;
    const rows = source.map((item) => ({
      user_id: userId,
      name: item.name,
      category: item.category,
      target_type: "count",
      target_value: item.target_value,
      unit: item.unit,
      recurrence_period: "daily",
      weekly_goal_type: "sum",
    }));
    const { error } = await supabase.from("habit_definitions").insert(rows);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast(
      `${pack === "ibadah" ? "Ibadah" : "Workout"} template pack added.`,
      "success"
    );
    await loadHabitsAndLogs(userId);
  };

  const addCategory = async () => {
    if (!userId) {
      showToast("Please sign in first.", "error");
      return;
    }
    const normalized = normalizeCategoryName(newCategoryDraft);
    if (!normalized) {
      showToast("Category name is required.", "error");
      return;
    }
    if (categoryOptions.includes(normalized)) {
      showToast("Category already exists.", "error");
      return;
    }
    const { error } = await supabase.from("habit_categories").insert({
      user_id: userId,
      name: normalized,
    });
    if (error) {
      if (error.code === "42P01") {
        showToast("Run sql/add-habit-categories.sql first.", "error");
        return;
      }
      showToast(error.message, "error");
      return;
    }
    setNewCategoryDraft("");
    showToast("Category added.", "success");
    await loadHabitsAndLogs(userId);
  };

  const saveCategoryEdit = async () => {
    if (!userId || !editingCategoryName) {
      return;
    }
    const nextName = normalizeCategoryName(editingCategoryDraft);
    if (!nextName) {
      showToast("Category name is required.", "error");
      return;
    }
    if (
      nextName !== editingCategoryName &&
      categoryOptions.some((name) => name === nextName)
    ) {
      showToast("Category already exists.", "error");
      return;
    }
    const { error: categoryError } = await supabase
      .from("habit_categories")
      .update({ name: nextName })
      .eq("user_id", userId)
      .eq("name", editingCategoryName);
    if (categoryError) {
      if (categoryError.code === "42P01") {
        showToast("Run sql/add-habit-categories.sql first.", "error");
        return;
      }
      showToast(categoryError.message, "error");
      return;
    }
    const { error: habitError } = await supabase
      .from("habit_definitions")
      .update({ category: nextName })
      .eq("user_id", userId)
      .eq("category", editingCategoryName);
    if (habitError) {
      showToast(`Category renamed, but habit sync failed: ${habitError.message}`, "error");
    } else {
      showToast("Category updated.", "success");
    }
    setEditingCategoryName(null);
    setEditingCategoryDraft("");
    await loadHabitsAndLogs(userId);
  };

  const deleteCategory = async (name: string) => {
    if (!userId) {
      return;
    }
    if (categoryOptions.length <= 1) {
      showToast("Keep at least one category.", "error");
      return;
    }
    const inUse = [...habits, ...archivedHabits].some((habit) => habit.category === name);
    if (inUse) {
      showToast("This category is used by habits. Reassign habits first.", "error");
      return;
    }
    const { error } = await supabase
      .from("habit_categories")
      .delete()
      .eq("user_id", userId)
      .eq("name", name);
    if (error) {
      if (error.code === "42P01") {
        showToast("Run sql/add-habit-categories.sql first.", "error");
        return;
      }
      showToast(error.message, "error");
      return;
    }
    showToast("Category deleted.", "success");
    await loadHabitsAndLogs(userId);
  };

  const togglePinnedHabit = (habitId: string) => {
    if (!userId || typeof window === "undefined") {
      return;
    }
    setPinnedHabitIds((prev) => {
      const next = prev.includes(habitId)
        ? prev.filter((id) => id !== habitId)
        : [...prev, habitId];
      window.localStorage.setItem(`tracker_pinned_habits_${userId}`, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    if (!autosaveEnabled || !userId || autosaveInFlight.current) {
      return;
    }
    const dirtyIds = Object.keys(dirtyHabits);
    if (dirtyIds.length === 0) {
      return;
    }
    const timer = setTimeout(async () => {
      autosaveInFlight.current = true;
      for (const habitId of dirtyIds) {
        const habit = habits.find((h) => h.id === habitId);
        if (habit) {
          await saveProgress(habit, true);
        }
      }
      autosaveInFlight.current = false;
      setToast((prev) => {
        if (prev?.variant === "info" && prev.text === "Autosaved.") {
          return prev;
        }
        return { text: "Autosaved.", variant: "info" };
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [autosaveEnabled, dirtyHabits, habits, saveProgress, userId]);

  const inputClass =
    "theme-input rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200";
  const panelClass =
    "theme-card rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl md:p-8";
  const buttonPrimaryClass =
    "theme-btn-primary rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
  const buttonSecondaryClass =
    "theme-btn-secondary rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100";
  const buttonGhostClass =
    "theme-btn-ghost rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100";
  const buttonDangerClass =
    "theme-btn-danger rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100";

  return (
    <main
      className={`mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-14 max-md:px-5 max-md:pt-6 ${
        userId ? "max-md:pb-[calc(14.5rem+env(safe-area-inset-bottom,0px))]" : ""
      }`}
    >
      <section
        ref={marketingHeroSectionRef}
        id="home-intro"
        className={`theme-card rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl max-md:mb-6 md:mb-12 md:p-8 ${
          userId && !marketingHeroOpen ? "hidden" : ""
        }`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Your progress
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
            Personal Development{" "}
            <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">
              Tracker
            </span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500">
            Track workout, ibadah, and personal goals in one place with a unified dashboard style.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Monthly dashboard
            </Link>
            <button
              type="button"
              className={buttonSecondaryClass}
              onClick={toggleTheme}
            >
              Theme: {themeMode === "light" ? "Light" : "Navy"}
            </button>
            {userId && (
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={signOut}
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </section>

      {!userId && (
        <section className="theme-card mb-8 rounded-3xl border border-white/15 bg-white/95 p-6 text-slate-900 shadow-xl md:p-8">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Magic link to your inbox — no password to remember.
          </p>
          <form
            className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-stretch"
            onSubmit={sendMagicLink}
          >
            <input
              type="email"
              className={`min-w-0 flex-1 ${inputClass}`}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button
              type="submit"
              className={`shrink-0 ${buttonPrimaryClass}`}
              disabled={loading}
            >
              {loading ? "Sending…" : "Send link"}
            </button>
          </form>
        </section>
      )}

      {userId && (
        <>
          {habits.length > 0 && !marketingHeroOpen && (
            <div className="theme-card mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-md md:mb-10">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Personal Development Tracker
                </p>
                <p className="text-sm font-medium text-slate-800">
                  Today view — open intro anytime for dashboard link and theme.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => setMarketingHeroOpen(true)}
                >
                  Show intro
                </button>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                >
                  Dashboard
                </Link>
                <button type="button" className={buttonSecondaryClass} onClick={toggleTheme}>
                  Theme: {themeMode === "light" ? "Light" : "Navy"}
                </button>
                <button type="button" className={buttonSecondaryClass} onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            </div>
          )}

          <nav
            aria-label="Jump to section"
            className="theme-card sticky top-2 z-30 mb-6 flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white/90 px-2 py-2 shadow-md backdrop-blur md:mb-10 md:justify-between md:px-3"
          >
            <span className="hidden pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:inline">
              Jump
            </span>
            <div className="flex flex-wrap justify-center gap-1.5 md:justify-end">
              <button
                type="button"
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 md:px-4 md:text-sm"
                onClick={() => scrollToHomeSection(progressSectionRef.current)}
              >
                Progress
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 md:px-4 md:text-sm"
                onClick={() => scrollToHomeSection(newHabitSectionRef.current)}
              >
                Add habit
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 md:px-4 md:text-sm"
                onClick={() => scrollToHomeSection(trackerSectionRef.current)}
              >
                Tracker
              </button>
              <button
                type="button"
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 md:px-4 md:text-sm"
                onClick={() => {
                  if (userId && !marketingHeroOpen) {
                    setMarketingHeroOpen(true);
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        marketingHeroSectionRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      });
                    });
                    return;
                  }
                  scrollToHomeSection(marketingHeroSectionRef.current);
                }}
              >
                Intro
              </button>
            </div>
          </nav>

          <div
            ref={progressSectionRef}
            id="home-progress"
            className="scroll-mt-28 space-y-6 md:space-y-12"
          >
          <section className="theme-card mb-0 rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-500 to-violet-500 p-6 text-white shadow-xl max-md:border-sky-200/40 max-md:from-sky-400 max-md:to-cyan-500 max-md:shadow-[0_18px_44px_-18px_rgba(14,165,233,0.38)] md:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">This goal window</h2>
                <p
                  className="mt-1 text-sm text-indigo-100"
                  title="Daily habits use today’s progress. Weekly, monthly, and yearly habits use totals for the current calendar week, month, or year."
                >
                  {summary.met} of {summary.total} habits meeting their target
                  (daily = today; week / month / year = total so far in that window)
                </p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold tabular-nums text-white">
                  {summary.percent}
                </span>
                <span className="text-sm font-medium text-indigo-100">%</span>
              </div>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-500 ease-out"
                style={{ width: `${summary.percent}%` }}
              />
            </div>
          </section>

          <section className="theme-card mb-0 rounded-3xl border border-white/15 bg-white/95 p-5 text-slate-900 shadow-xl max-md:border-teal-100/45 max-md:bg-white/92 md:p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Today scorecard
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="theme-subcard rounded-xl bg-slate-50 p-3 max-md:border-emerald-100/70 max-md:bg-emerald-50/55">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Completed</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{todayScorecard.completed}</p>
              </div>
              <div className="theme-subcard rounded-xl bg-slate-50 p-3 max-md:border-sky-100/70 max-md:bg-sky-50/55">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Remaining</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{todayScorecard.remaining}</p>
              </div>
              <div className="theme-subcard rounded-xl bg-slate-50 p-3 max-md:border-violet-100/70 max-md:bg-violet-50/50">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Next action</p>
                <p className="mt-1 text-sm font-semibold text-indigo-600">
                  {todayScorecard.nextHabit ? `Log ${todayScorecard.nextHabit.name}` : "All done!"}
                </p>
              </div>
            </div>
          </section>
          </div>

          <div
            className="my-8 hidden h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent md:my-12 md:block"
            aria-hidden
          />

          <section
            ref={newHabitSectionRef}
            id="home-new-habit"
            className={`scroll-mt-28 mb-8 md:mb-12 ${panelClass}`}
          >
            <h2 className="text-lg font-semibold">New habit</h2>
            <p className="mt-1 text-sm text-slate-500">
              Mix workouts, ibadah, and anything personal.
            </p>
            <div className="mt-4">
              <button
                type="button"
                className={buttonPrimaryClass}
                onClick={() =>
                  setShowNewHabitForm((prev) => {
                    const next = !prev;
                    if (!next) {
                      setShowCategoryManager(false);
                    }
                    return next;
                  })
                }
              >
                {showNewHabitForm ? "Hide habit form" : "Add new habit"}
              </button>
            </div>
            {showNewHabitForm && (
              <form
                className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
                onSubmit={addHabit}
              >
              <div className="sm:col-span-2 lg:col-span-4">
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  aria-expanded={showCategoryManager}
                  onClick={() => setShowCategoryManager((v) => !v)}
                >
                  {showCategoryManager ? "Hide" : "Manage"} categories
                </button>
              </div>
              {showCategoryManager && (
                <div className="theme-subcard rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2 lg:col-span-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Manage categories
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      className={`w-full ${inputClass}`}
                      placeholder="Add new category"
                      value={newCategoryDraft}
                      onChange={(e) => setNewCategoryDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className={buttonGhostClass}
                      onClick={() => void addCategory()}
                    >
                      Add category
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categoryOptions.map((option) => (
                      <div
                        key={option}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1"
                      >
                        {editingCategoryName === option ? (
                          <>
                            <input
                              className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                              value={editingCategoryDraft}
                              onChange={(e) => setEditingCategoryDraft(e.target.value)}
                            />
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-emerald-700"
                              onClick={() => void saveCategoryEdit()}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-slate-500"
                              onClick={() => {
                                setEditingCategoryName(null);
                                setEditingCategoryDraft("");
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-slate-700">{option}</span>
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-indigo-600"
                              onClick={() => {
                                setEditingCategoryName(option);
                                setEditingCategoryDraft(option);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-red-600"
                              onClick={() => void deleteCategory(option)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
                <button
                  type="button"
                  className={buttonGhostClass}
                  onClick={() => void applyTemplatePack("ibadah")}
                >
                  + Ibadah templates
                </button>
                <button
                  type="button"
                  className={buttonGhostClass}
                  onClick={() => void applyTemplatePack("workout")}
                >
                  + Workout templates
                </button>
              </div>
              <label className="sm:col-span-2 lg:col-span-2">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Habit name
                </span>
                <input
                  className={`w-full ${inputClass}`}
                  placeholder="e.g. Push Ups"
                  value={newHabit.name}
                  onChange={(e) => setNewHabit((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <label className="sm:col-span-2 lg:col-span-2">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Category
                </span>
                <select
                  className={`w-full ${inputClass} cursor-pointer`}
                  value={newHabit.category}
                  onChange={(e) =>
                    setNewHabit((prev) => ({
                      ...prev,
                      category: e.target.value,
                    }))
                  }
                >
                  {categoryOptions.map((option) => (
                    <option key={option} value={option} className="bg-navy-900">
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-4">
                <label>
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Target number
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`w-full ${inputClass}`}
                    placeholder="e.g. 50"
                    value={newHabit.target_value}
                    onChange={(e) =>
                      setNewHabit((prev) => ({
                        ...prev,
                        target_value: Number(e.target.value),
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                    Unit
                  </span>
                  <input
                    className={`w-full ${inputClass}`}
                    placeholder="e.g. reps / pages / minutes"
                    value={newHabit.unit}
                    onChange={(e) => setNewHabit((prev) => ({ ...prev, unit: e.target.value }))}
                  />
                </label>
              </div>
              <label className="theme-subcard flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:col-span-2 lg:col-span-4">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 bg-white accent-indigo-600 focus:ring-indigo-200"
                  checked={repeatSchedule}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setRepeatSchedule(on);
                    if (on) {
                      setNewHabit((prev) => ({
                        ...prev,
                        recurrence_period:
                          prev.recurrence_period === "daily"
                            ? "weekly"
                            : prev.recurrence_period,
                      }));
                    }
                  }}
                />
                <span className="text-sm font-medium text-slate-700">Repeat</span>
                <span className="text-xs text-slate-500">
                  Weekly, monthly, or yearly target (off = every day)
                </span>
              </label>
              {repeatSchedule && (
                <>
                  <label className="sm:col-span-2 lg:col-span-2">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-400">
                      Recurrence
                    </span>
                    <select
                      className={`w-full ${inputClass} cursor-pointer`}
                      value={
                        repeatRecurrenceOptions.includes(
                          newHabit.recurrence_period as (typeof repeatRecurrenceOptions)[number]
                        )
                          ? newHabit.recurrence_period
                          : "weekly"
                      }
                      onChange={(e) =>
                        setNewHabit((prev) => ({
                          ...prev,
                          recurrence_period: e.target
                            .value as (typeof repeatRecurrenceOptions)[number],
                        }))
                      }
                    >
                      {repeatRecurrenceOptions.map((option) => (
                        <option key={option} value={option} className="bg-navy-900">
                          {option === "weekly"
                            ? "Every week"
                            : option === "monthly"
                              ? "Every month"
                              : "Every year"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {newHabit.recurrence_period === "weekly" && (
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 sm:col-span-2 lg:col-span-2">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                        Weekly goal mode
                      </p>
                      <div className="grid gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="radio"
                            checked={newHabit.weekly_goal_type === "sum"}
                            onChange={() =>
                              setNewHabit((prev) => ({ ...prev, weekly_goal_type: "sum" }))
                            }
                          />
                          Sum values across week
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="radio"
                            checked={newHabit.weekly_goal_type === "times"}
                            onChange={() =>
                              setNewHabit((prev) => ({ ...prev, weekly_goal_type: "times" }))
                            }
                          />
                          x times per week
                        </label>
                        {newHabit.weekly_goal_type === "times" && (
                          <input
                            type="number"
                            min={1}
                            className={`w-full ${inputClass}`}
                            value={newHabit.weekly_target_count}
                            onChange={(e) =>
                              setNewHabit((prev) => ({
                                ...prev,
                                weekly_target_count: Number(e.target.value),
                              }))
                            }
                          />
                        )}
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="radio"
                            checked={newHabit.weekly_goal_type === "days"}
                            onChange={() =>
                              setNewHabit((prev) => ({ ...prev, weekly_goal_type: "days" }))
                            }
                          />
                          Specific weekdays
                        </label>
                        {newHabit.weekly_goal_type === "days" && (
                          <div className="flex flex-wrap gap-2">
                            {weekdayOptions.map((day) => {
                              const selected = newHabit.weekly_days.includes(day.id);
                              return (
                                <button
                                  key={day.id}
                                  type="button"
                                  className={`rounded-lg border px-2 py-1 text-[11px] ${
                                    selected
                                      ? "border-indigo-300 bg-indigo-500 text-white"
                                      : "border-slate-300 text-slate-600"
                                  }`}
                                  onClick={() =>
                                    setNewHabit((prev) => ({
                                      ...prev,
                                      weekly_days: selected
                                        ? prev.weekly_days.filter((d) => d !== day.id)
                                        : [...prev.weekly_days, day.id].sort(),
                                    }))
                                  }
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <p className="text-xs leading-relaxed text-slate-500 sm:col-span-2 lg:col-span-2">
                    <span className="text-indigo-600">Tip:</span> number values
                    add up across that window (week, month, or year). Use the checklist to mark whether
                    you completed the habit today.
                  </p>
                </>
              )}
                <button
                  type="submit"
                  className={`${buttonPrimaryClass} sm:col-span-2 lg:col-span-4`}
                >
                  Create habit
                </button>
              </form>
            )}
          </section>

          <div
            className="my-8 hidden h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent md:my-12 md:block"
            aria-hidden
          />

          <section
            ref={trackerSectionRef}
            id="home-tracker"
            className={`scroll-mt-28 mb-8 md:mb-12 ${panelClass}`}
            tabIndex={-1}
          >
            <h2 className="text-lg font-semibold">Today&apos;s tracker</h2>
            <p className="mt-1 text-sm text-slate-500">
              Mark completion and enter today&apos;s number. Use autosave or Save all.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={autosaveEnabled}
                  className="accent-gold-500"
                  onChange={(e) => setAutosaveEnabled(e.target.checked)}
                />
                Autosave on change
              </label>
              <button
                type="button"
                onClick={() => void saveAllProgress()}
                disabled={savingAll}
                className={buttonPrimaryClass}
              >
                {savingAll ? "Saving all..." : "Save all"}
              </button>
            </div>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                className={`${buttonSecondaryClass} w-full md:hidden`}
                onClick={() => setMobileFilterOpen(true)}
              >
                Filters ({filteredHabits.length})
              </button>
              <div className="theme-subcard hidden gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid md:grid-cols-4">
                <input
                  className={`${inputClass} md:col-span-2`}
                  placeholder="Search habits..."
                  value={habitSearch}
                  onChange={(e) => setHabitSearch(e.target.value)}
                />
                <select
                  className={`${inputClass} cursor-pointer`}
                  value={habitCategoryFilter}
                  onChange={(e) => setHabitCategoryFilter(e.target.value)}
                >
                  <option value="all">All categories</option>
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select
                  className={`${inputClass} cursor-pointer`}
                  value={habitStatusFilter}
                  onChange={(e) =>
                    setHabitStatusFilter(e.target.value as "all" | "remaining" | "met")
                  }
                >
                  <option value="all">All status</option>
                  <option value="remaining">Need focus</option>
                  <option value="met">Met target</option>
                </select>
                <p className="text-xs text-slate-500 md:col-span-4">
                  Showing {visibleHabits.length} of {filteredHabits.length} habit
                  {filteredHabits.length === 1 ? "" : "s"}.
                </p>
              </div>

              {habitsInitialLoading && (
                <div className="theme-subcard space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200" />
                  <div className="h-10 w-full animate-pulse rounded-lg bg-slate-200" />
                </div>
              )}

              {!habitsInitialLoading &&
                visibleHabits.map((habit) => {
                const isPinned = pinnedHabitIds.includes(habit.id);
                const rowLog = todayByHabit[habit.id] ?? {
                  habit_id: habit.id,
                  value: 0,
                  completed: false,
                };
                const periodRows = periodRowsByHabit[habit.id] ?? [];
                const met = habitPeriodMet(habit, periodRows);
                const period = normalizeRecurrencePeriod(habit.recurrence_period);
                const progress = habitPeriodProgress(habit, periodRows);
                const isDaily = period === "daily";
                return (
                  <div
                    key={habit.id}
                    className="theme-subcard grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-12 md:items-center md:gap-4 md:p-5"
                  >
                    <div className="relative md:col-span-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${met ? "bg-gold-400 shadow-[0_0_8px_rgba(240,201,82,0.7)]" : "bg-zinc-600"}`}
                        />
                        <p className="font-medium text-slate-900">{habit.name}</p>
                        {isPinned && (
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            Pinned
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        <span className="text-indigo-600">{habit.category}</span>
                        {" · "}
                        {recurrenceShortLabel(period)} · target {habit.target_value}{" "}
                        {habit.unit ?? "unit"}
                      </p>
                      <div className="mt-2" data-habit-action-menu>
                        <button
                          type="button"
                          ref={(el) => {
                            actionsButtonRefs.current[habit.id] = el;
                          }}
                          className="min-h-10 rounded-lg border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-700"
                          onClick={() =>
                            setOpenActionMenuHabitId((prev) =>
                              prev === habit.id ? null : habit.id
                            )
                          }
                          aria-expanded={openActionMenuHabitId === habit.id}
                          aria-haspopup="menu"
                        >
                          Actions
                        </button>
                        {openActionMenuHabitId === habit.id && (
                          <div
                            className="theme-card absolute left-0 top-full z-20 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
                            role="menu"
                          >
                            <button
                              type="button"
                              className="w-full rounded-lg px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                              onClick={() => {
                                togglePinnedHabit(habit.id);
                                setOpenActionMenuHabitId(null);
                              }}
                            >
                              {isPinned ? "Unpin habit" : "Pin habit"}
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-lg px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                              onClick={() => {
                                startEditHabit(habit);
                                setOpenActionMenuHabitId(null);
                              }}
                            >
                              Edit habit
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-lg px-2 py-2 text-left text-xs text-amber-700 hover:bg-amber-50"
                              onClick={() => {
                                void pauseHabit(habit.id);
                                setOpenActionMenuHabitId(null);
                              }}
                            >
                              Pause habit
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-lg px-2 py-2 text-left text-xs text-red-700 hover:bg-red-50"
                              onClick={() => {
                                returnFocusAfterDeleteRef.current =
                                  actionsButtonRefs.current[habit.id] ?? null;
                                setDeleteConfirmHabit(habit);
                                setOpenActionMenuHabitId(null);
                              }}
                            >
                              Delete habit
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-3 md:col-span-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 bg-white accent-indigo-600 focus:ring-indigo-200"
                        checked={rowLog.completed}
                        onChange={(e) => {
                          const prev = {
                            completed: rowLog.completed,
                            value: rowLog.value,
                          };
                          const nextChecked = e.target.checked;
                          patchTodayRow(habit.id, {
                            completed: nextChecked,
                            value: nextChecked ? habit.target_value : 0,
                          });
                          showToast(
                            nextChecked
                              ? `${habit.name}: marked done for today.`
                              : `${habit.name}: unchecked for today.`,
                            "success",
                            () =>
                              patchTodayRow(habit.id, {
                                completed: prev.completed,
                                value: prev.value,
                              })
                          );
                        }}
                      />
                      <span className="text-sm text-slate-700">Done today</span>
                    </label>
                    <div className="md:col-span-3">
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                        Today&apos;s value
                      </p>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={`w-full ${inputClass}`}
                        value={rowLog.value}
                        onChange={(e) =>
                          patchTodayRow(habit.id, {
                            value: Number(e.target.value),
                          })
                        }
                      />
                      <div className="mt-2 flex gap-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={`w-full ${inputClass}`}
                          placeholder="+ Add progress"
                          value={incrementDrafts[habit.id] ?? ""}
                          onChange={(e) =>
                            setIncrementDrafts((prev) => ({
                              ...prev,
                              [habit.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className={buttonGhostClass}
                          onClick={() => addProgress(habit)}
                        >
                          + Add
                        </button>
                      </div>
                    </div>
                    <div className="text-xs md:col-span-2">
                      <span className="text-slate-500">Status </span>
                      <span
                        className={
                          met ? "font-medium text-indigo-600" : "text-slate-500"
                        }
                      >
                        {isDaily
                          ? rowLog.completed
                            ? "Checked done"
                            : rowLog.value >= habit.target_value
                              ? "Target hit (not checked)"
                              : "Not yet"
                          : met
                            ? `Met ${recurrenceShortLabel(period)} target`
                            : `${progress.current} / ${progress.target} ${progress.label}`}
                      </span>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {saveStateByHabit[habit.id] === "saving"
                          ? "Saving..."
                          : saveStateByHabit[habit.id] === "dirty"
                            ? "Draft (unsaved changes)"
                            : saveStateByHabit[habit.id] === "error"
                              ? "Save failed"
                              : lastSavedAtByHabit[habit.id]
                                ? `Last saved ${lastSavedAtByHabit[habit.id]}`
                                : "Not saved yet"}
                      </p>
                    </div>
                    {editingHabitId === habit.id && (
                      <div className="theme-card rounded-xl border border-slate-200 bg-white p-3 md:col-span-12">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Edit habit
                        </p>
                        <div className="grid gap-2 md:grid-cols-4">
                          <input
                            className={inputClass}
                            value={editHabitDraft.name}
                            onChange={(e) =>
                              setEditHabitDraft((prev) => ({ ...prev, name: e.target.value }))
                            }
                            placeholder="Name"
                          />
                          <select
                            className={`${inputClass} cursor-pointer`}
                            value={editHabitDraft.category}
                            onChange={(e) =>
                              setEditHabitDraft((prev) => ({
                                ...prev,
                                category: e.target.value,
                              }))
                            }
                          >
                            {categoryOptions.map((option) => (
                              <option key={option} value={option} className="bg-navy-900">
                                {option}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={inputClass}
                            value={editHabitDraft.target_value}
                            onChange={(e) =>
                              setEditHabitDraft((prev) => ({
                                ...prev,
                                target_value: Number(e.target.value),
                              }))
                            }
                          />
                          <input
                            className={inputClass}
                            value={editHabitDraft.unit}
                            onChange={(e) =>
                              setEditHabitDraft((prev) => ({ ...prev, unit: e.target.value }))
                            }
                            placeholder="Unit"
                          />
                          <select
                            className={`${inputClass} cursor-pointer`}
                            value={editHabitDraft.recurrence_period}
                            onChange={(e) =>
                              setEditHabitDraft((prev) => ({
                                ...prev,
                                recurrence_period: e.target.value as RecurrencePeriod,
                              }))
                            }
                          >
                            {recurrenceOptions.map((option) => (
                              <option key={option} value={option} className="bg-navy-900">
                                {option === "daily"
                                  ? "Every day"
                                  : option === "weekly"
                                    ? "Every week"
                                    : option === "monthly"
                                      ? "Every month"
                                      : "Every year"}
                              </option>
                            ))}
                          </select>
                          {editHabitDraft.recurrence_period === "weekly" && (
                            <div className="theme-subcard md:col-span-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                              <div className="grid gap-2">
                                <label className="flex items-center gap-2 text-xs text-slate-700">
                                  <input
                                    type="radio"
                                    checked={editHabitDraft.weekly_goal_type === "sum"}
                                    onChange={() =>
                                      setEditHabitDraft((prev) => ({
                                        ...prev,
                                        weekly_goal_type: "sum",
                                      }))
                                    }
                                  />
                                  Sum values across week
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-700">
                                  <input
                                    type="radio"
                                    checked={editHabitDraft.weekly_goal_type === "times"}
                                    onChange={() =>
                                      setEditHabitDraft((prev) => ({
                                        ...prev,
                                        weekly_goal_type: "times",
                                      }))
                                    }
                                  />
                                  x times per week
                                </label>
                                {editHabitDraft.weekly_goal_type === "times" && (
                                  <input
                                    type="number"
                                    min={1}
                                    className={inputClass}
                                    value={editHabitDraft.weekly_target_count}
                                    onChange={(e) =>
                                      setEditHabitDraft((prev) => ({
                                        ...prev,
                                        weekly_target_count: Number(e.target.value),
                                      }))
                                    }
                                  />
                                )}
                                <label className="flex items-center gap-2 text-xs text-slate-700">
                                  <input
                                    type="radio"
                                    checked={editHabitDraft.weekly_goal_type === "days"}
                                    onChange={() =>
                                      setEditHabitDraft((prev) => ({
                                        ...prev,
                                        weekly_goal_type: "days",
                                      }))
                                    }
                                  />
                                  Specific weekdays
                                </label>
                                {editHabitDraft.weekly_goal_type === "days" && (
                                  <div className="flex flex-wrap gap-2">
                                    {weekdayOptions.map((day) => {
                                      const selected = editHabitDraft.weekly_days.includes(day.id);
                                      return (
                                        <button
                                          key={day.id}
                                          type="button"
                                          className={`rounded-lg border px-2 py-1 text-[11px] ${
                                            selected
                                              ? "border-indigo-300 bg-indigo-500 text-white"
                                              : "border-slate-300 text-slate-600"
                                          }`}
                                          onClick={() =>
                                            setEditHabitDraft((prev) => ({
                                              ...prev,
                                              weekly_days: selected
                                                ? prev.weekly_days.filter((d) => d !== day.id)
                                                : [...prev.weekly_days, day.id].sort(),
                                            }))
                                          }
                                        >
                                          {day.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-navy-950"
                            onClick={() => void saveHabitDetails(habit.id)}
                          >
                            Save changes
                          </button>
                          <button
                            type="button"
                            className={buttonSecondaryClass}
                            onClick={() => setEditingHabitId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {habits.length > 0 && filteredHabits.length === 0 && !habitsInitialLoading && (
                <p className="theme-subcard rounded-xl border border-dashed border-slate-300 bg-slate-50 py-6 text-center text-sm text-slate-500">
                  No habits match your current filters.
                </p>
              )}
              {hasMoreHabits && !habitsInitialLoading && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    className={buttonSecondaryClass}
                    onClick={() => setVisibleHabitCount((prev) => prev + 8)}
                  >
                    Show more habits
                  </button>
                </div>
              )}
              {habits.length === 0 && !habitsInitialLoading && (
                <div className="theme-subcard rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  <p className="text-base font-semibold text-slate-700">
                    Welcome! Let&apos;s set up your first habit.
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    1) Choose a template or create one manually. 2) Save once. 3) Start
                    logging throughout the day.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      className={buttonGhostClass}
                      onClick={() => void applyTemplatePack("ibadah")}
                    >
                      Start with Ibadah templates
                    </button>
                    <button
                      type="button"
                      className={buttonGhostClass}
                      onClick={() => void applyTemplatePack("workout")}
                    >
                      Start with Workout templates
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
          {archivedHabits.length > 0 && (
            <section className={`mt-8 ${panelClass}`}>
              <h2 className="text-lg font-semibold text-slate-900">Paused / Archived habits</h2>
              <p className="mt-1 text-sm text-slate-500">
                Restore habits to bring them back to your active tracker.
              </p>
              <div className="mt-4 space-y-2">
                {archivedHabits.map((habit) => (
                  <div
                    key={habit.id}
                    className="theme-subcard flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{habit.name}</p>
                      <p className="text-xs text-slate-500">
                        {habit.category} · target {habit.target_value} {habit.unit ?? "unit"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-emerald-600/60 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      onClick={() => void restoreHabit(habit.id)}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {toast && (
        <div
          className="fixed right-4 z-50 max-w-[min(100vw-2rem,22rem)] max-md:bottom-[calc(14.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6"
          role="status"
          aria-live="polite"
        >
          <div
            className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-xl sm:flex-row sm:items-start sm:gap-3 ${
              toast.variant === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : toast.variant === "info"
                  ? "border-slate-200 bg-slate-50 text-slate-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <p className="min-w-0 flex-1 leading-snug">{toast.text}</p>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:justify-start">
              {toast.onUndo ? (
                <button
                  type="button"
                  className="rounded-lg border border-current/25 bg-white/70 px-2.5 py-1 text-xs font-semibold text-inherit shadow-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  onClick={() => {
                    toast.onUndo?.();
                    setToast(null);
                  }}
                >
                  Undo
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-current/20 px-2 py-1 text-xs font-semibold opacity-80 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                aria-label="Dismiss notification"
                onClick={() => setToast(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmHabit && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-habit-dialog-title"
        >
          <div
            ref={deleteDialogPanelRef}
            className="theme-card w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-2xl"
          >
            <h3 id="delete-habit-dialog-title" className="text-lg font-semibold text-slate-900">
              Delete habit?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will archive <span className="font-semibold">{deleteConfirmHabit.name}</span>.
              You can keep old logs, but the habit will disappear from active tracker.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={deleteDialogCancelRef}
                type="button"
                className={buttonSecondaryClass}
                onClick={() => setDeleteConfirmHabit(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonDangerClass}
                onClick={() => void confirmArchiveHabit()}
              >
                Confirm delete
              </button>
            </div>
          </div>
        </div>
      )}
      {mobileFilterOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 p-4 md:hidden"
          onClick={() => setMobileFilterOpen(false)}
        >
          <div
            className="theme-card drawer-slide-up mx-auto mt-16 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => setMobileFilterTouchStartY(e.changedTouches[0]?.clientY ?? null)}
            onTouchEnd={(e) => {
              if (mobileFilterTouchStartY == null) {
                return;
              }
              const endY = e.changedTouches[0]?.clientY ?? mobileFilterTouchStartY;
              const deltaY = endY - mobileFilterTouchStartY;
              setMobileFilterTouchStartY(null);
              if (deltaY > 60) {
                setMobileFilterOpen(false);
              }
            }}
          >
            <div className="mb-2 flex justify-center">
              <span className="h-1.5 w-10 rounded-full bg-slate-300" />
            </div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Filter habits</h3>
              <button
                type="button"
                className={buttonSecondaryClass}
                onClick={() => setMobileFilterOpen(false)}
              >
                Done
              </button>
            </div>
            <div className="space-y-2">
              <input
                className={inputClass}
                placeholder="Search habits..."
                value={habitSearch}
                onChange={(e) => setHabitSearch(e.target.value)}
              />
              <select
                className={`${inputClass} cursor-pointer`}
                value={habitCategoryFilter}
                onChange={(e) => setHabitCategoryFilter(e.target.value)}
              >
                <option value="all">All categories</option>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className={`${inputClass} cursor-pointer`}
                value={habitStatusFilter}
                onChange={(e) =>
                  setHabitStatusFilter(e.target.value as "all" | "remaining" | "met")
                }
              >
                <option value="all">All status</option>
                <option value="remaining">Need focus</option>
                <option value="met">Met target</option>
              </select>
              <p className="text-xs text-slate-500">
                Showing {visibleHabits.length} of {filteredHabits.length} habits.
              </p>
            </div>
          </div>
        </div>
      )}
      {userId && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center max-md:px-4 md:hidden"
          style={{
            paddingBottom: "max(0.65rem, env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div
            className={`pointer-events-auto w-full max-w-md rounded-[1.75rem] border p-3 backdrop-blur-xl ${
              themeMode === "navy"
                ? "border-amber-200/20 bg-[rgba(10,22,40,0.88)] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.65)]"
                : "border-sky-100/80 bg-white/80 shadow-[0_22px_50px_-20px_rgba(59,130,246,0.28),0_12px_32px_-20px_rgba(15,23,42,0.12)]"
            }`}
          >
            <p
              className={`mb-2 text-center text-[10px] font-bold uppercase tracking-[0.18em] ${syncStatusClass}`}
            >
              {syncStatusText}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={`min-h-12 min-w-0 flex-1 rounded-2xl px-3 py-2.5 text-sm font-semibold shadow-md transition hover:brightness-105 active:scale-[0.98] ${
                  themeMode === "navy"
                    ? "bg-gradient-to-r from-amber-500 to-amber-400 text-navy-950"
                    : "bg-gradient-to-r from-sky-500 to-indigo-500 text-white"
                }`}
                onClick={() => void saveAllProgress()}
              >
                Save all
              </button>
              <button
                type="button"
                className={`min-h-12 min-w-0 flex-1 rounded-2xl border px-3 py-2.5 text-sm font-semibold shadow-sm transition ${
                  themeMode === "navy"
                    ? "border-amber-200/35 bg-navy-800/90 text-amber-100 hover:bg-navy-800"
                    : "border-sky-200/90 bg-white/95 text-slate-700 hover:bg-white"
                }`}
                onClick={() => {
                  setShowNewHabitForm(true);
                  queueMicrotask(() => {
                    newHabitSectionRef.current?.scrollIntoView({ behavior: "smooth" });
                  });
                }}
              >
                New habit
              </button>
            </div>
            <div
              className={`mt-2.5 flex rounded-full p-1 ring-1 ${
                themeMode === "navy"
                  ? "bg-navy-800/80 ring-amber-200/20"
                  : "bg-sky-100/80 ring-sky-200/50"
              }`}
            >
              <button
                type="button"
                className={`min-h-10 min-w-0 flex-1 rounded-full px-2 py-2 text-xs font-semibold shadow-sm ${
                  themeMode === "navy"
                    ? "bg-navy-950 text-amber-200"
                    : "bg-white text-indigo-700"
                }`}
                onClick={() =>
                  trackerSectionRef.current?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Tracker
              </button>
              <Link
                href="/dashboard"
                className={`flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-full px-2 py-2 text-center text-xs font-semibold transition ${
                  themeMode === "navy"
                    ? "text-slate-400 hover:bg-navy-950/60"
                    : "text-slate-600 hover:bg-white/70"
                }`}
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard?tab=history"
                className={`flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-full px-2 py-2 text-center text-xs font-semibold transition ${
                  themeMode === "navy"
                    ? "text-slate-400 hover:bg-navy-950/60"
                    : "text-slate-600 hover:bg-white/70"
                }`}
              >
                History
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
