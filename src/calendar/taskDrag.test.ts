import { describe, expect, it } from "vitest";
import {
  decodeTaskDrag,
  encodeTaskDrag,
  scheduledTaskIds,
  TASK_DRAG_PREFIX,
} from "./taskDrag";
import type { CalendarEvent } from "./types";

describe("task drag payload (ENG-66)", () => {
  it("round-trips a task id and rejects other text", () => {
    expect(encodeTaskDrag("t-1")).toBe(`${TASK_DRAG_PREFIX}t-1`);
    expect(decodeTaskDrag(encodeTaskDrag("t-1"))).toBe("t-1");
    expect(decodeTaskDrag("t-1")).toBeNull();
    expect(decodeTaskDrag(TASK_DRAG_PREFIX)).toBeNull();
  });

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
