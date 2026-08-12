import { invoke } from "@tauri-apps/api/core";
import { createMemoryNotesApi } from "./memoryApi";
import { isSearchKpiMode, makeSearchKpiSeed } from "./searchKpi";
import type { CreateNoteInput, Link, Note, UpdateNoteInput } from "./types";

export type NotesApi = {
  listNotes: () => Promise<Note[]>;
  searchNotes: (query: string) => Promise<Note[]>;
  createNote: (input: CreateNoteInput) => Promise<Note>;
  /** Lazy daily note for `YYYY-MM-DD`; idempotent. */
  getOrCreateDaily: (date: string) => Promise<Note>;
  updateNote: (input: UpdateNoteInput) => Promise<Note>;
  /** Metadata toggle; does not touch updated_at. */
  setPinned: (id: string, pinned: boolean) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  listLinksFrom: (sourceNoteId: string) => Promise<Link[]>;
  listLinksTo: (targetNoteId: string) => Promise<Link[]>;
};

const tauriNotesApi: NotesApi = {
  listNotes: () => invoke<Note[]>("list_notes"),
  searchNotes: (query) => invoke<Note[]>("search_notes", { query }),
  createNote: (input) => invoke<Note>("create_note", { input }),
  getOrCreateDaily: (date) =>
    invoke<Note>("get_or_create_daily_note", { date }),
  updateNote: (input) => invoke<Note>("update_note", { input }),
  setPinned: (id, pinned) => invoke<Note>("set_note_pinned", { id, pinned }),
  deleteNote: async (id) => {
    await invoke("delete_note", { id });
  },
  // Tauri 2 deserializes multi-word command args as camelCase by default.
  listLinksFrom: (sourceNoteId) =>
    invoke<Link[]>("list_links_from", { sourceNoteId }),
  listLinksTo: (targetNoteId) =>
    invoke<Link[]>("list_links_to", { targetNoteId }),
};

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri 2 injects this on the webview window.
    "__TAURI_INTERNALS__" in window
  );
}

const DEMO_SEED: Note[] = [
  {
    id: "demo-daily",
    title: "2026-08-12",
    body_markdown:
      "[[task:demo-task-today]] Prep standup notes\n[[task:demo-task-daily]] Follow up with design",
    note_type: "daily",
    pinned: false,
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
  },
  {
    id: "demo-roadmap",
    title: "Meridian Q3 roadmap",
    body_markdown:
      "[[task:demo-task-inbox]] Draft pricing brief\n[[task:demo-task-overdue]] Land design review\n[[task:demo-task-next-week]] Ship pricing v2",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-10T16:00:00.000Z",
    updated_at: "2026-08-10T16:00:00.000Z",
  },
  {
    id: "demo-pricing",
    title: "Pricing v2 draft",
    body_markdown:
      "[[task:demo-task-overdue-2]] Legal review of annual terms\n\nThree tiers, usage-based add-ons",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-10T13:00:00.000Z",
    updated_at: "2026-08-10T13:00:00.000Z",
  },
  {
    id: "demo-interview",
    title: "Interview — Priya Sharma",
    body_markdown:
      "[[task:demo-task-friday]] Send Priya take-home\n\nStrong on systems design, ask about tradeoffs",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-09T18:00:00.000Z",
    updated_at: "2026-08-09T18:00:00.000Z",
  },
  {
    id: "demo-sync",
    title: "Pricing sync",
    body_markdown: "[[task:demo-task-meeting]] Send recap to team",
    note_type: "meeting",
    pinned: false,
    created_at: "2026-08-09T15:00:00.000Z",
    updated_at: "2026-08-09T15:00:00.000Z",
  },
  {
    id: "demo-weekly",
    title: "Weekly review",
    body_markdown: "[[task:demo-task-done]] Ship the importer",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-07T18:00:00.000Z",
    updated_at: "2026-08-07T18:00:00.000Z",
  },
];

/** Browser `npm run dev` has no Tauri IPC; use memory so the shell is previewable. */
export const notesApi: NotesApi = isTauriRuntime()
  ? tauriNotesApi
  : createMemoryNotesApi(isSearchKpiMode() ? makeSearchKpiSeed() : DEMO_SEED);
