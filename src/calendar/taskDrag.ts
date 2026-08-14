import { formatDailyTitle } from "../notes/format";
import type { CalendarEvent } from "./types";

export function scheduledTaskIds(events: CalendarEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.task_id) {
      ids.add(event.task_id);
    }
  }
  return ids;
}

/** Earliest local day of a linked event per task. */
export function earliestScheduledOn(
  events: CalendarEvent[],
): Map<string, string> {
  const dates = new Map<string, string>();
  const starts = new Map<string, string>();
  for (const event of events) {
    if (!event.task_id) {
      continue;
    }
    const prev = starts.get(event.task_id);
    if (prev && prev <= event.start) {
      continue;
    }
    starts.set(event.task_id, event.start);
    dates.set(event.task_id, formatDailyTitle(new Date(event.start)));
  }
  return dates;
}
