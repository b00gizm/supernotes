import type { CalendarEvent } from "./types";

export const TASK_DRAG_PREFIX = "supernotes-task:";

export function encodeTaskDrag(taskId: string): string {
  return `${TASK_DRAG_PREFIX}${taskId}`;
}

export function decodeTaskDrag(payload: string): string | null {
  if (!payload.startsWith(TASK_DRAG_PREFIX)) {
    return null;
  }
  const id = payload.slice(TASK_DRAG_PREFIX.length);
  return id.length > 0 ? id : null;
}

export function scheduledTaskIds(events: CalendarEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.task_id) {
      ids.add(event.task_id);
    }
  }
  return ids;
}
