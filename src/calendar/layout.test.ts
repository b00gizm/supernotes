import { describe, expect, it } from "vitest";
import {
  agendaHeading,
  DEFAULT_DURATION_MIN,
  eventOverlapsRange,
  eventSegmentOnDay,
  formatClock,
  formatDuration,
  formatTimeInput,
  layoutDayEvents,
  minutesToIso,
  parseTimeInput,
  pointerToMinutes,
  HOUR_HEIGHT,
  GRID_HOURS,
  snapMinutes,
  startOfWeekMonday,
  weekDays,
  weekHeading,
  weekRangeIso,
} from "./layout";
import type { CalendarEvent } from "./types";

function event(
  partial: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "start" | "end">,
): CalendarEvent {
  return {
    title: partial.title ?? partial.id,
    task_id: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...partial,
  };
}

describe("calendar layout (ENG-65)", () => {
  it("starts weeks on Monday and lists seven days", () => {
    // Sunday 16 Aug 2026 → week of Mon 10.
    expect(startOfWeekMonday("2026-08-16")).toBe("2026-08-10");
    expect(startOfWeekMonday("2026-08-10")).toBe("2026-08-10");
    expect(weekDays("2026-08-10")).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
  });

  it("formats week and agenda headings", () => {
    expect(weekHeading("2026-08-10")).toEqual({
      monthYear: "August 2026",
      range: "Aug 10 – 16",
    });
    expect(weekHeading("2026-08-31").range).toBe("Aug 31 – Sep 6");
    expect(agendaHeading("2026-08-10")).toBe("Monday, Aug 10");
  });

  it("snaps pointer position to 15-minute slots", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(9 * 60 + 7)).toBe(9 * 60);
    expect(snapMinutes(9 * 60 + 8)).toBe(9 * 60 + 15);
    const gridHeight = GRID_HOURS * HOUR_HEIGHT;
    expect(pointerToMinutes(gridHeight / 2, 0, gridHeight)).toBe(12 * 60);
    expect(DEFAULT_DURATION_MIN).toBe(15);
  });

  it("formats clocks and durations", () => {
    expect(formatClock(9 * 60 + 30)).toBe("9:30");
    expect(formatClock(16 * 60)).toBe("16:00");
    expect(formatClock(14 * 60 + 5.816666666666666)).toBe("14:05");
    expect(formatTimeInput(9 * 60 + 30)).toBe("09:30");
    expect(formatTimeInput(14 * 60 + 5.816666666666666)).toBe("14:05");
    expect(parseTimeInput("09:30")).toBe(9 * 60 + 30);
    expect(parseTimeInput("25:00")).toBeNull();
    expect(
      formatDuration("2026-08-10T09:30:00.000Z", "2026-08-10T09:45:00.000Z"),
    ).toBe("15 min");
    expect(
      formatDuration("2026-08-10T11:00:00.000Z", "2026-08-10T12:00:00.000Z"),
    ).toBe("1 h");
    expect(
      formatDuration("2026-08-10T16:00:00.000Z", "2026-08-10T16:45:00.000Z"),
    ).toBe("45 min");
  });

  it("clips events to the local day including midnight spill", () => {
    const ymd = "2026-08-10";
    const start = minutesToIso(ymd, 9 * 60 + 30);
    const end = minutesToIso(ymd, 9 * 60 + 45);
    const clip = eventSegmentOnDay(event({ id: "standup", start, end }), ymd);
    expect(clip).toEqual({ startMin: 9 * 60 + 30, endMin: 9 * 60 + 45 });

    const overnight = event({
      id: "late",
      start: minutesToIso(ymd, 23 * 60 + 30),
      end: minutesToIso("2026-08-11", 30),
    });
    expect(eventSegmentOnDay(overnight, ymd)?.endMin).toBe(24 * 60);
    expect(eventSegmentOnDay(overnight, "2026-08-11")?.startMin).toBe(0);
    expect(eventSegmentOnDay(overnight, "2026-08-09")).toBeNull();
  });

  it("packs overlapping events into columns", () => {
    const ymd = "2026-08-10";
    const a = event({
      id: "a",
      start: minutesToIso(ymd, 10 * 60),
      end: minutesToIso(ymd, 11 * 60),
    });
    const b = event({
      id: "b",
      start: minutesToIso(ymd, 10 * 60 + 30),
      end: minutesToIso(ymd, 11 * 60 + 30),
    });
    const c = event({
      id: "c",
      start: minutesToIso(ymd, 12 * 60),
      end: minutesToIso(ymd, 13 * 60),
    });
    const laid = layoutDayEvents([a, b, c], ymd);
    const byId = Object.fromEntries(laid.map((item) => [item.event.id, item]));
    expect(byId.a?.cols).toBe(2);
    expect(byId.b?.cols).toBe(2);
    expect(byId.a?.col).not.toBe(byId.b?.col);
    expect(byId.c?.cols).toBe(1);
  });

  it("does not paint the same event id twice", () => {
    const ymd = "2026-08-10";
    const a = event({
      id: "dup",
      start: minutesToIso(ymd, 16 * 60),
      end: minutesToIso(ymd, 17 * 60),
    });
    const laid = layoutDayEvents([a, a], ymd);
    expect(laid).toHaveLength(1);
  });

  it("layouts 50 events without dropping any", () => {
    const ymd = "2026-08-10";
    const events = Array.from({ length: 50 }, (_, index) => {
      const startMin = 8 * 60 + (index % 10) * 15;
      return event({
        id: `e${String(index)}`,
        start: minutesToIso(ymd, startMin),
        end: minutesToIso(ymd, startMin + 30),
      });
    });
    const started = performance.now();
    const laid = layoutDayEvents(events, ymd);
    const elapsed = performance.now() - started;
    expect(laid).toHaveLength(50);
    expect(elapsed).toBeLessThan(50);
  });

  it("detects range overlap for week queries", () => {
    const { from, to } = weekRangeIso("2026-08-10");
    const inside = event({
      id: "in",
      start: minutesToIso("2026-08-12", 10 * 60),
      end: minutesToIso("2026-08-12", 11 * 60),
    });
    const outside = event({
      id: "out",
      start: minutesToIso("2026-08-17", 10 * 60),
      end: minutesToIso("2026-08-17", 11 * 60),
    });
    expect(eventOverlapsRange(inside, from, to)).toBe(true);
    expect(eventOverlapsRange(outside, from, to)).toBe(false);
  });
});
