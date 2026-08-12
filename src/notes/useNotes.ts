import { useEffect, useRef, useState } from "react";
import { debugLog as dbg } from "../debugLog";
import type { NotesApi } from "./api";
import { notesApi as defaultNotesApi } from "./api";
import { byUpdatedAtDesc } from "./format";
import type { CreateNoteInput, Note } from "./types";

export const AUTOSAVE_DEBOUNCE_MS = 500;
/** Continuous typing must still hit disk this often (ENG-78). */
export const AUTOSAVE_MAX_WAIT_MS = 2000;

export type NotesSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type UseNotesOptions = {
  api?: NotesApi;
  debounceMs?: number;
  maxWaitMs?: number;
  /** When false, load without selecting a note (shell picks Daily / overview). */
  autoSelect?: boolean;
};

export function useNotes(options: UseNotesOptions = {}) {
  const api = options.api ?? defaultNotesApi;
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
  const autoSelect = options.autoSelect ?? true;
  const apiRef = useRef(api);
  const autoSelectRef = useRef(autoSelect);
  apiRef.current = api;
  autoSelectRef.current = autoSelect;

  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [titleDraft, setTitleDraftState] = useState("");
  const [bodyDraft, setBodyDraftState] = useState("");
  const [status, setStatus] = useState<NotesSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedIdRef = useRef<string | null>(null);
  const titleDraftRef = useRef("");
  const bodyDraftRef = useRef("");
  const notesRef = useRef<Note[]>([]);
  const saveGeneration = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef<NotesSaveStatus>("idle");
  const dirtySinceRef = useRef<number | null>(null);

  selectedIdRef.current = selectedId;
  titleDraftRef.current = titleDraft;
  bodyDraftRef.current = bodyDraft;
  notesRef.current = notes;
  statusRef.current = status;

  const selectedNote = selectedId
    ? (notes.find((note) => note.id === selectedId) ?? null)
    : null;

  const applySelection = (note: Note | null) => {
    setSelectedId(note?.id ?? null);
    setTitleDraftState(note?.title ?? "");
    setBodyDraftState(note?.body_markdown ?? "");
    setStatus("idle");
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const listed = [...(await apiRef.current.listNotes())].sort(
        byUpdatedAtDesc,
      );
      if (!mountedRef.current) {
        return;
      }
      setNotes(listed);
      setError(null);

      const currentId = selectedIdRef.current;
      if (currentId) {
        if (!listed.some((note) => note.id === currentId)) {
          applySelection(autoSelectRef.current ? (listed[0] ?? null) : null);
        }
      } else if (autoSelectRef.current && listed[0]) {
        applySelection(listed[0]);
      }
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    mountedRef.current = true;
    void refreshRef.current();
    return () => {
      mountedRef.current = false;
      saveGeneration.current += 1;
    };
  }, []);

  const persistDraft = async () => {
    const id = selectedIdRef.current;
    if (!id) {
      return;
    }

    const existing = notesRef.current.find((note) => note.id === id);
    if (!existing) {
      return;
    }

    const title = titleDraftRef.current;
    const body = bodyDraftRef.current;
    // #region agent log
    dbg("A", "useNotes.ts:persistDraft", "persistDraft capture", {
      id,
      title,
      bodyLen: body.length,
      bodyPreview: body.slice(0, 80),
      existingBodyLen: existing.body_markdown.length,
      existingTitle: existing.title,
      status: statusRef.current,
    });
    // #endregion
    if (title === existing.title && body === existing.body_markdown) {
      dirtySinceRef.current = null;
      setStatus("idle");
      return;
    }

    dirtySinceRef.current = null;
    const generation = ++saveGeneration.current;
    setStatus("saving");
    setError(null);

    setNotes((prev) =>
      [
        ...prev.map((note) =>
          note.id === id
            ? {
                ...note,
                title,
                body_markdown: body,
                updated_at: new Date().toISOString(),
              }
            : note,
        ),
      ].sort(byUpdatedAtDesc),
    );

    try {
      const titleChanged = title !== existing.title;
      const saved = await apiRef.current.updateNote({
        id,
        title,
        body_markdown: body,
      });
      // #region agent log
      dbg("A", "useNotes.ts:persistDraft:afterUpdate", "updateNote completed", {
        id,
        title,
        bodyPreview: body.slice(0, 80),
        generation,
        currentGeneration: saveGeneration.current,
        stale: generation !== saveGeneration.current,
        selectedIdNow: selectedIdRef.current,
      });
      // #endregion
      if (!mountedRef.current || generation !== saveGeneration.current) {
        return;
      }
      if (titleChanged) {
        // Renames rewrite `[[old]]` in other notes' bodies (ENG-56).
        const listed = [...(await apiRef.current.listNotes())].sort(
          byUpdatedAtDesc,
        );
        // Drop the result if a newer edit superseded this save.
        if (generation !== saveGeneration.current) {
          return;
        }
        setNotes(listed);
      } else {
        setNotes((prev) =>
          [...prev.map((note) => (note.id === id ? saved : note))].sort(
            byUpdatedAtDesc,
          ),
        );
      }
      setStatus("saved");
    } catch (err) {
      // A stale generation must still surface the failure and reconcile with
      // the DB; only the status flag belongs to the current selection (ENG-78).
      if (mountedRef.current && generation === saveGeneration.current) {
        setStatus("error");
      }
      // Reconcile first — refresh() clears the error state.
      await refresh();
      if (!mountedRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const existing = notesRef.current.find((note) => note.id === selectedId);
    if (!existing) {
      return;
    }
    if (titleDraft === existing.title && bodyDraft === existing.body_markdown) {
      dirtySinceRef.current = null;
      return;
    }

    setStatus("dirty");
    // Trailing debounce, but never later than maxWaitMs after the first
    // unsaved keystroke — continuous typing must still persist (ENG-78).
    const now = Date.now();
    dirtySinceRef.current ??= now;
    const deadline = dirtySinceRef.current + maxWaitMs;
    const delay = Math.min(debounceMs, Math.max(0, deadline - now));
    const handle = window.setTimeout(() => {
      void persistDraftRef.current();
    }, delay);
    return () => {
      window.clearTimeout(handle);
    };
  }, [selectedId, titleDraft, bodyDraft, debounceMs, maxWaitMs]);

  // The debounce dies with the process; flush dirty edits when the window
  // goes away or loses focus (ENG-78).
  useEffect(() => {
    const flushIfDirty = () => {
      if (statusRef.current === "dirty") {
        void persistDraftRef.current();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushIfDirty();
      }
    };
    window.addEventListener("beforeunload", flushIfDirty);
    window.addEventListener("blur", flushIfDirty);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", flushIfDirty);
      window.removeEventListener("blur", flushIfDirty);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const selectNote = (id: string | null) => {
    // #region agent log
    dbg("A", "useNotes.ts:selectNote", "selectNote called", {
      toId: id,
      fromId: selectedIdRef.current,
      status: statusRef.current,
      willFlushDirty:
        Boolean(selectedIdRef.current) && statusRef.current === "dirty",
      bodyPreview: bodyDraftRef.current.slice(0, 80),
      notesHasTarget: id ? notesRef.current.some((n) => n.id === id) : null,
    });
    // #endregion
    if (selectedIdRef.current && statusRef.current === "dirty") {
      void persistDraftRef.current();
    }
    saveGeneration.current += 1;
    applySelection(
      id ? (notesRef.current.find((item) => item.id === id) ?? null) : null,
    );
  };

  const createNote = async (
    title = "Untitled",
    input: Omit<CreateNoteInput, "title" | "body_markdown"> = {},
  ) => {
    setError(null);
    try {
      // #region agent log
      dbg("C", "useNotes.ts:createNote:start", "createNote start", {
        title,
        selectedId: selectedIdRef.current,
        status: statusRef.current,
        bodyPreview: bodyDraftRef.current.slice(0, 80),
      });
      // #endregion
      if (selectedIdRef.current && statusRef.current === "dirty") {
        await persistDraftRef.current();
      }
      const created = await apiRef.current.createNote({
        title,
        body_markdown: "",
        ...input,
      });
      setNotes((prev) => [created, ...prev].sort(byUpdatedAtDesc));
      saveGeneration.current += 1;
      applySelection(created);
      // #region agent log
      dbg(
        "C",
        "useNotes.ts:createNote:afterSelect",
        "createNote applied selection",
        {
          createdId: created.id,
          createdTitle: created.title,
          selectedIdRefStill: selectedIdRef.current,
          bodyDraftRefStill: bodyDraftRef.current.slice(0, 80),
          notesRefHasCreated: notesRef.current.some((n) => n.id === created.id),
        },
      );
      // #endregion
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const deleteSelected = async () => {
    const id = selectedIdRef.current;
    if (!id) {
      return;
    }
    setError(null);
    saveGeneration.current += 1;
    const previous = notesRef.current;
    const remaining = previous.filter((note) => note.id !== id);
    setNotes(remaining);
    applySelection(remaining[0] ?? null);
    try {
      await apiRef.current.deleteNote(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotes(previous);
      applySelection(previous.find((note) => note.id === id) ?? null);
    }
  };

  const setPinned = async (id: string, pinned: boolean) => {
    const existing = notesRef.current.find((note) => note.id === id);
    if (!existing || existing.pinned === pinned) {
      return;
    }
    setError(null);
    // Metadata-only toggle: content and updated_at stay untouched, so this
    // can't race the autosave and doesn't reorder the lists (ENG-79).
    setNotes((prev) =>
      prev.map((note) => (note.id === id ? { ...note, pinned } : note)),
    );
    try {
      const saved = await apiRef.current.setPinned(id, pinned);
      if (!mountedRef.current) {
        return;
      }
      setNotes((prev) =>
        prev.map((note) =>
          note.id === id ? { ...note, pinned: saved.pinned } : note,
        ),
      );
    } catch (err) {
      // Reconcile first — refresh() clears the error state.
      await refresh();
      if (!mountedRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    notes,
    selectedId,
    selectedNote,
    titleDraft,
    bodyDraft,
    status,
    error,
    loading,
    selectNote,
    setTitleDraft: setTitleDraftState,
    setBodyDraft: (body: string) => {
      // #region agent log
      dbg("B", "useNotes.ts:setBodyDraft", "setBodyDraft", {
        selectedId: selectedIdRef.current,
        bodyLen: body.length,
        bodyPreview: body.slice(0, 80),
        prevPreview: bodyDraftRef.current.slice(0, 80),
      });
      // #endregion
      setBodyDraftState(body);
    },
    createNote,
    deleteSelected,
    setPinned,
    refresh,
  };
}
