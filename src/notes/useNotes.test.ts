import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryNotesApi } from "./memoryApi";
import type { Note } from "./types";
import { AUTOSAVE_DEBOUNCE_MS, useNotes } from "./useNotes";

function seedNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Alpha",
    body_markdown: "hello",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("useNotes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads notes and selects the most recently updated", async () => {
    const api = createMemoryNotesApi([
      seedNote({
        id: "old",
        title: "Old",
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
      seedNote({
        id: "new",
        title: "New",
        updated_at: "2026-08-10T12:00:00.000Z",
      }),
    ]);

    const { result } = renderHook(() => useNotes({ api }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notes.map((note) => note.id)).toEqual(["new", "old"]);
    expect(result.current.selectedId).toBe("new");
    expect(result.current.titleDraft).toBe("New");
  });

  it("debounces autosave and persists title/body edits", async () => {
    vi.useFakeTimers();
    const api = createMemoryNotesApi([seedNote()]);
    const updateNote = vi.spyOn(api, "updateNote");

    const { result } = renderHook(() =>
      useNotes({ api, debounceMs: AUTOSAVE_DEBOUNCE_MS }),
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.setTitleDraft("Alpha edited");
      result.current.setBodyDraft("hello world");
    });
    expect(result.current.status).toBe("dirty");
    expect(updateNote).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(updateNote).toHaveBeenCalledWith({
      id: "n1",
      title: "Alpha edited",
      body_markdown: "hello world",
      pinned: false,
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.notes[0]?.title).toBe("Alpha edited");
  });

  it("creates a note and deletes the selected note from the list", async () => {
    const api = createMemoryNotesApi([]);
    const { result } = renderHook(() => useNotes({ api }));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createNote("Fresh");
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.selectedId).toBe(result.current.notes[0]?.id);
    expect(result.current.titleDraft).toBe("Fresh");

    await act(async () => {
      await result.current.deleteSelected();
    });
    expect(result.current.notes).toHaveLength(0);
    expect(result.current.selectedId).toBeNull();
  });
});
