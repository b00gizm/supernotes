import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../notes/types";
import type { TasksApi } from "../tasks/api";
import { createMemoryTasksApi } from "../tasks/memoryApi";
import type { Task } from "../tasks/types";
import type { CalendarApi } from "./api";
import { createMemoryCalendarApi } from "./api";
import { CalendarView } from "./CalendarView";
import { minutesToIso } from "./layout";

const calRef: { current: CalendarApi } = {
  current: createMemoryCalendarApi(),
};

const tasksRef: { current: TasksApi } = {
  current: createMemoryTasksApi(),
};

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    calendarApi: {
      createEvent: (input: Parameters<CalendarApi["createEvent"]>[0]) =>
        calRef.current.createEvent(input),
      getEvent: (id: string) => calRef.current.getEvent(id),
      listEvents: (from?: string, to?: string) =>
        calRef.current.listEvents(from, to),
      updateEvent: (input: Parameters<CalendarApi["updateEvent"]>[0]) =>
        calRef.current.updateEvent(input),
      deleteEvent: (id: string) => calRef.current.deleteEvent(id),
    },
  };
});

vi.mock("../tasks/api", async () => {
  const actual =
    await vi.importActual<typeof import("../tasks/api")>("../tasks/api");
  return {
    ...actual,
    tasksApi: {
      createTask: (input: Parameters<TasksApi["createTask"]>[0]) =>
        tasksRef.current.createTask(input),
      getTask: (id: string) => tasksRef.current.getTask(id),
      listTasks: (
        filter: Parameters<TasksApi["listTasks"]>[0],
        today: string,
      ) => tasksRef.current.listTasks(filter, today),
      listTasksForNote: (noteId: string) =>
        tasksRef.current.listTasksForNote(noteId),
      searchTasks: (query: string) => tasksRef.current.searchTasks(query),
      updateTask: (input: Parameters<TasksApi["updateTask"]>[0]) =>
        tasksRef.current.updateTask(input),
      deleteTask: (id: string) => tasksRef.current.deleteTask(id),
    },
  };
});

const TODAY = "2026-08-10";

const notes: Note[] = [
  {
    id: "n1",
    title: "Roadmap",
    body_markdown: "",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
  },
];

const overdue: Task = {
  id: "t-overdue",
  note_id: "n1",
  title: "Survey → beta list",
  state: "open",
  due_date: "2026-08-08",
  priority: "high",
  created_at: "2026-08-08T00:00:00.000Z",
  updated_at: "2026-08-08T00:00:00.000Z",
  completed_at: null,
};

function renderCalendar(onOpenDaily = vi.fn(), onOpenTask = vi.fn()) {
  return render(
    <CalendarView
      today={TODAY}
      notes={notes}
      onOpenDaily={onOpenDaily}
      onOpenTask={onOpenTask}
    />,
  );
}

describe("CalendarView (ENG-65)", () => {
  beforeEach(() => {
    calRef.current = createMemoryCalendarApi([
      {
        id: "standup",
        title: "Standup",
        start: minutesToIso(TODAY, 9 * 60 + 30),
        end: minutesToIso(TODAY, 9 * 60 + 45),
        task_id: null,
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    tasksRef.current = createMemoryTasksApi([overdue]);
  });

  it("renders the week grid", async () => {
    renderCalendar();
    const pane = await screen.findByRole("region", { name: "Calendar" });
    expect(within(pane).getByText("August 2026")).toBeInTheDocument();
    expect(within(pane).getByText("Aug 10 – 16")).toBeInTheDocument();
    expect(within(pane).getByRole("tab", { name: "Week" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(pane).queryByRole("region", { name: "Agenda" }),
    ).not.toBeInTheDocument();
    expect(await within(pane).findAllByText("Standup")).not.toHaveLength(0);
    expect(
      await within(pane).findAllByText("Survey → beta list"),
    ).not.toHaveLength(0);
  });

  it("opens the daily note from a day header", async () => {
    const user = userEvent.setup();
    const onOpenDaily = vi.fn();
    renderCalendar(onOpenDaily);
    await screen.findAllByText("Standup");
    await user.click(
      screen.getByRole("button", {
        name: "Open daily note for Tuesday, Aug 11",
      }),
    );
    expect(onOpenDaily).toHaveBeenCalledWith("2026-08-11");
  });

  it("creates, edits, and deletes an event from the agenda", async () => {
    const user = userEvent.setup();
    renderCalendar();
    await screen.findAllByText("Standup");
    await user.click(screen.getByRole("tab", { name: "Agenda" }));
    expect(screen.getByRole("tab", { name: "Agenda" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("region", { name: "Agenda" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Week" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add event" }));
    const title = await screen.findByLabelText("Event title");
    await user.type(title, "Pricing sync");
    await user.keyboard("{Enter}");
    await waitFor(async () => {
      const listed = await calRef.current.listEvents();
      expect(listed.some((item) => item.title === "Pricing sync")).toBe(true);
    });

    const hits = await screen.findAllByRole("button", {
      name: /Pricing sync/,
    });
    const hit = hits.at(0);
    if (!hit) {
      throw new Error("expected an event to click");
    }
    await user.click(hit);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByText("Pricing sync")).not.toBeInTheDocument();
    });
    const after = await calRef.current.listEvents();
    expect(after.some((item) => item.title === "Pricing sync")).toBe(false);
  });

  it("creates an event by dragging on the week grid", async () => {
    renderCalendar();
    await screen.findAllByText("Standup");
    const grid = document.querySelector(".cal-grid");
    const col = document.querySelector('[data-day="2026-08-11"]');
    expect(grid).toBeTruthy();
    expect(col).toBeTruthy();
    vi.spyOn(grid as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 700,
      bottom: 24 * 48,
      width: 700,
      height: 24 * 48,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(col as HTMLElement, { button: 0, clientY: 10 * 48 });
    fireEvent.mouseMove(window, { clientY: 11 * 48 });
    fireEvent.mouseUp(window, { clientY: 11 * 48 });
    await waitFor(() => {
      expect(screen.getAllByLabelText("Event title")).toHaveLength(1);
    });
    const listed = await calRef.current.listEvents();
    expect(listed.length).toBeGreaterThan(1);
  });
});
