import { describe, expect, it } from "vitest";
import { planCardHeader, planItemLabel } from "./planCard";

describe("plan card copy (ENG-75)", () => {
  it("joins title and date_label with a centered-dot separator", () => {
    expect(
      planCardHeader({ title: "3 time blocks", date_label: "Thu, Aug 13" }),
    ).toBe("3 time blocks · Thu, Aug 13");
    expect(planCardHeader({ title: "1 task", date_label: null })).toBe(
      "1 task",
    );
  });

  it("uses the item title and falls back to id plus patch fields", () => {
    expect(
      planItemLabel({
        kind: "create_calendar_event",
        title: "Finalize tier table",
        time_range: "9:00 – 10:30",
      }),
    ).toBe("Finalize tier table");
    expect(
      planItemLabel({
        kind: "update_task",
        title: "",
        id: "task-9",
        state: "done",
        due_date: "2026-08-13",
        priority: "high",
      }),
    ).toBe("task-9 · done · 2026-08-13 · high");
    expect(planItemLabel({ kind: "update_task", title: "" })).toBe("");
  });
});
