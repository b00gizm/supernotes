import { formatDailyTitle, parseDailyTitle } from "../notes/format";
import type { CalendarEvent } from "./types";

export const HOUR_HEIGHT = 48;
export const SNAP_MINUTES = 15;
export const DEFAULT_DURATION_MIN = 15;
export const GRID_HOURS = 24;

export type DaySegment = {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

export function startOfWeekMonday(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return formatDailyTitle(date);
}

export function shiftYmd(ymd: string, days: number): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  date.setDate(date.getDate() + days);
  return formatDailyTitle(date);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftYmd(weekStart, index));
}

/** Inclusive local week as UTC ISO instants `[from, to)`. */
export function weekRangeIso(weekStart: string): { from: string; to: string } {
  const start = parseDailyTitle(weekStart) ?? new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function weekHeading(weekStart: string): {
  monthYear: string;
  range: string;
} {
  const start = parseDailyTitle(weekStart);
  const end = parseDailyTitle(shiftYmd(weekStart, 6));
  if (!start || !end) {
    return { monthYear: weekStart, range: weekStart };
  }
  const monthYear = start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  if (start.getMonth() === end.getMonth()) {
    return {
      monthYear,
      range: `${startMonth} ${String(start.getDate())} – ${String(end.getDate())}`,
    };
  }
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  return {
    monthYear,
    range: `${startMonth} ${String(start.getDate())} – ${endMonth} ${String(end.getDate())}`,
  };
}

/** Agenda heading: `Monday, Aug 10`. */
export function agendaHeading(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}, ${month} ${String(date.getDate())}`;
}

export function weekdayShort(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

export function dayNumber(ymd: string): number {
  const date = parseDailyTitle(ymd);
  return date ? date.getDate() : 0;
}

export function snapMinutes(mins: number, step: number = SNAP_MINUTES): number {
  const max = GRID_HOURS * 60;
  const clamped = Math.max(0, Math.min(max, mins));
  return Math.round(clamped / step) * step;
}

export function formatClock(mins: number): string {
  const wrapped = Math.floor(((mins % (24 * 60)) + 24 * 60) % (24 * 60));
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours)}:${String(minutes).padStart(2, "0")}`;
}

export function formatTimeInput(mins: number): string {
  const wrapped = Math.floor(((mins % (24 * 60)) + 24 * 60) % (24 * 60));
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseTimeInput(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function formatDuration(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return "";
  }
  const mins = Math.round((end - start) / 60_000);
  if (mins < 60) {
    return `${String(mins)} min`;
  }
  if (mins % 60 === 0) {
    return `${String(mins / 60)} h`;
  }
  return `${String(Math.floor(mins / 60))} h ${String(mins % 60)} min`;
}

export function minutesToIso(ymd: string, mins: number): string {
  const date = parseDailyTitle(ymd) ?? new Date();
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/**
 * Clip an event onto a local calendar day.
 * ponytail: 24h grid ignores DST 23h/25h days; upgrade: size the column by
 * the day's actual local duration.
 */
export function eventSegmentOnDay(
  event: CalendarEvent,
  ymd: string,
): { startMin: number; endMin: number } | null {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const dayStart = parseDailyTitle(ymd);
  if (Number.isNaN(start) || Number.isNaN(end) || !dayStart || end <= start) {
    return null;
  }
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const clipStart = Math.max(start, dayStart.getTime());
  const clipEnd = Math.min(end, dayEnd.getTime());
  if (clipEnd <= clipStart) {
    return null;
  }
  return {
    startMin: (clipStart - dayStart.getTime()) / 60_000,
    endMin: (clipEnd - dayStart.getTime()) / 60_000,
  };
}

export function layoutDayEvents(
  events: CalendarEvent[],
  ymd: string,
): DaySegment[] {
  const segments = events
    .map((event) => {
      const clip = eventSegmentOnDay(event, ymd);
      if (!clip) {
        return null;
      }
      return { event, startMin: clip.startMin, endMin: clip.endMin };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const laid: DaySegment[] = [];
  let cluster: typeof segments = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) {
      return;
    }
    laid.push(...assignColumns(cluster));
    cluster = [];
    clusterEnd = -1;
  };

  for (const segment of segments) {
    if (cluster.length > 0 && segment.startMin >= clusterEnd) {
      flush();
    }
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.endMin);
  }
  flush();
  return laid;
}

function assignColumns(
  cluster: Array<{ event: CalendarEvent; startMin: number; endMin: number }>,
): DaySegment[] {
  const colEnd: number[] = [];
  const assigned: Array<{
    event: CalendarEvent;
    startMin: number;
    endMin: number;
    col: number;
  }> = [];
  for (const segment of cluster) {
    let col = colEnd.findIndex((end) => end <= segment.startMin);
    if (col < 0) {
      col = colEnd.length;
      colEnd.push(segment.endMin);
    } else {
      colEnd[col] = segment.endMin;
    }
    assigned.push({ ...segment, col });
  }
  const cols = Math.max(1, colEnd.length);
  return assigned.map((item) => ({ ...item, cols }));
}

export function pointerToMinutes(
  clientY: number,
  gridTop: number,
  gridHeight: number,
): number {
  const ratio = gridHeight <= 0 ? 0 : (clientY - gridTop) / gridHeight;
  const mins = ratio * GRID_HOURS * 60;
  return snapMinutes(mins);
}

export function nowMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

export function eventOverlapsRange(
  event: CalendarEvent,
  fromIso: string,
  toIso: string,
): boolean {
  return event.start < toIso && event.end > fromIso;
}
