import type { CreateNoteInput, Note, UpdateNoteInput } from "./types";
import type { NotesApi } from "./api";

/** In-memory NotesApi for tests. */
export function createMemoryNotesApi(seed: Note[] = []): NotesApi {
  let notes = [...seed];
  let seq = 0;

  return {
    listNotes() {
      return Promise.resolve(
        [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );
    },
    searchNotes(query: string) {
      const needle = query.trim().toLowerCase();
      const listed = [...notes].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
      if (!needle) {
        return Promise.resolve(listed);
      }
      return Promise.resolve(
        listed.filter((note) => note.title.toLowerCase().includes(needle)),
      );
    },
    createNote(input: CreateNoteInput) {
      seq += 1;
      const stamp = new Date().toISOString();
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
        ...current,
        title: input.title,
        body_markdown: input.body_markdown,
        updated_at: new Date().toISOString(),
      };
      notes = notes.map((item) => (item.id === input.id ? updated : item));
      return Promise.resolve(updated);
    },
    setPinned(id: string, pinned: boolean) {
      const current = notes.find((item) => item.id === id);
      if (!current) {
        return Promise.reject(new Error("not found"));
      }
      // Metadata toggle; updated_at deliberately unchanged.
      const updated: Note = { ...current, pinned };
      notes = notes.map((item) => (item.id === id ? updated : item));
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
