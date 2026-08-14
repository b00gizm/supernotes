import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Note } from "../notes/types";
import { formatShortDue } from "../tasks/due";
import { subscribeTasksChanged } from "../tasks/events";
import { priorityDotClass } from "../tasks/priority";
import { allDayChipTasks, isTaskOverdue } from "../tasks/query";
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
import { scheduledTaskIds } from "./taskDrag";
import type { CalendarEvent } from "./types";

export type CalendarViewProps = {
  today: string;
  notes: Note[];
  onOpenDaily: (ymd: string) => void;
  onOpenTask: (task: Task, note: Note) => void;
};

type CalMode = "week" | "agenda";

const MODES: Array<{ id: CalMode; label: string }> = [
  { id: "week", label: "Week" },
  { id: "agenda", label: "Agenda" },
];

type DragState =
  | {
      kind: "create";
      day: string;
      originMin: number;
      currentMin: number;
    }
  | {
      kind: "move";
      id: string;
      day: string;
      startMin: number;
      endMin: number;
    }
  | {
      kind: "resize";
      id: string;
      day: string;
      startMin: number;
      endMin: number;
    }
  | {
      kind: "drop";
      day: string;
      startMin: number;
    };

type EditState = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  day: string;
  surface: "grid" | "agenda";
};

function priorityName(dot: string): string {
  if (dot === "is-p1") {
    return "Priority P1";
  }
  if (dot === "is-p2") {
    return "Priority P2";
  }
  return "Priority P3";
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

function dayFromPoint(clientX: number, clientY: number): string | null {
  const node = document.elementFromPoint(clientX, clientY);
  if (node instanceof Element) {
    const fromNode = node.closest("[data-day]")?.getAttribute("data-day");
    if (fromNode) {
      return fromNode;
    }
  }
  for (const col of document.querySelectorAll("[data-day]")) {
    const rect = col.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX < rect.right &&
      clientY >= rect.top &&
      clientY < rect.bottom
    ) {
      return col.getAttribute("data-day");
    }
  }
  return null;
}

function overlayDrag(
  events: CalendarEvent[],
  drag: DragState | null,
): CalendarEvent[] {
  if (!drag || (drag.kind !== "move" && drag.kind !== "resize")) {
    return events;
  }
  const times = timesToIso(drag.day, drag.startMin, drag.endMin);
  return events.map((item) =>
    item.id === drag.id
      ? { ...item, start: times.start, end: times.end }
      : item,
  );
}

function mergeTasks(groups: Task[][]): Task[] {
  const byId = new Map<string, Task>();
  for (const group of groups) {
    for (const task of group) {
      byId.set(task.id, task);
    }
  }
  return [...byId.values()];
}

function TaskChip({
  task,
  today,
  onToggle,
  onOpen,
  onPointerDrag,
}: {
  task: Task;
  today: string;
  onToggle: () => void;
  onOpen: () => void;
  onPointerDrag?: (event: ReactMouseEvent) => void;
}) {
  const overdue = isTaskOverdue(task, today);
  const dot = priorityDotClass(task.priority);
  const showDue = overdue && task.due_date;
  return (
    <div
      className={overdue ? "cal-chip is-overdue" : "cal-chip"}
      data-task-id={task.id}
    >
      <button
        type="button"
        className="cal-chip-toggle"
        aria-label={task.state === "done" ? "Mark task open" : "Mark task done"}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={onToggle}
      >
        <TaskStateIcon state={task.state} />
      </button>
      <button
        type="button"
        className="cal-chip-main"
        onClick={onPointerDrag ? undefined : onOpen}
        onMouseDown={onPointerDrag}
      >
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
  const [mode, setMode] = useState<CalMode>("week");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const creatingRef = useRef(false);
  const draggingTaskRef = useRef<string | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const editRef = useRef<EditState | null>(null);
  const movedRef = useRef(false);
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
      // ponytail: unbounded list just to hide scheduled inbox rows. Upgrade:
      // `NOT EXISTS (SELECT 1 FROM calendar_events WHERE task_id = tasks.id)`.
      const [listed, all] = await Promise.all([
        calendarApi.listEvents(range.from, range.to),
        calendarApi.listEvents(),
      ]);
      setEvents(listed);
      setScheduledIds(scheduledTaskIds(all));
      setError(null);
      return listed;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
      return [];
    }
  }, [range.from, range.to]);

  const loadTasks = useCallback(
    async (linkedIds: Iterable<string> = []) => {
      try {
        const [inbox, upcoming] = await Promise.all([
          tasksApi.listTasks("inbox", today),
          tasksApi.listTasks("upcoming", today),
        ]);
        const extraIds = [...linkedIds].filter(
          (id) =>
            !inbox.some((task) => task.id === id) &&
            !upcoming.some((task) => task.id === id),
        );
        const extras = await Promise.all(
          extraIds.map((id) =>
            tasksApi.getTask(id).catch(() => null as Task | null),
          ),
        );
        setTasks(
          mergeTasks([
            inbox,
            upcoming,
            extras.filter((task): task is Task => task !== null),
          ]),
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tasks");
      }
    },
    [today],
  );

  useEffect(() => {
    void loadEvents().then((listed) => {
      const linked = listed.flatMap((item) =>
        item.task_id ? [item.task_id] : [],
      );
      void loadTasks(linked);
    });
  }, [loadEvents, loadTasks]);

  useEffect(
    () =>
      subscribeCalendarChanged(() => {
        if (creatingRef.current || dragRef.current) {
          return;
        }
        void loadEvents().then((listed) => {
          const linked = listed.flatMap((item) =>
            item.task_id ? [item.task_id] : [],
          );
          void loadTasks(linked);
        });
      }),
    [loadEvents, loadTasks],
  );
  useEffect(
    () =>
      subscribeTasksChanged(() => {
        const linked = events.flatMap((item) =>
          item.task_id ? [item.task_id] : [],
        );
        void loadTasks(linked);
      }),
    [events, loadTasks],
  );

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

  const goMode = (next: CalMode) => {
    setMode(next);
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
      if (current.task_id) {
        const linked = tasks.find((task) => task.id === current.task_id);
        if (linked && linked.title !== next.title) {
          const saved = await tasksApi.updateTask({
            id: linked.id,
            title: next.title,
            state: linked.state,
            due_date: linked.due_date,
            priority: linked.priority,
          });
          setTasks((prev) =>
            prev.map((item) => (item.id === saved.id ? saved : item)),
          );
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save event");
      void loadEvents();
    }
  };

  const persistTimes = async (
    id: string,
    day: string,
    startMin: number,
    endMin: number,
  ) => {
    const current = events.find((item) => item.id === id);
    if (!current) {
      return;
    }
    const times = timesToIso(day, startMin, endMin);
    const previous = events;
    setEvents((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, start: times.start, end: times.end } : item,
      ),
    );
    try {
      const updated = await calendarApi.updateEvent({
        id,
        title: current.title,
        start: times.start,
        end: times.end,
        task_id: current.task_id,
      });
      setEvents((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      setError(null);
    } catch (err) {
      setEvents(previous);
      setError(err instanceof Error ? err.message : "Failed to save event");
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
    const removed = events.find((item) => item.id === id);
    setEvents((prev) => prev.filter((item) => item.id !== id));
    if (removed?.task_id) {
      setScheduledIds((prev) => {
        const next = new Set(prev);
        next.delete(removed.task_id as string);
        return next;
      });
    }
    setEdit(null);
    try {
      await calendarApi.deleteEvent(id);
      setError(null);
    } catch (err) {
      setEvents(previous);
      setScheduledIds(scheduledTaskIds(previous));
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
      setEvents((prev) => {
        if (prev.some((item) => item.id === created.id)) {
          return prev;
        }
        return [...prev, created].sort((a, b) =>
          a.start.localeCompare(b.start),
        );
      });
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

  const scheduleTask = async (task: Task, day: string, startMin: number) => {
    if (
      creatingRef.current ||
      scheduledIds.has(task.id) ||
      !Number.isFinite(startMin)
    ) {
      return;
    }
    creatingRef.current = true;
    const endMin = startMin + DEFAULT_DURATION_MIN;
    const times = timesToIso(day, startMin, endMin);
    setScheduledIds((prev) => new Set(prev).add(task.id));
    try {
      const created = await calendarApi.createEvent({
        title: task.title,
        start: times.start,
        end: times.end,
        task_id: task.id,
      });
      setEvents((prev) => {
        if (prev.some((item) => item.id === created.id)) {
          return prev;
        }
        return [...prev, created].sort((a, b) =>
          a.start.localeCompare(b.start),
        );
      });
      setTasks((prev) =>
        prev.some((item) => item.id === task.id) ? prev : [...prev, task],
      );
      setSelectedDay(day);
      setError(null);
    } catch (err) {
      setScheduledIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      setError(err instanceof Error ? err.message : "Failed to schedule task");
      void loadEvents();
    } finally {
      creatingRef.current = false;
    }
  };

  const gridMinutes = (clientY: number): number | null => {
    const grid = gridRef.current;
    if (!grid || !Number.isFinite(clientY)) {
      return null;
    }
    const rect = grid.getBoundingClientRect();
    if (rect.height <= 0) {
      return null;
    }
    return pointerToMinutes(clientY, rect.top, rect.height);
  };

  const onGridMouseDown = (day: string, event: ReactMouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    const mins = gridMinutes(event.clientY);
    if (mins === null) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".cal-event")) {
      return;
    }
    event.preventDefault();
    const next: DragState = {
      kind: "create",
      day,
      originMin: mins,
      currentMin: mins,
    };
    dragRef.current = next;
    setDrag(next);
    setSelectedDay(day);
    setEdit(null);

    const onMove = (move: MouseEvent) => {
      const current = gridMinutes(move.clientY);
      const live = dragRef.current;
      if (!live || live.kind !== "create" || current === null) {
        return;
      }
      const updated: DragState = { ...live, currentMin: current };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = (up: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const live = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!live || live.kind !== "create") {
        return;
      }
      const current = gridMinutes(up.clientY) ?? live.currentMin;
      const start = Math.min(live.originMin, current);
      const end = Math.max(live.originMin, current);
      void createAt(live.day, start, end === start ? start : end, "grid");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const beginMove = (
    item: CalendarEvent,
    day: string,
    event: ReactMouseEvent,
  ) => {
    if (event.button !== 0) {
      return;
    }
    const clip = eventSegmentOnDay(item, day);
    const startMin = clip?.startMin ?? 9 * 60;
    const endMin = clip
      ? Math.max(clip.endMin, startMin + DEFAULT_DURATION_MIN)
      : startMin + DEFAULT_DURATION_MIN;
    const grab = gridMinutes(event.clientY);
    const grabOffset = grab === null ? 0 : grab - startMin;
    event.preventDefault();
    event.stopPropagation();
    movedRef.current = false;
    const next: DragState = {
      kind: "move",
      id: item.id,
      day,
      startMin,
      endMin,
    };
    dragRef.current = next;
    setDrag(next);
    setSelectedDay(day);
    setEdit(null);

    const onMove = (move: MouseEvent) => {
      const current = gridMinutes(move.clientY);
      const live = dragRef.current;
      if (!live || live.kind !== "move" || current === null) {
        return;
      }
      const duration = live.endMin - live.startMin;
      const start = Math.max(
        0,
        Math.min(GRID_HOURS * 60 - DEFAULT_DURATION_MIN, current - grabOffset),
      );
      const overDay = dayFromPoint(move.clientX, move.clientY) ?? live.day;
      if (start !== live.startMin || overDay !== live.day) {
        movedRef.current = true;
      }
      const updated: DragState = {
        ...live,
        day: overDay,
        startMin: start,
        endMin: start + duration,
      };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const live = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!live || live.kind !== "move") {
        return;
      }
      if (!movedRef.current) {
        beginEdit(item, day, "grid");
        return;
      }
      void persistTimes(live.id, live.day, live.startMin, live.endMin);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const beginResize = (
    item: CalendarEvent,
    day: string,
    event: ReactMouseEvent,
  ) => {
    if (event.button !== 0) {
      return;
    }
    const clip = eventSegmentOnDay(item, day);
    const startMin = clip?.startMin ?? 9 * 60;
    const endMin = clip
      ? Math.max(clip.endMin, startMin + DEFAULT_DURATION_MIN)
      : startMin + DEFAULT_DURATION_MIN;
    event.preventDefault();
    event.stopPropagation();
    const next: DragState = {
      kind: "resize",
      id: item.id,
      day,
      startMin,
      endMin,
    };
    dragRef.current = next;
    setDrag(next);
    setSelectedDay(day);
    setEdit(null);

    const onMove = (move: MouseEvent) => {
      const current = gridMinutes(move.clientY);
      const live = dragRef.current;
      if (!live || live.kind !== "resize" || current === null) {
        return;
      }
      const updated: DragState = {
        ...live,
        endMin: Math.max(live.startMin + DEFAULT_DURATION_MIN, current),
      };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const live = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!live || live.kind !== "resize") {
        return;
      }
      void persistTimes(live.id, live.day, live.startMin, live.endMin);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const beginTaskDrag = (task: Task, event: ReactMouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    draggingTaskRef.current = task.id;
    movedRef.current = false;
    dragRef.current = null;
    setDrag(null);
    setEdit(null);

    const onMove = (move: MouseEvent) => {
      const day = dayFromPoint(move.clientX, move.clientY);
      const startMin = gridMinutes(move.clientY);
      if (!day || startMin === null) {
        if (dragRef.current?.kind === "drop") {
          dragRef.current = null;
          setDrag(null);
        }
        return;
      }
      movedRef.current = true;
      const live = dragRef.current;
      if (
        live &&
        live.kind === "drop" &&
        live.day === day &&
        live.startMin === startMin
      ) {
        return;
      }
      const updated: DragState = { kind: "drop", day, startMin };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = (up: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const taskId = draggingTaskRef.current;
      draggingTaskRef.current = null;
      const live = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!movedRef.current) {
        const note = noteById.get(task.note_id);
        if (note) {
          onOpenTask(task, note);
        }
        return;
      }
      const day =
        live?.kind === "drop" ? live.day : dayFromPoint(up.clientX, up.clientY);
      const startMin =
        live?.kind === "drop" ? live.startMin : gridMinutes(up.clientY);
      if (!taskId || !day || startMin === null) {
        return;
      }
      void scheduleTask(task, day, startMin);
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
    const linked = item.task_id
      ? tasks.find((task) => task.id === item.task_id)
      : undefined;
    setSelectedDay(day);
    setEdit({
      id: item.id,
      title: linked?.title ?? item.title,
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
  const viewingToday =
    mode === "week"
      ? weekStart === startOfWeekMonday(today)
      : selectedDay === today;
  const gridHeight = GRID_HOURS * HOUR_HEIGHT;
  const visibleEvents = overlayDrag(events, drag);
  const selectedEvents = visibleEvents
    .filter((item) => eventSegmentOnDay(item, selectedDay) !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  const selectedChips = allDayChipTasks(
    tasks,
    selectedDay,
    today,
    scheduledIds,
  );
  const inboxTasks = tasks.filter(
    (task) =>
      (task.state === "open" || task.state === "waiting") &&
      task.due_date === null &&
      !scheduledIds.has(task.id),
  );
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const hourMarks = Array.from({ length: GRID_HOURS }, (_, hour) => hour);

  return (
    <section className="calendar-pane" aria-label="Calendar">
      <div className="cal-header">
        <div className="cal-title-block">
          {mode === "week" ? (
            <>
              <h1 className="pane-title">{heading.monthYear}</h1>
              <span className="cal-range">{heading.range}</span>
            </>
          ) : (
            <h1 className="pane-title">{agendaHeading(selectedDay)}</h1>
          )}
        </div>
        <div className="cal-header-actions">
          <div
            className="tasks-filter"
            role="tablist"
            aria-label="Calendar views"
            onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              goMode(mode === "week" ? "agenda" : "week");
              const tabs =
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              tabs[mode === "week" ? 1 : 0]?.focus();
            }}
          >
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                tabIndex={mode === item.id ? 0 : -1}
                aria-selected={mode === item.id}
                className={`tasks-filter-tab${mode === item.id ? " is-active" : ""}`}
                onClick={() => {
                  goMode(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            className="daily-nav"
            role="group"
            aria-label={mode === "week" ? "Week navigation" : "Day navigation"}
          >
            <button
              type="button"
              className="daily-nav-btn"
              aria-label={mode === "week" ? "Previous week" : "Previous day"}
              onClick={() => {
                if (mode === "week") {
                  goWeek(-1);
                } else {
                  goDay(-1);
                }
              }}
            >
              ‹
            </button>
            <button
              type="button"
              className="daily-nav-btn"
              aria-label={mode === "week" ? "Next week" : "Next day"}
              onClick={() => {
                if (mode === "week") {
                  goWeek(1);
                } else {
                  goDay(1);
                }
              }}
            >
              ›
            </button>
            {!viewingToday ? (
              <button
                type="button"
                className="text-button daily-today"
                onClick={goToday}
              >
                Today
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cal-body">
        {mode === "week" ? (
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
                      className={
                        isToday ? "cal-day-num is-today" : "cal-day-num"
                      }
                    >
                      {String(dayNumber(day))}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="cal-allday" role="group" aria-label="All-day">
              <span className="cal-gutter cal-allday-label">ALL-DAY</span>
              {days.map((day) => (
                <div key={day} className="cal-allday-cell" data-allday={day}>
                  {allDayChipTasks(tasks, day, today, scheduledIds).map(
                    (task) => {
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
                          onPointerDrag={(event) => {
                            beginTaskDrag(task, event);
                          }}
                        />
                      );
                    },
                  )}
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
                  const laid = layoutDayEvents(visibleEvents, day);
                  const dropping =
                    drag &&
                    drag.day === day &&
                    (drag.kind === "create" || drag.kind === "drop")
                      ? drag
                      : null;
                  let previewStart = 0;
                  let previewEnd = 0;
                  if (dropping?.kind === "create") {
                    previewStart = Math.min(
                      dropping.originMin,
                      dropping.currentMin,
                    );
                    previewEnd = Math.max(
                      dropping.originMin,
                      dropping.currentMin,
                      previewStart + DEFAULT_DURATION_MIN,
                    );
                  } else if (dropping?.kind === "drop") {
                    previewStart = dropping.startMin;
                    previewEnd = dropping.startMin + DEFAULT_DURATION_MIN;
                  }
                  return (
                    <div
                      key={day}
                      className={[
                        "cal-day-col",
                        day === selectedDay ? "is-selected" : "",
                        dropping ? "is-drop" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-day={day}
                      onMouseDown={(event) => {
                        onGridMouseDown(day, event);
                      }}
                    >
                      {laid.map((segment) => {
                        const top = (segment.startMin / 60) * HOUR_HEIGHT;
                        // 15 min is 12px on a 48px hour; floor so a one-line chip can center.
                        const height = Math.max(
                          ((segment.endMin - segment.startMin) / 60) *
                            HOUR_HEIGHT,
                          22,
                        );
                        const compact = height < 28;
                        const width = `calc((100% - 4px) / ${String(segment.cols)})`;
                        const left = `calc(${String(segment.col)} * (100% - 4px) / ${String(segment.cols)} + 2px)`;
                        const editing =
                          edit !== null && edit.id === segment.event.id;
                        const linked = segment.event.task_id
                          ? taskById.get(segment.event.task_id)
                          : undefined;
                        const title =
                          (linked?.title ?? segment.event.title).trim() ||
                          "Untitled";
                        const done =
                          linked?.state === "done" ||
                          linked?.state === "cancelled";
                        const startLabel = formatClock(segment.startMin);
                        const endLabel = formatClock(segment.endMin);
                        const classes = [
                          "cal-event",
                          editing ? "is-editing" : "",
                          linked ? "is-task" : "",
                          done ? "is-done" : "",
                          compact ? "is-compact" : "",
                          drag &&
                          (drag.kind === "move" || drag.kind === "resize") &&
                          drag.id === segment.event.id
                            ? "is-dragging"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <div
                            key={segment.event.id}
                            className={classes}
                            style={{ top, height, width, left }}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            {linked ? (
                              <button
                                type="button"
                                className="cal-event-toggle"
                                aria-label={
                                  linked.state === "done"
                                    ? "Mark task open"
                                    : "Mark task done"
                                }
                                onMouseDown={(event) => {
                                  event.stopPropagation();
                                }}
                                onClick={() => {
                                  toggleTask(linked);
                                }}
                              >
                                <TaskStateIcon state={linked.state} />
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="cal-event-hit"
                              onMouseDown={(event) => {
                                beginMove(segment.event, day, event);
                              }}
                            >
                              <span className="cal-event-title">{title}</span>
                              <span className="cal-event-when">
                                {startLabel} – {endLabel}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="cal-event-resize"
                              aria-label={`Resize ${title}`}
                              onMouseDown={(event) => {
                                beginResize(segment.event, day, event);
                              }}
                            />
                          </div>
                        );
                      })}
                      {dropping ? (
                        <div
                          className="cal-event is-preview"
                          style={{
                            top: (previewStart / 60) * HOUR_HEIGHT,
                            height:
                              ((previewEnd - previewStart) / 60) * HOUR_HEIGHT,
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
                    <span className="cal-now-line" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <section className="cal-agenda" aria-label="Agenda">
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
                const linked = item.task_id
                  ? taskById.get(item.task_id)
                  : undefined;
                const done =
                  linked?.state === "done" || linked?.state === "cancelled";
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
                const nodes = [];
                if (showNow) {
                  nodes.push(
                    <li key="now" className="cal-agenda-now">
                      <span className="cal-now-dot" />
                      <span className="cal-now-label">
                        {formatClock(nowMin)}
                      </span>
                      <span className="cal-now-line" />
                    </li>,
                  );
                }
                nodes.push(
                  <li
                    key={item.id}
                    className={[
                      "cal-agenda-row",
                      past ? "is-past" : "",
                      edit?.id === item.id ? "is-editing" : "",
                      linked && done ? "is-done" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {linked ? (
                      <button
                        type="button"
                        className="cal-event-toggle"
                        aria-label={
                          linked.state === "done"
                            ? "Mark task open"
                            : "Mark task done"
                        }
                        onClick={() => {
                          toggleTask(linked);
                        }}
                      >
                        <TaskStateIcon state={linked.state} />
                      </button>
                    ) : null}
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
                        {(linked?.title ?? item.title).trim() || "Untitled"}
                      </span>
                      <span className="cal-agenda-dur">
                        {formatDuration(item.start, item.end)}
                      </span>
                    </button>
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
                  <span className="cal-now-line" />
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
          </section>
        )}
        <InboxSidebar
          tasks={inboxTasks}
          onPointerDrag={beginTaskDrag}
          onToggle={toggleTask}
        />
        {edit ? (
          <EventFields
            edit={edit}
            onChange={setEdit}
            onCommit={() => {
              void commitEdit();
            }}
            onDelete={() => {
              void deleteEvent(edit.id);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function InboxSidebar({
  tasks,
  onPointerDrag,
  onToggle,
}: {
  tasks: Task[];
  onPointerDrag: (task: Task, event: ReactMouseEvent) => void;
  onToggle: (task: Task) => void;
}) {
  return (
    <aside className="cal-inbox" aria-label="Inbox tasks">
      <h2 className="cal-inbox-title">Unscheduled Tasks</h2>
      {tasks.length === 0 ? (
        <p className="cal-inbox-empty">No unscheduled tasks</p>
      ) : (
        <ul className="cal-inbox-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <div className="cal-inbox-row" data-task-id={task.id}>
                <button
                  type="button"
                  className="cal-inbox-toggle"
                  aria-label={
                    task.state === "done" ? "Mark task open" : "Mark task done"
                  }
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    onToggle(task);
                  }}
                >
                  <TaskStateIcon state={task.state} />
                </button>
                <button
                  type="button"
                  className="cal-inbox-main"
                  onMouseDown={(event) => {
                    onPointerDrag(task, event);
                  }}
                >
                  <span className="cal-inbox-task-title">
                    {task.title.trim() || "Untitled task"}
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
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
        placeholder="New event"
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
