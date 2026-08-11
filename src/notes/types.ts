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
