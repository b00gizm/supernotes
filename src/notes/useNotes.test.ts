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
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.notes[0]?.title).toBe("Alpha edited");
  });

  it("force-saves within the max wait while typing continuously", async () => {
    vi.useFakeTimers();
    const api = createMemoryNotesApi([seedNote()]);
    const updateNote = vi.spyOn(api, "updateNote");

    const { result } = renderHook(() => useNotes({ api }));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    // Keystrokes every 300ms keep resetting the 500ms debounce; the 2s
    // max wait must still push a save through.
    for (let i = 0; i < 8; i += 1) {
      act(() => {
        result.current.setBodyDraft(`draft ${String(i)}`);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
    }

    expect(updateNote).toHaveBeenCalled();
  });

  it("surfaces a failed flush when switching notes", async () => {
    const api = createMemoryNotesApi([
      seedNote({ id: "a", title: "A" }),
      seedNote({
        id: "b",
        title: "B",
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    ]);
    vi.spyOn(api, "updateNote").mockRejectedValue(new Error("db locked"));

    const { result } = renderHook(() => useNotes({ api }));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.selectedId).toBe("a");

    act(() => {
      result.current.setBodyDraft("unsaved edit");
    });
    act(() => {
      result.current.selectNote("b");
    });

    await waitFor(() => {
      expect(result.current.error).toContain("db locked");
    });
    // The optimistic edit must not survive the failed flush.
    expect(
      result.current.notes.find((note) => note.id === "a")?.body_markdown,
    ).toBe("hello");
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

  it("toggles pinned without requiring the note to be selected", async () => {
    const api = createMemoryNotesApi([
      seedNote({ id: "a", title: "A", pinned: false }),
      seedNote({
        id: "b",
        title: "B",
        pinned: false,
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    ]);
    const { result } = renderHook(() => useNotes({ api, autoSelect: false }));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.setPinned("b", true);
    });
    const pinned = result.current.notes.find((note) => note.id === "b");
    expect(pinned?.pinned).toBe(true);
    // Pinning is metadata-only and must not masquerade as an edit.
    expect(pinned?.updated_at).toBe("2026-08-09T10:00:00.000Z");
  });

  it("does not write the previous note body into a create-on-click note", async () => {
    // Stale TipTap onUpdate from the daily editor must not dirty Person after
    // create-on-click; navigating away must not persist daily text onto Person.
    const dailyBody = "Discuss [[Existing]] with @Person";
    const api = createMemoryNotesApi([
      seedNote({
        id: "daily",
        title: "Friday, August 8, 2025",
        body_markdown: dailyBody,
        note_type: "daily",
        updated_at: "2026-08-10T12:00:00.000Z",
      }),
      seedNote({
        id: "existing",
        title: "Existing",
        body_markdown: "",
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    ]);

    const { result } = renderHook(() => useNotes({ api, autoSelect: false }));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.selectNote("daily");
    });
    expect(result.current.bodyDraft).toBe(dailyBody);

    let personId = "";
    await act(async () => {
      const created = await result.current.createNote("Person");
      expect(created).not.toBeNull();
      if (!created) {
        return;
      }
      personId = created.id;
    });

    await waitFor(() => {
      expect(result.current.selectedId).toBe(personId);
      expect(result.current.bodyDraft).toBe("");
    });

    // App openWikiLink used to re-select via openFromSearch after create.
    act(() => {
      result.current.selectNote(personId);
    });
    expect(result.current.selectedId).toBe(personId);

    // Stale onUpdate from the daily editor (wrong fromNoteId) is ignored.
    act(() => {
      result.current.setBodyDraft(dailyBody, "daily");
    });
    expect(result.current.bodyDraft).toBe("");
    expect(result.current.status).toBe("idle");

    act(() => {
      result.current.selectNote("daily");
    });

    await waitFor(() => {
      const person = result.current.notes.find((note) => note.id === personId);
      expect(person?.body_markdown).toBe("");
    });

    const listed = await api.listNotes();
    expect(listed.find((note) => note.id === personId)?.body_markdown).toBe("");
  });

  it("openWikiLink double-select must not clear selection or flush daily into Person", async () => {
    // createNote applySelection(created) then selectNote(id) before React
    // flushes must still find Person (notesRef updated eagerly).
    const dailyBody = "Discuss [[Existing]] with @Person";
    const api = createMemoryNotesApi([
      seedNote({
        id: "daily",
        title: "Daily",
        body_markdown: dailyBody,
        note_type: "daily",
      }),
      seedNote({
        id: "existing",
        title: "Existing",
        body_markdown: "",
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    ]);

    const updateCalls: { id: string; body: string }[] = [];
    const realUpdate = api.updateNote.bind(api);
    vi.spyOn(api, "updateNote").mockImplementation(async (input) => {
      updateCalls.push({ id: input.id, body: input.body_markdown });
      return realUpdate(input);
    });

    const { result } = renderHook(() => useNotes({ api, autoSelect: false }));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.selectNote("daily");
    });

    act(() => {
      result.current.setBodyDraft(`${dailyBody} `);
    });
    expect(result.current.status).toBe("dirty");

    let personId = "";
    await act(async () => {
      const created = await result.current.createNote("Person");
      expect(created).not.toBeNull();
      if (!created) {
        return;
      }
      personId = created.id;
      result.current.selectNote(personId);
    });

    await waitFor(() => {
      expect(result.current.selectedId).toBe(personId);
    });
    expect(result.current.bodyDraft).toBe("");

    expect(
      updateCalls.some(
        (call) => call.id === personId && call.body.includes("[[Existing]]"),
      ),
    ).toBe(false);
    expect(
      result.current.notes.find((note) => note.id === personId)?.body_markdown,
    ).toBe("");
  });

  it("createNote then immediate selectNote must not persist daily draft onto Person", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const dailyBody = "Discuss [[Existing]] with @Person";
    const api = createMemoryNotesApi([
      seedNote({
        id: "daily",
        title: "Daily",
        body_markdown: dailyBody,
        note_type: "daily",
      }),
      seedNote({
        id: "existing",
        title: "Existing",
        body_markdown: "",
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    ]);

    const realUpdate = api.updateNote.bind(api);
    vi.spyOn(api, "updateNote").mockImplementation(async (input) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      return realUpdate(input);
    });

    const { result } = renderHook(() =>
      useNotes({ api, autoSelect: false, debounceMs: 500 }),
    );
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.selectNote("daily");
    });

    act(() => {
      result.current.setBodyDraft(`${dailyBody}!`);
    });
    expect(result.current.status).toBe("dirty");

    let personId = "";
    await act(async () => {
      const created = await result.current.createNote("Person");
      expect(created).not.toBeNull();
      if (!created) {
        return;
      }
      personId = created.id;
    });

    await waitFor(() => {
      expect(result.current.selectedId).toBe(personId);
    });

    // Stale onChange attributed to the daily note while Person is selected.
    act(() => {
      result.current.setBodyDraft(`${dailyBody}!`, "daily");
    });
    expect(result.current.bodyDraft).toBe("");

    act(() => {
      result.current.selectNote("daily");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    const person = result.current.notes.find((note) => note.id === personId);
    expect(person?.body_markdown).toBe("");
  });
});
