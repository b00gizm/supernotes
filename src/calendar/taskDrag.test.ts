import { describe, expect, it } from "vitest";
import { scheduledTaskIds } from "./taskDrag";
import type { CalendarEvent } from "./types";

describe("scheduledTaskIds (ENG-66)", () => {
  it("collects linked task ids so scheduled inbox rows can hide", () => {
    const events: CalendarEvent[] = [
      {
        id: "e1",
        title: "Focus",
        start: "2026-08-10T16:00:00.000Z",
        end: "2026-08-10T16:15:00.000Z",
        task_id: "t-1",
        created_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "e2",
        title: "Standup",
        start: "2026-08-10T09:30:00.000Z",
        end: "2026-08-10T09:45:00.000Z",
        task_id: null,
        created_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "e3",
        title: "Focus again",
        start: "2026-08-11T10:00:00.000Z",
        end: "2026-08-11T10:15:00.000Z",
        task_id: "t-1",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ];
    expect([...scheduledTaskIds(events)]).toEqual(["t-1"]);
  });
});
