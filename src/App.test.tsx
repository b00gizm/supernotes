import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { agendaHeading, startOfWeekMonday, weekDays } from "./calendar/layout";
import type { NotesApi } from "./notes/api";
import {
  createMemoryMeetingsApi,
  type MeetingsApi,
  type MemoryMeetingsApi,
} from "./notes/meetings";
import { createMemoryRecordingApi, type RecordingApi } from "./notes/recording";
import type { Meeting } from "./notes/types";
import {
  formatDailyDisplayTitle,
  formatDailyTitle,
  dailyDisplayTitle,
  shiftDailyTitle,
} from "./notes/format";
import { createMemoryNotesApi } from "./notes/memoryApi";
import type { TasksApi } from "./tasks/api";
import { createMemoryTasksApi } from "./tasks/memoryApi";
import type { Task } from "./tasks/types";
import {
  createMemoryMeetingSummaryApi,
  type MeetingSummaryApi,
  type SummaryParticipant,
} from "./meetings/summaryApi";

const summaryApiRef: { current: MeetingSummaryApi } = {
  current: createMemoryMeetingSummaryApi(),
};

const apiRef: { current: NotesApi } = {
  current: createMemoryNotesApi(),
};

const tasksApiRef: { current: TasksApi } = {
  current: createMemoryTasksApi(),
};

const meetingsApiRef: { current: MemoryMeetingsApi } = {
  current: createMemoryMeetingsApi(apiRef.current),
};

function bindRecordingApi(): RecordingApi {
  return createMemoryRecordingApi(
    apiRef.current,
    {
      getMeeting: (noteId) => meetingsApiRef.current.getMeeting(noteId),
      linkTranscript: (noteId, transcriptNoteId) => {
        meetingsApiRef.current.linkTranscript(noteId, transcriptNoteId);
      },
    },
    {
      segmentsFor: () => [
        {
          clock: "14:02",
          text: "Let's lock the Q3 pricing before the board deck goes out.",
          start_ms: 120_000,
          end_ms: 128_000,
        },
      ],
    },
  );
}

const recordingApiRef: { current: RecordingApi } = {
  current: bindRecordingApi(),
};

const PRICING_MEETING: Meeting = {
  note_id: "m1",
  meeting_date: "2026-08-10",
  start_time: "14:00",
  end_time: "14:23",
  transcript_note_id: null,
  calendar_event_id: null,
};

vi.mock("./notes/api", async () => {
  const actual =
    await vi.importActual<typeof import("./notes/api")>("./notes/api");
  return {
    ...actual,
    notesApi: {
      listNotes: () => apiRef.current.listNotes(),
      searchNotes: (query: string) => apiRef.current.searchNotes(query),
      createNote: (input: Parameters<NotesApi["createNote"]>[0]) =>
        apiRef.current.createNote(input),
      getOrCreateDaily: (date: string) => apiRef.current.getOrCreateDaily(date),
      updateNote: (input: Parameters<NotesApi["updateNote"]>[0]) =>
        apiRef.current.updateNote(input),
      setPinned: (id: string, pinned: boolean) =>
        apiRef.current.setPinned(id, pinned),
      deleteNote: (id: string) => apiRef.current.deleteNote(id),
      listLinksFrom: (sourceNoteId: string) =>
        apiRef.current.listLinksFrom(sourceNoteId),
      listLinksTo: (targetNoteId: string) =>
        apiRef.current.listLinksTo(targetNoteId),
    },
  };
});

vi.mock("./notes/meetings", async () => {
  const actual =
    await vi.importActual<typeof import("./notes/meetings")>(
      "./notes/meetings",
    );
  return {
    ...actual,
    meetingsApi: {
      getMeeting: (noteId: string) => meetingsApiRef.current.getMeeting(noteId),
      createMeetingNote: (
        input: Parameters<MeetingsApi["createMeetingNote"]>[0],
      ) => meetingsApiRef.current.createMeetingNote(input),
      createMeetingNoteFromEvent: (eventId: string) =>
        meetingsApiRef.current.createMeetingNoteFromEvent(eventId),
      updateMeeting: (input: Parameters<MeetingsApi["updateMeeting"]>[0]) =>
        meetingsApiRef.current.updateMeeting(input),
      getMeetingForEvent: (eventId: string) =>
        meetingsApiRef.current.getMeetingForEvent(eventId),
    },
  };
});

vi.mock("./notes/recording", async () => {
  const actual =
    await vi.importActual<typeof import("./notes/recording")>(
      "./notes/recording",
    );
  return {
    ...actual,
    recordingApi: {
      startRecording: (meetingNoteId: string, modelId?: string) =>
        recordingApiRef.current.startRecording(meetingNoteId, modelId),
      stopRecording: () => recordingApiRef.current.stopRecording(),
      getRecordingState: () => recordingApiRef.current.getRecordingState(),
      getMicrophonePermission: () =>
        recordingApiRef.current.getMicrophonePermission(),
      listTranscriptionModels: () =>
        recordingApiRef.current.listTranscriptionModels(),
      ensureTranscriptionModel: (modelId: string) =>
        recordingApiRef.current.ensureTranscriptionModel(modelId),
    },
  };
});

vi.mock("./meetings/summaryApi", async () => {
  const actual = await vi.importActual<typeof import("./meetings/summaryApi")>(
    "./meetings/summaryApi",
  );
  return {
    ...actual,
    summaryApi: {
      getSummary: (meetingNoteId: string) =>
        summaryApiRef.current.getSummary(meetingNoteId),
      generateSummary: (meetingNoteId: string) =>
        summaryApiRef.current.generateSummary(meetingNoteId),
      saveParticipants: (
        meetingNoteId: string,
        participants: SummaryParticipant[],
      ) => summaryApiRef.current.saveParticipants(meetingNoteId, participants),
    },
  };
});

vi.mock("./tasks/api", async () => {
  const actual =
    await vi.importActual<typeof import("./tasks/api")>("./tasks/api");
  return {
    ...actual,
    tasksApi: {
      createTask: (input: Parameters<TasksApi["createTask"]>[0]) =>
        tasksApiRef.current.createTask(input),
      getTask: (id: string) => tasksApiRef.current.getTask(id),
      listTasks: (
        filter: Parameters<TasksApi["listTasks"]>[0],
        today: string,
      ) => tasksApiRef.current.listTasks(filter, today),
      listTasksForNote: (noteId: string) =>
        tasksApiRef.current.listTasksForNote(noteId),
      searchTasks: (query: string) => tasksApiRef.current.searchTasks(query),
      updateTask: (input: Parameters<TasksApi["updateTask"]>[0]) =>
        tasksApiRef.current.updateTask(input),
      deleteTask: (id: string) => tasksApiRef.current.deleteTask(id),
    },
  };
});

describe("App shell", () => {
  beforeEach(() => {
    apiRef.current = createMemoryNotesApi();
    tasksApiRef.current = createMemoryTasksApi();
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current);
    recordingApiRef.current = bindRecordingApi();
    summaryApiRef.current = createMemoryMeetingSummaryApi();
  });

  async function expandRecent(user: ReturnType<typeof userEvent.setup>) {
    const toggle = screen.getByRole("button", { name: /^Recent$/i });
    if (toggle.getAttribute("aria-expanded") !== "true") {
      await user.click(toggle);
    }
  }

  it("opens today's daily note by default with shell chrome", async () => {
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Daily Note" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Daily Note" })).toHaveClass(
      "is-active",
    );
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Recent$/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    const title = formatDailyDisplayTitle();
    expect(await screen.findByLabelText("Note title")).toHaveValue(title);
    expect(
      screen.queryByRole("region", { name: "Due" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pin note" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Unpin note" }),
    ).not.toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(
      within(sidebar).queryByRole("region", { name: "Pinned" }),
    ).not.toBeInTheDocument();
    expect(within(sidebar).getByText("Supernotes")).toHaveClass(
      "sidebar-wordmark",
    );
  });

  it("opens Settings from the sidebar footer", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
    expect(screen.getByLabelText("API key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeInTheDocument();
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(settings).toHaveClass("sidebar-settings", "is-active");
    expect(settings.closest(".sidebar-footer")).not.toBeNull();
    expect(
      settings.closest(".sidebar-footer")?.querySelector(".sidebar-search"),
    ).toBeNull();
    expect(settings.querySelector("svg")).toBeTruthy();
    // Previous glyph was a sun (radial ticks); footer must read as a cog.
    expect(settings.innerHTML).not.toContain("M8 1.7v1.4");
  });

  it("opens Tasks overview grouped by overdue / day / unscheduled", async () => {
    const user = userEvent.setup();
    const today = formatDailyTitle();
    const todayIso = new Date().toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "n1",
        title: "Project plan",
        body_markdown: "[[task:t-inbox]] Buy milk",
        note_type: "regular",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
      {
        id: "n2",
        title: today,
        body_markdown: "[[task:t-due]] Ship it",
        note_type: "daily",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
    ]);
    const seed: Task[] = [
      {
        id: "t-inbox",
        note_id: "n1",
        title: "Buy milk",
        state: "open",
        due_date: null,
        priority: null,
        created_at: todayIso,
        updated_at: todayIso,
        completed_at: null,
      },
      {
        id: "t-due",
        note_id: "n2",
        title: "Ship it",
        state: "open",
        due_date: "2026-08-01",
        priority: "high",
        created_at: todayIso,
        updated_at: todayIso,
        completed_at: null,
      },
      {
        id: "t-done",
        note_id: "n1",
        title: "Wrapped up",
        state: "done",
        due_date: null,
        priority: null,
        created_at: todayIso,
        updated_at: todayIso,
        completed_at: todayIso,
      },
    ];
    tasksApiRef.current = createMemoryTasksApi(seed);

    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Tasks" }));

    const pane = await screen.findByRole("region", { name: "Tasks" });
    expect(within(pane).queryByRole("tab")).toBeNull();
    expect(
      within(pane).getByRole("button", { name: "Buy milk" }),
    ).toBeInTheDocument();
    expect(
      within(pane).getByRole("button", { name: "Ship it" }),
    ).toBeInTheDocument();
    const overdue = within(pane).getByRole("region", { name: "Overdue" });
    const unscheduled = within(pane).getByRole("region", {
      name: "Unscheduled",
    });
    expect(
      Boolean(
        unscheduled.compareDocumentPosition(overdue) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(within(pane).getByText("Aug 1")).toHaveClass("is-overdue");
    expect(within(overdue).getByText("Daily note")).toBeInTheDocument();
    expect(within(unscheduled).getByText("Project plan")).toBeInTheDocument();
    expect(
      within(pane).queryByRole("button", { name: "Wrapped up" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(unscheduled).getByRole("button", { name: "Mark task done" }),
    );
    await waitFor(() => {
      expect(
        within(pane).queryByRole("button", { name: "Buy milk" }),
      ).not.toBeInTheDocument();
    });

    await user.click(within(pane).getByRole("button", { name: "Ship it" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      dailyDisplayTitle(today),
    );
  });

  it("opens Calendar week + agenda and day headers jump to the daily note", async () => {
    const user = userEvent.setup();
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Calendar" }));

    const pane = await screen.findByRole("region", { name: "Calendar" });
    expect(within(pane).getByRole("tab", { name: "Week" })).toBeInTheDocument();
    expect(
      within(pane).getByRole("tab", { name: "Agenda" }),
    ).toBeInTheDocument();
    expect(within(pane).getByLabelText("Week navigation")).toBeInTheDocument();

    const headers = within(pane).getAllByRole("button", {
      name: /Open daily note for /,
    });
    expect(headers.length).toBe(7);
    const monday = headers.at(0);
    if (!monday) {
      throw new Error("expected a day header");
    }
    await user.click(monday);
    expect(await screen.findByLabelText("Note title")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Calendar" }),
    ).not.toBeInTheDocument();
  });

  it("opens Notes overview with Pinned/Today groups and pin action", async () => {
    const user = userEvent.setup();
    const now = new Date();
    const todayIso = now.toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "p1",
        title: "Meridian Q3 roadmap",
        body_markdown: "Draft outline for #meridian",
        note_type: "regular",
        pinned: true,
        created_at: todayIso,
        updated_at: todayIso,
      },
      {
        id: "t1",
        title: "Interview — Priya Sharma",
        body_markdown: "Notes with @Priya Sharma",
        note_type: "regular",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);

    render(<App />);
    expect(await screen.findByLabelText("Note title")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Notes" }));
    const overview = await screen.findByRole("region", {
      name: "Notes overview",
    });
    expect(
      within(overview).getByRole("button", { name: "+ New note" }),
    ).toHaveClass("new-note-button");
    expect(
      within(overview).getByRole("button", { name: "+ New meeting note" }),
    ).toHaveClass("new-note-button");
    expect(within(overview).getByText("3")).toBeInTheDocument();
    expect(
      within(overview).getByRole("region", { name: "Pinned" }),
    ).toBeInTheDocument();
    expect(
      within(overview).getByRole("region", { name: "Today" }),
    ).toBeInTheDocument();
    expect(within(overview).getByText("#meridian")).toBeInTheDocument();
    const meetingRow = within(overview).getByRole("button", {
      name: /Pricing sync/,
    });
    expect(meetingRow.querySelector(".waveform-icon")).toBeTruthy();
    expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const pinnedSection = within(sidebar).getByRole("region", {
      name: "Pinned",
    });
    expect(
      within(pinnedSection).getByRole("button", {
        name: "Meridian Q3 roadmap",
      }),
    ).toBeInTheDocument();

    const pinnedRow = within(overview).getByRole("button", {
      name: /Meridian Q3 roadmap/,
    });
    await user.pointer({ keys: "[MouseRight>]", target: pinnedRow });
    // Leftover mouse event from the opening gesture must not dismiss the menu.
    window.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    const unpin = await screen.findByRole("menuitem", { name: "Unpin" });
    await user.click(unpin);
    expect(
      within(overview).queryByRole("region", { name: "Pinned" }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("region", { name: "Pinned" }),
    ).not.toBeInTheDocument();
  });

  it("pins a note from the overview context menu", async () => {
    const user = userEvent.setup();
    const todayIso = new Date().toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "t1",
        title: "Interview — Priya Sharma",
        body_markdown: "Notes",
        note_type: "regular",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
    ]);

    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Notes" }));
    const overview = await screen.findByRole("region", {
      name: "Notes overview",
    });
    const row = within(overview).getByRole("button", {
      name: /Interview/,
    });
    await user.pointer({ keys: "[MouseRight>]", target: row });
    await user.click(await screen.findByRole("menuitem", { name: "Pin" }));
    expect(
      within(overview).getByRole("region", { name: "Pinned" }),
    ).toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(
      within(sidebar).getByRole("region", { name: "Pinned" }),
    ).toBeInTheDocument();
  });

  it("pins a note from the editor toolbar", async () => {
    const user = userEvent.setup();
    const todayIso = new Date().toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "t1",
        title: "Interview — Priya Sharma",
        body_markdown: "Notes",
        note_type: "regular",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(
      within(sidebar).queryByRole("region", { name: "Pinned" }),
    ).not.toBeInTheDocument();

    await expandRecent(user);
    await user.click(
      within(sidebar).getByRole("button", { name: "Interview — Priya Sharma" }),
    );
    const pin = await screen.findByRole("button", { name: "Pin note" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    await user.click(pin);

    expect(
      within(sidebar).getByRole("region", { name: "Pinned" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin note" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows Notes breadcrumb on regular notes, not daily notes", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current, {
      meetings: [PRICING_MEETING],
    });
    recordingApiRef.current = bindRecordingApi();

    render(<App />);
    await screen.findByLabelText("Note title");
    expect(
      screen.queryByRole("button", { name: "Back to Notes" }),
    ).not.toBeInTheDocument();

    await expandRecent(user);
    await user.click(screen.getByRole("button", { name: "Pricing sync" }));
    const crumb = await screen.findByRole("button", { name: "Back to Notes" });
    expect(screen.getByLabelText("Meeting details")).toBeInTheDocument();
    expect(screen.getByText("Mon, Aug 10")).toBeInTheDocument();
    expect(screen.getByText("14:00 – 14:23")).toBeInTheDocument();
    await user.click(crumb);
    expect(
      await screen.findByRole("region", { name: "Notes overview" }),
    ).toBeInTheDocument();
  });

  it("opens a linked transcript note from the meeting header", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "t1",
        title: "Pricing sync transcript",
        body_markdown: "Let's lock the Q3 pricing",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-10T14:23:00.000Z",
        updated_at: "2026-08-10T14:23:00.000Z",
      },
    ]);
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current, {
      meetings: [{ ...PRICING_MEETING, transcript_note_id: "t1" }],
    });
    recordingApiRef.current = bindRecordingApi();

    render(<App />);
    await expandRecent(user);
    await user.click(
      await screen.findByRole("button", { name: "Pricing sync" }),
    );
    await user.click(await screen.findByRole("button", { name: "Transcript" }));

    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Pricing sync transcript",
    );
    expect(screen.queryByLabelText("Meeting details")).not.toBeInTheDocument();
  });

  it("records via Woz IPC mock and opens the persisted transcript note", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current, {
      meetings: [PRICING_MEETING],
    });
    recordingApiRef.current = bindRecordingApi();
    summaryApiRef.current = {
      getSummary: () => Promise.resolve(null),
      generateSummary: (meetingNoteId) =>
        Promise.resolve({ stream_id: "quiet", meeting_note_id: meetingNoteId }),
      saveParticipants: () => Promise.reject(new Error("unused")),
    };

    render(<App />);
    await expandRecent(user);
    await user.click(
      await screen.findByRole("button", { name: "Pricing sync" }),
    );
    await user.click(await screen.findByRole("button", { name: "Record" }));

    const panel = await screen.findByLabelText("Live transcript");
    expect(panel).toHaveTextContent(/Q3 pricing/);
    expect(panel.textContent).not.toMatch(/\bSara\b|\bMarcus\b|\bYou\b/);

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Transcript" }));

    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Pricing sync — transcript",
    );
  });

  it("creates a meeting note from the notes list with persisted metadata", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([]);
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current);
    recordingApiRef.current = bindRecordingApi();
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Notes" }));
    const overview = await screen.findByRole("region", {
      name: "Notes overview",
    });
    await user.click(
      within(overview).getByRole("button", { name: "+ New meeting note" }),
    );

    expect(await screen.findByLabelText("Note title")).toHaveValue("Untitled");
    expect(
      await screen.findByRole("button", { name: "Back to Notes" }),
    ).toBeInTheDocument();
    const meta = await screen.findByLabelText("Meeting details");
    expect(within(meta).getByText("Meeting")).toBeInTheDocument();
    expect(meta.querySelector(".waveform-icon")).toBeTruthy();

    const created = (await apiRef.current.listNotes()).find(
      (note) => note.note_type === "meeting",
    );
    expect(created).toBeTruthy();
    if (!created) {
      throw new Error("expected a meeting note");
    }
    await expect(
      meetingsApiRef.current.getMeeting(created.id),
    ).resolves.toEqual(
      expect.objectContaining({
        note_id: created.id,
        calendar_event_id: null,
      }),
    );
  });

  it("creates a meeting note from a calendar event and persists the link", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([]);
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current);
    recordingApiRef.current = bindRecordingApi();
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Calendar" }));
    const pane = await screen.findByRole("region", { name: "Calendar" });
    await user.click(within(pane).getByRole("tab", { name: "Agenda" }));
    // Demo "Pricing sync" is Monday of the current week; Agenda is today-only.
    const today = formatDailyTitle();
    const monday = startOfWeekMonday(today);
    const offset = weekDays(monday).indexOf(today);
    for (let step = 0; step < offset; step += 1) {
      await user.click(
        within(pane).getByRole("button", { name: "Previous day" }),
      );
    }
    expect(within(pane).getByRole("heading", { level: 1 })).toHaveTextContent(
      agendaHeading(monday),
    );
    const hits = await screen.findAllByRole("button", { name: /Pricing sync/ });
    const hit = hits.at(0);
    if (!hit) {
      throw new Error("expected a calendar event to click");
    }
    await user.click(hit);
    await user.click(screen.getByRole("button", { name: "Meeting note" }));

    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Pricing sync",
    );
    const created = (await apiRef.current.listNotes()).find(
      (note) => note.note_type === "meeting",
    );
    expect(created).toBeTruthy();
    if (!created) {
      throw new Error("expected a meeting note");
    }
    await expect(
      meetingsApiRef.current.getMeeting(created.id),
    ).resolves.toEqual(
      expect.objectContaining({
        note_id: created.id,
        calendar_event_id: "demo-pricing",
      }),
    );
  });

  it("lists recent notes with meeting waveform and supports edit/delete", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);
    meetingsApiRef.current = createMemoryMeetingsApi(apiRef.current, {
      meetings: [PRICING_MEETING],
    });
    recordingApiRef.current = bindRecordingApi();

    render(<App />);
    await screen.findByLabelText("Note title");

    await expandRecent(user);
    const recent = screen.getByRole("button", { name: "Pricing sync" });
    expect(within(recent).getByText(/Decided to keep/)).toBeInTheDocument();
    expect(recent.querySelector(".waveform-icon")).toBeTruthy();

    await user.click(recent);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Pricing sync",
    );

    const body = await screen.findByLabelText("Note body");
    // Contenteditable: select-all + replace (user.clear is textarea-oriented).
    await user.click(body);
    await user.keyboard("{Control>}a{/Control}Updated decision");
    expect(body).toHaveTextContent("Updated decision");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByRole("region", { name: "Notes overview" }),
    ).toBeInTheDocument();
  });

  it("keeps Recent collapsed on launch and expands to show rows (ENG-156)", async () => {
    const user = userEvent.setup();
    const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "p1",
        title: "Canada 2026 🇨🇦",
        body_markdown: "Offene Todos",
        note_type: "regular",
        pinned: true,
        created_at: threeMinAgo,
        updated_at: threeMinAgo,
      },
      {
        id: "r1",
        title: "Supernotes improvements",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: threeMinAgo,
        updated_at: threeMinAgo,
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const recentSection = within(sidebar).getByRole("region", {
      name: "Recent",
    });
    const recentToggle = within(recentSection).getByRole("button", {
      name: /^Recent$/i,
    });
    expect(recentToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(recentSection).queryByRole("button", {
        name: "Supernotes improvements",
      }),
    ).not.toBeInTheDocument();

    const pinned = within(sidebar).getByRole("region", { name: "Pinned" });
    const pinnedRow = within(pinned).getByRole("button", {
      name: "Canada 2026 🇨🇦",
    });
    expect(pinnedRow).toHaveTextContent("3m · Offene Todos");
    expect(pinnedRow.querySelector(".recent-title")).toHaveTextContent(
      "Canada 2026 🇨🇦",
    );

    await user.click(recentToggle);
    expect(recentToggle).toHaveAttribute("aria-expanded", "true");
    const recentRow = within(recentSection).getByRole("button", {
      name: "Supernotes improvements",
    });
    expect(recentRow).toHaveTextContent("3m · Empty note");

    await user.click(recentToggle);
    expect(recentToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(recentSection).queryByRole("button", {
        name: "Supernotes improvements",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("button", { name: "Canada 2026 🇨🇦" }),
    ).toBeInTheDocument();
  });

  it("strips task tokens from sidebar row snippets (ENG-138)", async () => {
    const user = userEvent.setup();
    const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "n1",
        title: "Sprint plan",
        body_markdown: "[[task:abc]] Buy milk",
        note_type: "regular",
        pinned: false,
        created_at: threeMinAgo,
        updated_at: threeMinAgo,
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");
    await expandRecent(user);
    const row = screen.getByRole("button", { name: "Sprint plan" });
    expect(row).toHaveTextContent("3m · Buy milk");
    expect(row.textContent).not.toMatch(/\[\[task:/);
  });

  it("lays out search, selected nav, and Settings footer (ENG-156)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Note title");

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const search = within(sidebar).getByRole("search");
    expect(within(search).getByRole("button", { name: "Search" })).toHaveClass(
      "sidebar-search",
    );
    expect(within(search).getByText("Search")).toBeInTheDocument();
    expect(within(search).getByText("⌘K")).toBeInTheDocument();

    const nav = within(sidebar).getByRole("navigation", { name: "Primary" });
    const daily = within(nav).getByRole("button", { name: "Daily Note" });
    expect(daily).toHaveClass("is-active");
    expect(daily).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Notes" })).not.toHaveClass(
      "is-active",
    );

    await user.click(within(search).getByRole("button", { name: "Search" }));
    expect(
      await screen.findByLabelText("Search notes and tasks"),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const settings = within(sidebar).getByRole("button", { name: "Settings" });
    expect(settings.closest(".sidebar-footer")).not.toBeNull();
    expect(
      within(sidebar).getByRole("button", { name: "New note" }),
    ).toHaveClass("sidebar-new");
    expect(
      within(sidebar).getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveClass("sidebar-collapse");
  });

  it("keeps New note and collapse on the expanded titlebar (ENG-156)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Note title");

    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(sidebar).getByText("Supernotes")).toHaveClass(
      "sidebar-wordmark",
    );
    expect(
      within(sidebar).getByRole("button", { name: "New note" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Collapse sidebar" }),
    );
    expect(screen.getByLabelText("Supernotes")).toHaveClass(
      "is-sidebar-collapsed",
    );
    expect(within(sidebar).queryByText("Supernotes")).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("button", { name: "New note" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(sidebar).getByRole("button", { name: "Expand sidebar" }),
    );
    expect(screen.getByLabelText("Supernotes")).not.toHaveClass(
      "is-sidebar-collapsed",
    );
    expect(within(sidebar).getByText("Supernotes")).toHaveClass(
      "sidebar-wordmark",
    );
    expect(
      within(sidebar).getByRole("button", { name: "New note" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });

  it("uses an icon rail with accessible names when collapsed", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) =>
        ({
          matches: query === "(max-width: 720px)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
          onchange: null,
        }) as MediaQueryList,
    });

    try {
      render(<App />);
      await screen.findByLabelText("Note title");

      expect(screen.getByLabelText("Supernotes")).toHaveClass(
        "is-sidebar-collapsed",
      );

      const nav = screen.getByRole("navigation", { name: "Primary" });
      for (const label of [
        "Daily Note",
        "Notes",
        "Tasks",
        "Calendar",
      ] as const) {
        const item = within(nav).getByRole("button", { name: label });
        expect(item).toHaveAttribute("aria-label", label);
        expect(item).toHaveAttribute("title", label);
      }
      const search = screen.getByRole("button", { name: "Search" });
      expect(search).toHaveAttribute("title", "Search");
      expect(
        screen.getByRole("button", { name: "Expand sidebar" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "New note" }),
      ).not.toBeInTheDocument();
      expect(
        within(
          screen.getByRole("complementary", { name: "Sidebar" }),
        ).queryByText("Supernotes"),
      ).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("reserves mac overlay titlebar drag regions under traffic lights (ENG-115)", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    const agent = vi
      .spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      );

    try {
      render(<App />);
      await screen.findByLabelText("Note title");

      const shell = screen.getByLabelText("Supernotes");
      expect(shell).toHaveClass("has-mac-overlay-chrome");
      expect(
        within(
          screen.getByRole("complementary", { name: "Sidebar" }),
        ).queryByText("Supernotes"),
      ).not.toBeInTheDocument();

      const dragRegions = shell.querySelectorAll("[data-tauri-drag-region]");
      expect(dragRegions.length).toBe(2);
      expect(shell.querySelector(".titlebar-drag-sidebar")).toBeInTheDocument();
      expect(shell.querySelector(".titlebar-drag-main")).toBeInTheDocument();

      // + and collapse stay below the reserved chrome strip.
      const newNote = screen.getByRole("button", {
        name: "New note",
      });
      const collapse = screen.getByRole("button", {
        name: "Collapse sidebar",
      });
      const sidebarDrag = shell.querySelector(".titlebar-drag-sidebar");
      expect(sidebarDrag).toBeInstanceOf(HTMLElement);
      if (!(sidebarDrag instanceof HTMLElement)) {
        return;
      }
      expect(
        sidebarDrag.compareDocumentPosition(newNote) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        sidebarDrag.compareDocumentPosition(collapse) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      agent.mockRestore();
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  it("shows a dirty-only save dot instead of Unsaved/Saved text (ENG-114)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Note title");
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();

    // Daily titles are read-only (ENG-59); dirty via body instead.
    const body = await screen.findByLabelText("Note body");
    await user.type(body, "Edited daily");
    expect(await screen.findByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("opens title search with ⌘K, filters, and creates from the always-on row", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "n1",
        title: "Pricing sync",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "n2",
        title: "Weekly review",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-08T10:00:00.000Z",
        updated_at: "2026-08-08T10:00:00.000Z",
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByLabelText("Search notes and tasks");
    expect(screen.getByText("esc")).toBeInTheDocument();
    expect(screen.getByText("↑↓ Navigate")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\+ Create note 'Untitled'/ }),
    ).toBeInTheDocument();

    await user.type(search, "pricing");
    const pricing = await screen.findByRole("option", {
      name: /Pricing sync/,
    });
    expect(pricing).toBeInTheDocument();
    expect(within(pricing).getByText("Pricing").tagName).toBe("STRONG");
    expect(
      screen.queryByRole("option", { name: /Weekly review/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\+ Create note 'pricing'/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("⌘+⏎")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByLabelText("Note title")).toHaveValue("pricing");
    expect(
      screen.queryByLabelText("Search notes and tasks"),
    ).not.toBeInTheDocument();
  });

  it("routes early keystrokes into search instead of the open note (ENG-130)", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "n1",
        title: "Hello world",
        body_markdown: "Known unique sentence",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");
    await expandRecent(user);
    await user.click(screen.getByRole("button", { name: "Hello world" }));
    const body = await screen.findByLabelText("Note body");
    expect(body).toHaveTextContent("Known unique sentence");

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByLabelText("Search notes and tasks");

    // Target-phase keydown on the editor: without capture this would hit the
    // note under the overlay before the search input is focused.
    body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        bubbles: true,
        cancelable: true,
      }),
    );

    await waitFor(() => {
      expect(search).toHaveValue("p");
    });
    expect(body).toHaveTextContent("Known unique sentence");
  });

  it("shows backlinks from the links index and hides when empty", async () => {
    const user = userEvent.setup();
    const stamp = "2026-08-09T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "foo",
        title: "Foo",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: "src",
        title: "Source note",
        body_markdown: "See [[Foo]] tomorrow.",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    // Seed link rows (createMemoryNotesApi only syncs on create/update).
    await apiRef.current.updateNote({
      id: "src",
      title: "Source note",
      body_markdown: "See [[Foo]] tomorrow.",
    });

    render(<App />);
    await screen.findByLabelText("Note title");

    await expandRecent(user);
    await user.click(screen.getByRole("button", { name: "Foo" }));
    const backlinks = await screen.findByRole("region", { name: "Backlinks" });
    expect(
      within(backlinks).getByRole("button", { name: /Source note/ }),
    ).toBeInTheDocument();
    const match = within(backlinks).getByText("[[Foo]]");
    expect(match.tagName).toBe("MARK");
    expect(match).toHaveClass("backlink-match");
    expect(match.parentElement).toHaveTextContent("See [[Foo]] tomorrow.");

    await user.click(
      within(backlinks).getByRole("button", { name: /Source note/ }),
    );
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Source note",
    );
    expect(
      screen.queryByRole("region", { name: "Backlinks" }),
    ).not.toBeInTheDocument();
  });

  it("create-on-click @Person keeps an empty Person note selected", async () => {
    // From the daily surface, create-on-click must open Person in one click
    // (leave daily before notes.length bumps so ensureDaily cannot steal).
    const user = userEvent.setup();
    const dailyTitle = formatDailyTitle();
    const dailyBody = "Discuss [[Existing]] with @Person";
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "daily",
        title: dailyTitle,
        body_markdown: dailyBody,
        note_type: "daily",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: "existing",
        title: "Existing",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    await apiRef.current.updateNote({
      id: "daily",
      title: dailyTitle,
      body_markdown: dailyBody,
    });

    render(<App />);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    await screen.findByLabelText("Note body");

    const personLink = await waitFor(() => {
      const el = document.querySelector('.wiki-link[data-title="Person"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(personLink);

    expect(await screen.findByLabelText("Note title")).toHaveValue("Person");
    expect(await screen.findByLabelText("Note body")).toHaveTextContent("");
    expect(
      await screen.findByRole("button", { name: "Back to Notes" }),
    ).toBeInTheDocument();

    const person = (await apiRef.current.listNotes()).find(
      (note) => note.title === "Person",
    );
    expect(person?.body_markdown).toBe("");
  });

  it("double-clicking unresolved wikilink creates only one note (ENG-97)", async () => {
    const user = userEvent.setup();
    const dailyTitle = formatDailyTitle();
    const dailyBody = "Ping @Person";
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "daily",
        title: dailyTitle,
        body_markdown: dailyBody,
        note_type: "daily",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    await apiRef.current.updateNote({
      id: "daily",
      title: dailyTitle,
      body_markdown: dailyBody,
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realCreate = apiRef.current.createNote.bind(apiRef.current);
    const createSpy = vi
      .spyOn(apiRef.current, "createNote")
      .mockImplementation(async (input) => {
        await gate;
        return realCreate(input);
      });

    render(<App />);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    const personLink = await waitFor(() => {
      const el = document.querySelector('.wiki-link[data-title="Person"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    await user.click(personLink);
    await user.click(personLink);
    expect(createSpy).toHaveBeenCalledTimes(1);
    release();

    expect(await screen.findByLabelText("Note title")).toHaveValue("Person");
    const persons = (await apiRef.current.listNotes()).filter(
      (note) => note.title.toLowerCase() === "person",
    );
    expect(persons).toHaveLength(1);
  });

  it("Daily Note nav reopens today from a regular note", async () => {
    const user = userEvent.setup();
    const dailyTitle = formatDailyTitle();
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "daily",
        title: dailyTitle,
        body_markdown: "",
        note_type: "daily",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: "other",
        title: "Other note",
        body_markdown: "hello",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);

    render(<App />);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );

    await expandRecent(user);
    await user.click(screen.getByRole("button", { name: "Other note" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Other note",
    );

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Daily Note" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    expect(
      screen.queryByRole("button", { name: "Back to Notes" }),
    ).not.toBeInTheDocument();
  });

  it("stores daily titles as YYYY-MM-DD and shows the display form (ENG-59)", async () => {
    render(<App />);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    const notes = await apiRef.current.listNotes();
    const daily = notes.find((note) => note.note_type === "daily");
    expect(daily?.title).toBe(formatDailyTitle());
    expect(daily?.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("prev/next walks days and Today jumps back (ENG-60)", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(yesterday),
    );
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    expect(
      screen.queryByRole("button", { name: "Today" }),
    ).not.toBeInTheDocument();
  });

  it("rolls unresolved due tasks onto later daily notes and hides when empty (ENG-64)", async () => {
    const user = userEvent.setup();
    const today = formatDailyTitle();
    const monday = shiftDailyTitle(today, -2);
    const sunday = shiftDailyTitle(today, -3);
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "src",
        title: "Project plan",
        body_markdown: "[[task:t-due]] Ship pricing",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    tasksApiRef.current = createMemoryTasksApi([
      {
        id: "t-due",
        note_id: "src",
        title: "Ship pricing",
        state: "open",
        due_date: monday,
        priority: "high",
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
      {
        id: "t-future",
        note_id: "src",
        title: "Later work",
        state: "open",
        due_date: shiftDailyTitle(today, 3),
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
      {
        id: "t-done",
        note_id: "src",
        title: "Already done",
        state: "done",
        due_date: monday,
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: stamp,
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");

    const dueToday = await screen.findByRole("region", { name: "Due" });
    expect(
      within(dueToday).getByRole("button", { name: "Ship pricing" }),
    ).toBeInTheDocument();
    expect(within(dueToday).getByText("Project plan")).toBeInTheDocument();
    expect(
      within(dueToday).queryByRole("button", { name: "Later work" }),
    ).not.toBeInTheDocument();
    expect(
      within(dueToday).queryByRole("button", { name: "Already done" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      dailyDisplayTitle(shiftDailyTitle(today, -1)),
    );
    expect(
      within(await screen.findByRole("region", { name: "Due" })).getByRole(
        "button",
        { name: "Ship pricing" },
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      dailyDisplayTitle(monday),
    );
    expect(
      within(await screen.findByRole("region", { name: "Due" })).getByRole(
        "button",
        { name: "Ship pricing" },
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      dailyDisplayTitle(sunday),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Due" }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Next day" }));
    const dueMonday = await screen.findByRole("region", { name: "Due" });
    await user.click(
      within(dueMonday).getByRole("button", { name: "Mark task done" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Due" }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Next day" }));
    await screen.findByLabelText("Note title");
    expect(
      screen.queryByRole("region", { name: "Due" }),
    ).not.toBeInTheDocument();
  });

  it("hides same-note due tasks from the daily Due section (ENG-144)", async () => {
    const today = formatDailyTitle();
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "daily",
        title: today,
        body_markdown: "[[task:t-standup]] Prep standup",
        note_type: "daily",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: "src",
        title: "Project plan",
        body_markdown: "[[task:t-other]] Ship pricing",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    tasksApiRef.current = createMemoryTasksApi([
      {
        id: "t-standup",
        note_id: "daily",
        title: "Prep standup",
        state: "open",
        due_date: today,
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
      {
        id: "t-other",
        note_id: "src",
        title: "Ship pricing",
        state: "open",
        due_date: today,
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
    ]);

    render(<App />);
    const due = await screen.findByRole("region", { name: "Due" });
    expect(
      within(due).getByRole("button", { name: "Ship pricing" }),
    ).toBeInTheDocument();
    expect(
      within(due).queryByRole("button", { name: "Prep standup" }),
    ).not.toBeInTheDocument();
  });

  it("links Due rows to the source note and omits the section on regular notes", async () => {
    const user = userEvent.setup();
    const today = formatDailyTitle();
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "src",
        title: "Project plan",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    tasksApiRef.current = createMemoryTasksApi([
      {
        id: "t-due",
        note_id: "src",
        title: "Ship pricing",
        state: "waiting",
        due_date: today,
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
    ]);

    render(<App />);
    const due = await screen.findByRole("region", { name: "Due" });
    await user.click(within(due).getByRole("button", { name: "Task details" }));
    expect(
      screen.getByRole("dialog", { name: /Ship pricing/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(due).getByRole("button", { name: "Ship pricing" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Project plan",
    );
    expect(
      screen.queryByRole("region", { name: "Due" }),
    ).not.toBeInTheDocument();
  });

  it("Cmd+2 opens Notes and Cmd+1 returns to today's daily (ENG-60)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Note title");

    await user.keyboard("{Meta>}2{/Meta}");
    expect(
      await screen.findByRole("region", { name: "Notes overview" }),
    ).toBeInTheDocument();

    await user.keyboard("{Meta>}1{/Meta}");
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    expect(screen.getByRole("button", { name: "Daily Note" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("drops a Due row when the task is completed without window focus (ENG-120)", async () => {
    const today = formatDailyTitle();
    const stamp = "2026-08-10T10:00:00.000Z";
    tasksApiRef.current = createMemoryTasksApi([
      {
        id: "t-live",
        note_id: "src",
        title: "Live due item",
        state: "open",
        due_date: today,
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
    ]);

    render(<App />);
    const due = await screen.findByRole("region", { name: "Due" });
    expect(
      within(due).getByRole("button", { name: "Live due item" }),
    ).toBeInTheDocument();

    await tasksApiRef.current.updateTask({
      id: "t-live",
      title: "Live due item",
      state: "done",
      due_date: today,
      priority: null,
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Due" }),
      ).not.toBeInTheDocument();
    });
  });

  it("creates a task on today's daily from Tasks + New task (ENG-121)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Note title");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Tasks" }));
    const pane = await screen.findByRole("region", { name: "Tasks" });
    expect(
      within(pane).getByText(
        "No open tasks. Type [] at the start of a line in a note.",
      ),
    ).toBeInTheDocument();

    await user.click(within(pane).getByRole("button", { name: "+ New task" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      formatDailyDisplayTitle(),
    );
    expect(await screen.findByPlaceholderText("Task")).toBeInTheDocument();
  });

  it("finds tasks in ⌘K and opens the source note (ENG-122)", async () => {
    const user = userEvent.setup();
    const stamp = "2026-08-09T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "src",
        title: "Project plan",
        body_markdown: "[[task:t-qk]] Xylophone stand QK",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    tasksApiRef.current = createMemoryTasksApi([
      {
        id: "t-qk",
        note_id: "src",
        title: "Xylophone stand QK",
        state: "open",
        due_date: null,
        priority: null,
        created_at: stamp,
        updated_at: stamp,
        completed_at: null,
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByLabelText("Search notes and tasks");
    expect(
      screen.queryByRole("option", { name: /Task ·/ }),
    ).not.toBeInTheDocument();

    await user.type(search, "Xylophone stand QK");
    const option = await screen.findByRole("option", {
      name: /Task · Project plan/,
    });
    expect(option).toHaveTextContent("Xylophone stand QK");

    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Project plan",
    );
    expect(
      screen.queryByLabelText("Search notes and tasks"),
    ).not.toBeInTheDocument();
  });
});
