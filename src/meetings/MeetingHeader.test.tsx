import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createMemoryMeetingsApi } from "../notes/meetings";
import { createMemoryNotesApi } from "../notes/memoryApi";
import { createMemoryRecordingApi } from "../notes/recording";
import type { Meeting, Note } from "../notes/types";
import { MeetingHeader } from "./MeetingHeader";
import type { MeetingSummaryApi } from "./summaryApi";

function quietSummary(): MeetingSummaryApi {
  return {
    getSummary: () => Promise.resolve(null),
    generateSummary: (id) =>
      Promise.resolve({ stream_id: "quiet", meeting_note_id: id }),
    saveParticipants: () => Promise.reject(new Error("unused")),
  };
}

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
  end_time: "14:23",
  transcript_note_id: null,
  calendar_event_id: "evt-1",
};

const LIVE_SEGMENTS = [
  {
    clock: "14:02",
    text: "Let's lock the Q3 pricing before the board deck goes out.",
    start_ms: 120_000,
    end_ms: 128_000,
  },
];

function setup(
  meetings: Meeting[] = [MEETING],
  recordingOptions: Parameters<typeof createMemoryRecordingApi>[2] = {},
) {
  const notes = createMemoryNotesApi([NOTE]);
  const api = createMemoryMeetingsApi(notes, { meetings });
  const recording = createMemoryRecordingApi(
    notes,
    {
      getMeeting: (id) => api.getMeeting(id),
      linkTranscript: (noteId, transcriptNoteId) => {
        api.linkTranscript(noteId, transcriptNoteId);
      },
    },
    {
      segmentsFor: () => LIVE_SEGMENTS,
      ...recordingOptions,
    },
  );
  return { notes, api, recording };
}

describe("MeetingHeader (ENG-68)", () => {
  it("shows the waveform meta row and persists edits", async () => {
    const user = userEvent.setup();
    const { api, recording } = setup();

    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );

    expect(await screen.findByText("Mon, Aug 10")).toBeInTheDocument();
    expect(screen.getByText("Meeting")).toBeInTheDocument();
    expect(screen.getByText("14:00 – 14:23")).toBeInTheDocument();
    expect(document.querySelector(".meeting-meta .waveform-icon")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit meeting time" }));
    await user.clear(screen.getByLabelText("Meeting date"));
    await user.type(screen.getByLabelText("Meeting date"), "2026-08-11");
    await user.clear(screen.getByLabelText("Start time"));
    await user.type(screen.getByLabelText("Start time"), "10:00");
    await user.clear(screen.getByLabelText("End time"));
    await user.type(screen.getByLabelText("End time"), "10:30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Tue, Aug 11")).toBeInTheDocument();
    expect(screen.getByText("10:00 – 10:30")).toBeInTheDocument();
    await expect(api.getMeeting("m1")).resolves.toMatchObject({
      meeting_date: "2026-08-11",
      start_time: "10:00",
      end_time: "10:30",
      calendar_event_id: "evt-1",
    });
  });

  it("surfaces a missing meeting instead of creating one", async () => {
    const { api, recording } = setup([]);
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
    await expect(api.getMeeting("m1")).rejects.toThrow(/not found/i);
  });

  it("lets Escape cancel an edit without writing", async () => {
    const user = userEvent.setup();
    const { api, recording } = setup();
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );

    expect(
      await screen.findByLabelText("Edit meeting time"),
    ).toBeInTheDocument();
    const loaded = await api.getMeeting("m1");

    await user.click(screen.getByRole("button", { name: "Edit meeting time" }));
    await user.clear(screen.getByLabelText("Meeting date"));
    await user.type(screen.getByLabelText("Meeting date"), "2026-01-01");
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Meeting date")).not.toBeInTheDocument();
    await expect(api.getMeeting("m1")).resolves.toEqual(loaded);
  });

  it("surfaces a failed save instead of keeping the optimistic row", async () => {
    const user = userEvent.setup();
    const { api, recording } = setup();
    api.updateMeeting = () => Promise.reject(new Error("disk full"));

    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Edit meeting time" }),
    );
    await user.clear(screen.getByLabelText("Meeting date"));
    await user.type(screen.getByLabelText("Meeting date"), "2026-08-12");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByText("Mon, Aug 10")).toBeInTheDocument();
  });

  it("starts recording chrome from Woz segments without speaker names", async () => {
    const user = userEvent.setup();
    const { api, recording } = setup();
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));

    expect(await screen.findByText("Recording")).toBeInTheDocument();
    expect(document.querySelector(".recording-dot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    const panel = screen.getByLabelText("Live transcript");
    expect(panel).toHaveTextContent("Transcribing locally · summary on stop");
    expect(await screen.findByText(/Q3 pricing/)).toBeInTheDocument();
    expect(panel).toHaveTextContent("14:02");
    expect(panel.textContent).not.toMatch(/\bSara\b|\bMarcus\b|\bYou\b/);
    expect(panel.querySelector(".live-transcript-cursor")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Record" }),
    ).not.toBeInTheDocument();
  });

  it("stops recording, hides the live transcript, and links the note", async () => {
    const user = userEvent.setup();
    const { api, recording } = setup();
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));
    expect(await screen.findByLabelText("Live transcript")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.queryByLabelText("Live transcript")).not.toBeInTheDocument();
    expect(screen.queryByText("Recording")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Transcript" }),
    ).toBeInTheDocument();
    const stopped = await api.getMeeting("m1");
    expect(stopped.transcript_note_id).toEqual(expect.stringMatching(/\S/));
  });

  it("surfaces permission_denied instead of starting", async () => {
    const user = userEvent.setup();
    const { api, recording } = setup([MEETING], { permission: "denied" });
    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Microphone access is required to record/,
    );
    expect(screen.queryByText("Recording")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Live transcript")).not.toBeInTheDocument();
  });

  it("opens a persisted transcript note from the header", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    const { api, recording } = setup([
      { ...MEETING, transcript_note_id: "transcript-1" },
    ]);

    render(
      <MeetingHeader
        noteId="m1"
        api={api}
        recording={recording}
        summary={quietSummary()}
        onOpenNote={(id) => {
          opened.push(id);
        }}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Transcript" }));
    expect(opened).toEqual(["transcript-1"]);
  });
});
