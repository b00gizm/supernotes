import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  formatDailyTitle,
  formatRelativeUpdated,
  noteSnippet,
} from "./notes/format";
import type { Note } from "./notes/types";
import { useNotes } from "./notes/useNotes";
import "./App.css";

type NavId = "daily" | "notes" | "tasks" | "calendar";

type Surface = { kind: NavId } | { kind: "note"; id: string };

function saveLabel(status: ReturnType<typeof useNotes>["status"]): string {
  switch (status) {
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    default:
      return "";
  }
}

function IconDaily({ active }: { active?: boolean }) {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="3"
        width="11"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M5 1.75v2.5M11 1.75v2.5M2.5 6.5h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle
        cx="8"
        cy="10"
        r="1.35"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function IconNotes() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 2.75h5.2L12.5 5.6v7.65a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.85V5.5H12.3M5.5 8.25h5M5.5 10.75h3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTasks() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="5.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M5.75 8.1 7.3 9.6l3.1-3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="3.25"
        width="11"
        height="10.25"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M5 1.75v2.5M11 1.75v2.5M2.5 6.75h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M5.25 9h1.1M7.45 9h1.1M9.65 9h1.1M5.25 11.15h1.1M7.45 11.15h1.1"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWaveform() {
  return (
    <svg className="waveform-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M1.5 6v0M3.2 3.8v4.4M4.9 2.4v7.2M6.6 4.2v3.6M8.3 3.1v5.8M10 5.2v1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
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

function IconChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={expanded ? "chevron is-expanded" : "chevron"}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path
        d="M3 4.5 6 7.5 9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV_ITEMS: {
  id: NavId;
  label: string;
  icon: (active: boolean) => ReactNode;
}[] = [
  {
    id: "daily",
    label: "Daily Note",
    icon: (active) => <IconDaily active={active} />,
  },
  { id: "notes", label: "Notes", icon: () => <IconNotes /> },
  { id: "tasks", label: "Tasks", icon: () => <IconTasks /> },
  { id: "calendar", label: "Calendar", icon: () => <IconCalendar /> },
];

function App() {
  const {
    notes,
    selectedId,
    titleDraft,
    bodyDraft,
    status,
    error,
    loading,
    selectNote,
    setTitleDraft,
    setBodyDraft,
    createNote,
    deleteSelected,
  } = useNotes({ autoSelect: false });

  const [surface, setSurface] = useState<Surface>({ kind: "daily" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const dailyOpening = useRef(false);
  const notesRef = useRef(notes);
  const selectedIdRef = useRef(selectedId);
  notesRef.current = notes;
  selectedIdRef.current = selectedId;

  const recentNotes = notes.filter((note) => note.note_type !== "daily");

  const ensureDaily = async () => {
    if (dailyOpening.current) {
      return;
    }
    const title = formatDailyTitle();
    const existing = notesRef.current.find(
      (note) => note.note_type === "daily" && note.title === title,
    );
    if (existing) {
      if (selectedIdRef.current !== existing.id) {
        selectNote(existing.id);
      }
      return;
    }
    dailyOpening.current = true;
    try {
      await createNote(title, { note_type: "daily" });
    } finally {
      dailyOpening.current = false;
    }
  };

  useEffect(() => {
    if (loading || surface.kind !== "daily") {
      return;
    }
    void ensureDaily();
    // Bootstrap / re-sync when returning to Daily Note after notes load.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- select/create are unstable identities
  }, [loading, surface.kind, notes.length]);

  const goNav = (id: NavId) => {
    if (id === "daily") {
      setSurface({ kind: "daily" });
      void ensureDaily();
      return;
    }
    setSurface({ kind: id });
    selectNote(null);
  };

  const openRecent = (note: Note) => {
    setSurface({ kind: "note", id: note.id });
    selectNote(note.id);
  };

  const activeNav: NavId | null =
    surface.kind === "note"
      ? null
      : surface.kind === "daily"
        ? "daily"
        : surface.kind;

  const showEditor =
    (surface.kind === "daily" || surface.kind === "note") &&
    Boolean(selectedId);

  return (
    <div
      className={
        sidebarCollapsed ? "app-shell is-sidebar-collapsed" : "app-shell"
      }
      aria-label="Supernotes"
    >
      <aside className="sidebar" aria-label="Sidebar">
        <div className="sidebar-top">
          <button
            type="button"
            className="sidebar-collapse"
            aria-expanded={!sidebarCollapsed}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            onClick={() => {
              setSidebarCollapsed((value) => !value);
            }}
          >
            <span className="sidebar-collapse-bars" aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={active ? "nav-item is-active" : "nav-item"}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  goNav(item.id);
                }}
              >
                <span className="nav-item-icon">{item.icon(active)}</span>
                <span className="nav-item-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-recent">
          <button
            type="button"
            className="recent-toggle"
            aria-expanded={recentOpen}
            onClick={() => {
              setRecentOpen((value) => !value);
            }}
          >
            <span>Recent</span>
            <IconChevron expanded={recentOpen} />
          </button>

          {recentOpen ? (
            <ul className="recent-list">
              {loading ? (
                <li className="recent-empty">Loading…</li>
              ) : recentNotes.length === 0 ? (
                <li className="recent-empty">No recent notes</li>
              ) : (
                recentNotes.map((note) => {
                  const title =
                    note.id === selectedId ? titleDraft : note.title;
                  const body =
                    note.id === selectedId ? bodyDraft : note.body_markdown;
                  const selected =
                    surface.kind === "note" && note.id === selectedId;
                  return (
                    <li key={note.id}>
                      <button
                        type="button"
                        className={
                          selected ? "recent-item is-selected" : "recent-item"
                        }
                        onClick={() => {
                          openRecent(note);
                        }}
                      >
                        <span className="recent-title-row">
                          {note.note_type === "meeting" ? (
                            <IconWaveform />
                          ) : null}
                          <span className="recent-title">
                            {title || "Untitled"}
                          </span>
                        </span>
                        <span className="recent-meta">
                          <span className="recent-when">
                            {formatRelativeUpdated(note.updated_at)}
                          </span>
                          <span className="recent-snippet">
                            {noteSnippet(body)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </div>

        <div className="sidebar-footer">
          <button type="button" className="search-hint" aria-label="Search">
            <IconSearch />
            <span className="search-hint-label">Search</span>
            <kbd className="search-chip">⌘K</kbd>
          </button>
        </div>
      </aside>

      <main className="main-pane">
        {surface.kind === "notes" ? (
          <section className="placeholder-pane" aria-label="Notes overview">
            <div className="placeholder-header">
              <h1 className="pane-title">Notes</h1>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void createNote().then((created) => {
                    if (created) {
                      setSurface({ kind: "note", id: created.id });
                    }
                  });
                }}
              >
                + New note
              </button>
            </div>
            <p className="muted">{String(recentNotes.length)} notes</p>
            <p className="muted">
              Browse view groups arrive next; open a note from Recent for now.
            </p>
          </section>
        ) : null}

        {surface.kind === "tasks" ? (
          <section className="placeholder-pane" aria-label="Tasks">
            <h1 className="pane-title">Tasks</h1>
            <p className="muted">Tasks arrive in a later milestone.</p>
          </section>
        ) : null}

        {surface.kind === "calendar" ? (
          <section className="placeholder-pane" aria-label="Calendar">
            <h1 className="pane-title">Calendar</h1>
            <p className="muted">Calendar arrives in a later milestone.</p>
          </section>
        ) : null}

        {showEditor ? (
          <section className="editor-pane" aria-label="Note editor">
            <div className="editor-toolbar">
              <span className="save-status" aria-live="polite">
                {saveLabel(status)}
              </span>
              {surface.kind === "note" ? (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    void deleteSelected().then(() => {
                      setSurface({ kind: "notes" });
                    });
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>
            <input
              className="title-input"
              aria-label="Note title"
              value={titleDraft}
              onChange={(event) => {
                setTitleDraft(event.target.value);
              }}
            />
            <textarea
              className="body-input"
              aria-label="Note body"
              value={bodyDraft}
              onChange={(event) => {
                setBodyDraft(event.target.value);
              }}
            />
          </section>
        ) : null}

        {surface.kind === "daily" && !selectedId && loading ? (
          <p className="muted pane-loading">Loading…</p>
        ) : null}

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}

export default App;
