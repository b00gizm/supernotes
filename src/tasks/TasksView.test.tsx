import { render, screen, waitFor, within } from "@testing-library/react";
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

const inbox: Task = {
  id: "t-inbox",
  note_id: "n1",
  title: "Beatport kündigen",
  state: "open",
  due_date: null,
  priority: null,
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
  completed_at: null,
};

describe("TasksView inbox vs time-blocking", () => {
  beforeEach(() => {
    calRef.current = createMemoryCalendarApi();
    tasksRef.current = createMemoryTasksApi([inbox]);
  });

  it("hides inbox tasks that have a linked calendar event", async () => {
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Beatport kündigen",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 18 * 60 + 15),
        task_id: "t-inbox",
        created_at: "2026-08-10T00:00:00.000Z",
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
    await waitFor(() => {
      expect(within(pane).queryByText("Beatport kündigen")).toBeNull();
    });
    expect(
      within(pane).getByText(
        "Inbox is empty. Type [] at the start of a line in a note.",
      ),
    ).toBeInTheDocument();
  });

  it("returns the task to inbox after the linked event is deleted", async () => {
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Beatport kündigen",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 18 * 60 + 15),
        task_id: "t-inbox",
        created_at: "2026-08-10T00:00:00.000Z",
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
    await waitFor(() => {
      expect(within(pane).queryByText("Beatport kündigen")).toBeNull();
    });

    await calRef.current.deleteEvent("block");
    emitCalendarChanged();

    expect(
      await within(pane).findByText("Beatport kündigen"),
    ).toBeInTheDocument();
  });
});
