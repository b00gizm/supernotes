import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LlmError } from "../llm/api";
import { createMemoryMeetingsApi } from "../notes/meetings";
import { createMemoryNotesApi } from "../notes/memoryApi";
import { createMemoryRecordingApi } from "../notes/recording";
import type { Meeting, Note } from "../notes/types";
import { createMemoryTasksApi } from "../tasks/memoryApi";
import type { Task } from "../tasks/types";
import { MeetingHeader } from "./MeetingHeader";
import { MeetingSummary } from "./MeetingSummary";
import {
  createMemoryMeetingSummaryApi,
  demoMeetingSummary,
  SUMMARY_DONE_EVENT,
  SUMMARY_PROGRESS_EVENT,
  type GenerateSummaryJob,
  type MeetingSummaryApi,
} from "./summaryApi";

const NOTE: Note = {
  id: "m1",
  title: "Pricing sync",
  body_markdown: "",
  note_type: "meeting",
  pinned: false,
  created_at: "2026-08-09T10:00:00.000Z",
  updated_at: "2026-08-09T10:00:00.000Z",
};

const MEETING: Meeting = {
  note_id: "m1",
  meeting_date: "2026-08-10",
  start_time: "14:00",
  end_time: "14:45",
  transcript_note_id: "transcript-1",
  calendar_event_id: "evt-1",
};

function flushGenerate(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function taskSeed(id: string, title: string, due: string | null): Task {
  return {
    id,
    note_id: "m1",
    title,
    state: "open",
    due_date: due,
    priority: due === "2026-08-10" ? "high" : null,
    created_at: "2026-08-10T14:00:00.000Z",
    updated_at: "2026-08-10T14:00:00.000Z",
    completed_at: null,
  };
}

function setupHeader(
  summary = createMemoryMeetingSummaryApi(),
  meeting: Meeting = MEETING,
) {
  const notes = createMemoryNotesApi([NOTE]);
  const api = createMemoryMeetingsApi(notes, { meetings: [meeting] });
  const recording = createMemoryRecordingApi(notes, {
    getMeeting: (id) => api.getMeeting(id),
    linkTranscript: (noteId, transcriptNoteId) => {
      api.linkTranscript(noteId, transcriptNoteId);
    },
  });
  const tasks = createMemoryTasksApi([
    taskSeed("mem-task-1", "Send updated tier table", "2026-08-10"),
    taskSeed("mem-task-2", "Legal review of annual terms", "2026-08-14"),
  ]);
  return { notes, api, recording, summary, tasks };
}

describe("MeetingSummary render (ENG-71 UI)", () => {
  it("renders the mockup-1h JSON block with TaskRow action items", async () => {
    const summary = demoMeetingSummary();
    render(
      <MeetingSummary
        summary={summary}
        today="2026-08-10"
        note={NOTE}
        tasks={createMemoryTasksApi([
          taskSeed("mem-task-1", "Send updated tier table", "2026-08-10"),
          taskSeed("mem-task-2", "Legal review of annual terms", "2026-08-14"),
        ])}
      />,
    );

    const block = screen.getByLabelText("Meeting summary");
    expect(block.querySelector(".ProseMirror")).toBeNull();
    expect(within(block).getByText("Purpose")).toBeInTheDocument();
    expect(block).toHaveTextContent(/pricing v2 tier structure/);
    expect(
      within(block).getByRole("button", { name: "Edit participant Sara Kim" }),
    ).toHaveTextContent("@Sara Kim");
    expect(
      within(block).getByRole("button", { name: "Edit participant Steve" }),
    ).toHaveTextContent("(Maybe) Steve");
    expect(block).toHaveTextContent("Free tier stays");
    expect(block.querySelector(".meeting-summary-time")?.textContent).toBe(
      "14:02",
    );
    expect(block.querySelector(".meeting-summary-code")?.textContent).toBe(
      "flags.pricingV2",
    );
    expect(block.querySelector(".tasks-row")).toBeTruthy();
    expect(
      await within(block).findByRole("button", {
        name: "Send updated tier table",
      }),
    ).toBeInTheDocument();
    expect(
      within(block).getAllByRole("button", { name: "Mark task done" }),
    ).toHaveLength(2);
    expect(
      within(block).getAllByRole("button", { name: "Task details" }),
    ).toHaveLength(2);
    expect(within(block).getByText("Aug 10")).toBeInTheDocument();
    expect(within(block).getByText("Aug 14")).toBeInTheDocument();
    expect(
      within(block).getByRole("button", { name: "Full transcript" }),
    ).toBeInTheDocument();
    expect(block).toHaveTextContent("45 min");
    expect(block).toHaveTextContent("6,120 words");
  });

  it("lets participant pills be edited and persisted", async () => {
    const user = userEvent.setup();
    const api = createMemoryMeetingSummaryApi();
    await api.generateSummary("demo-sync");
    await flushGenerate();
    const loaded = await api.getSummary("demo-sync");
    if (!loaded) {
      throw new Error("expected a summary");
    }
    const save = vi.spyOn(api, "saveParticipants");
    const onSummaryChange = vi.fn();

    render(
      <MeetingSummary
        summary={loaded}
        summaryApi={api}
        today="2026-08-10"
        onSummaryChange={onSummaryChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Edit participant Steve" }),
    );
    const input = screen.getByLabelText("Edit participant Steve");
    await user.clear(input);
    await user.type(input, "Steven");
    await user.tab();

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith("demo-sync", [
        { name: "Sara Kim", certainty: "certain", note_id: "person-sara" },
        { name: "Marcus Webb", certainty: "certain", note_id: "person-marcus" },
        { name: "Steven", certainty: "maybe", note_id: null },
      ]);
    });
    expect(onSummaryChange).toHaveBeenCalled();
    const saved = await api.getSummary("demo-sync");
    expect(saved?.participants.at(2)?.name).toBe("Steven");
    expect(saved?.action_items.map((item) => item.task_id)).toEqual(
      loaded.action_items.map((item) => item.task_id),
    );
  });
});

describe("MeetingHeader summary generate (ENG-71 UI)", () => {
  it("record → stop starts generate without a Generate click", async () => {
    const user = userEvent.setup();
    const { api, recording, summary, tasks } = setupHeader(
      createMemoryMeetingSummaryApi(),
      { ...MEETING, transcript_note_id: null },
    );
    const generate = vi.spyOn(summary, "generateSummary");

    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        api={api}
        recording={recording}
        summary={summary}
        tasks={tasks}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(generate).toHaveBeenCalledWith("m1");
    expect(
      screen.queryByRole("button", { name: "Generate summary" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Meeting summary")).toHaveTextContent(
      /pricing v2/,
    );
    expect(screen.getByText("Summary from recording")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Full transcript" }),
    ).toBeTruthy();
  });

  it("shows in-progress chrome from summary://progress and stays usable", async () => {
    const user = userEvent.setup();
    const job: GenerateSummaryJob = {
      stream_id: "hold-1",
      meeting_note_id: "m1",
    };
    const held: MeetingSummaryApi = {
      getSummary: () => Promise.resolve(null),
      generateSummary: () => {
        window.dispatchEvent(
          new CustomEvent(SUMMARY_PROGRESS_EVENT, { detail: job }),
        );
        return Promise.resolve(job);
      },
      saveParticipants: () =>
        Promise.reject(new LlmError("invalid", "no summary")),
    };
    const { api, recording, tasks } = setupHeader(held);

    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        api={api}
        recording={recording}
        summary={held}
        tasks={tasks}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(await screen.findByText("Summarizing…")).toBeInTheDocument();
    expect(document.querySelector(".meeting-summary-spinner")).toBeTruthy();
    expect(screen.queryByLabelText("Meeting summary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Transcript" })).toBeTruthy();

    window.dispatchEvent(
      new CustomEvent(SUMMARY_DONE_EVENT, {
        detail: {
          ...job,
          summary: demoMeetingSummary("m1", "transcript-1"),
        },
      }),
    );
    expect(await screen.findByLabelText("Meeting summary")).toBeInTheDocument();
    expect(screen.queryByText("Summarizing…")).not.toBeInTheDocument();
  });

  it("regenerate replaces the previous summary block", async () => {
    const user = userEvent.setup();
    const { api, recording, summary, tasks } = setupHeader();
    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        api={api}
        recording={recording}
        summary={summary}
        tasks={tasks}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByLabelText("Meeting summary")).toBeInTheDocument();
    const first = await summary.getSummary("m1");

    await user.click(
      screen.getByRole("button", { name: "Regenerate summary" }),
    );
    await flushGenerate();
    const second = await summary.getSummary("m1");
    expect(second?.action_items.map((item) => item.task_id)).not.toEqual(
      first?.action_items.map((item) => item.task_id),
    );
    expect(screen.getAllByLabelText("Purpose")).toHaveLength(1);
    expect(screen.getAllByLabelText("Meeting summary")).toHaveLength(1);
  });

  it("keeps the transcript and shows the LLM error when generate fails", async () => {
    const user = userEvent.setup();
    const summary = createMemoryMeetingSummaryApi({
      fail: {
        code: "unreachable",
        message: "Could not reach the LLM server.",
      },
    });
    const { api, recording, tasks } = setupHeader(summary);
    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        api={api}
        recording={recording}
        summary={summary}
        tasks={tasks}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the LLM server.",
    );
    expect(screen.queryByLabelText("Meeting summary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transcript" })).toBeTruthy();
    const stopped = await api.getMeeting("m1");
    expect(stopped.transcript_note_id).toBeTruthy();
  });
});
