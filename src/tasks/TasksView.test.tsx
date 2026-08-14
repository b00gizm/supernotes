import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarApi } from "../calendar/api";
import { createMemoryCalendarApi } from "../calendar/api";
import { minutesToIso } from "../calendar/layout";
import type { Note } from "../notes/types";
import { TasksView } from "./TasksView";
import type { TasksApi } from "./api";
import { createMemoryTasksApi } from "./memoryApi";
import type { Task } from "./types";

const calRef: { current: CalendarApi } = {
  current: createMemoryCalendarApi(),
};

const tasksRef: { current: TasksApi } = {
  current: createMemoryTasksApi(),
};

vi.mock("../calendar/api", async () => {
  const actual =
    await vi.importActual<typeof import("../calendar/api")>("../calendar/api");
  return {
    ...actual,
    calendarApi: {
      createEvent: async (input: Parameters<CalendarApi["createEvent"]>[0]) => {
        const event = await calRef.current.createEvent(input);
        actual.emitCalendarChanged();
        return event;
      },
      getEvent: (id: string) => calRef.current.getEvent(id),
      listEvents: (from?: string, to?: string) =>
        calRef.current.listEvents(from, to),
      updateEvent: async (input: Parameters<CalendarApi["updateEvent"]>[0]) => {
        const event = await calRef.current.updateEvent(input);
        actual.emitCalendarChanged();
        return event;
      },
      deleteEvent: async (id: string) => {
        await calRef.current.deleteEvent(id);
        actual.emitCalendarChanged();
      },
    },
  };
});

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
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

const TODAY = "2026-08-14";

const notes: Note[] = [
  {
    id: "n1",
    title: "Roadmap",
    body_markdown: "",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  },
];

function openTask(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    note_id: "n1",
    state: "open",
    due_date: null,
    priority: null,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    completed_at: null,
    ...partial,
  };
}

describe("TasksView date grouping", () => {
  beforeEach(() => {
    calRef.current = createMemoryCalendarApi();
    tasksRef.current = createMemoryTasksApi();
  });

  it("puts a Friday block with a Sunday due date on Today", async () => {
    const task = openTask({
      id: "t-sun",
      title: "Pricing sync",
      due_date: "2026-08-16",
    });
    tasksRef.current = createMemoryTasksApi([task]);
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Pricing sync",
        start: minutesToIso(TODAY, 13 * 60),
        end: minutesToIso(TODAY, 14 * 60),
        task_id: "t-sun",
        created_at: "2026-08-14T00:00:00.000Z",
      },
    ]);
    render(
      <TasksView
        notes={notes}
        today={TODAY}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
      />,
    );
    const pane = await screen.findByRole("region", { name: "Tasks" });
    expect(within(pane).queryByRole("tab")).toBeNull();
    const today = await within(pane).findByRole("region", {
      name: /Today /,
    });
    expect(within(today).getByText("Pricing sync")).toBeInTheDocument();
    expect(within(today).getByText("13:00–14:00")).toBeInTheDocument();
    expect(within(today).getByText("(Due: Aug 16)")).toBeInTheDocument();
    expect(within(pane).queryByRole("region", { name: "Overdue" })).toBeNull();
  });

  it("keeps a Friday block with a Thursday due date in Overdue", async () => {
    const task = openTask({
      id: "t-thu",
      title: "Late brief",
      due_date: "2026-08-13",
    });
    tasksRef.current = createMemoryTasksApi([task]);
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Late brief",
        start: minutesToIso(TODAY, 13 * 60),
        end: minutesToIso(TODAY, 14 * 60),
        task_id: "t-thu",
        created_at: "2026-08-14T00:00:00.000Z",
      },
    ]);
    render(
      <TasksView
        notes={notes}
        today={TODAY}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
      />,
    );
    const pane = await screen.findByRole("region", { name: "Tasks" });
    const overdue = await within(pane).findByRole("region", {
      name: "Overdue",
    });
    expect(within(overdue).getByText("Late brief")).toBeInTheDocument();
    expect(within(overdue).getByText("13:00–14:00")).toBeInTheDocument();
    expect(within(overdue).getByText("(Due: Aug 13)")).toHaveClass(
      "is-overdue",
    );
    expect(within(pane).queryByRole("region", { name: /Today / })).toBeNull();
  });

  it("returns an unscheduled undated task after its event is deleted", async () => {
    const task = openTask({ id: "t-inbox", title: "Beatport kündigen" });
    tasksRef.current = createMemoryTasksApi([task]);
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Beatport kündigen",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 18 * 60 + 15),
        task_id: "t-inbox",
        created_at: "2026-08-14T00:00:00.000Z",
      },
    ]);
    const { emitCalendarChanged } = await import("../calendar/api");
    render(
      <TasksView
        notes={notes}
        today={TODAY}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
      />,
    );
    const pane = await screen.findByRole("region", { name: "Tasks" });
    expect(
      await within(pane).findByRole("region", { name: /Today / }),
    ).toBeInTheDocument();

    await calRef.current.deleteEvent("block");
    emitCalendarChanged();

    await waitFor(() => {
      expect(within(pane).queryByRole("region", { name: /Today / })).toBeNull();
    });
    expect(
      within(pane).getByRole("region", { name: "Unscheduled" }),
    ).toBeInTheDocument();
    expect(within(pane).getByText("Beatport kündigen")).toBeInTheDocument();
  });

  it("shows completed tasks only when the Completed toggle is on", async () => {
    const user = userEvent.setup();
    tasksRef.current = createMemoryTasksApi([
      openTask({ id: "t-open", title: "Buy milk" }),
      openTask({
        id: "t-done",
        title: "Wrapped up",
        state: "done",
        due_date: TODAY,
        completed_at: "2026-08-14T12:00:00.000Z",
      }),
    ]);
    render(
      <TasksView
        notes={notes}
        today={TODAY}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
      />,
    );
    const pane = await screen.findByRole("region", { name: "Tasks" });
    expect(within(pane).getByText("Buy milk")).toBeInTheDocument();
    expect(within(pane).queryByText("Wrapped up")).toBeNull();

    const toggle = within(pane).getByRole("button", { name: "Completed" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await within(pane).findByText("Wrapped up")).toBeInTheDocument();

    await user.click(toggle);
    await waitFor(() => {
      expect(within(pane).queryByText("Wrapped up")).toBeNull();
    });
  });
});
