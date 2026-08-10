import { useEffect, useId, useRef, useState } from "react";
import type { Note } from "./notes/types";

export type SearchPaletteProps = {
  open: boolean;
  onClose: () => void;
  searchNotes: (query: string) => Promise<Note[]>;
  onOpenNote: (note: Note) => void;
  onCreateNote: (title: string) => void;
};

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

  const createLabel = query.trim()
    ? `Create note '${query.trim()}'`
    : "Create note 'Untitled'";
  const itemCount = results.length + 1;
  const createIndex = results.length;

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
    void searchNotes(query).then((notes) => {
      if (cancelled) {
        return;
      }
      setResults(notes);
      setActiveIndex(0);
      setSearching(false);
    });
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
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % itemCount);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + itemCount) % itemCount);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (activeIndex === createIndex) {
          onCreateNote(query.trim() || "Untitled");
        } else {
          const note = results[activeIndex];
          if (note) {
            onOpenNote(note);
          }
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    open,
    onClose,
    onCreateNote,
    onOpenNote,
    activeIndex,
    createIndex,
    itemCount,
    query,
    results,
  ]);

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
        <ul id={listId} className="search-results" role="listbox">
          {results.map((note, index) => {
            const active = index === activeIndex;
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
                  <span className="search-result-title">
                    {note.title || "Untitled"}
                  </span>
                </button>
              </li>
            );
          })}
          {results.length === 0 && !searching ? (
            <li className="search-empty" role="presentation">
              No matching notes
            </li>
          ) : null}
          <li role="presentation">
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
              onClick={() => {
                onCreateNote(query.trim() || "Untitled");
                onClose();
              }}
            >
              {createLabel}
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
