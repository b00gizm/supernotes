import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LlmError } from "../llm/api";
import { createMemoryMeetingsApi } from "../notes/meetings";
import { createMemoryNotesApi } from "../notes/memoryApi";
import { createMemoryRecordingApi } from "../notes/recording";
import type { Meeting, Note } from "../notes/types";
import { MeetingHeader } from "./MeetingHeader";
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
  body_markdown: "Agenda notes",
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

function waitForGenerate(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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
  return { notes, api, recording, summary };
}

describe("MeetingHeader summary → note body (ENG-71)", () => {
  it("record → stop writes five editable sections into the note", async () => {
    const user = userEvent.setup();
    const { api, recording, summary } = setupHeader(
      createMemoryMeetingSummaryApi(),
      { ...MEETING, transcript_note_id: null },
    );
    const generate = vi.spyOn(summary, "generateSummary");
    const onWriteBody = vi.fn();

    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        body="Agenda notes"
        api={api}
        recording={recording}
        summary={summary}
        onWriteBody={onWriteBody}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(generate).toHaveBeenCalledWith("m1");
    expect(
      screen.queryByRole("button", { name: "Generate summary" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Meeting summary")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(onWriteBody).toHaveBeenCalled();
    });
    const written = onWriteBody.mock.calls.at(-1)?.[0] as string;
    expect(written).toContain("Agenda notes");
    expect(written).toContain("## Purpose");
    expect(written).toContain("## Participants");
    expect(written).toContain("## Key points");
    expect(written).toContain("## Outcome / next steps");
    expect(written).toContain("## Action items");
    expect(written).toContain("- @Sara Kim");
    expect(written).toContain("- (Maybe) Steve");
    expect(written).toMatch(/\[\[task:[^\]]+\]\] Send updated tier table/);
    expect(
      screen.getByRole("button", { name: "Regenerate summary" }),
    ).toHaveTextContent("Regenerate");
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
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
    const { api, recording } = setupHeader(held);
    const onWriteBody = vi.fn();

    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        body=""
        api={api}
        recording={recording}
        summary={held}
        onWriteBody={onWriteBody}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));

    expect(await screen.findByText("Summarizing…")).toBeInTheDocument();
    expect(document.querySelector(".meeting-summary-spinner")).toBeTruthy();
    expect(onWriteBody).not.toHaveBeenCalled();
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
    await waitFor(() => {
      expect(onWriteBody).toHaveBeenCalled();
    });
    expect(screen.queryByText("Summarizing…")).not.toBeInTheDocument();
    expect(onWriteBody.mock.calls.at(-1)?.[0]).toContain("## Purpose");
  });

  it("regenerate replaces only the previous summary block", async () => {
    const user = userEvent.setup();
    const { api, recording, summary } = setupHeader();
    let body = "Agenda notes";
    const onWriteBody = vi.fn((next: string) => {
      body = next;
    });

    const { rerender } = render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        body={body}
        api={api}
        recording={recording}
        summary={summary}
        onWriteBody={onWriteBody}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(onWriteBody).toHaveBeenCalled();
    });
    const first = await summary.getSummary("m1");
    rerender(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        body={`${body}\n\n## Follow-up\n\nKeep this`}
        api={api}
        recording={recording}
        summary={summary}
        onWriteBody={onWriteBody}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Regenerate summary" }),
    );
    await waitForGenerate();
    await waitFor(() => {
      expect(onWriteBody.mock.calls.length).toBeGreaterThan(1);
    });
    const second = await summary.getSummary("m1");
    const written = onWriteBody.mock.calls.at(-1)?.[0] as string;
    expect(second?.action_items.map((item) => item.task_id)).not.toEqual(
      first?.action_items.map((item) => item.task_id),
    );
    expect(written).toContain("Agenda notes");
    expect(written).toContain("## Follow-up");
    expect(written).toContain("Keep this");
    expect(written).toContain(
      `[[task:${second?.action_items[0]?.task_id ?? ""}]]`,
    );
    expect(written.match(/## Purpose/g)).toHaveLength(1);
  });

  it("keeps the transcript and shows the LLM error when generate fails", async () => {
    const user = userEvent.setup();
    const summary = createMemoryMeetingSummaryApi({
      fail: {
        code: "unreachable",
        message: "Could not reach the LLM server.",
      },
    });
    const { api, recording } = setupHeader(summary);
    const onWriteBody = vi.fn();
    render(
      <MeetingHeader
        noteId="m1"
        note={NOTE}
        body="Agenda notes"
        api={api}
        recording={recording}
        summary={summary}
        onWriteBody={onWriteBody}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the LLM server.",
    );
    expect(onWriteBody).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Transcript" })).toBeTruthy();
    const stopped = await api.getMeeting("m1");
    expect(stopped.transcript_note_id).toBeTruthy();
  });
});
