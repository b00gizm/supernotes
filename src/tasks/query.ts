import { formatDailyTitle, parseDailyTitle } from "../notes/format";
import type { Task, TaskListFilter, TaskPriority } from "./types";

/** Priority rank for Upcoming sort (lower = higher priority). */
export function priorityRank(
  priority: TaskPriority | null | undefined,
): number {
  switch (priority) {
    case "urgent":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    case "none":
      return 4;
    default:
      return 5;
  }
}

/** Overdue = due date before today and not Done/Cancelled. */
export function isTaskOverdue(task: Task, today: string): boolean {
  if (task.state === "done" || task.state === "cancelled") {
    return false;
  }
  if (!task.due_date) {
    return false;
  }
  return task.due_date < today;
}

function completeCutoff(today: string): string {
  // ponytail: completed_at is UTC ISO; window uses the UTC calendar prefix
  // against local `today`. Upgrade: convert to local date first.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) {
    return today;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  date.setDate(date.getDate() - 14);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

function parseYmd(ymd: string): Date | null {
  return parseDailyTitle(ymd);
}

function addDays(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  if (!date) {
    return ymd;
  }
  date.setDate(date.getDate() + days);
  return formatDailyTitle(date);
}

/** Monday of the calendar week containing `ymd` (local). */
function startOfWeekMonday(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) {
    return ymd;
  }
  const day = date.getDay(); // 0 Sun … 6 Sat
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return formatDailyTitle(date);
}

function formatShortDay(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) {
    return ymd;
  }
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}, ${month} ${String(date.getDate())}`;
}

function formatMonthDay(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) {
    return ymd;
  }
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${String(date.getDate())}`;
}

function formatWeekdayMonthDay(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) {
    return ymd;
  }
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${month} ${String(date.getDate())}`;
}

function formatWeekRange(start: string, end: string): string {
  const startDate = parseYmd(start);
  const endDate = parseYmd(end);
  if (!startDate || !endDate) {
    return `${start} – ${end}`;
  }
  if (startDate.getMonth() === endDate.getMonth()) {
    return `${formatMonthDay(start)} – ${String(endDate.getDate())}`;
  }
  return `${formatMonthDay(start)} – ${formatMonthDay(end)}`;
}

export type UpcomingGroupTone = "overdue" | "today" | "default";

export type UpcomingGroup = {
  id: string;
  label: string;
  tone: UpcomingGroupTone;
  /** Show count after label (Overdue). */
  showCount: boolean;
  tasks: Task[];
};

/**
 * Group Upcoming tasks per design mockup:
 * Overdue → Today → Tomorrow → rest of this week (per day) → Next week → later weeks.
 */
export function groupUpcomingTasks(
  tasks: Task[],
  today: string,
): UpcomingGroup[] {
  const tomorrow = addDays(today, 1);
  const thisWeekStart = startOfWeekMonday(today);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);

  const overdue: Task[] = [];
  const byDue = new Map<string, Task[]>();

  for (const task of tasks) {
    const due = task.due_date;
    if (!due) {
      continue;
    }
    if (due < today) {
      overdue.push(task);
      continue;
    }
    const bucket = byDue.get(due) ?? [];
    bucket.push(task);
    byDue.set(due, bucket);
  }

  const groups: UpcomingGroup[] = [];

  if (overdue.length > 0) {
    groups.push({
      id: "overdue",
      label: "Overdue",
      tone: "overdue",
      showCount: true,
      tasks: overdue,
    });
  }

  const todayTasks = byDue.get(today);
  if (todayTasks?.length) {
    groups.push({
      id: `day-${today}`,
      label: `Today ${formatShortDay(today)}`,
      tone: "today",
      showCount: false,
      tasks: todayTasks,
    });
    byDue.delete(today);
  }

  const tomorrowTasks = byDue.get(tomorrow);
  if (tomorrowTasks?.length) {
    groups.push({
      id: `day-${tomorrow}`,
      label: `Tomorrow ${formatShortDay(tomorrow)}`,
      tone: "default",
      showCount: false,
      tasks: tomorrowTasks,
    });
    byDue.delete(tomorrow);
  }

  // Remaining days in the current week (after tomorrow), each as its own section.
  for (
    let cursor = addDays(tomorrow, 1);
    cursor <= thisWeekEnd;
    cursor = addDays(cursor, 1)
  ) {
    const dayTasks = byDue.get(cursor);
    if (!dayTasks?.length) {
      continue;
    }
    groups.push({
      id: `day-${cursor}`,
      label: formatWeekdayMonthDay(cursor),
      tone: "default",
      showCount: false,
      tasks: dayTasks,
    });
    byDue.delete(cursor);
  }

  // Next week as a single ranged group.
  const nextWeekTasks: Task[] = [];
  for (
    let cursor = nextWeekStart;
    cursor <= nextWeekEnd;
    cursor = addDays(cursor, 1)
  ) {
    const dayTasks = byDue.get(cursor);
    if (dayTasks?.length) {
      nextWeekTasks.push(...dayTasks);
      byDue.delete(cursor);
    }
  }
  if (nextWeekTasks.length > 0) {
    groups.push({
      id: `week-${nextWeekStart}`,
      label: `Next week ${formatWeekRange(nextWeekStart, nextWeekEnd)}`,
      tone: "default",
      showCount: false,
      tasks: nextWeekTasks,
    });
  }

  // Anything later: bucket by week (Mon–Sun).
  const remainingDates = [...byDue.keys()].sort();
  const weekBuckets = new Map<string, Task[]>();
  for (const due of remainingDates) {
    const weekStart = startOfWeekMonday(due);
    const bucket = weekBuckets.get(weekStart) ?? [];
    bucket.push(...(byDue.get(due) ?? []));
    weekBuckets.set(weekStart, bucket);
  }
  for (const weekStart of [...weekBuckets.keys()].sort()) {
    const weekEnd = addDays(weekStart, 6);
    groups.push({
      id: `week-${weekStart}`,
      label: formatWeekRange(weekStart, weekEnd),
      tone: "default",
      showCount: false,
      tasks: weekBuckets.get(weekStart) ?? [],
    });
  }

  return groups;
}

/** Mirror of backend `list_tasks` filters (memory API / unit checks). */
export function filterTasks(
  tasks: Task[],
  filter: TaskListFilter,
  today: string,
): Task[] {
  if (filter === "inbox") {
    return tasks
      .filter((task) => task.state === "open" && task.due_date == null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if (filter === "upcoming") {
    return tasks
      .filter(
        (task) =>
          (task.state === "open" || task.state === "waiting") &&
          task.due_date != null,
      )
      .sort((a, b) => {
        const due = (a.due_date ?? "").localeCompare(b.due_date ?? "");
        if (due !== 0) {
          return due;
        }
        const priority = priorityRank(a.priority) - priorityRank(b.priority);
        if (priority !== 0) {
          return priority;
        }
        return a.created_at.localeCompare(b.created_at);
      });
  }
  const cutoff = completeCutoff(today);
  return tasks
    .filter((task) => {
      if (task.state !== "done" && task.state !== "cancelled") {
        return false;
      }
      if (!task.completed_at) {
        return false;
      }
      return task.completed_at.slice(0, 10) >= cutoff;
    })
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
}
