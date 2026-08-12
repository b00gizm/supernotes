import type { CreateNoteInput, Link, Note, UpdateNoteInput } from "./types";
import type { NotesApi } from "./api";
import {
  extractWikilinkTitles,
  findNoteByTitle,
  rewriteWikilinkTitle,
} from "./wikilinks";

/** In-memory NotesApi for tests / browser preview (mirrors SQLite link sync). */
export function createMemoryNotesApi(seed: Note[] = []): NotesApi {
  let notes = [...seed];
  let links: Link[] = [];
  let seq = 0;

  const syncLinksFromBody = (sourceId: string, body: string) => {
    links = links.filter((link) => link.source_note_id !== sourceId);
    const seen = new Set<string>();
    const stamp = new Date().toISOString();
    for (const title of extractWikilinkTitles(body)) {
      const target = findNoteByTitle(notes, title);
      if (!target || target.id === sourceId || seen.has(target.id)) {
        continue;
      }
      seen.add(target.id);
      links.push({
        source_note_id: sourceId,
        target_note_id: target.id,
        created_at: stamp,
      });
    }
  };

  const rewriteIncoming = (
    targetId: string,
    oldTitle: string,
    newTitle: string,
  ) => {
    for (const link of links.filter(
      (item) => item.target_note_id === targetId,
    )) {
      const source = notes.find((note) => note.id === link.source_note_id);
      if (!source) {
        continue;
      }
      const rewritten = rewriteWikilinkTitle(
        source.body_markdown,
        oldTitle,
        newTitle,
      );
      if (rewritten === source.body_markdown) {
        continue;
      }
      // Don't bump updated_at — same as Rust (recency stays the author's).
      notes = notes.map((note) =>
        note.id === source.id ? { ...note, body_markdown: rewritten } : note,
      );
    }
  };

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
      if (
        note.note_type === "daily" &&
        notes.some(
          (item) => item.note_type === "daily" && item.title === note.title,
        )
      ) {
        return Promise.reject(new Error("daily title already exists"));
      }
      notes = [note, ...notes];
      syncLinksFromBody(note.id, note.body_markdown);
      // Late targets: bodies that already mention this title get a link row.
      for (const source of notes) {
        if (source.id === note.id) {
          continue;
        }
        for (const title of extractWikilinkTitles(source.body_markdown)) {
          const target = findNoteByTitle(notes, title);
          if (!target || target.id !== note.id) {
            continue;
          }
          if (
            links.some(
              (link) =>
                link.source_note_id === source.id &&
                link.target_note_id === note.id,
            )
          ) {
            break;
          }
          links.push({
            source_note_id: source.id,
            target_note_id: note.id,
            created_at: stamp,
          });
          break;
        }
      }
      return Promise.resolve(note);
    },
    async getOrCreateDaily(date: string) {
      const title = date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(title)) {
        return Promise.reject(new Error("daily date must be YYYY-MM-DD"));
      }
      const existing = notes.find(
        (note) => note.note_type === "daily" && note.title === title,
      );
      if (existing) {
        return existing;
      }
      return this.createNote({ title, note_type: "daily" });
    },
    updateNote(input: UpdateNoteInput) {
      const current = notes.find((item) => item.id === input.id);
      if (!current) {
        return Promise.reject(new Error("not found"));
      }
      const titleChanged = current.title !== input.title;
      const updated: Note = {
        ...current,
        title: input.title,
        body_markdown: input.body_markdown,
        updated_at: new Date().toISOString(),
      };
      notes = notes.map((item) => (item.id === input.id ? updated : item));
      syncLinksFromBody(input.id, input.body_markdown);
      if (titleChanged) {
        rewriteIncoming(input.id, current.title, input.title);
      }
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
      notes = notes.filter((note) => note.id !== id);
      links = links.filter(
        (link) => link.source_note_id !== id && link.target_note_id !== id,
      );
      if (notes.length === before) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve();
    },
    listLinksFrom(sourceNoteId: string) {
      return Promise.resolve(
        links.filter((link) => link.source_note_id === sourceNoteId),
      );
    },
    listLinksTo(targetNoteId: string) {
      return Promise.resolve(
        links.filter((link) => link.target_note_id === targetNoteId),
      );
    },
  };
}
