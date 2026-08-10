import { invoke } from "@tauri-apps/api/core";
import { createMemoryNotesApi } from "./memoryApi";
import type { CreateNoteInput, Note, UpdateNoteInput } from "./types";

export type NotesApi = {
  listNotes: () => Promise<Note[]>;
  createNote: (input: CreateNoteInput) => Promise<Note>;
  updateNote: (input: UpdateNoteInput) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
};

const tauriNotesApi: NotesApi = {
  listNotes: () => invoke<Note[]>("list_notes"),
  createNote: (input) => invoke<Note>("create_note", { input }),
  updateNote: (input) => invoke<Note>("update_note", { input }),
  deleteNote: async (id) => {
    await invoke("delete_note", { id });
  },
};

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri 2 injects this on the webview window.
    "__TAURI_INTERNALS__" in window
  );
}

/** Browser `npm run dev` has no Tauri IPC; use memory so the shell is previewable. */
export const notesApi: NotesApi = isTauriRuntime()
  ? tauriNotesApi
  : createMemoryNotesApi([
      {
        id: "demo-roadmap",
        title: "Meridian Q3 roadmap",
        body_markdown: "Ship pricing v2, land two design reviews",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-10T16:00:00.000Z",
        updated_at: "2026-08-10T16:00:00.000Z",
      },
      {
        id: "demo-pricing",
        title: "Pricing v2 draft",
        body_markdown: "Three tiers, usage-based add-ons",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-10T13:00:00.000Z",
        updated_at: "2026-08-10T13:00:00.000Z",
      },
      {
        id: "demo-interview",
        title: "Interview — Priya Sharma",
        body_markdown: "Strong on systems design, ask about tradeoffs",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-09T18:00:00.000Z",
        updated_at: "2026-08-09T18:00:00.000Z",
      },
      {
        id: "demo-sync",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier for now",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T15:00:00.000Z",
        updated_at: "2026-08-09T15:00:00.000Z",
      },
      {
        id: "demo-weekly",
        title: "Weekly review",
        body_markdown: "Shipped the importer; survey still open",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-07T18:00:00.000Z",
        updated_at: "2026-08-07T18:00:00.000Z",
      },
    ]);
