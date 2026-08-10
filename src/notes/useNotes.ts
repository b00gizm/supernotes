import { useEffect, useRef, useState } from "react";
import type { NotesApi } from "./api";
import { notesApi as defaultNotesApi } from "./api";
import type { Note } from "./types";

export const AUTOSAVE_DEBOUNCE_MS = 500;

export type NotesSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type UseNotesOptions = {
  api?: NotesApi;
  debounceMs?: number;
};

export type UseNotesResult = {
  notes: Note[];
  selectedId: string | null;
  selectedNote: Note | null;
  titleDraft: string;
  bodyDraft: string;
  status: NotesSaveStatus;
  error: string | null;
  loading: boolean;
  selectNote: (id: string | null) => void;
  setTitleDraft: (title: string) => void;
  setBodyDraft: (body: string) => void;
  createNote: (title?: string) => Promise<Note | null>;
  deleteSelected: () => Promise<void>;
  refresh: () => Promise<void>;
};

function sortByUpdatedAtDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function applySelection(
  note: Note | null,
  setSelectedId: (id: string | null) => void,
  setTitleDraftState: (title: string) => void,
  setBodyDraftState: (body: string) => void,
  setStatus: (status: NotesSaveStatus) => void,
) {
  if (!note) {
    setSelectedId(null);
    setTitleDraftState("");
    setBodyDraftState("");
    setStatus("idle");
    return;
  }
  setSelectedId(note.id);
  setTitleDraftState(note.title);
  setBodyDraftState(note.body_markdown);
  setStatus("idle");
}

export function useNotes(options: UseNotesOptions = {}): UseNotesResult {
  const api = options.api ?? defaultNotesApi;
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const apiRef = useRef(api);
  apiRef.current = api;

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

  selectedIdRef.current = selectedId;
  titleDraftRef.current = titleDraft;
  bodyDraftRef.current = bodyDraft;
  notesRef.current = notes;
  statusRef.current = status;

  const selectedNote = selectedId
    ? (notes.find((note) => note.id === selectedId) ?? null)
    : null;

  const refresh = async () => {
    setLoading(true);
    try {
      const listed = sortByUpdatedAtDesc(await apiRef.current.listNotes());
      if (!mountedRef.current) {
        return;
      }
      setNotes(listed);
      setError(null);

      const currentId = selectedIdRef.current;
      if (currentId) {
        const current = listed.find((note) => note.id === currentId) ?? null;
        if (!current) {
          applySelection(
            listed[0] ?? null,
            setSelectedId,
            setTitleDraftState,
            setBodyDraftState,
            setStatus,
          );
        }
      } else if (listed[0]) {
        applySelection(
          listed[0],
          setSelectedId,
          setTitleDraftState,
          setBodyDraftState,
          setStatus,
        );
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

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
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
    if (title === existing.title && body === existing.body_markdown) {
      setStatus("idle");
      return;
    }

    const generation = ++saveGeneration.current;
    setStatus("saving");
    setError(null);

    setNotes((prev) =>
      sortByUpdatedAtDesc(
        prev.map((note) =>
          note.id === id
            ? {
                ...note,
                title,
                body_markdown: body,
                updated_at: new Date().toISOString(),
              }
            : note,
        ),
      ),
    );

    try {
      const saved = await apiRef.current.updateNote({
        id,
        title,
        body_markdown: body,
        pinned: existing.pinned,
      });
      if (!mountedRef.current || generation !== saveGeneration.current) {
        return;
      }
      setNotes((prev) =>
        sortByUpdatedAtDesc(
          prev.map((note) => (note.id === id ? saved : note)),
        ),
      );
      setStatus("saved");
    } catch (err) {
      if (!mountedRef.current || generation !== saveGeneration.current) {
        return;
      }
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
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
      return;
    }

    setStatus("dirty");
    const handle = window.setTimeout(() => {
      void persistDraftRef.current();
    }, debounceMs);
    return () => {
      window.clearTimeout(handle);
    };
  }, [selectedId, titleDraft, bodyDraft, debounceMs]);

  const selectNote = (id: string | null) => {
    if (selectedIdRef.current && statusRef.current === "dirty") {
      void persistDraftRef.current();
    }
    saveGeneration.current += 1;
    const note = id
      ? (notesRef.current.find((item) => item.id === id) ?? null)
      : null;
    applySelection(
      note,
      setSelectedId,
      setTitleDraftState,
      setBodyDraftState,
      setStatus,
    );
  };

  const createNote = async (title = "Untitled") => {
    setError(null);
    try {
      if (selectedIdRef.current && statusRef.current === "dirty") {
        await persistDraftRef.current();
      }
      const created = await apiRef.current.createNote({
        title,
        body_markdown: "",
      });
      setNotes((prev) => sortByUpdatedAtDesc([created, ...prev]));
      saveGeneration.current += 1;
      applySelection(
        created,
        setSelectedId,
        setTitleDraftState,
        setBodyDraftState,
        setStatus,
      );
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
    applySelection(
      remaining[0] ?? null,
      setSelectedId,
      setTitleDraftState,
      setBodyDraftState,
      setStatus,
    );
    try {
      await apiRef.current.deleteNote(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setNotes(previous);
      const restored = previous.find((note) => note.id === id) ?? null;
      applySelection(
        restored,
        setSelectedId,
        setTitleDraftState,
        setBodyDraftState,
        setStatus,
      );
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
    setBodyDraft: setBodyDraftState,
    createNote,
    deleteSelected,
    refresh,
  };
}
