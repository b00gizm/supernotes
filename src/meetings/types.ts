export type Meeting = {
  note_id: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  transcript_note_id: string | null;
};

export type MeetingInput = {
  note_id: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  transcript_note_id?: string | null;
};

export type MeetingPrefill = {
  title?: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
};
