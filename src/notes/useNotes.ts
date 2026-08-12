import { useEffect, useRef, useState } from "react";
import type { NotesApi } from "./api";
import { notesApi as defaultNotesApi } from "./api";
import { byUpdatedAtDesc, formatDailyTitle } from "./format";
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

type DraftSnapshot = {
  id: string;
  title: string;
  body: string;
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
    const id = note?.id ?? null;
    const title = note?.title ?? "";
    const body = note?.body_markdown ?? "";
    // Eager refs: callers may flush/select again before React re-renders.
    selectedIdRef.current = id;
    titleDraftRef.current = title;
    bodyDraftRef.current = body;
    statusRef.current = "idle";
    dirtySinceRef.current = null;
    setSelectedId(id);
    setTitleDraftState(title);
    setBodyDraftState(body);
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
      notesRef.current = listed;
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

  const persistDraft = async (snapshot?: DraftSnapshot) => {
    const id = snapshot?.id ?? selectedIdRef.current;
    if (!id) {
      return;
    }

    const existing = notesRef.current.find((note) => note.id === id);
    if (!existing) {
      return;
    }

    const title = snapshot?.title ?? titleDraftRef.current;
    const body = snapshot?.body ?? bodyDraftRef.current;
    if (title === existing.title && body === existing.body_markdown) {
      dirtySinceRef.current = null;
      if (!snapshot || selectedIdRef.current === id) {
        statusRef.current = "idle";
        setStatus("idle");
      }
      return;
    }

    dirtySinceRef.current = null;
    const generation = ++saveGeneration.current;
    if (!snapshot || selectedIdRef.current === id) {
      statusRef.current = "saving";
      setStatus("saving");
    }
    setError(null);

    setNotes((prev) => {
      const next = [
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
      ].sort(byUpdatedAtDesc);
      notesRef.current = next;
      return next;
    });

    try {
      const titleChanged = title !== existing.title;
      const saved = await apiRef.current.updateNote({
        id,
        title,
        body_markdown: body,
      });
      if (!mountedRef.current) {
        return;
      }
      if (titleChanged) {
        // Renames rewrite `[[old]]` in other notes' bodies (ENG-56). Always
        // reconcile — selectNote bumps saveGeneration after flush, and skipping
        // here leaves stale bodies that autosave would revert (ENG-91).
        const listed = [...(await apiRef.current.listNotes())].sort(
          byUpdatedAtDesc,
        );
        // Mounted already checked after updateNote; skip a second ref read —
        // TS narrows `mountedRef.current` across the await (always-falsy lint).
        notesRef.current = listed;
        setNotes(listed);
        // Switched-to note may hold a pre-rewrite body in its draft.
        const currentId = selectedIdRef.current;
        if (currentId && currentId !== id && statusRef.current === "idle") {
          const current = listed.find((note) => note.id === currentId);
          if (current && bodyDraftRef.current !== current.body_markdown) {
            bodyDraftRef.current = current.body_markdown;
            setBodyDraftState(current.body_markdown);
          }
        }
      } else if (generation === saveGeneration.current) {
        setNotes((prev) => {
          const next = [
            ...prev.map((note) => (note.id === id ? saved : note)),
          ].sort(byUpdatedAtDesc);
          notesRef.current = next;
          return next;
        });
      }
      // Status belongs to this generation's selection. Only "saved" when drafts
      // still match the payload — otherwise leave/set dirty so flush-on-close
      // still runs (ENG-90).
      if (
        generation === saveGeneration.current &&
        selectedIdRef.current === id
      ) {
        if (titleDraftRef.current === title && bodyDraftRef.current === body) {
          statusRef.current = "saved";
          setStatus("saved");
        } else {
          statusRef.current = "dirty";
          setStatus("dirty");
        }
      }
    } catch (err) {
      // A stale generation must still surface the failure and reconcile with
      // the DB; only the status flag belongs to the current selection (ENG-78).
      if (
        mountedRef.current &&
        generation === saveGeneration.current &&
        selectedIdRef.current === id
      ) {
        statusRef.current = "error";
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

    statusRef.current = "dirty";
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
    if (selectedIdRef.current && statusRef.current === "dirty") {
      // Snapshot before switching — live refs will point at the next note.
      void persistDraftRef.current({
        id: selectedIdRef.current,
        title: titleDraftRef.current,
        body: bodyDraftRef.current,
      });
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
      if (selectedIdRef.current && statusRef.current === "dirty") {
        await persistDraftRef.current({
          id: selectedIdRef.current,
          title: titleDraftRef.current,
          body: bodyDraftRef.current,
        });
      }
      const created = await apiRef.current.createNote({
        title,
        body_markdown: "",
        ...input,
      });
      const next = [created, ...notesRef.current].sort(byUpdatedAtDesc);
      notesRef.current = next;
      setNotes(next);
      saveGeneration.current += 1;
      applySelection(created);
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  /** Open (or lazily create) the daily note for `date` (local calendar day). */
  const openDaily = async (date: Date = new Date()) => {
    const title = formatDailyTitle(date);
    const existing = notesRef.current.find(
      (note) => note.note_type === "daily" && note.title === title,
    );
    if (existing) {
      if (selectedIdRef.current !== existing.id) {
        // Flush before switching away from a dirty draft.
        if (selectedIdRef.current && statusRef.current === "dirty") {
          await persistDraftRef.current({
            id: selectedIdRef.current,
            title: titleDraftRef.current,
            body: bodyDraftRef.current,
          });
        }
        applySelection(existing);
      }
      return existing;
    }
    setError(null);
    try {
      if (selectedIdRef.current && statusRef.current === "dirty") {
        await persistDraftRef.current({
          id: selectedIdRef.current,
          title: titleDraftRef.current,
          body: bodyDraftRef.current,
        });
      }
      const note = await apiRef.current.getOrCreateDaily(title);
      const withoutDup = notesRef.current.filter((item) => item.id !== note.id);
      const next = [note, ...withoutDup].sort(byUpdatedAtDesc);
      notesRef.current = next;
      setNotes(next);
      saveGeneration.current += 1;
      applySelection(note);
      return note;
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
    notesRef.current = remaining;
    setNotes(remaining);
    applySelection(remaining[0] ?? null);
    try {
      await apiRef.current.deleteNote(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      notesRef.current = previous;
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
    setNotes((prev) => {
      const next = prev.map((note) =>
        note.id === id ? { ...note, pinned } : note,
      );
      notesRef.current = next;
      return next;
    });
    try {
      const saved = await apiRef.current.setPinned(id, pinned);
      if (!mountedRef.current) {
        return;
      }
      setNotes((prev) => {
        const next = prev.map((note) =>
          note.id === id ? { ...note, pinned: saved.pinned } : note,
        );
        notesRef.current = next;
        return next;
      });
    } catch (err) {
      // Reconcile first — refresh() clears the error state.
      await refresh();
      if (!mountedRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** Ignore TipTap onUpdate from a note that is no longer selected. */
  const setBodyDraft = (body: string, fromNoteId?: string | null) => {
    if (fromNoteId !== undefined && fromNoteId !== selectedIdRef.current) {
      return;
    }
    bodyDraftRef.current = body;
    setBodyDraftState(body);
  };

  const setTitleDraft = (title: string) => {
    titleDraftRef.current = title;
    setTitleDraftState(title);
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
    setTitleDraft,
    setBodyDraft,
    createNote,
    openDaily,
    deleteSelected,
    setPinned,
    refresh,
  };
}
