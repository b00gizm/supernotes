export type NoteType = "regular" | "daily" | "meeting";

export type Note = {
  id: string;
  title: string;
  body_markdown: string;
  note_type: NoteType;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type Link = {
  source_note_id: string;
  target_note_id: string;
  created_at: string;
};

export type CreateNoteInput = {
  title: string;
  body_markdown?: string;
  note_type?: NoteType;
  pinned?: boolean;
};

export type UpdateNoteInput = {
  id: string;
  title: string;
  body_markdown: string;
};

/** Stored as local `YYYY-MM-DD` + `HH:MM` (display: `Mon, Aug 10`, `14:00 – 14:23`). */
export type Meeting = {
  note_id: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  transcript_note_id: string | null;
  calendar_event_id: string | null;
};

export type MeetingNote = {
  note: Note;
  meeting: Meeting;
};

export type CreateMeetingNoteInput = {
  title: string;
  body_markdown?: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
};

export type UpdateMeetingInput = {
  note_id: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
};
