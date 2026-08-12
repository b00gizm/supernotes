import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { formatDailyTitle, parseDailyTitle } from "../notes/format";
import type { Note } from "../notes/types";
import { tasksApi } from "./api";
import { groupUpcomingTasks, isTaskOverdue } from "./query";
import { TaskMetaPopover } from "./TaskMetaPopover";
import { priorityDotClass } from "./priority";
import { TaskStateIcon } from "./TaskStateIcon";
import type { Task, TaskListFilter, TaskPriority, TaskState } from "./types";

export type TasksViewProps = {
  notes: Note[];
  today?: string;
  onOpenTask: (task: Task, note: Note) => void;
};

const FILTERS: Array<{ id: TaskListFilter; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "upcoming", label: "Upcoming" },
  { id: "complete", label: "Complete" },
];

function noteLabel(note: Note): string {
  if (note.note_type === "daily") {
    const parsed = parseDailyTitle(note.title);
    if (parsed) {
      const month = parsed.toLocaleDateString("en-US", { month: "short" });
      return `${month} ${String(parsed.getDate())}`;
    }
  }
  return note.title.trim() || "Untitled";
}

function formatOverdueDue(due: string): string {
  const date = parseDailyTitle(due);
  if (!date) {
    return due;
  }
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${String(date.getDate())}`;
}

type PopoverState = {
  taskId: string;
  x: number;
  y: number;
};

function SourceLink({ label }: { label: string }) {
  return (
    <span className="tasks-source">
      <span className="tasks-source-arrow" aria-hidden="true">
        ↗
      </span>
      <span className="tasks-source-label">{label}</span>
    </span>
  );
}

function TaskRow({
  task,
  note,
  today,
  showDue,
  onToggle,
  onOpen,
  onMeta,
}: {
  task: Task;
  note: Note | undefined;
  today: string;
  showDue: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMeta: (event: ReactMouseEvent) => void;
}) {
  const overdue = isTaskOverdue(task, today);
  const dot = priorityDotClass(task.priority);
  const terminal = task.state === "done" || task.state === "cancelled";

  return (
    <div
      className={`tasks-row${terminal ? " is-terminal" : ""}${overdue && showDue ? " is-overdue-due" : ""}`}
    >
      <button
        type="button"
        className="tasks-row-toggle"
        aria-label={task.state === "done" ? "Mark task open" : "Mark task done"}
        onClick={onToggle}
      >
        <TaskStateIcon state={task.state} />
      </button>
      <button
        type="button"
        className="tasks-row-main"
        onClick={onOpen}
        onContextMenu={onMeta}
      >
        <span className="tasks-row-title">
          {task.title.trim() || "Untitled task"}
        </span>
        {showDue && task.due_date ? (
          <span className={`tasks-due-chip${overdue ? " is-overdue" : ""}`}>
            {formatOverdueDue(task.due_date)}
          </span>
        ) : null}
        {dot ? (
          <span className={`task-priority-dot ${dot}`} aria-hidden="true" />
        ) : null}
        <SourceLink label={note ? noteLabel(note) : "Missing note"} />
      </button>
      <button
        type="button"
        className="tasks-row-more"
        aria-label="Task details"
        onClick={onMeta}
      >
        ···
      </button>
    </div>
  );
}

/**
 * Global Tasks overview: Inbox / Upcoming / Complete (ENG-63).
 * Upcoming layout follows the design mockup (date-grouped sections).
 */
export function TasksView({
  notes,
  today: todayProp,
  onOpenTask,
}: TasksViewProps) {
  const today = todayProp ?? formatDailyTitle();
  const [filter, setFilter] = useState<TaskListFilter>("inbox");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listed = await tasksApi.listTasks(filter, today);
      setTasks(listed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [filter, today]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const noteById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const upcomingGroups = useMemo(
    () => (filter === "upcoming" ? groupUpcomingTasks(tasks, today) : []),
    [filter, tasks, today],
  );
  const popoverTask = popover
    ? (tasks.find((task) => task.id === popover.taskId) ?? null)
    : null;

  const applyUpdate = async (
    task: Task,
    patch: {
      state?: TaskState;
      due_date?: string | null;
      priority?: TaskPriority | null;
    },
  ) => {
    try {
      const updated = await tasksApi.updateTask({
        id: task.id,
        title: task.title,
        state: patch.state ?? task.state,
        due_date: patch.due_date === undefined ? task.due_date : patch.due_date,
        priority: patch.priority === undefined ? task.priority : patch.priority,
      });
      setTasks((prev) => {
        const next = prev.map((item) =>
          item.id === updated.id ? updated : item,
        );
        return next.filter((item) => {
          if (filter === "inbox") {
            return item.state === "open" && item.due_date == null;
          }
          if (filter === "upcoming") {
            return (
              (item.state === "open" || item.state === "waiting") &&
              item.due_date != null
            );
          }
          return (
            (item.state === "done" || item.state === "cancelled") &&
            item.completed_at != null
          );
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const toggleDone = (task: Task) => {
    const next: TaskState = task.state === "done" ? "open" : "done";
    void applyUpdate(task, { state: next });
  };

  const openMeta = (event: ReactMouseEvent, task: Task) => {
    event.preventDefault();
    event.stopPropagation();
    setPopover({
      taskId: task.id,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const renderRow = (task: Task, showDue: boolean): ReactNode => {
    const note = noteById.get(task.note_id);
    return (
      <li key={task.id}>
        <TaskRow
          task={task}
          note={note}
          today={today}
          showDue={showDue}
          onToggle={() => {
            toggleDone(task);
          }}
          onOpen={() => {
            if (!note) {
              return;
            }
            onOpenTask(task, note);
          }}
          onMeta={(event) => {
            openMeta(event, task);
          }}
        />
      </li>
    );
  };

  let body: ReactNode;
  if (loading) {
    body = <p className="muted">Loading…</p>;
  } else if (tasks.length === 0) {
    body = (
      <p className="muted">
        {filter === "inbox"
          ? "Inbox is empty."
          : filter === "upcoming"
            ? "No upcoming tasks."
            : "No completed tasks in the last 14 days."}
      </p>
    );
  } else if (filter === "upcoming") {
    body = (
      <div className="tasks-groups">
        {upcomingGroups.map((group) => (
          <section
            key={group.id}
            className={`tasks-group is-${group.tone}`}
            aria-label={group.label}
          >
            <h2 className="tasks-group-label">
              <span>{group.label}</span>
              {group.showCount ? (
                <span className="tasks-group-count">
                  {String(group.tasks.length)}
                </span>
              ) : null}
            </h2>
            <ul className="tasks-list">
              {group.tasks.map((task) =>
                renderRow(task, group.tone === "overdue"),
              )}
            </ul>
          </section>
        ))}
      </div>
    );
  } else {
    body = (
      <ul className="tasks-list">
        {tasks.map((task) => renderRow(task, filter === "complete"))}
      </ul>
    );
  }

  return (
    <section className="overview-pane tasks-pane" aria-label="Tasks">
      <div className="overview-header">
        <div className="overview-title-row">
          <h1 className="pane-title">Tasks</h1>
        </div>
        <div className="tasks-filter" role="tablist" aria-label="Task views">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`tasks-filter-tab${filter === item.id ? " is-active" : ""}`}
              onClick={() => {
                setFilter(item.id);
                setPopover(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}

      {body}

      {popover && popoverTask ? (
        <TaskMetaPopover
          task={popoverTask}
          anchor={{ x: popover.x, y: popover.y }}
          onClose={() => {
            setPopover(null);
          }}
          onUpdate={(patch) => {
            void applyUpdate(popoverTask, patch).then(() => {
              void reload();
            });
          }}
        />
      ) : null}
    </section>
  );
}
