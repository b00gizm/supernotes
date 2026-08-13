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
