import { describe, expect, it } from "vitest";
import {
  filterTasks,
  groupUpcomingTasks,
  isTaskOverdue,
  priorityRank,
  tasksDueOnOrBefore,
} from "./query";
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
      "waiting",
      "inbox",
    ]);
    expect(
      filterTasks(tasks, "inbox", "2026-08-12", new Set(["waiting"])).map(
        (t) => t.id,
      ),
    ).toEqual(["inbox"]);
    expect(
      filterTasks(tasks, "upcoming", "2026-08-12").map((t) => t.id),
    ).toEqual(["up1", "up2", "up3"]);
    expect(
      filterTasks(tasks, "complete", "2026-08-12").map((t) => t.id),
    ).toEqual(["done"]);
  });

  it("groups upcoming into overdue / today / tomorrow / week buckets", () => {
    // Wed 2026-08-12 → this week ends Sun 16; next week Mon 17 – Sun 23.
    const tasks = [
      task({ id: "o1", title: "Late", due_date: "2026-08-08" }),
      task({ id: "o2", title: "Also late", due_date: "2026-08-10" }),
      task({ id: "td", title: "Due today", due_date: "2026-08-12" }),
      task({ id: "tm", title: "Due tomorrow", due_date: "2026-08-13" }),
      task({ id: "fri", title: "Friday", due_date: "2026-08-14" }),
      task({ id: "nw", title: "Next week item", due_date: "2026-08-19" }),
      task({ id: "later", title: "Later", due_date: "2026-08-26" }),
    ];

    const groups = groupUpcomingTasks(tasks, "2026-08-12");
    expect(groups.map((g) => g.id)).toEqual([
      "overdue",
      "day-2026-08-12",
      "day-2026-08-13",
      "day-2026-08-14",
      "week-2026-08-17",
      "week-2026-08-24",
    ]);
    expect(groups[0]?.label).toBe("Overdue");
    expect(groups[0]?.tone).toBe("overdue");
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["o1", "o2"]);
    expect(groups[1]?.label).toMatch(/^Today /);
    expect(groups[1]?.tone).toBe("today");
    expect(groups[2]?.label).toMatch(/^Tomorrow /);
    expect(groups[4]?.label).toMatch(/^Next week /);
    expect(groups[5]?.label).toBe("Aug 24 – 30");
  });

  it("rolls unresolved due tasks onto later days and drops terminal ones", () => {
    const tasks = [
      task({ id: "mon", title: "Monday due", due_date: "2026-08-10" }),
      task({
        id: "waiting",
        title: "Waiting overdue",
        state: "waiting",
        due_date: "2026-08-09",
      }),
      task({ id: "tue", title: "Tuesday due", due_date: "2026-08-11" }),
      task({
        id: "done",
        title: "Resolved",
        state: "done",
        due_date: "2026-08-10",
        completed_at: "2026-08-10T12:00:00.000Z",
      }),
      task({
        id: "cancelled",
        title: "Cancelled",
        state: "cancelled",
        due_date: "2026-08-10",
        completed_at: "2026-08-10T12:00:00.000Z",
      }),
      task({ id: "inbox", title: "No due" }),
    ];

    expect(tasksDueOnOrBefore(tasks, "2026-08-09").map((t) => t.id)).toEqual([
      "waiting",
    ]);
    expect(tasksDueOnOrBefore(tasks, "2026-08-10").map((t) => t.id)).toEqual([
      "waiting",
      "mon",
    ]);
    expect(tasksDueOnOrBefore(tasks, "2026-08-11").map((t) => t.id)).toEqual([
      "waiting",
      "mon",
      "tue",
    ]);
    expect(tasksDueOnOrBefore(tasks, "2026-08-12").map((t) => t.id)).toEqual([
      "waiting",
      "mon",
      "tue",
    ]);
  });

  it("labels later weeks that span months with both month names", () => {
    const groups = groupUpcomingTasks(
      [task({ id: "sep", title: "September", due_date: "2026-09-02" })],
      "2026-08-12",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Aug 31 – Sep 6");
  });
});
