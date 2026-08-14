import {
  formatDailyTitle,
  parseDailyTitle,
  shiftDailyTitle,
} from "../notes/format";

export type DueChipTone = "today" | "tomorrow" | "overdue" | "default";

export type DueChip = {
  label: string;
  tone: DueChipTone;
};

/** Local YYYY-MM-DD for `date` (defaults to now). */
export function todayYmd(date: Date = new Date()): string {
  return formatDailyTitle(date);
}

export function shiftYmd(ymd: string, days: number): string {
  return shiftDailyTitle(ymd, days);
}

/** Local clock range (`13:00–14:00`) for a linked calendar slot. */
export function formatScheduleSpan(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }
  const clock = (date: Date) =>
    `${String(date.getHours())}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${clock(start)}–${clock(end)}`;
}

/** Short month-day label (`Aug 14`). */
export function formatShortDue(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${String(date.getDate())}`;
}

/**
 * Compact due chip next to a task title (sheet 1a):
 * Today → blue, Tomorrow → amber, overdue → red, else muted month-day.
 */
export function dueChip(
  dueDate: string | null | undefined,
  today: string = todayYmd(),
  opts?: { terminal?: boolean },
): DueChip | null {
  if (!dueDate) {
    return null;
  }
  if (dueDate === today) {
    return { label: "Today", tone: "today" };
  }
  if (dueDate === shiftYmd(today, 1)) {
    return { label: "Tomorrow", tone: "tomorrow" };
  }
  // Terminal tasks don't shout overdue; still show the date muted.
  if (!opts?.terminal && dueDate < today) {
    return { label: formatShortDue(dueDate), tone: "overdue" };
  }
  return { label: formatShortDue(dueDate), tone: "default" };
}
