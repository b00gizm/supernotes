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
import type { CalendarEvent } from "./types";

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

const dueToday: Task = {
  id: "t-today",
  note_id: "n1",
  title: "Ship pricing brief",
  state: "open",
  due_date: TODAY,
  priority: "medium",
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
  completed_at: null,
};

const dueWed: Task = {
  id: "t-wed",
  note_id: "n1",
  title: "Interview Priya",
  state: "open",
  due_date: "2026-08-12",
  priority: null,
  created_at: "2026-08-10T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
  completed_at: null,
};

function mockGridRect() {
  const grid = document.querySelector(".cal-grid");
  expect(grid).toBeTruthy();
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
  return grid as HTMLElement;
}

function renderCalendar(
  onOpenDaily = vi.fn(),
  onOpenTask = vi.fn(),
  onCreateMeetingNote = vi.fn(),
) {
  return render(
    <CalendarView
      today={TODAY}
      notes={notes}
      onOpenDaily={onOpenDaily}
      onOpenTask={onOpenTask}
      onCreateMeetingNote={onCreateMeetingNote}
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
    tasksRef.current = createMemoryTasksApi([overdue, inbox, dueToday, dueWed]);
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

  it("offers Meeting note from an event with the event's date and times", async () => {
    const user = userEvent.setup();
    const onCreateMeetingNote = vi.fn<(event: CalendarEvent) => void>();
    renderCalendar(vi.fn(), vi.fn(), onCreateMeetingNote);
    await screen.findAllByText("Standup");
    await user.click(screen.getByRole("tab", { name: "Agenda" }));
    const hits = await screen.findAllByRole("button", { name: /Standup/ });
    const hit = hits.at(0);
    if (!hit) {
      throw new Error("expected an event to click");
    }
    await user.click(hit);
    await user.click(screen.getByRole("button", { name: "Meeting note" }));
    expect(onCreateMeetingNote).toHaveBeenCalledTimes(1);
    const event = onCreateMeetingNote.mock.calls[0]?.[0];
    expect(event?.title).toBe("Standup");
    expect(event?.start).toBe(minutesToIso(TODAY, 9 * 60 + 30));
    expect(event?.end).toBe(minutesToIso(TODAY, 9 * 60 + 45));
  });

  it("creates an event by dragging on the week grid", async () => {
    renderCalendar();
    await screen.findAllByText("Standup");
    mockGridRect();
    const col = document.querySelector('[data-day="2026-08-11"]');
    expect(col).toBeTruthy();
    fireEvent.mouseDown(col as HTMLElement, { button: 0, clientY: 10 * 48 });
    fireEvent.mouseMove(window, { clientY: 11 * 48 });
    fireEvent.mouseUp(window, { clientY: 11 * 48 });
    await waitFor(() => {
      expect(screen.getAllByLabelText("Event title")).toHaveLength(1);
    });
    const untitled = [...document.querySelectorAll(".cal-event-title")].filter(
      (node) => node.textContent === "Untitled",
    );
    expect(untitled).toHaveLength(1);
    const listed = await calRef.current.listEvents();
    expect(listed.length).toBeGreaterThan(1);
  });
});

describe("CalendarView time blocking (ENG-66)", () => {
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
    tasksRef.current = createMemoryTasksApi([overdue, inbox, dueToday, dueWed]);
  });

  it("lists unscheduled inbox tasks in the calendar sidebar", async () => {
    renderCalendar();
    const sidebar = await screen.findByRole("complementary", {
      name: "Inbox tasks",
    });
    expect(
      within(sidebar).getByRole("heading", { name: "Unscheduled Tasks" }),
    ).toBeInTheDocument();
    expect(within(sidebar).getByText("Beatport kündigen")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Survey → beta list")).toBeNull();
  });

  it("schedules an inbox task onto the grid and hides it from the sidebar", async () => {
    renderCalendar();
    const sidebar = await screen.findByRole("complementary", {
      name: "Inbox tasks",
    });
    const row = sidebar.querySelector(
      '[data-task-id="t-inbox"] .cal-inbox-main',
    );
    expect(row).toBeTruthy();
    mockGridRect();
    const col = document.querySelector('[data-day="2026-08-10"]');
    expect(col).toBeTruthy();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(col);
    fireEvent.mouseDown(row as HTMLElement, {
      button: 0,
      clientX: 80,
      clientY: 18 * 48,
    });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 18 * 48 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 18 * 48 });
    await waitFor(() => {
      expect(
        within(sidebar).queryByText("Beatport kündigen"),
      ).not.toBeInTheDocument();
    });
    const listed = await calRef.current.listEvents();
    const linked = listed.find((item) => item.task_id === "t-inbox");
    expect(linked).toBeTruthy();
    expect(linked?.title).toBe("Beatport kündigen");
    expect(
      Date.parse(linked?.end ?? "") - Date.parse(linked?.start ?? ""),
    ).toBe(15 * 60_000);
  });

  it("persists a resize and a move", async () => {
    renderCalendar();
    await screen.findAllByText("Standup");
    mockGridRect();
    const resize = screen.getByRole("button", { name: "Resize Standup" });
    fireEvent.mouseDown(resize, { button: 0, clientY: 9.75 * 48 });
    fireEvent.mouseMove(window, { clientY: 11 * 48 });
    fireEvent.mouseUp(window);
    await waitFor(async () => {
      const listed = await calRef.current.listEvents();
      const standup = listed.find((item) => item.id === "standup");
      expect(standup?.end).toBe(minutesToIso(TODAY, 11 * 60));
    });

    const hit = document.querySelector(".cal-event-hit");
    expect(hit).toBeTruthy();
    fireEvent.mouseDown(hit as HTMLElement, { button: 0, clientY: 9.5 * 48 });
    fireEvent.mouseMove(window, { clientY: 10.5 * 48 });
    fireEvent.mouseUp(window);
    await waitFor(async () => {
      const listed = await calRef.current.listEvents();
      const standup = listed.find((item) => item.id === "standup");
      expect(standup?.start).toBe(minutesToIso(TODAY, 10 * 60 + 30));
      expect(standup?.end).toBe(minutesToIso(TODAY, 12 * 60));
    });
  });

  it("clamps a 2-hour move to 24h minus duration, not 15min (ENG-133)", async () => {
    calRef.current = createMemoryCalendarApi([
      {
        id: "deep-work",
        title: "Deep work",
        start: minutesToIso(TODAY, 10 * 60),
        end: minutesToIso(TODAY, 12 * 60),
        task_id: null,
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    renderCalendar();
    await screen.findAllByText("Deep work");
    mockGridRect();
    const hit = document.querySelector(".cal-event-hit");
    expect(hit).toBeTruthy();
    fireEvent.mouseDown(hit as HTMLElement, { button: 0, clientY: 10 * 48 });
    fireEvent.mouseMove(window, { clientY: 24 * 48 });
    fireEvent.mouseUp(window);
    await waitFor(async () => {
      const listed = await calRef.current.listEvents();
      const moved = listed.find((item) => item.id === "deep-work");
      expect(moved?.start).toBe(minutesToIso(TODAY, 22 * 60));
      expect(moved?.end).toBe(minutesToIso(TODAY, 24 * 60));
    });
  });

  it("marks a linked event done without deleting the task", async () => {
    const user = userEvent.setup();
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Beatport kündigen",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 19 * 60),
        task_id: "t-inbox",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    renderCalendar();
    const sidebar = await screen.findByRole("complementary", {
      name: "Inbox tasks",
    });
    await waitFor(() => {
      expect(
        within(sidebar).queryByText("Beatport kündigen"),
      ).not.toBeInTheDocument();
    });
    const chip = document.querySelector(".cal-event.is-task");
    expect(chip).toBeTruthy();
    await user.click(
      within(chip as HTMLElement).getByRole("button", {
        name: "Mark task done",
      }),
    );
    await waitFor(() => {
      expect(document.querySelector(".cal-event.is-done")).toBeTruthy();
    });
    const task = await tasksRef.current.getTask("t-inbox");
    expect(task.state).toBe("done");
  });

  it("deletes the linked event and restores an open task to the inbox", async () => {
    const user = userEvent.setup();
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Beatport kündigen",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 19 * 60),
        task_id: "t-inbox",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    renderCalendar();
    const sidebar = await screen.findByRole("complementary", {
      name: "Inbox tasks",
    });
    await waitFor(() => {
      expect(
        within(sidebar).queryByText("Beatport kündigen"),
      ).not.toBeInTheDocument();
    });
    const hit = document.querySelector(".cal-event.is-task .cal-event-hit");
    expect(hit).toBeTruthy();
    mockGridRect();
    fireEvent.mouseDown(hit as HTMLElement, { button: 0, clientY: 18 * 48 });
    fireEvent.mouseUp(window);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(
        within(sidebar).getByText("Beatport kündigen"),
      ).toBeInTheDocument();
    });
    const listed = await calRef.current.listEvents();
    expect(listed.some((item) => item.id === "block")).toBe(false);
    const kept = await tasksRef.current.getTask("t-inbox");
    expect(kept.title).toBe("Beatport kündigen");
    expect(kept.state).toBe("open");
  });

  it("does not return a done task to the inbox after deleting its event", async () => {
    const user = userEvent.setup();
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Beatport kündigen",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 19 * 60),
        task_id: "t-inbox",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    renderCalendar();
    const sidebar = await screen.findByRole("complementary", {
      name: "Inbox tasks",
    });
    const chip = await waitFor(() => {
      const node = document.querySelector(".cal-event.is-task");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    await user.click(
      within(chip).getByRole("button", { name: "Mark task done" }),
    );
    await waitFor(() => {
      expect(document.querySelector(".cal-event.is-done")).toBeTruthy();
    });
    const hit = chip.querySelector(".cal-event-hit");
    expect(hit).toBeTruthy();
    mockGridRect();
    fireEvent.mouseDown(hit as HTMLElement, { button: 0, clientY: 18 * 48 });
    fireEvent.mouseUp(window);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => {
      const listed = await calRef.current.listEvents();
      expect(listed.some((item) => item.id === "block")).toBe(false);
    });
    expect(within(sidebar).queryByText("Beatport kündigen")).toBeNull();
    const kept = await tasksRef.current.getTask("t-inbox");
    expect(kept.state).toBe("done");
  });
});

describe("CalendarView all-day chips (ENG-67)", () => {
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
    tasksRef.current = createMemoryTasksApi([overdue, inbox, dueToday, dueWed]);
  });

  it("shows due tasks as chips on their day and overdue chips on today", async () => {
    renderCalendar();
    const allDay = await screen.findByRole("group", { name: "All-day" });
    const todayCell = allDay.querySelector('[data-allday="2026-08-10"]');
    const wedCell = allDay.querySelector('[data-allday="2026-08-12"]');
    expect(todayCell).toBeTruthy();
    expect(wedCell).toBeTruthy();
    expect(
      await within(todayCell as HTMLElement).findByText("Ship pricing brief"),
    ).toBeInTheDocument();
    const overdueChip = await within(todayCell as HTMLElement).findByText(
      "Survey → beta list",
    );
    expect(overdueChip.closest(".cal-chip")).toHaveClass("is-overdue");
    expect(
      within(todayCell as HTMLElement).queryByText("Interview Priya"),
    ).toBeNull();
    expect(
      await within(wedCell as HTMLElement).findByText("Interview Priya"),
    ).toBeInTheDocument();
    expect(
      within(allDay).queryByText("Beatport kündigen"),
    ).not.toBeInTheDocument();
  });

  it("hides a due chip once the task has a time block", async () => {
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Ship pricing brief",
        start: minutesToIso(TODAY, 11 * 60),
        end: minutesToIso(TODAY, 11 * 60 + 15),
        task_id: "t-today",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    renderCalendar();
    const allDay = await screen.findByRole("group", { name: "All-day" });
    await waitFor(() => {
      expect(
        within(allDay).queryByText("Ship pricing brief"),
      ).not.toBeInTheDocument();
    });
    expect(document.querySelector(".cal-event.is-task")).toBeTruthy();
  });

  it("converts a chip into a 15-minute event when dragged onto the grid", async () => {
    renderCalendar();
    const allDay = await screen.findByRole("group", { name: "All-day" });
    const chip = await waitFor(() => {
      const node = allDay.querySelector(
        '[data-task-id="t-today"] .cal-chip-main',
      );
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    mockGridRect();
    const col = document.querySelector('[data-day="2026-08-10"]');
    expect(col).toBeTruthy();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(col);
    fireEvent.mouseDown(chip, { button: 0, clientX: 80, clientY: 14 * 48 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 14 * 48 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 14 * 48 });
    await waitFor(() => {
      expect(
        within(allDay).queryByText("Ship pricing brief"),
      ).not.toBeInTheDocument();
    });
    const listed = await calRef.current.listEvents();
    const linked = listed.find((item) => item.task_id === "t-today");
    expect(linked).toBeTruthy();
    expect(linked?.title).toBe("Ship pricing brief");
    expect(
      Date.parse(linked?.end ?? "") - Date.parse(linked?.start ?? ""),
    ).toBe(15 * 60_000);
  });

  it("resolves a task from the chip and drops it from the all-day row", async () => {
    const user = userEvent.setup();
    renderCalendar();
    const allDay = await screen.findByRole("group", { name: "All-day" });
    const chip = await waitFor(() => {
      const node = allDay.querySelector('[data-task-id="t-overdue"]');
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });
    await user.click(
      within(chip).getByRole("button", { name: "Mark task done" }),
    );
    await waitFor(() => {
      expect(
        within(allDay).queryByText("Survey → beta list"),
      ).not.toBeInTheDocument();
    });
    const saved = await tasksRef.current.getTask("t-overdue");
    expect(saved.state).toBe("done");
  });
});

describe("CalendarView linked-task load (ENG-137)", () => {
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
    tasksRef.current = createMemoryTasksApi([overdue, inbox, dueToday, dueWed]);
  });

  it("keeps unlinked events chip-less without an error", async () => {
    renderCalendar();
    expect(await screen.findAllByText("Standup")).not.toHaveLength(0);
    expect(await screen.findByText("Beatport kündigen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector(".cal-event.is-task")).toBeNull();
  });

  it("surfaces a getTask failure instead of a silent missing chip", async () => {
    const inner = createMemoryTasksApi([overdue, inbox, dueToday, dueWed]);
    tasksRef.current = {
      ...inner,
      getTask: (id: string) =>
        id === "t-linked"
          ? Promise.reject(new Error("task lookup failed"))
          : inner.getTask(id),
    };
    calRef.current = createMemoryCalendarApi([
      {
        id: "block",
        title: "Orphan block",
        start: minutesToIso(TODAY, 18 * 60),
        end: minutesToIso(TODAY, 19 * 60),
        task_id: "t-linked",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    renderCalendar();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "task lookup failed",
    );
    expect(await screen.findAllByText("Orphan block")).not.toHaveLength(0);
    expect(document.querySelector(".cal-event.is-task")).toBeNull();
  });
});

describe("CalendarView event edit (ENG-132)", () => {
  const overnightStart = minutesToIso(TODAY, 23 * 60);
  const overnightEnd = minutesToIso(TODAY, 25 * 60);

  beforeEach(() => {
    calRef.current = createMemoryCalendarApi([
      {
        id: "overnight",
        title: "Night shift",
        start: overnightStart,
        end: overnightEnd,
        task_id: null,
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    tasksRef.current = createMemoryTasksApi([overdue, inbox, dueToday, dueWed]);
  });

  it("keeps full cross-midnight times on blur and does not persist on Escape", async () => {
    const user = userEvent.setup();
    renderCalendar();
    await screen.findAllByText("Night shift");
    mockGridRect();
    const openEdit = () => {
      const hit = document.querySelector(".cal-event-hit");
      expect(hit).toBeTruthy();
      fireEvent.mouseDown(hit as HTMLElement, { button: 0, clientY: 23 * 48 });
      fireEvent.mouseUp(window);
    };

    openEdit();
    await screen.findByLabelText("Event title");
    const form = document.querySelector(".cal-event-form");
    expect(form).toBeInstanceOf(HTMLElement);
    expect(Number.parseFloat((form as HTMLElement).style.top)).toBeGreaterThan(
      0,
    );
    expect(screen.getByLabelText("Start time")).toHaveValue("23:00");
    expect(screen.getByLabelText("End time")).toHaveValue("01:00");
    await user.click(screen.getByText("August 2026"));
    await waitFor(() => {
      expect(screen.queryByLabelText("Event title")).not.toBeInTheDocument();
    });
    await waitFor(async () => {
      const listed = await calRef.current.listEvents();
      const overnight = listed.find((item) => item.id === "overnight");
      expect(overnight?.start).toBe(overnightStart);
      expect(overnight?.end).toBe(overnightEnd);
    });

    openEdit();
    const title = await screen.findByLabelText("Event title");
    await user.type(title, " changed");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("Event title")).not.toBeInTheDocument();
    });
    const afterEscape = await calRef.current.listEvents();
    const overnight = afterEscape.find((item) => item.id === "overnight");
    expect(overnight?.title).toBe("Night shift");
    expect(overnight?.start).toBe(overnightStart);
    expect(overnight?.end).toBe(overnightEnd);
  });
});
