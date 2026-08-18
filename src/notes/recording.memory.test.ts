import { describe, expect, it } from "vitest";
import { createMemoryMeetingsApi } from "./meetings";
import { createMemoryNotesApi } from "./memoryApi";
import {
  createMemoryRecordingApi,
  RECORDING_SEGMENT_EVENT,
  subscribeRecordingSegments,
} from "./recording";

describe("memory recording (ENG-69)", () => {
  it("streams segments and links a transcript note on stop", async () => {
    const notes = createMemoryNotesApi();
    const meetings = createMemoryMeetingsApi(notes);
    const created = await meetings.createMeetingNote({
      title: "Pricing sync",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });

    const store = new Map<string, (typeof created)["meeting"]>();
    store.set(created.note.id, created.meeting);

    const seen: string[] = [];
    const unlisten = await subscribeRecordingSegments((segment) => {
      seen.push(segment.text);
    });

    const recording = createMemoryRecordingApi(
      notes,
      {
        getMeeting: (id) => {
          const meeting = store.get(id);
          if (!meeting) {
            return Promise.reject(new Error("not found"));
          }
          return Promise.resolve(meeting);
        },
        linkTranscript: (noteId, transcriptNoteId) => {
          const current = store.get(noteId);
          if (current) {
            store.set(noteId, {
              ...current,
              transcript_note_id: transcriptNoteId,
            });
          }
        },
      },
      {
        segmentsFor: () => [
          {
            clock: "14:02",
            text: "Let's walk through the enterprise tier.",
            start_ms: 120_000,
            end_ms: 128_000,
          },
        ],
      },
    );

    const state = await recording.startRecording(created.note.id);
    expect(state.status).toBe("recording");
    expect(state.model_id).toBe("tiny");
    expect(state.engine_id).toBe("fake");
    expect(seen).toEqual(["Let's walk through the enterprise tier."]);

    const stopped = await recording.stopRecording();
    expect(stopped.meeting.transcript_note_id).toBe(stopped.transcript_note.id);
    expect(stopped.transcript_note.title).toBe("Pricing sync — transcript");
    expect(stopped.transcript_note.body_markdown).toContain(
      "Let's walk through the enterprise tier.",
    );
    expect(store.get(created.note.id)?.transcript_note_id).toBe(
      stopped.transcript_note.id,
    );
    unlisten();
    expect(RECORDING_SEGMENT_EVENT).toBe("recording://segment");
  });

  it("represents permission_denied", async () => {
    const notes = createMemoryNotesApi();
    const meetings = createMemoryMeetingsApi(notes);
    const created = await meetings.createMeetingNote({
      title: "Pricing sync",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });
    const recording = createMemoryRecordingApi(
      notes,
      { getMeeting: (id) => meetings.getMeeting(id) },
      { permission: "denied" },
    );
    await expect(
      recording.startRecording(created.note.id),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});
