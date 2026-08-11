import type { NotesApi } from "./api";
import type { Note, NoteType } from "./types";

/** ENG-52 acceptance: search over this many notes must stay under the budget. */
export const SEARCH_KPI_NOTE_COUNT = 1000;
export const SEARCH_KPI_MAX_MS = 50;
export const SEARCH_KPI_QUERY = "Note 05";

export type SearchKpiResult = {
  noteCount: number;
  query: string;
  hitCount: number;
  /** Wall time for one `searchNotes` call, in milliseconds. */
  elapsedMs: number;
  passed: boolean;
};

/** Deterministic 1k-note corpus for the title-search KPI. */
export function makeSearchKpiSeed(
  count: number = SEARCH_KPI_NOTE_COUNT,
): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < count; i += 1) {
    const note_type: NoteType =
      i % 37 === 0 ? "meeting" : i % 11 === 0 ? "daily" : "regular";
    const day = String((i % 28) + 1).padStart(2, "0");
    notes.push({
      id: `kpi-${String(i).padStart(4, "0")}`,
      title: `Note ${String(i).padStart(4, "0")}`,
      body_markdown: `Body for note ${String(i)}`,
      note_type,
      pinned: false,
      created_at: `2026-07-${day}T12:00:00.000Z`,
      updated_at: `2026-08-01T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
    });
  }
  // Guaranteed demo hits for the palette UI check.
  const pricingDraft = notes[42];
  const pricingSync = notes[77];
  if (pricingDraft) {
    notes[42] = {
      ...pricingDraft,
      title: "Pricing v2 draft",
      note_type: "regular",
    };
  }
  if (pricingSync) {
    notes[77] = {
      ...pricingSync,
      title: "Pricing sync",
      note_type: "meeting",
    };
  }
  return notes;
}

/**
 * Seed is assumed already loaded in `api`. Times one title search against it.
 * Warm once, then measure — matches how the palette hits a hot DB/index.
 */
export async function runSearchKpi(
  api: NotesApi,
  query: string = SEARCH_KPI_QUERY,
): Promise<SearchKpiResult> {
  const listed = await api.listNotes();
  // Warm path (JIT / allocator / first prepare).
  await api.searchNotes(query);

  const started = performance.now();
  const hits = await api.searchNotes(query);
  const elapsedMs = performance.now() - started;

  return {
    noteCount: listed.length,
    query,
    hitCount: hits.length,
    elapsedMs,
    passed:
      listed.length >= SEARCH_KPI_NOTE_COUNT &&
      hits.length > 0 &&
      elapsedMs < SEARCH_KPI_MAX_MS,
  };
}

export function isSearchKpiMode(
  search: string = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  return new URLSearchParams(search).get("kpi") === "search";
}
