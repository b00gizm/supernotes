import type { CreateNoteInput, Note, UpdateNoteInput } from "./types";
import type { NotesApi } from "./api";

function nowIso(): string {
  return new Date().toISOString();
}

function sortByUpdatedAtDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** In-memory NotesApi for tests and browser-only demos. */
export function createMemoryNotesApi(seed: Note[] = []): NotesApi {
  let notes = [...seed];
  let seq = 0;

  return {
    listNotes() {
      return Promise.resolve(sortByUpdatedAtDesc(notes));
    },
    getNote(id) {
      const note = notes.find((item) => item.id === id);
      if (!note) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(note);
    },
    createNote(input: CreateNoteInput) {
      seq += 1;
      const stamp = nowIso();
      const note: Note = {
        id: `note-${String(seq)}`,
        title: input.title,
        body_markdown: input.body_markdown ?? "",
        note_type: input.note_type ?? "regular",
        pinned: input.pinned ?? false,
        created_at: stamp,
        updated_at: stamp,
      };
      notes = [note, ...notes];
      return Promise.resolve(note);
    },
    updateNote(input: UpdateNoteInput) {
      const current = notes.find((item) => item.id === input.id);
      if (!current) {
        return Promise.reject(new Error("not found"));
      }
      const updated: Note = {
        id: current.id,
        title: input.title,
        body_markdown: input.body_markdown,
        note_type: current.note_type,
        pinned: input.pinned,
        created_at: current.created_at,
        updated_at: nowIso(),
      };
      notes = notes.map((item) => (item.id === input.id ? updated : item));
      return Promise.resolve(updated);
    },
    deleteNote(id) {
      const before = notes.length;
      notes = notes.filter((item) => item.id !== id);
      if (notes.length === before) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve();
    },
  };
}
