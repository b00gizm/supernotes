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

/**
 * Daily-note Due query (ENG-64): dated, not Done/Cancelled, due on or before
 * `date`. Live query — resolving a task drops it from every day's section.
 */
export function tasksDueOnOrBefore(tasks: Task[], date: string): Task[] {
  return tasks
    .filter((task) => {
      if (task.state === "done" || task.state === "cancelled") {
        return false;
      }
      if (!task.due_date) {
        return false;
      }
      return task.due_date <= date;
    })
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

/**
 * Calendar all-day chips (ENG-67): dated open/waiting tasks with no time
 * block. Overdue items roll onto `today` (same as daily-note Due); past days
 * stay empty. Scheduled tasks drop off the chip row.
 */
export function allDayChipTasks(
  tasks: Task[],
  day: string,
  today: string,
  scheduledIds: ReadonlySet<string> = new Set(),
): Task[] {
  const unscheduled = tasks.filter((task) => !scheduledIds.has(task.id));
  if (day < today) {
    return [];
  }
  if (day === today) {
    return tasksDueOnOrBefore(unscheduled, today);
  }
  return tasksDueOnOrBefore(unscheduled, day).filter(
    (task) => task.due_date === day,
  );
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

export type UpcomingGroupTone = "overdue" | "today" | "unscheduled" | "default";

export type UpcomingGroup = {
  id: string;
  label: string;
  tone: UpcomingGroupTone;
  /** Show count after label (Overdue, Unscheduled). */
  showCount: boolean;
  tasks: Task[];
};

export type TaskSchedule = {
  start: string;
  end: string;
  day: string;
};

/** Earliest linked calendar slot per task. */
export function schedulesFromEvents(
  events: ReadonlyArray<{
    task_id: string | null;
    start: string;
    end: string;
  }>,
): Map<string, TaskSchedule> {
  const byTask = new Map<string, TaskSchedule>();
  for (const event of events) {
    if (!event.task_id) {
      continue;
    }
    const prev = byTask.get(event.task_id);
    if (prev && prev.start <= event.start) {
      continue;
    }
    byTask.set(event.task_id, {
      start: event.start,
      end: event.end,
      day: formatDailyTitle(new Date(event.start)),
    });
  }
  return byTask;
}

function isTerminal(task: Task): boolean {
  return task.state === "done" || task.state === "cancelled";
}

function sortOpenTasks(
  tasks: Task[],
  schedules: ReadonlyMap<string, TaskSchedule>,
): Task[] {
  return [...tasks].sort((a, b) => {
    const terminalA = isTerminal(a);
    const terminalB = isTerminal(b);
    if (terminalA !== terminalB) {
      return terminalA ? 1 : -1;
    }
    const scheduledA = schedules.get(a.id);
    const scheduledB = schedules.get(b.id);
    if (scheduledA && scheduledB) {
      const start = scheduledA.start.localeCompare(scheduledB.start);
      if (start !== 0) {
        return start;
      }
    } else if (scheduledA) {
      return -1;
    } else if (scheduledB) {
      return 1;
    }
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority !== 0) {
      return priority;
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Open tasks on the Tasks page:
 * Unscheduled (no due, no slot) first — the goal is none of these — then
 * Overdue (due date in the past, even if scheduled later) → earlier days
 * this week → Today → Tomorrow → rest of this week → Next week → later
 * weeks.
 *
 * A time block places the row on that day unless the due date is overdue.
 * Done/cancelled rows (when passed in) skip Overdue and sit on their slot,
 * due date, or completed day.
 */
export function groupUpcomingTasks(
  tasks: Task[],
  today: string,
  schedules: ReadonlyMap<string, TaskSchedule> = new Map(),
): UpcomingGroup[] {
  const tomorrow = addDays(today, 1);
  const thisWeekStart = startOfWeekMonday(today);
  const thisWeekEnd = addDays(thisWeekStart, 6);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const nextWeekEnd = addDays(nextWeekStart, 6);

  const overdue: Task[] = [];
  const unscheduled: Task[] = [];
  const byDay = new Map<string, Task[]>();

  for (const task of tasks) {
    const terminal = isTerminal(task);
    if (!terminal && task.due_date && task.due_date < today) {
      overdue.push(task);
      continue;
    }
    const day =
      schedules.get(task.id)?.day ??
      task.due_date ??
      (terminal ? (task.completed_at?.slice(0, 10) ?? null) : null);
    if (!day) {
      unscheduled.push(task);
      continue;
    }
    const bucket = byDay.get(day) ?? [];
    bucket.push(task);
    byDay.set(day, bucket);
  }

  const groups: UpcomingGroup[] = [];
  const takeDay = (day: string): Task[] => {
    const listed = byDay.get(day);
    byDay.delete(day);
    return listed?.length ? sortOpenTasks(listed, schedules) : [];
  };

  if (overdue.length > 0) {
    groups.push({
      id: "overdue",
      label: "Overdue",
      tone: "overdue",
      showCount: true,
      tasks: sortOpenTasks(overdue, schedules),
    });
  }

  for (
    let cursor = thisWeekStart;
    cursor < today;
    cursor = addDays(cursor, 1)
  ) {
    const dayTasks = takeDay(cursor);
    if (!dayTasks.length) {
      continue;
    }
    groups.push({
      id: `day-${cursor}`,
      label: formatWeekdayMonthDay(cursor),
      tone: "default",
      showCount: false,
      tasks: dayTasks,
    });
  }

  const todayTasks = takeDay(today);
  if (todayTasks.length) {
    groups.push({
      id: `day-${today}`,
      label: `Today ${formatShortDay(today)}`,
      tone: "today",
      showCount: false,
      tasks: todayTasks,
    });
  }

  const tomorrowTasks = takeDay(tomorrow);
  if (tomorrowTasks.length) {
    groups.push({
      id: `day-${tomorrow}`,
      label: `Tomorrow ${formatShortDay(tomorrow)}`,
      tone: "default",
      showCount: false,
      tasks: tomorrowTasks,
    });
  }

  for (
    let cursor = addDays(tomorrow, 1);
    cursor <= thisWeekEnd;
    cursor = addDays(cursor, 1)
  ) {
    const dayTasks = takeDay(cursor);
    if (!dayTasks.length) {
      continue;
    }
    groups.push({
      id: `day-${cursor}`,
      label: formatWeekdayMonthDay(cursor),
      tone: "default",
      showCount: false,
      tasks: dayTasks,
    });
  }

  const nextWeekTasks: Task[] = [];
  for (
    let cursor = nextWeekStart;
    cursor <= nextWeekEnd;
    cursor = addDays(cursor, 1)
  ) {
    nextWeekTasks.push(...takeDay(cursor));
  }
  if (nextWeekTasks.length > 0) {
    groups.push({
      id: `week-${nextWeekStart}`,
      label: `Next week ${formatWeekRange(nextWeekStart, nextWeekEnd)}`,
      tone: "default",
      showCount: false,
      tasks: sortOpenTasks(nextWeekTasks, schedules),
    });
  }

  const remainingDates = [...byDay.keys()].sort();
  const weekBuckets = new Map<string, Task[]>();
  for (const day of remainingDates) {
    const weekStart = startOfWeekMonday(day);
    const bucket = weekBuckets.get(weekStart) ?? [];
    bucket.push(...(byDay.get(day) ?? []));
    weekBuckets.set(weekStart, bucket);
  }
  for (const weekStart of [...weekBuckets.keys()].sort()) {
    const weekEnd = addDays(weekStart, 6);
    groups.push({
      id: `week-${weekStart}`,
      label: formatWeekRange(weekStart, weekEnd),
      tone: "default",
      showCount: false,
      tasks: sortOpenTasks(weekBuckets.get(weekStart) ?? [], schedules),
    });
  }

  if (unscheduled.length > 0) {
    groups.unshift({
      id: "unscheduled",
      label: "Unscheduled",
      tone: "unscheduled",
      showCount: true,
      tasks: sortOpenTasks(unscheduled, schedules),
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
    // Calendar sidebar + Due still use these filters. Tasks page merges
    // inbox + upcoming and groups by due / schedule.
    return tasks
      .filter(
        (task) =>
          (task.state === "open" || task.state === "waiting") &&
          task.due_date == null,
      )
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
