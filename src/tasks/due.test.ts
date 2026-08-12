import { describe, expect, it } from "vitest";
import { dueChip, formatShortDue, shiftYmd } from "./due";

describe("due chips (ENG-62)", () => {
  const today = "2026-08-12";

  it("labels Today / Tomorrow / overdue / month-day", () => {
    expect(dueChip(today, today)).toEqual({ label: "Today", tone: "today" });
    expect(dueChip(shiftYmd(today, 1), today)).toEqual({
      label: "Tomorrow",
      tone: "tomorrow",
    });
    expect(dueChip("2026-08-08", today)).toEqual({
      label: "Aug 8",
      tone: "overdue",
    });
    expect(dueChip("2026-08-14", today)).toEqual({
      label: "Aug 14",
      tone: "default",
    });
    expect(dueChip(null, today)).toBeNull();
  });

  it("mutes overdue tone when the task is terminal", () => {
    expect(dueChip("2026-08-08", today, { terminal: true })).toEqual({
      label: "Aug 8",
      tone: "default",
    });
  });

  it("formats short due labels", () => {
    expect(formatShortDue("2026-08-14")).toBe("Aug 14");
  });
});
