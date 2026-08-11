import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatRelativeUpdated } from "./notes/format";
import type { Note, NoteType } from "./notes/types";

export type SearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  searchNotes: (query: string) => Promise<Note[]>;
  onOpenNote: (note: Note) => void;
  onCreateNote: (title: string) => void;
};

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

/** Bold the first case-insensitive substring match (mockup 1j). */
function highlightMatch(title: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle) {
    return title;
  }
  const index = title.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return title;
  }
  const end = index + needle.length;
  return (
    <>
      {title.slice(0, index)}
      <strong>{title.slice(index, end)}</strong>
      {title.slice(end)}
    </>
  );
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

function IconMeetingBars() {
  return (
    <svg className="search-type-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 5.5v5M8 3.5v9M12 6v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TypeIcon({ type }: { type: NoteType }) {
  return type === "meeting" ? <IconMeetingBars /> : <IconNoteDoc />;
}

export function SearchPalette({
  open,
  onClose,
  searchNotes,
  onOpenNote,
  onCreateNote,
}: SearchPaletteProps) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Note[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const createTitle = query.trim() || "Untitled";
  const createLabel = `+ Create note '${createTitle}'`;
  const itemCount = results.length + 1;
  const createIndex = results.length;

  const queryRef = useRef(query);
  const resultsRef = useRef(results);
  const activeIndexRef = useRef(activeIndex);
  const createIndexRef = useRef(createIndex);
  const itemCountRef = useRef(itemCount);
  queryRef.current = query;
  resultsRef.current = results;
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
    setResults([]);
    setActiveIndex(0);
    const handle = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchNotes(query).then(
      (notes) => {
        if (cancelled) {
          return;
        }
        setResults(notes);
        setActiveIndex(0);
        setSearching(false);
      },
      () => {
        // Failed search: drop stale results so the create row stands alone
        // instead of leaving "searching" stuck (ENG-81).
        if (cancelled) {
          return;
        }
        setResults([]);
        setActiveIndex(0);
        setSearching(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, query, searchNotes]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
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
        const note = resultsRef.current[index];
        if (note) {
          onOpenNote(note);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
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
            aria-label="Search notes"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={`${listId}-item-${String(activeIndex)}`}
            placeholder="Search notes…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <kbd className="search-esc-chip">esc</kbd>
        </div>

        <ul id={listId} className="search-results" role="listbox">
          {results.map((note, index) => {
            const active = index === activeIndex;
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
          })}
          {results.length === 0 && !searching ? (
            <li className="search-empty" role="presentation">
              No matching notes
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
