import { formatDailyTitle, parseDailyTitle } from "../notes/format";
import { formatTimeInput, snapMinutes } from "../calendar/layout";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isMeetingTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

export function isMeetingDate(value: string): boolean {
  return parseDailyTitle(value) !== null;
}

/** Mockup date: `Mon, Aug 10`. */
export function formatMeetingDate(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}, ${month} ${String(date.getDate())}`;
}

/** Mockup range: `14:00 – 14:23`. */
export function formatMeetingRange(start: string, end: string): string {
  return `${start} – ${end}`;
}

/** Footer duration: `45 min`. */
export function formatTranscriptDuration(seconds: number): string {
  return `${String(Math.max(0, Math.round(seconds / 60)))} min`;
}

/** Footer words: `6,120 words`. */
export function formatTranscriptWords(count: number): string {
  return `${count.toLocaleString("en-US")} words`;
}

export function formatMeetingMeta(
  meeting_date: string,
  start_time: string,
  end_time: string,
): string {
  return `Meeting · ${formatMeetingDate(meeting_date)} · ${formatMeetingRange(start_time, end_time)}`;
}

export function defaultMeetingTimes(now: Date = new Date()): {
  meeting_date: string;
  start_time: string;
  end_time: string;
} {
  const startMin = snapMinutes(now.getHours() * 60 + now.getMinutes());
  const endMin = Math.min(startMin + 30, 23 * 60 + 59);
  return {
    meeting_date: formatDailyTitle(now),
    start_time: formatTimeInput(startMin),
    end_time: formatTimeInput(endMin),
  };
}

export function meetingTimesFromLocalIso(
  startIso: string,
  endIso: string,
): { meeting_date: string; start_time: string; end_time: string } | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  return {
    meeting_date: formatDailyTitle(start),
    start_time: formatTimeInput(start.getHours() * 60 + start.getMinutes()),
    end_time: formatTimeInput(end.getHours() * 60 + end.getMinutes()),
  };
}

export function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found/i.test(message);
}
