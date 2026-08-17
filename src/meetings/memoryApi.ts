import type { MeetingsApi } from "./api";
import type { Meeting, MeetingInput } from "./types";

/** In-memory MeetingsApi for tests / browser preview. */
export function createMemoryMeetingsApi(seed: Meeting[] = []): MeetingsApi {
  let meetings = [...seed];

  const get = (noteId: string): Meeting | undefined =>
    meetings.find((item) => item.note_id === noteId);

  return {
    getMeeting(noteId) {
      const meeting = get(noteId);
      if (!meeting) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(meeting);
    },
    createMeeting(input) {
      if (get(input.note_id)) {
        return Promise.reject(new Error("meeting already exists"));
      }
      const meeting: Meeting = {
        note_id: input.note_id,
        meeting_date: input.meeting_date,
        start_time: input.start_time,
        end_time: input.end_time,
        transcript_note_id: input.transcript_note_id ?? null,
      };
      meetings = [...meetings, meeting];
      return Promise.resolve(meeting);
    },
    updateMeeting(input: MeetingInput) {
      const current = get(input.note_id);
      if (!current) {
        return Promise.reject(new Error("not found"));
      }
      const updated: Meeting = {
        ...current,
        meeting_date: input.meeting_date,
        start_time: input.start_time,
        end_time: input.end_time,
        transcript_note_id:
          input.transcript_note_id === undefined
            ? current.transcript_note_id
            : input.transcript_note_id,
      };
      meetings = meetings.map((item) =>
        item.note_id === updated.note_id ? updated : item,
      );
      return Promise.resolve(updated);
    },
  };
}
