import { describe, expect, it } from "vitest";
import { filterTasks, isTaskOverdue, priorityRank } from "./query";
import type { Task } from "./types";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    note_id: "n1",
    state: "open",
    due_date: null,
    priority: null,
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    completed_at: null,
    ...partial,
  };
}

describe("task query helpers (ENG-63)", () => {
  it("ranks priority urgent → none", () => {
    expect(priorityRank("urgent")).toBeLessThan(priorityRank("high"));
    expect(priorityRank("high")).toBeLessThan(priorityRank("medium"));
    expect(priorityRank(null)).toBeGreaterThan(priorityRank("none"));
  });

  it("marks overdue only for dated non-terminal tasks before today", () => {
    expect(
      isTaskOverdue(
        task({ id: "1", title: "a", due_date: "2026-08-11" }),
        "2026-08-12",
      ),
    ).toBe(true);
    expect(
      isTaskOverdue(
        task({ id: "2", title: "b", due_date: "2026-08-12" }),
        "2026-08-12",
      ),
    ).toBe(false);
    expect(
      isTaskOverdue(
        task({
          id: "3",
          title: "c",
          due_date: "2026-08-01",
          state: "done",
        }),
        "2026-08-12",
      ),
    ).toBe(false);
  });

  it("filters inbox / upcoming / complete", () => {
    const tasks = [
      task({
        id: "inbox",
        title: "No due",
        created_at: "2026-08-11T10:00:00.000Z",
      }),
      task({
        id: "waiting",
        title: "Wait",
        state: "waiting",
        created_at: "2026-08-12T10:00:00.000Z",
      }),
      task({
        id: "up1",
        title: "Soon urgent",
        due_date: "2026-08-15",
        priority: "urgent",
      }),
      task({
        id: "up2",
        title: "Soon high",
        state: "waiting",
        due_date: "2026-08-15",
        priority: "high",
      }),
      task({
        id: "up3",
        title: "Later",
        due_date: "2026-08-20",
        priority: "low",
      }),
      task({
        id: "done",
        title: "Done",
        state: "done",
        completed_at: "2026-08-10T12:00:00.000Z",
      }),
      task({
        id: "old",
        title: "Old",
        state: "cancelled",
        completed_at: "2026-07-01T12:00:00.000Z",
      }),
    ];

    expect(filterTasks(tasks, "inbox", "2026-08-12").map((t) => t.id)).toEqual([
      "inbox",
    ]);
    expect(
      filterTasks(tasks, "upcoming", "2026-08-12").map((t) => t.id),
    ).toEqual(["up1", "up2", "up3"]);
    expect(
      filterTasks(tasks, "complete", "2026-08-12").map((t) => t.id),
    ).toEqual(["done"]);
  });
});
