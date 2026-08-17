import { invoke } from "@tauri-apps/api/core";
import { calendarApi } from "../calendar/api";
import type { CalendarEvent } from "../calendar/types";
import { notesApi } from "./api";
import { formatDailyTitle } from "./format";
import type {
  CreateMeetingNoteInput,
  Meeting,
  MeetingNote,
  Note,
  UpdateMeetingInput,
} from "./types";

export type MeetingsApi = {
  createMeetingNote: (input: CreateMeetingNoteInput) => Promise<MeetingNote>;
  updateMeeting: (input: UpdateMeetingInput) => Promise<Meeting>;
  getMeeting: (noteId: string) => Promise<Meeting>;
  createMeetingNoteFromEvent: (eventId: string) => Promise<MeetingNote>;
  getMeetingForEvent: (eventId: string) => Promise<MeetingNote>;
};

const tauriMeetingsApi: MeetingsApi = {
  createMeetingNote: (input) =>
    invoke<MeetingNote>("create_meeting_note", { input }),
  updateMeeting: (input) => invoke<Meeting>("update_meeting", { input }),
  getMeeting: (noteId) => invoke<Meeting>("get_meeting", { noteId }),
  createMeetingNoteFromEvent: (eventId) =>
    invoke<MeetingNote>("create_meeting_note_from_event", { eventId }),
  getMeetingForEvent: (eventId) =>
    invoke<MeetingNote>("get_meeting_for_event", { eventId }),
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function assertMeetingTimes(
  meetingDate: string,
  startTime: string,
  endTime: string,
): void {
  if (!DATE_RE.test(meetingDate)) {
    throw new Error(`meeting_date must be YYYY-MM-DD, got ${meetingDate}`);
  }
  if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) {
    throw new Error("start_time and end_time must be HH:MM");
  }
}

function localDateAndHm(iso: string): { date: string; hm: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`could not convert timestamp to local date/time: ${iso}`);
  }
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return { date: formatDailyTitle(date), hm };
}

export type MemoryMeetingsOptions = {
  meetings?: Meeting[];
  getEvent?: (eventId: string) => Promise<CalendarEvent>;
};

/** In-memory MeetingsApi; creates notes through the shared notes store. */
export function createMemoryMeetingsApi(
  notes: {
    createNote: (input: {
      title: string;
      body_markdown?: string;
      note_type?: Note["note_type"];
    }) => Promise<Note>;
    listNotes: () => Promise<Note[]>;
  },
  options: MemoryMeetingsOptions = {},
): MeetingsApi {
  let meetings = [...(options.meetings ?? [])];
  const getEvent =
    options.getEvent ?? ((eventId: string) => calendarApi.getEvent(eventId));

  const noteById = async (id: string): Promise<Note> => {
    const listed = await notes.listNotes();
    const note = listed.find((item) => item.id === id);
    if (!note) {
      throw new Error("not found");
    }
    return note;
  };

  const meetingNote = async (meeting: Meeting): Promise<MeetingNote> => ({
    note: await noteById(meeting.note_id),
    meeting,
  });

  return {
    async createMeetingNote(input) {
      assertMeetingTimes(input.meeting_date, input.start_time, input.end_time);
      const note = await notes.createNote({
        title: input.title,
        ...(input.body_markdown !== undefined
          ? { body_markdown: input.body_markdown }
          : {}),
        note_type: "meeting",
      });
      const meeting: Meeting = {
        note_id: note.id,
        meeting_date: input.meeting_date,
        start_time: input.start_time,
        end_time: input.end_time,
        transcript_note_id: null,
        calendar_event_id: null,
      };
      meetings = [...meetings, meeting];
      return { note, meeting };
    },
    async updateMeeting(input) {
      assertMeetingTimes(input.meeting_date, input.start_time, input.end_time);
      const note = await noteById(input.note_id);
      if (note.note_type !== "meeting") {
        throw new Error("meeting metadata requires note_type = meeting");
      }
      const current = meetings.find((item) => item.note_id === input.note_id);
      if (!current) {
        throw new Error("not found");
      }
      const updated: Meeting = {
        ...current,
        meeting_date: input.meeting_date,
        start_time: input.start_time,
        end_time: input.end_time,
      };
      meetings = meetings.map((item) =>
        item.note_id === input.note_id ? updated : item,
      );
      return updated;
    },
    getMeeting(noteId) {
      const meeting = meetings.find((item) => item.note_id === noteId);
      if (!meeting) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(meeting);
    },
    async createMeetingNoteFromEvent(eventId) {
      const existing = meetings.find(
        (item) => item.calendar_event_id === eventId,
      );
      if (existing) {
        return meetingNote(existing);
      }
      const event = await getEvent(eventId);
      const start = localDateAndHm(event.start);
      const end = localDateAndHm(event.end);
      assertMeetingTimes(start.date, start.hm, end.hm);
      const note = await notes.createNote({
        title: event.title,
        note_type: "meeting",
      });
      const meeting: Meeting = {
        note_id: note.id,
        meeting_date: start.date,
        start_time: start.hm,
        end_time: end.hm,
        transcript_note_id: null,
        calendar_event_id: event.id,
      };
      meetings = [...meetings, meeting];
      return { note, meeting };
    },
    async getMeetingForEvent(eventId) {
      const meeting = meetings.find(
        (item) => item.calendar_event_id === eventId,
      );
      if (!meeting) {
        throw new Error("not found");
      }
      return meetingNote(meeting);
    },
  };
}

const DEMO_MEETINGS: Meeting[] = [
  {
    note_id: "demo-sync",
    meeting_date: "2026-08-10",
    start_time: "14:00",
    end_time: "14:23",
    transcript_note_id: null,
    calendar_event_id: "demo-pricing",
  },
];

/** Browser `npm run dev` has no Tauri IPC; use memory so the shell is previewable. */
export const meetingsApi: MeetingsApi = isTauriRuntime()
  ? tauriMeetingsApi
  : createMemoryMeetingsApi(notesApi, { meetings: DEMO_MEETINGS });
