import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { SearchPalette } from "./SearchPalette";
import { notesApi } from "./notes/api";
import {
  dailyDisplayTitle,
  formatDailyTitle,
  formatOverviewWhen,
  formatRelativeUpdated,
  groupNotesForOverview,
  noteSnippet,
  parseDailyTitle,
  parseSnippetParts,
  shiftDailyTitle,
  startOfLocalDay,
} from "./notes/format";
import { NoteEditor } from "./editor/NoteEditor";
import { Backlinks } from "./notes/Backlinks";
import {
  isSearchKpiMode,
  runSearchKpi,
  SEARCH_KPI_MAX_MS,
  SEARCH_KPI_NOTE_COUNT,
  type SearchKpiResult,
} from "./notes/searchKpi";
import type { Note } from "./notes/types";
import { useNotes } from "./notes/useNotes";
import { findNoteByTitle } from "./notes/wikilinks";
import "./App.css";

type NavId = "daily" | "notes" | "tasks" | "calendar";

type Surface = { kind: NavId } | { kind: "note"; id: string };

type PinMenu = { noteId: string; pinned: boolean; x: number; y: number };

// Rough menu footprint used to keep it inside the viewport.
const PIN_MENU_SAFE_WIDTH = 160;
const PIN_MENU_SAFE_HEIGHT = 48;

const NARROW_MQ = "(max-width: 720px)";

function prefersNarrow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW_MQ).matches
  );
}

/** Overlay titlebar + traffic lights are macOS-only (`titleBarStyle: Overlay`). */
function prefersMacOverlayChrome(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent)
  );
}

function saveIndicator(
  status: ReturnType<typeof useNotes>["status"],
): ReactNode {
  if (status === "error") {
    return (
      <span className="save-status" aria-live="polite">
        Save failed
      </span>
    );
  }
  // Quiet dirty-only cue — no "Saved"/"Unsaved" text (ENG-114).
  if (status === "dirty") {
    return <span className="save-dot" aria-label="Unsaved changes" />;
  }
  return null;
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
  // Lucide "pin" icon (top-down thumbtack).
  return (
    <svg
      className="pin-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
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
  } = useNotes({ autoSelect: false });

  const [surface, setSurface] = useState<Surface>({ kind: "daily" });
  /** Which calendar day the Daily surface is showing (`YYYY-MM-DD`). */
  const [dailyDate, setDailyDate] = useState(() => formatDailyTitle());
  const [isNarrow, setIsNarrow] = useState(prefersNarrow);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(prefersNarrow);
  const macOverlayChrome = prefersMacOverlayChrome();
  const [recentOpen, setRecentOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pinMenu, setPinMenu] = useState<PinMenu | null>(null);
  const [kpiMode] = useState(() => isSearchKpiMode());
  const [kpiResult, setKpiResult] = useState<SearchKpiResult | null>(null);
  const [lastSearchMs, setLastSearchMs] = useState<number | null>(null);
  const dailyOpening = useRef(false);
  const notesRef = useRef(notes);
  const selectedIdRef = useRef(selectedId);
  /** Case-insensitive titles with an in-flight createNote (ENG-97). */
  const creatingWikiTitlesRef = useRef(new Set<string>());
  notesRef.current = notes;
  selectedIdRef.current = selectedId;

  const pinMenuRef = useRef<HTMLDivElement | null>(null);
  const pinMenuItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(NARROW_MQ);
    const onChange = () => {
      setIsNarrow(mq.matches);
      // Narrow windows use the icon rail; force collapse when crossing in.
      if (mq.matches) {
        setSidebarCollapsed(true);
      }
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (!pinMenu) {
      return;
    }
    // Keyboard users need to operate the menu, so only Escape closes it,
    // not any key (ENG-83).
    pinMenuItemRef.current?.focus();
    const close = () => {
      setPinMenu(null);
    };
    // WebKit/Tauri can deliver a leftover mouse event from the opening
    // right-click after the menu mounts; ignore dismiss briefly.
    const openedAt = performance.now();
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (event.ctrlKey || event.button !== 0) {
        return;
      }
      if (performance.now() - openedAt < 100) {
        return;
      }
      const menu = pinMenuRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
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

      if (
        event.shiftKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        setDailyDate((prev) => shiftDailyTitle(prev, delta));
        setSurface({ kind: "daily" });
        return;
      }

      if (!event.shiftKey) {
        if (event.key === "1") {
          event.preventDefault();
          setDailyDate(formatDailyTitle());
          setSurface({ kind: "daily" });
          return;
        }
        if (event.key === "2") {
          event.preventDefault();
          setSurface({ kind: "notes" });
          selectNote(null);
          return;
        }
        if (event.key === "3") {
          event.preventDefault();
          setSurface({ kind: "tasks" });
          selectNote(null);
          return;
        }
        if (event.key === "4") {
          event.preventDefault();
          setSurface({ kind: "calendar" });
          selectNote(null);
          return;
        }
      }

      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "o") {
        return;
      }
      // ENG-54: Mod-k on a text selection inside the editor sets a link.
      if (key === "k") {
        const target = event.target;
        const inEditor =
          target instanceof Element &&
          Boolean(target.closest(".note-editor, .ProseMirror"));
        const selection = window.getSelection();
        if (inEditor && selection && !selection.isCollapsed) {
          return;
        }
      }
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectNote identity churns
  }, []);

  // Recent is a glance list, not the full corpus (search owns findability).
  const nonDailyNotes = notes.filter((note) => note.note_type !== "daily");
  const recentNotes = nonDailyNotes.slice(0, 12);

  // Local-day stamp so the Today/Yesterday buckets roll over at midnight
  // without a reload (ENG-84).
  const [dayStamp, setDayStamp] = useState(() => startOfLocalDay(Date.now()));
  useEffect(() => {
    const handle = window.setInterval(() => {
      setDayStamp((prev) => {
        const next = startOfLocalDay(Date.now());
        return next === prev ? prev : next;
      });
    }, 60_000);
    return () => {
      window.clearInterval(handle);
    };
  }, []);
  const overviewGroups = useMemo(
    () =>
      surface.kind === "notes" ? groupNotesForOverview(notes, dayStamp) : [],
    [surface.kind, notes, dayStamp],
  );
  const todayTitle = formatDailyTitle(new Date(dayStamp));
  const viewingToday = dailyDate === todayTitle;

  const openOverviewNote = (note: Note) => {
    setSurface({ kind: "note", id: note.id });
    selectNote(note.id);
    setPinMenu(null);
  };

  const openPinMenu = (event: MouseEvent, note: Note) => {
    event.preventDefault();
    event.stopPropagation();
    // Keyboard/OS-invoked contextmenu carries (0,0); anchor to the row.
    let x = event.clientX;
    let y = event.clientY;
    if (x === 0 && y === 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      x = rect.left + 12;
      y = rect.bottom - 4;
    }
    setPinMenu({
      noteId: note.id,
      pinned: note.pinned,
      x: Math.max(8, Math.min(x, window.innerWidth - PIN_MENU_SAFE_WIDTH)),
      y: Math.max(8, Math.min(y, window.innerHeight - PIN_MENU_SAFE_HEIGHT)),
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
    dailyOpening.current = true;
    try {
      const date = parseDailyTitle(dailyDate) ?? new Date();
      await openDaily(date);
    } finally {
      dailyOpening.current = false;
    }
  };

  useEffect(() => {
    if (loading || surface.kind !== "daily") {
      return;
    }
    void ensureDaily();
    // Bootstrap / re-sync when returning to Daily Note or changing day.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openDaily identity is unstable
  }, [loading, surface.kind, dailyDate, notes.length]);

  const goNav = (id: NavId) => {
    if (id === "daily") {
      setDailyDate(formatDailyTitle(new Date(dayStamp)));
      setSurface({ kind: "daily" });
      return;
    }
    setSurface({ kind: id });
    selectNote(null);
  };

  const goDailyDelta = (delta: number) => {
    setDailyDate((prev) => shiftDailyTitle(prev, delta));
    setSurface({ kind: "daily" });
  };

  const openRecent = (note: Note) => {
    setSurface({ kind: "note", id: note.id });
    selectNote(note.id);
  };

  const openFromSearch = (note: Note) => {
    if (note.note_type === "daily" && parseDailyTitle(note.title)) {
      setDailyDate(note.title);
      setSurface({ kind: "daily" });
    } else {
      setSurface({ kind: "note", id: note.id });
    }
    selectNote(note.id);
  };

  const createFromSearch = (title: string) => {
    // Leave daily before notes.length bumps so ensureDaily can't steal selection.
    setSurface({ kind: "note", id: "" });
    void createNote(title).then((created) => {
      if (created) {
        openFromSearch(created);
      }
    });
  };

  const openWikiLink = (link: { title: string; noteId: string | null }) => {
    const byId = link.noteId
      ? notesRef.current.find((note) => note.id === link.noteId)
      : null;
    const existing = byId ?? findNoteByTitle(notesRef.current, link.title);
    if (existing) {
      openFromSearch(existing);
      return;
    }
    const key = link.title.trim().toLowerCase();
    if (!key || creatingWikiTitlesRef.current.has(key)) {
      return;
    }
    creatingWikiTitlesRef.current.add(key);
    // Create-on-click: title = link text, empty body (ENG-56).
    // Leave the daily surface first — otherwise ensureDaily re-selects today
    // when createNote bumps notes.length (one-frame race).
    setSurface({ kind: "note", id: "" });
    void createNote(link.title)
      .then((created) => {
        if (created) {
          openFromSearch(created);
        }
      })
      .finally(() => {
        creatingWikiTitlesRef.current.delete(key);
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

  const shellClass = [
    "app-shell",
    sidebarCollapsed ? "is-sidebar-collapsed" : "",
    macOverlayChrome ? "has-mac-overlay-chrome" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass} aria-label="Supernotes">
      {isNarrow && !sidebarCollapsed ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close sidebar"
          onClick={() => {
            setSidebarCollapsed(true);
          }}
        />
      ) : null}
      <aside className="sidebar" aria-label="Sidebar">
        <div className="sidebar-top">
          {macOverlayChrome ? (
            <div
              className="titlebar-drag titlebar-drag-sidebar"
              data-tauri-drag-region
              aria-hidden="true"
            />
          ) : null}
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
        {macOverlayChrome ? (
          <div
            className="titlebar-drag titlebar-drag-main"
            data-tauri-drag-region
            aria-hidden="true"
          />
        ) : null}
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
                              onClick={(event) => {
                                // macOS Ctrl+click is a context-menu gesture,
                                // not navigation (Firefox sends both).
                                if (event.ctrlKey) {
                                  return;
                                }
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
              ) : surface.kind === "daily" ? (
                <div
                  className="daily-nav"
                  role="group"
                  aria-label="Daily navigation"
                >
                  <button
                    type="button"
                    className="daily-nav-btn"
                    aria-label="Previous day"
                    onClick={() => {
                      goDailyDelta(-1);
                    }}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="daily-nav-btn"
                    aria-label="Next day"
                    onClick={() => {
                      goDailyDelta(1);
                    }}
                  >
                    ›
                  </button>
                  {!viewingToday ? (
                    <button
                      type="button"
                      className="text-button daily-today"
                      onClick={() => {
                        setDailyDate(todayTitle);
                      }}
                    >
                      Today
                    </button>
                  ) : null}
                </div>
              ) : (
                <span />
              )}
              <div className="editor-toolbar-actions">
                {saveIndicator(status)}
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
              value={
                selectedNote?.note_type === "daily"
                  ? dailyDisplayTitle(titleDraft)
                  : titleDraft
              }
              readOnly={selectedNote?.note_type === "daily"}
              onChange={(event) => {
                if (selectedNote?.note_type === "daily") {
                  return;
                }
                setTitleDraft(event.target.value);
              }}
            />
            {selectedId ? (
              <NoteEditor
                key={selectedId}
                markdown={bodyDraft}
                onChange={setBodyDraft}
                notes={notes}
                currentNoteId={selectedId}
                onOpenWikiLink={openWikiLink}
              />
            ) : null}
            {selectedId ? (
              <Backlinks
                noteId={selectedId}
                noteTitle={titleDraft}
                notes={notes}
                onOpen={openFromSearch}
              />
            ) : null}
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
          ref={pinMenuRef}
          className="context-menu"
          role="menu"
          style={{ left: pinMenu.x, top: pinMenu.y }}
        >
          <button
            ref={pinMenuItemRef}
            type="button"
            role="menuitem"
            className="context-menu-item"
            onMouseDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              // Act on mousedown so WebKit blur/click-outside can't unmount
              // the item before a click handler runs (Tauri webview).
              event.preventDefault();
              event.stopPropagation();
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
