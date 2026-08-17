import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatRelativeUpdated } from "./notes/format";
import type { Note, NoteType } from "./notes/types";
import { TaskStateIcon } from "./tasks/TaskStateIcon";
import type { Task } from "./tasks/types";
import { highlightMatch } from "./ui/highlightMatch";
import { IconWaveform } from "./ui/IconWaveform";

export type SearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  searchNotes: (query: string) => Promise<Note[]>;
  searchTasks: (query: string) => Promise<Task[]>;
  notes: Note[];
  onOpenNote: (note: Note, taskId?: string | null) => void;
  onCreateNote: (title: string) => void;
};

type SearchHit =
  { kind: "note"; note: Note } | { kind: "task"; task: Task; note: Note };

function noteTypeLabel(type: NoteType): string {
  switch (type) {
    case "meeting":
      return "Meeting";
    case "daily":
      return "Daily";
    default:
      return "Note";
  }
}

function IconSearchGlyph() {
  return (
    <svg className="search-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r="4.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M10.2 10.2 13.5 13.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconNoteDoc() {
  return (
    <svg className="search-type-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 2.75h5.2L12.5 5.6v7.65a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.85V5.5H12.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TypeIcon({ type }: { type: NoteType }) {
  return type === "meeting" ? (
    <IconWaveform className="search-type-icon" />
  ) : (
    <IconNoteDoc />
  );
}

export function SearchPalette({
  open,
  onClose,
  searchNotes,
  searchTasks,
  notes,
  onOpenNote,
  onCreateNote,
}: SearchPaletteProps) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [noteHits, setNoteHits] = useState<Note[]>([]);
  const [taskHits, setTaskHits] = useState<Task[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const visibleTaskHits = useMemo(() => {
    const byId = new Map(notes.map((note) => [note.id, note]));
    return taskHits.flatMap((task) => {
      const note = byId.get(task.note_id);
      return note ? [{ task, note }] : [];
    });
  }, [taskHits, notes]);

  const hits: SearchHit[] = [
    ...noteHits.map((note) => ({ kind: "note" as const, note })),
    ...visibleTaskHits.map(({ task, note }) => ({
      kind: "task" as const,
      task,
      note,
    })),
  ];

  const createTitle = query.trim() || "Untitled";
  const createLabel = `+ Create note '${createTitle}'`;
  const itemCount = hits.length + 1;
  const createIndex = hits.length;

  const queryRef = useRef(query);
  const hitsRef = useRef(hits);
  const activeIndexRef = useRef(activeIndex);
  const createIndexRef = useRef(createIndex);
  const itemCountRef = useRef(itemCount);
  queryRef.current = query;
  hitsRef.current = hits;
  activeIndexRef.current = activeIndex;
  createIndexRef.current = createIndex;
  itemCountRef.current = itemCount;

  const createAndClose = () => {
    onCreateNote(queryRef.current.trim() || "Untitled");
    onClose();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setNoteHits([]);
    setTaskHits([]);
    setActiveIndex(0);
    setSearchError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const notesPromise = searchNotes(query);
    const tasksPromise = query.trim()
      ? searchTasks(query)
      : Promise.resolve([] as Task[]);
    void Promise.all([notesPromise, tasksPromise]).then(
      ([foundNotes, foundTasks]) => {
        if (cancelled) {
          return;
        }
        setNoteHits(foundNotes);
        setTaskHits(foundTasks);
        setActiveIndex(0);
        setSearching(false);
      },
      (err: unknown) => {
        // Failed search: drop stale results so the create row stands alone
        // instead of leaving "searching" stuck (ENG-81). Surface the
        // failure so a broken search_tasks IPC isn't "no matches" (ENG-136).
        if (cancelled) {
          return;
        }
        setNoteHits([]);
        setTaskHits([]);
        setActiveIndex(0);
        setSearching(false);
        setSearchError(err instanceof Error ? err.message : "Failed to search");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, query, searchNotes, searchTasks]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // Printable keys that still target the editor (focus hasn't moved yet)
      // must land in the query, not the note underneath (ENG-130).
      const printable =
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey;
      if (printable) {
        const input = inputRef.current;
        if (
          input &&
          event.target instanceof Node &&
          input.contains(event.target)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setQuery((current) => current + event.key);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        onCreateNote(queryRef.current.trim() || "Untitled");
        onClose();
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        onCreateNote(queryRef.current.trim() || "Untitled");
        onClose();
        return;
      }

      const count = itemCountRef.current;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % count);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + count) % count);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const index = activeIndexRef.current;
        if (index === createIndexRef.current) {
          onCreateNote(queryRef.current.trim() || "Untitled");
          onClose();
          return;
        }
        const hit = hitsRef.current[index];
        if (hit?.kind === "note") {
          onOpenNote(hit.note);
          onClose();
        } else if (hit?.kind === "task") {
          onOpenNote(hit.note, hit.task.id);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, onCreateNote, onOpenNote]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={inputId}
      >
        <div className="search-input-row">
          <IconSearchGlyph />
          <input
            ref={inputRef}
            id={inputId}
            className="search-input"
            autoFocus
            aria-label="Search notes and tasks"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={`${listId}-item-${String(activeIndex)}`}
            placeholder="Search notes and tasks…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <kbd className="search-esc-chip">esc</kbd>
        </div>

        {searchError ? (
          <p className="error-banner" role="alert">
            {searchError}
          </p>
        ) : null}

        <ul id={listId} className="search-results" role="listbox">
          {hits.map((hit, index) => {
            const active = index === activeIndex;
            if (hit.kind === "note") {
              const note = hit.note;
              const when = formatRelativeUpdated(note.updated_at);
              const meta = when
                ? `${noteTypeLabel(note.note_type)} · ${when}`
                : noteTypeLabel(note.note_type);
              return (
                <li key={note.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-item-${String(index)}`}
                    role="option"
                    aria-selected={active}
                    className={
                      active ? "search-result is-active" : "search-result"
                    }
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    onClick={() => {
                      onOpenNote(note);
                      onClose();
                    }}
                  >
                    <TypeIcon type={note.note_type} />
                    <span className="search-result-title">
                      {highlightMatch(note.title || "Untitled", query)}
                    </span>
                    <span className="search-result-meta">{meta}</span>
                    {active ? (
                      <span className="search-result-return" aria-hidden="true">
                        ⏎
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            }
            const { task, note } = hit;
            const meta = `Task · ${note.title.trim() || "Untitled"}`;
            return (
              <li key={`task:${task.id}`} role="presentation">
                <button
                  type="button"
                  id={`${listId}-item-${String(index)}`}
                  role="option"
                  aria-selected={active}
                  className={
                    active ? "search-result is-active" : "search-result"
                  }
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    onOpenNote(note, task.id);
                    onClose();
                  }}
                >
                  <TaskStateIcon state={task.state} />
                  <span className="search-result-title">
                    {highlightMatch(
                      task.title.trim() || "Untitled task",
                      query,
                    )}
                  </span>
                  <span className="search-result-meta">{meta}</span>
                  {active ? (
                    <span className="search-result-return" aria-hidden="true">
                      ⏎
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {hits.length === 0 && !searching && !searchError ? (
            <li className="search-empty" role="presentation">
              No matching notes or tasks
            </li>
          ) : null}
          <li className="search-create-row" role="presentation">
            <button
              type="button"
              id={`${listId}-item-${String(createIndex)}`}
              role="option"
              aria-selected={activeIndex === createIndex}
              className={
                activeIndex === createIndex
                  ? "search-result search-create is-active"
                  : "search-result search-create"
              }
              onMouseEnter={() => {
                setActiveIndex(createIndex);
              }}
              onClick={createAndClose}
            >
              <span className="search-create-label">{createLabel}</span>
              <kbd className="search-shortcut">⌘+⏎</kbd>
            </button>
          </li>
        </ul>

        <div className="search-legend" aria-hidden="true">
          <span>↑↓ Navigate</span>
          <span>⏎ Open</span>
          <span>⌘N New note</span>
        </div>
      </div>
    </div>
  );
}
