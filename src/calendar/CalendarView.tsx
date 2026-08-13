import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Note } from "../notes/types";
import { formatShortDue } from "../tasks/due";
import { subscribeTasksChanged } from "../tasks/events";
import { priorityDotClass } from "../tasks/priority";
import { isTaskOverdue, tasksDueOnOrBefore } from "../tasks/query";
import { TaskStateIcon } from "../tasks/TaskStateIcon";
import { tasksApi } from "../tasks/api";
import type { Task, TaskState } from "../tasks/types";
import { calendarApi, subscribeCalendarChanged } from "./api";
import {
  agendaHeading,
  DEFAULT_DURATION_MIN,
  dayNumber,
  formatClock,
  formatDuration,
  formatTimeInput,
  GRID_HOURS,
  HOUR_HEIGHT,
  eventSegmentOnDay,
  layoutDayEvents,
  minutesToIso,
  nowMinutes,
  parseTimeInput,
  pointerToMinutes,
  shiftYmd,
  startOfWeekMonday,
  weekDays,
  weekHeading,
  weekRangeIso,
  weekdayShort,
} from "./layout";
import type { CalendarEvent } from "./types";

export type CalendarViewProps = {
  today: string;
  notes: Note[];
  onOpenDaily: (ymd: string) => void;
  onOpenTask: (task: Task, note: Note) => void;
};

type DragState = {
  day: string;
  originMin: number;
  currentMin: number;
};

type EditState = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  day: string;
  surface: "grid" | "agenda";
};

function dueTasksForDay(tasks: Task[], day: string, today: string): Task[] {
  if (day === today) {
    return tasksDueOnOrBefore(tasks, today);
  }
  return tasks.filter((task) => {
    if (task.state === "done" || task.state === "cancelled") {
      return false;
    }
    return task.due_date === day;
  });
}

function priorityName(dot: string): string {
  if (dot === "is-p1") {
    return "Priority P1";
  }
  if (dot === "is-p2") {
    return "Priority P2";
  }
  return "Priority P3";
}

function IconDoc() {
  return (
    <svg className="cal-daily-icon" viewBox="0 0 16 16" aria-hidden="true">
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

function timesToIso(
  ymd: string,
  startMin: number,
  endMin: number,
): { start: string; end: string } {
  if (endMin <= startMin) {
    return {
      start: minutesToIso(ymd, startMin),
      end: minutesToIso(shiftYmd(ymd, 1), endMin),
    };
  }
  return {
    start: minutesToIso(ymd, startMin),
    end: minutesToIso(ymd, endMin),
  };
}

function TaskChip({
  task,
  today,
  onToggle,
  onOpen,
}: {
  task: Task;
  today: string;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const overdue = isTaskOverdue(task, today);
  const dot = priorityDotClass(task.priority);
  const showDue = overdue && task.due_date;
  return (
    <div className="cal-chip">
      <button
        type="button"
        className="cal-chip-toggle"
        aria-label={task.state === "done" ? "Mark task open" : "Mark task done"}
        onClick={onToggle}
      >
        <TaskStateIcon state={task.state} />
      </button>
      <button type="button" className="cal-chip-main" onClick={onOpen}>
        <span className="cal-chip-title">
          {task.title.trim() || "Untitled task"}
        </span>
        {showDue && task.due_date ? (
          <span className="cal-chip-due">{formatShortDue(task.due_date)}</span>
        ) : null}
        {dot ? (
          <span
            className={`task-priority-dot ${dot}`}
            title={priorityName(dot)}
            aria-label={priorityName(dot)}
          />
        ) : null}
      </button>
    </div>
  );
}

export function CalendarView({
  today,
  notes,
  onOpenDaily,
  onOpenTask,
}: CalendarViewProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const creatingRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const editRef = useRef<EditState | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  editRef.current = edit;

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const heading = useMemo(() => weekHeading(weekStart), [weekStart]);
  const range = useMemo(() => weekRangeIso(weekStart), [weekStart]);
  const noteById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );

  useEffect(() => {
    const monday = startOfWeekMonday(today);
    setWeekStart(monday);
    setSelectedDay(today);
  }, [today]);

  useEffect(() => {
    if (days.includes(selectedDay)) {
      return;
    }
    setSelectedDay(days.includes(today) ? today : weekStart);
  }, [days, selectedDay, today, weekStart]);

  const loadEvents = useCallback(async () => {
    try {
      const listed = await calendarApi.listEvents(range.from, range.to);
      setEvents(listed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    }
  }, [range.from, range.to]);

  const loadTasks = useCallback(async () => {
    try {
      const listed = await tasksApi.listTasks("upcoming", today);
      setTasks(listed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    }
  }, [today]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(
    () => subscribeCalendarChanged(() => void loadEvents()),
    [loadEvents],
  );
  useEffect(() => subscribeTasksChanged(() => void loadTasks()), [loadTasks]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = 8 * HOUR_HEIGHT - 12;
  }, [weekStart]);

  const goWeek = (delta: number) => {
    const next = shiftYmd(weekStart, delta * 7);
    setWeekStart(next);
    const nextDays = weekDays(next);
    setSelectedDay(nextDays.includes(today) ? today : next);
    setEdit(null);
  };

  const goDay = (delta: number) => {
    const next = shiftYmd(selectedDay, delta);
    setSelectedDay(next);
    setWeekStart(startOfWeekMonday(next));
    setEdit(null);
  };

  const goToday = () => {
    setWeekStart(startOfWeekMonday(today));
    setSelectedDay(today);
    setEdit(null);
  };

  const persistEdit = async (next: EditState) => {
    const current = events.find((item) => item.id === next.id);
    if (!current) {
      return;
    }
    const times = timesToIso(next.day, next.startMin, next.endMin);
    try {
      const updated = await calendarApi.updateEvent({
        id: next.id,
        title: next.title,
        start: times.start,
        end: times.end,
        task_id: current.task_id,
      });
      setEvents((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save event");
      void loadEvents();
    }
  };

  const commitEdit = async () => {
    const snapshot = editRef.current;
    if (!snapshot) {
      return;
    }
    setEdit(null);
    await persistEdit(snapshot);
  };

  const deleteEvent = async (id: string) => {
    const previous = events;
    setEvents((prev) => prev.filter((item) => item.id !== id));
    setEdit(null);
    try {
      await calendarApi.deleteEvent(id);
      setError(null);
    } catch (err) {
      setEvents(previous);
      setError(err instanceof Error ? err.message : "Failed to delete event");
    }
  };

  const createAt = async (
    day: string,
    startMin: number,
    endMin: number,
    surface: EditState["surface"],
  ) => {
    if (creatingRef.current) {
      return;
    }
    creatingRef.current = true;
    const span = Math.max(endMin - startMin, DEFAULT_DURATION_MIN);
    const times = timesToIso(day, startMin, startMin + span);
    try {
      const created = await calendarApi.createEvent({
        title: "",
        start: times.start,
        end: times.end,
      });
      setEvents((prev) =>
        [...prev, created].sort((a, b) => a.start.localeCompare(b.start)),
      );
      setSelectedDay(day);
      setEdit({
        id: created.id,
        title: "",
        startMin,
        endMin: startMin + span,
        day,
        surface,
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      creatingRef.current = false;
    }
  };

  const onGridMouseDown = (day: string, event: ReactMouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    event.preventDefault();
    const rect = grid.getBoundingClientRect();
    const mins = pointerToMinutes(event.clientY, rect.top, rect.height);
    const next = { day, originMin: mins, currentMin: mins };
    dragRef.current = next;
    setDrag(next);
    setSelectedDay(day);
    setEdit(null);

    const onMove = (move: MouseEvent) => {
      const current = pointerToMinutes(move.clientY, rect.top, rect.height);
      const live = dragRef.current;
      if (!live) {
        return;
      }
      const updated = { ...live, currentMin: current };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = (up: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const live = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!live) {
        return;
      }
      const current = pointerToMinutes(up.clientY, rect.top, rect.height);
      const start = Math.min(live.originMin, current);
      const end = Math.max(live.originMin, current);
      void createAt(live.day, start, end === start ? start : end, "grid");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const beginEdit = (
    item: CalendarEvent,
    day: string,
    surface: EditState["surface"],
  ) => {
    const clip = eventSegmentOnDay(item, day);
    const startMin = clip?.startMin ?? 9 * 60;
    const endMin = clip
      ? Math.max(clip.endMin, startMin + DEFAULT_DURATION_MIN)
      : startMin + DEFAULT_DURATION_MIN;
    setSelectedDay(day);
    setEdit({
      id: item.id,
      title: item.title,
      startMin,
      endMin,
      day,
      surface,
    });
  };

  const toggleTask = (task: Task) => {
    const next: TaskState = task.state === "done" ? "open" : "done";
    void tasksApi
      .updateTask({
        id: task.id,
        title: task.title,
        state: next,
        due_date: task.due_date,
        priority: task.priority,
      })
      .then((updated) => {
        setTasks((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item)),
        );
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to update task");
        void loadTasks();
      });
  };

  const nowMin = nowMinutes(now);
  const todayInWeek = days.includes(today);
  const viewingTodayWeek = weekStart === startOfWeekMonday(today);
  const gridHeight = GRID_HOURS * HOUR_HEIGHT;
  const selectedEvents = events
    .filter((item) => eventSegmentOnDay(item, selectedDay) !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  const selectedChips = dueTasksForDay(tasks, selectedDay, today);

  const hourMarks = Array.from({ length: GRID_HOURS }, (_, hour) => hour);

  return (
    <section className="calendar-pane" aria-label="Calendar">
      <div className="cal-header">
        <div className="cal-title-block">
          <h1 className="pane-title">{heading.monthYear}</h1>
          <span className="cal-range">{heading.range}</span>
        </div>
        <div className="cal-header-actions">
          <div className="daily-nav" role="group" aria-label="Week navigation">
            <button
              type="button"
              className="daily-nav-btn"
              aria-label="Previous week"
              onClick={() => {
                goWeek(-1);
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className="daily-nav-btn"
              aria-label="Next week"
              onClick={() => {
                goWeek(1);
              }}
            >
              ›
            </button>
            {!viewingTodayWeek || selectedDay !== today ? (
              <button
                type="button"
                className="text-button daily-today"
                onClick={goToday}
              >
                Today
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="cal-daily-btn"
            aria-label="Open today's daily note"
            onClick={() => {
              onOpenDaily(today);
            }}
          >
            <IconDoc />
            Daily note
          </button>
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cal-body">
        <div className="cal-week" aria-label="Week">
          <div className="cal-day-head">
            <span className="cal-gutter" />
            {days.map((day) => {
              const isToday = day === today;
              return (
                <button
                  key={day}
                  type="button"
                  className={
                    day === selectedDay
                      ? "cal-day-label is-selected"
                      : "cal-day-label"
                  }
                  aria-label={`Open daily note for ${agendaHeading(day)}`}
                  onClick={() => {
                    setSelectedDay(day);
                    onOpenDaily(day);
                  }}
                >
                  <span className="cal-day-wk">{weekdayShort(day)}</span>
                  <span
                    className={isToday ? "cal-day-num is-today" : "cal-day-num"}
                  >
                    {String(dayNumber(day))}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="cal-allday">
            <span className="cal-gutter cal-allday-label">ALL-DAY</span>
            {days.map((day) => (
              <div key={day} className="cal-allday-cell">
                {dueTasksForDay(tasks, day, today).map((task) => {
                  const note = noteById.get(task.note_id);
                  return (
                    <TaskChip
                      key={task.id}
                      task={task}
                      today={today}
                      onToggle={() => {
                        toggleTask(task);
                      }}
                      onOpen={() => {
                        if (note) {
                          onOpenTask(task, note);
                        }
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <div className="cal-scroll" ref={scrollRef}>
            <div
              className="cal-grid"
              ref={gridRef}
              style={{ height: gridHeight }}
            >
              <div className="cal-hours">
                {hourMarks.map((hour) => (
                  <div
                    key={hour}
                    className="cal-hour"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    {hour % 2 === 0 && hour > 0 ? (
                      <span className="cal-hour-label">
                        {formatClock(hour * 60)}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
              {days.map((day) => {
                const laid = layoutDayEvents(events, day);
                const dragging = drag && drag.day === day ? drag : null;
                const dragStart = dragging
                  ? Math.min(dragging.originMin, dragging.currentMin)
                  : 0;
                const dragEnd = dragging
                  ? Math.max(
                      dragging.originMin,
                      dragging.currentMin,
                      dragStart + DEFAULT_DURATION_MIN,
                    )
                  : 0;
                return (
                  <div
                    key={day}
                    className={
                      day === selectedDay
                        ? "cal-day-col is-selected"
                        : "cal-day-col"
                    }
                    data-day={day}
                    onMouseDown={(event) => {
                      onGridMouseDown(day, event);
                    }}
                  >
                    {laid.map((segment) => {
                      const top = (segment.startMin / 60) * HOUR_HEIGHT;
                      const height = Math.max(
                        ((segment.endMin - segment.startMin) / 60) *
                          HOUR_HEIGHT,
                        16,
                      );
                      const width = `calc((100% - 4px) / ${String(segment.cols)})`;
                      const left = `calc(${String(segment.col)} * (100% - 4px) / ${String(segment.cols)} + 2px)`;
                      const editing =
                        edit !== null &&
                        edit.id === segment.event.id &&
                        edit.surface === "grid"
                          ? edit
                          : null;
                      const startLabel = formatClock(segment.startMin);
                      const endLabel = formatClock(segment.endMin);
                      return (
                        <div
                          key={segment.event.id}
                          className={
                            editing ? "cal-event is-editing" : "cal-event"
                          }
                          style={{ top, height, width, left }}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {editing ? (
                            <EventFields
                              edit={editing}
                              onChange={setEdit}
                              onCommit={() => {
                                void commitEdit();
                              }}
                              onDelete={() => {
                                void deleteEvent(editing.id);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="cal-event-hit"
                              onClick={() => {
                                beginEdit(segment.event, day, "grid");
                              }}
                            >
                              <span className="cal-event-title">
                                {segment.event.title.trim() || "Untitled"}
                              </span>
                              <span className="cal-event-when">
                                {startLabel} – {endLabel}
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {dragging ? (
                      <div
                        className="cal-event is-preview"
                        style={{
                          top: (dragStart / 60) * HOUR_HEIGHT,
                          height: ((dragEnd - dragStart) / 60) * HOUR_HEIGHT,
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
              {todayInWeek ? (
                <div
                  className="cal-now"
                  style={{ top: (nowMin / 60) * HOUR_HEIGHT }}
                >
                  <span className="cal-now-dot" />
                  <span className="cal-now-label">{formatClock(nowMin)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="cal-agenda" aria-label="Agenda">
          <div className="cal-agenda-head">
            <div className="cal-agenda-title-row">
              <h2 className="cal-agenda-title">{agendaHeading(selectedDay)}</h2>
              <div
                className="daily-nav"
                role="group"
                aria-label="Day navigation"
              >
                <button
                  type="button"
                  className="daily-nav-btn"
                  aria-label="Previous day"
                  onClick={() => {
                    goDay(-1);
                  }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="daily-nav-btn"
                  aria-label="Next day"
                  onClick={() => {
                    goDay(1);
                  }}
                >
                  ›
                </button>
              </div>
            </div>
            <span className="cal-agenda-kicker">Agenda</span>
          </div>

          {selectedChips.length > 0 ? (
            <div className="cal-agenda-chips">
              {selectedChips.map((task) => {
                const note = noteById.get(task.note_id);
                return (
                  <TaskChip
                    key={task.id}
                    task={task}
                    today={today}
                    onToggle={() => {
                      toggleTask(task);
                    }}
                    onOpen={() => {
                      if (note) {
                        onOpenTask(task, note);
                      }
                    }}
                  />
                );
              })}
            </div>
          ) : null}

          <ol className="cal-agenda-list">
            {selectedEvents.flatMap((item, index) => {
              const startDate = new Date(item.start);
              const startMin =
                startDate.getHours() * 60 + startDate.getMinutes();
              const past = Date.parse(item.end) < now.getTime();
              const showNow =
                selectedDay === today &&
                startMin > nowMin &&
                (index === 0 ||
                  (() => {
                    const prev = selectedEvents[index - 1];
                    if (!prev) {
                      return true;
                    }
                    const prevStart = new Date(prev.start);
                    return (
                      prevStart.getHours() * 60 + prevStart.getMinutes() <=
                      nowMin
                    );
                  })());
              const editing =
                edit !== null &&
                edit.id === item.id &&
                edit.surface === "agenda"
                  ? edit
                  : null;
              const nodes = [];
              if (showNow) {
                nodes.push(
                  <li key="now" className="cal-agenda-now">
                    <span className="cal-now-dot" />
                    <span className="cal-now-label">{formatClock(nowMin)}</span>
                    <span className="cal-agenda-now-line" />
                  </li>,
                );
              }
              nodes.push(
                <li
                  key={item.id}
                  className={past ? "cal-agenda-row is-past" : "cal-agenda-row"}
                >
                  {editing ? (
                    <EventFields
                      edit={editing}
                      onChange={setEdit}
                      onCommit={() => {
                        void commitEdit();
                      }}
                      onDelete={() => {
                        void deleteEvent(editing.id);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="cal-agenda-hit"
                      onClick={() => {
                        beginEdit(item, selectedDay, "agenda");
                      }}
                    >
                      <span className="cal-agenda-time">
                        {formatClock(startMin)}
                      </span>
                      <span className="cal-agenda-event-title">
                        {item.title.trim() || "Untitled"}
                      </span>
                      <span className="cal-agenda-dur">
                        {formatDuration(item.start, item.end)}
                      </span>
                    </button>
                  )}
                </li>,
              );
              return nodes;
            })}
            {selectedDay === today &&
            (selectedEvents.length === 0 ||
              (() => {
                const last = selectedEvents[selectedEvents.length - 1];
                if (!last) {
                  return true;
                }
                const lastStart = new Date(last.start);
                return (
                  lastStart.getHours() * 60 + lastStart.getMinutes() <= nowMin
                );
              })()) ? (
              <li key="now-end" className="cal-agenda-now">
                <span className="cal-now-dot" />
                <span className="cal-now-label">{formatClock(nowMin)}</span>
                <span className="cal-agenda-now-line" />
              </li>
            ) : null}
          </ol>

          <button
            type="button"
            className="cal-agenda-add"
            onClick={() => {
              const start =
                selectedDay === today
                  ? Math.ceil(nowMin / DEFAULT_DURATION_MIN) *
                    DEFAULT_DURATION_MIN
                  : 9 * 60;
              void createAt(
                selectedDay,
                start,
                start + DEFAULT_DURATION_MIN,
                "agenda",
              );
            }}
          >
            Add event
          </button>

          <p className="cal-agenda-foot">
            Day header opens{" "}
            <button
              type="button"
              className="cal-agenda-link"
              onClick={() => {
                onOpenDaily(selectedDay);
              }}
            >
              {agendaHeading(selectedDay)}
            </button>
          </p>
        </aside>
      </div>
    </section>
  );
}

function EventFields({
  edit,
  onChange,
  onCommit,
  onDelete,
}: {
  edit: EditState;
  onChange: (next: EditState) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  return (
    <form
      className="cal-event-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCommit();
      }}
    >
      <input
        className="cal-event-title-input"
        aria-label="Event title"
        value={edit.title}
        autoFocus
        onChange={(event) => {
          onChange({ ...edit, title: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCommit();
          }
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof HTMLElement &&
            event.relatedTarget.closest(".cal-event-form")
          ) {
            return;
          }
          onCommit();
        }}
      />
      <div className="cal-event-times">
        <input
          type="time"
          aria-label="Start time"
          value={formatTimeInput(edit.startMin)}
          onChange={(event) => {
            const mins = parseTimeInput(event.target.value);
            if (mins === null) {
              return;
            }
            onChange({ ...edit, startMin: mins });
          }}
        />
        <span aria-hidden="true">–</span>
        <input
          type="time"
          aria-label="End time"
          value={formatTimeInput(
            edit.endMin >= 24 * 60 ? 23 * 60 + 59 : edit.endMin,
          )}
          onChange={(event) => {
            const mins = parseTimeInput(event.target.value);
            if (mins === null) {
              return;
            }
            onChange({ ...edit, endMin: mins });
          }}
        />
        <button
          type="button"
          className="text-button danger"
          onMouseDown={(event) => {
            event.preventDefault();
            onDelete();
          }}
        >
          Delete
        </button>
      </div>
    </form>
  );
}
