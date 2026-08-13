import { invoke } from "@tauri-apps/api/core";
import { formatDailyTitle } from "../notes/format";
import {
  DEFAULT_DURATION_MIN,
  minutesToIso,
  startOfWeekMonday,
  weekDays,
} from "./layout";
import type {
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
} from "./types";

export type CalendarApi = {
  createEvent: (input: CreateCalendarEventInput) => Promise<CalendarEvent>;
  getEvent: (id: string) => Promise<CalendarEvent>;
  listEvents: (from?: string, to?: string) => Promise<CalendarEvent[]>;
  updateEvent: (input: UpdateCalendarEventInput) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
};

export const CALENDAR_CHANGED_EVENT = "supernotes:calendar-changed";

export function emitCalendarChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(CALENDAR_CHANGED_EVENT));
}

export function subscribeCalendarChanged(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(CALENDAR_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(CALENDAR_CHANGED_EVENT, handler);
  };
}

const tauriCalendarApi: CalendarApi = {
  createEvent: (input) =>
    invoke<CalendarEvent>("create_calendar_event", { input }),
  getEvent: (id) => invoke<CalendarEvent>("get_calendar_event", { id }),
  listEvents: (from, to) =>
    invoke<CalendarEvent[]>("list_calendar_events", { from, to }),
  updateEvent: (input) =>
    invoke<CalendarEvent>("update_calendar_event", { input }),
  deleteEvent: async (id) => {
    await invoke("delete_calendar_event", { id });
  },
};

function stamp(): string {
  return new Date().toISOString();
}

function overlaps(
  event: CalendarEvent,
  from: string | undefined,
  to: string | undefined,
): boolean {
  if (to !== undefined && event.start >= to) {
    return false;
  }
  if (from !== undefined && event.end <= from) {
    return false;
  }
  return true;
}

/** In-memory CalendarApi for tests / browser preview. */
export function createMemoryCalendarApi(
  seed: CalendarEvent[] = [],
): CalendarApi {
  let events = [...seed];
  let seq = 0;

  return {
    createEvent(input) {
      if (!input.start || !input.end || input.end <= input.start) {
        return Promise.reject(new Error("event end must be after start"));
      }
      seq += 1;
      const event: CalendarEvent = {
        id: `event-${String(seq)}`,
        title: input.title,
        start: input.start,
        end: input.end,
        task_id: input.task_id ?? null,
        created_at: stamp(),
      };
      events = [...events, event];
      return Promise.resolve(event);
    },
    getEvent(id) {
      const event = events.find((item) => item.id === id);
      if (!event) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(event);
    },
    listEvents(from, to) {
      return Promise.resolve(
        events
          .filter((item) => overlaps(item, from, to))
          .sort((a, b) => a.start.localeCompare(b.start)),
      );
    },
    updateEvent(input) {
      const current = events.find((item) => item.id === input.id);
      if (!current) {
        return Promise.reject(new Error("not found"));
      }
      if (!input.start || !input.end || input.end <= input.start) {
        return Promise.reject(new Error("event end must be after start"));
      }
      const updated: CalendarEvent = {
        ...current,
        title: input.title,
        start: input.start,
        end: input.end,
        task_id: input.task_id === undefined ? current.task_id : input.task_id,
      };
      events = events.map((item) => (item.id === updated.id ? updated : item));
      return Promise.resolve(updated);
    },
    deleteEvent(id) {
      const before = events.length;
      events = events.filter((item) => item.id !== id);
      if (events.length === before) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve();
    },
  };
}

function localMinutes(ymd: string, hour: number, minute: number): string {
  return minutesToIso(ymd, hour * 60 + minute);
}

function addMinutes(iso: string, mins: number): string {
  return new Date(Date.parse(iso) + mins * 60_000).toISOString();
}

/** Browser preview seed matching mockup 1e times on the current week. */
function demoEvents(): CalendarEvent[] {
  const today = formatDailyTitle();
  const days = weekDays(startOfWeekMonday(today));
  const monday = days[0] ?? today;
  const thursday = days[3] ?? today;
  const now = stamp();
  const standupStart = localMinutes(monday, 9, 30);
  const thuStandup = localMinutes(thursday, 9, 30);
  const pricing = localMinutes(monday, 11, 0);
  const focus = localMinutes(monday, 16, 0);
  return [
    {
      id: "demo-standup-mon",
      title: "Standup",
      start: standupStart,
      end: addMinutes(standupStart, DEFAULT_DURATION_MIN),
      task_id: null,
      created_at: now,
    },
    {
      id: "demo-pricing",
      title: "Pricing sync",
      start: pricing,
      end: addMinutes(pricing, 60),
      task_id: null,
      created_at: now,
    },
    {
      id: "demo-focus",
      title: "Focus block — pricing draft",
      start: focus,
      end: addMinutes(focus, 45),
      task_id: null,
      created_at: now,
    },
    {
      id: "demo-standup-thu",
      title: "Standup",
      start: thuStandup,
      end: addMinutes(thuStandup, DEFAULT_DURATION_MIN),
      task_id: null,
      created_at: now,
    },
    {
      id: "demo-review",
      title: "Design review",
      start: localMinutes(days[2] ?? monday, 10, 0),
      end: localMinutes(days[2] ?? monday, 11, 0),
      task_id: null,
      created_at: now,
    },
  ];
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function withCalendarInvalidation(api: CalendarApi): CalendarApi {
  return {
    createEvent: async (input) => {
      const event = await api.createEvent(input);
      emitCalendarChanged();
      return event;
    },
    getEvent: (id) => api.getEvent(id),
    listEvents: (from, to) => api.listEvents(from, to),
    updateEvent: async (input) => {
      const event = await api.updateEvent(input);
      emitCalendarChanged();
      return event;
    },
    deleteEvent: async (id) => {
      await api.deleteEvent(id);
      emitCalendarChanged();
    },
  };
}

export const calendarApi: CalendarApi = withCalendarInvalidation(
  isTauriRuntime() ? tauriCalendarApi : createMemoryCalendarApi(demoEvents()),
);
