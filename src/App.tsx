import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { SearchPalette } from "./SearchPalette";
import { notesApi } from "./notes/api";
import {
  formatDailyTitle,
  formatOverviewWhen,
  formatRelativeUpdated,
  groupNotesForOverview,
  noteSnippet,
  parseSnippetParts,
} from "./notes/format";
import {
  isSearchKpiMode,
  runSearchKpi,
  SEARCH_KPI_MAX_MS,
  SEARCH_KPI_NOTE_COUNT,
  type SearchKpiResult,
} from "./notes/searchKpi";
import type { Note } from "./notes/types";
import { useNotes } from "./notes/useNotes";
import "./App.css";

type NavId = "daily" | "notes" | "tasks" | "calendar";

type Surface = { kind: NavId } | { kind: "note"; id: string };

type PinMenu = { noteId: string; pinned: boolean; x: number; y: number };

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
        d="M1.25 5v2M3.1 3.25v5.5M4.95 1.75v8.5M6.8 4v4M8.65 2.75v6.5M10.5 4.75v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
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

function IconPin() {
  // Diagonal pushpin, stroke-only, 16×16 — matches sidebar icon weight.
  // Body is a concave-sided kite (4-pointed star shape) pointing upper-right.
  // A collar line bisects it; needle extends lower-left.
  // Derived from Phosphor push-pin geometry, simplified to straight/arc strokes.
  return (
    <svg className="pin-icon" viewBox="0 0 16 16" aria-hidden="true">
      {/* kite body: top → right → bottom-notch → left-notch, concave sides via arcs */}
      <path
        d="M9.5 1.5
           C10.2 0.8 11.8 0.8 12.5 1.5
           L14.5 3.5
           C15.2 4.2 15.2 5.8 14.5 6.5
           L11.5 9.5
           C11.5 9.5 12 11 11.5 11.5
           C11 12 9.5 11.5 9.5 11.5
           L6.5 14.5
           C5.8 15.2 4.2 15.2 3.5 14.5
           L1.5 12.5
           C0.8 11.8 0.8 10.2 1.5 9.5
           L4.5 6.5
           C4.5 6.5 4 5 4.5 4.5
           C5 4 6.5 4.5 6.5 4.5
           Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* collar — diagonal line across the waist of the pin body */}
      <path
        d="M6.5 4.5 L11.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SnippetWithChips({ body }: { body: string }) {
  return (
    <span className="overview-snippet">
      {parseSnippetParts(body).map((part, index) => {
        if (part.type === "tag") {
          return (
            <span key={`t-${String(index)}`} className="note-chip is-tag">
              {part.value}
            </span>
          );
        }
        if (part.type === "mention") {
          return (
            <span key={`m-${String(index)}`} className="note-chip is-mention">
              {part.value}
            </span>
          );
        }
        return <span key={`x-${String(index)}`}>{part.value}</span>;
      })}
    </span>
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
    setPinned,
  } = useNotes({ autoSelect: false });

  const [surface, setSurface] = useState<Surface>({ kind: "daily" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinMenu, setPinMenu] = useState<PinMenu | null>(null);
  const [kpiMode] = useState(() => isSearchKpiMode());
  const [kpiResult, setKpiResult] = useState<SearchKpiResult | null>(null);
  const [lastSearchMs, setLastSearchMs] = useState<number | null>(null);
  const dailyOpening = useRef(false);
  const notesRef = useRef(notes);
  const selectedIdRef = useRef(selectedId);
  notesRef.current = notes;
  selectedIdRef.current = selectedId;

  useEffect(() => {
    if (!pinMenu) {
      return;
    }
    const close = () => {
      setPinMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [pinMenu]);

  useEffect(() => {
    if (!kpiMode || loading) {
      return;
    }
    let cancelled = false;
    void runSearchKpi(notesApi).then((result) => {
      if (!cancelled) {
        setKpiResult(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [kpiMode, loading]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "o") {
        return;
      }
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Recent is a glance list, not the full corpus (search owns findability).
  const nonDailyNotes = notes.filter((note) => note.note_type !== "daily");
  const recentNotes = nonDailyNotes.slice(0, 12);
  const overviewGroups = groupNotesForOverview(notes);

  const openOverviewNote = (note: Note) => {
    setSurface({ kind: "note", id: note.id });
    selectNote(note.id);
    setPinMenu(null);
  };

  const openPinMenu = (event: MouseEvent, note: Note) => {
    event.preventDefault();
    event.stopPropagation();
    setPinMenu({
      noteId: note.id,
      pinned: note.pinned,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const timedSearchNotes = useCallback(
    async (query: string) => {
      const started = performance.now();
      const hits = await notesApi.searchNotes(query);
      if (kpiMode) {
        setLastSearchMs(performance.now() - started);
      }
      return hits;
    },
    [kpiMode],
  );

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

  const openFromSearch = (note: Note) => {
    if (note.note_type === "daily") {
      setSurface({ kind: "daily" });
    } else {
      setSurface({ kind: "note", id: note.id });
    }
    selectNote(note.id);
  };

  const createFromSearch = (title: string) => {
    void createNote(title).then((created) => {
      if (created) {
        setSurface({ kind: "note", id: created.id });
      }
    });
  };

  const activeNav: NavId | null =
    surface.kind === "note"
      ? "notes"
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
          <button
            type="button"
            className="search-hint"
            aria-label="Search"
            onClick={() => {
              setSearchOpen(true);
            }}
          >
            <IconSearch />
            <span className="search-hint-label">Search</span>
            <kbd className="search-chip">⌘K</kbd>
          </button>
        </div>
      </aside>

      <main className="main-pane">
        {surface.kind === "notes" ? (
          <section className="overview-pane" aria-label="Notes overview">
            <div className="overview-header">
              <div className="overview-title-row">
                <h1 className="pane-title">Notes</h1>
                <span className="overview-count">
                  {String(nonDailyNotes.length)}
                </span>
              </div>
              <button
                type="button"
                className="new-note-button"
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

            {loading ? (
              <p className="muted">Loading…</p>
            ) : overviewGroups.length === 0 ? (
              <p className="muted">No notes yet.</p>
            ) : (
              <div className="overview-groups">
                {overviewGroups.map((group) => (
                  <section
                    key={group.id}
                    className="overview-group"
                    aria-label={group.label}
                  >
                    <h2 className="overview-group-label">
                      {group.id === "pinned" ? <IconPin /> : null}
                      <span>{group.label}</span>
                    </h2>
                    <ul className="overview-list">
                      {group.notes.map((note) => {
                        const title =
                          note.id === selectedId ? titleDraft : note.title;
                        const body =
                          note.id === selectedId
                            ? bodyDraft
                            : note.body_markdown;
                        return (
                          <li key={note.id}>
                            <button
                              type="button"
                              className="overview-item"
                              onClick={() => {
                                openOverviewNote(note);
                              }}
                              onContextMenu={(event) => {
                                openPinMenu(event, note);
                              }}
                            >
                              <span className="overview-item-top">
                                <span className="overview-item-title-row">
                                  {note.note_type === "meeting" ? (
                                    <IconWaveform />
                                  ) : null}
                                  <span className="overview-item-title">
                                    {title || "Untitled"}
                                  </span>
                                </span>
                                <span className="overview-when">
                                  {formatOverviewWhen(
                                    note.updated_at,
                                    group.id,
                                  )}
                                </span>
                              </span>
                              <SnippetWithChips body={body} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
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
              {surface.kind === "note" ? (
                <button
                  type="button"
                  className="breadcrumb"
                  aria-label="Back to Notes"
                  onClick={() => {
                    setSurface({ kind: "notes" });
                    selectNote(null);
                  }}
                >
                  Notes <span aria-hidden="true">›</span>
                </button>
              ) : (
                <span />
              )}
              <div className="editor-toolbar-actions">
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

        {kpiMode ? (
          <aside className="kpi-banner" aria-label="Search KPI">
            <strong>Search KPI</strong>
            <span>
              corpus {String(notes.length)} / target{" "}
              {String(SEARCH_KPI_NOTE_COUNT)}
            </span>
            {kpiResult ? (
              <span
                data-testid="search-kpi-result"
                data-passed={kpiResult.passed ? "true" : "false"}
                data-ms={kpiResult.elapsedMs.toFixed(2)}
              >
                baseline {kpiResult.elapsedMs.toFixed(2)}ms
                {kpiResult.passed ? " · pass" : " · FAIL"}
                {" · budget "}
                {String(SEARCH_KPI_MAX_MS)}ms
              </span>
            ) : (
              <span>running…</span>
            )}
            {lastSearchMs !== null ? (
              <span data-testid="search-kpi-live">
                last palette search {lastSearchMs.toFixed(2)}ms
              </span>
            ) : null}
          </aside>
        ) : null}
      </main>

      <SearchPalette
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
        }}
        searchNotes={timedSearchNotes}
        onOpenNote={openFromSearch}
        onCreateNote={createFromSearch}
      />

      {pinMenu ? (
        <div
          className="context-menu"
          role="menu"
          style={{ left: pinMenu.x, top: pinMenu.y }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              void setPinned(pinMenu.noteId, !pinMenu.pinned);
              setPinMenu(null);
            }}
          >
            {pinMenu.pinned ? "Unpin" : "Pin"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
