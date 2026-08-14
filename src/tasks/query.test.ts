import { describe, expect, it } from "vitest";
import { minutesToIso } from "../calendar/layout";
import {
  allDayChipTasks,
  filterTasks,
  groupUpcomingTasks,
  isTaskOverdue,
  priorityRank,
  schedulesFromEvents,
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

  it("places time-blocked tasks on the slot day unless they are overdue", () => {
    const friday = "2026-08-14";
    const slot = {
      start: minutesToIso(friday, 13 * 60),
      end: minutesToIso(friday, 14 * 60),
    };
    const tasks = [
      task({
        id: "today-due-sun",
        title: "Block today, due Sunday",
        due_date: "2026-08-16",
      }),
      task({
        id: "today-due-thu",
        title: "Block today, due Thursday",
        due_date: "2026-08-13",
      }),
      task({ id: "today-only", title: "Block today" }),
      task({ id: "undated", title: "No date" }),
    ];
    const schedules = schedulesFromEvents([
      { task_id: "today-due-sun", ...slot },
      { task_id: "today-due-thu", ...slot },
      { task_id: "today-only", ...slot },
    ]);

    const groups = groupUpcomingTasks(tasks, friday, schedules);
    expect(groups.map((g) => g.id)).toEqual([
      "unscheduled",
      "overdue",
      "day-2026-08-14",
    ]);
    expect(groups[0]?.tone).toBe("unscheduled");
    expect(groups[0]?.showCount).toBe(true);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["undated"]);
    expect(groups[1]?.tasks.map((t) => t.id)).toEqual(["today-due-thu"]);
    expect(groups[2]?.tasks.map((t) => t.id)).toEqual([
      "today-due-sun",
      "today-only",
    ]);
  });

  it("keeps completed tasks out of Overdue and sorts them after open rows", () => {
    const friday = "2026-08-14";
    const tasks = [
      task({
        id: "done-overdue",
        title: "Finished late",
        due_date: "2026-08-13",
        state: "done",
        completed_at: "2026-08-14T12:00:00.000Z",
      }),
      task({ id: "open-today", title: "Still open", due_date: friday }),
      task({
        id: "done-today",
        title: "Wrapped today",
        due_date: friday,
        state: "done",
        completed_at: "2026-08-14T15:00:00.000Z",
      }),
    ];
    const groups = groupUpcomingTasks(tasks, friday);
    expect(groups.map((g) => g.id)).toEqual([
      "day-2026-08-13",
      "day-2026-08-14",
    ]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual(["done-overdue"]);
    expect(groups[1]?.tasks.map((t) => t.id)).toEqual([
      "open-today",
      "done-today",
    ]);
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

  it("places all-day chips on the due day, overdue on today, and hides scheduled", () => {
    const today = "2026-08-12";
    const tasks = [
      task({ id: "overdue", title: "Late", due_date: "2026-08-10" }),
      task({ id: "today", title: "Due today", due_date: today }),
      task({ id: "thu", title: "Thursday", due_date: "2026-08-13" }),
      task({ id: "blocked", title: "Already blocked", due_date: today }),
      task({ id: "inbox", title: "No due" }),
      task({
        id: "done",
        title: "Done",
        due_date: today,
        state: "done",
        completed_at: "2026-08-12T12:00:00.000Z",
      }),
    ];
    const scheduled = new Set(["blocked"]);

    expect(
      allDayChipTasks(tasks, "2026-08-10", today, scheduled).map((t) => t.id),
    ).toEqual([]);
    expect(
      allDayChipTasks(tasks, today, today, scheduled).map((t) => t.id),
    ).toEqual(["overdue", "today"]);
    expect(
      allDayChipTasks(tasks, "2026-08-13", today, scheduled).map((t) => t.id),
    ).toEqual(["thu"]);
  });
});
