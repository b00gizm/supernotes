import { invoke } from "@tauri-apps/api/core";
import type { CreateNoteInput, Note, UpdateNoteInput } from "./types";

export type NotesApi = {
  listNotes: () => Promise<Note[]>;
  createNote: (input: CreateNoteInput) => Promise<Note>;
  updateNote: (input: UpdateNoteInput) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
};

export const notesApi: NotesApi = {
  listNotes: () => invoke<Note[]>("list_notes"),
  createNote: (input) => invoke<Note>("create_note", { input }),
  updateNote: (input) => invoke<Note>("update_note", { input }),
  deleteNote: async (id) => {
    await invoke("delete_note", { id });
  },
};
