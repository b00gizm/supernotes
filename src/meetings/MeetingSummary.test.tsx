import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMemoryMeetingsApi } from "../notes/meetings";
import { createMemoryNotesApi } from "../notes/memoryApi";
import { createMemoryRecordingApi } from "../notes/recording";
import type { Meeting, Note } from "../notes/types";
import { createMemoryTasksApi } from "../tasks/memoryApi";
import type { Task } from "../tasks/types";
import { MeetingHeader } from "./MeetingHeader";
import { MeetingSummary } from "./MeetingSummary";
import { LlmError } from "../llm/api";
import {
  createMemoryMeetingSummaryApi,
  demoMeetingSummary,
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
  it("renders the mockup-1h JSON block, not markdown", () => {
    const opened: string[] = [];
    const summary = demoMeetingSummary();
    render(
      <MeetingSummary
        summary={summary}
        today="2026-08-10"
        tasks={createMemoryTasksApi([
          taskSeed("mem-task-1", "Send updated tier table", "2026-08-10"),
          taskSeed("mem-task-2", "Legal review of annual terms", "2026-08-14"),
        ])}
        onOpenNote={(id) => {
          opened.push(id);
        }}
      />,
    );

    const block = screen.getByLabelText("Meeting summary");
    expect(block.querySelector(".ProseMirror")).toBeNull();
    expect(within(block).getByText("Purpose")).toBeInTheDocument();
    expect(block).toHaveTextContent(/pricing v2 tier structure/);
    expect(
      within(block).getByRole("button", { name: "@Sara Kim" }),
    ).toBeInTheDocument();
    expect(
      within(block).getByRole("button", { name: "@Marcus Webb" }),
    ).toBeInTheDocument();
    expect(within(block).getByText("(Maybe) Steve").tagName).toBe("SPAN");
    expect(within(block).queryByRole("button", { name: "(Maybe) Steve" })).toBe(
      null,
    );
    expect(block).toHaveTextContent("Free tier stays");
    expect(block.querySelector(".meeting-summary-time")?.textContent).toBe(
      "14:02",
    );
    expect(block).toHaveTextContent("14:05");
    expect(block.querySelector(".meeting-summary-code")?.textContent).toBe(
      "flags.pricingV2",
    );
    expect(
      within(block).getByText("Send updated tier table").closest("li"),
    ).not.toBeNull();
    expect(block.querySelector(".meeting-summary-actions li")).toBeTruthy();
    expect(within(block).getByText("Today")).toBeInTheDocument();
    expect(within(block).getByText("Aug 14")).toBeInTheDocument();
    expect(
      within(block).getByRole("button", { name: "Full transcript" }),
    ).toBeInTheDocument();
    expect(block).toHaveTextContent("45 min");
    expect(block).toHaveTextContent("6,120 words");
  });

  it("opens linked participants and the transcript footer", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(
      <MeetingSummary
        summary={demoMeetingSummary()}
        today="2026-08-10"
        onOpenNote={(id) => {
          opened.push(id);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "@Sara Kim" }));
    await user.click(screen.getByRole("button", { name: "Full transcript" }));
    expect(opened).toEqual(["person-sara", "demo-transcript"]);
  });
});

describe("MeetingHeader summary generate (ENG-71 UI)", () => {
  it("record → stop → generate paints the summary on the meeting note", async () => {
    const user = userEvent.setup();
    const { api, recording, summary, tasks } = setupHeader(
      createMemoryMeetingSummaryApi(),
      { ...MEETING, transcript_note_id: null },
    );
    const generate = vi.spyOn(summary, "generateSummary");

    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={summary}
        tasks={tasks}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(generate).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Transcript" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generate summary" }));

    expect(generate).toHaveBeenCalledWith("m1");
    expect(await screen.findByLabelText("Meeting summary")).toHaveTextContent(
      /pricing v2/,
    );
    expect(screen.getByText("Summary from recording")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Generate summary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Transcript" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Full transcript" }),
    ).toBeTruthy();
  });

  it("regenerate replaces the previous summary block", async () => {
    const user = userEvent.setup();
    const { api, recording, summary, tasks } = setupHeader();
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={summary}
        tasks={tasks}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Generate summary" }),
    );
    const first = await summary.getSummary("m1");
    expect(first).toBeTruthy();
    expect(await screen.findAllByLabelText("Purpose")).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "Regenerate summary" }),
    );
    const second = await summary.getSummary("m1");
    expect(second).toBeTruthy();
    expect(second?.action_items.map((item) => item.task_id)).not.toEqual(
      first?.action_items.map((item) => item.task_id),
    );
    expect(screen.getAllByLabelText("Purpose")).toHaveLength(1);
    expect(screen.getAllByLabelText("Meeting summary")).toHaveLength(1);
  });

  it("keeps the transcript and shows the LLM error when generate fails", async () => {
    const user = userEvent.setup();
    const inner = createMemoryMeetingSummaryApi();
    const summary: MeetingSummaryApi = {
      getSummary: (id) => inner.getSummary(id),
      generateSummary: () =>
        Promise.reject(
          new LlmError("unreachable", "Could not reach the LLM server."),
        ),
    };
    const { api, recording, tasks } = setupHeader(summary);
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={summary}
        tasks={tasks}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Generate summary" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the LLM server.",
    );
    expect(screen.queryByLabelText("Meeting summary")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transcript" })).toBeTruthy();
    await expect(api.getMeeting("m1")).resolves.toMatchObject({
      transcript_note_id: "transcript-1",
    });
  });
});
