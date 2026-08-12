import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  formatDailyDisplayTitle,
  formatDailyTitle,
  parseDailyTitle,
} from "../notes/format";
import type { Note } from "../notes/types";
import { tasksApi } from "./api";
import { isTaskOverdue } from "./query";
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
      return formatDailyDisplayTitle(parsed);
    }
  }
  return note.title.trim() || "Untitled";
}

function formatDueChip(due: string, today: string): string {
  if (due === today) {
    return "Today";
  }
  const tomorrow = formatDailyTitle(
    new Date(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)) - 1,
      Number(today.slice(8, 10)) + 1,
    ),
  );
  if (due === tomorrow) {
    return "Tomorrow";
  }
  const date = new Date(`${due}T12:00:00`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type PopoverState = {
  taskId: string;
  x: number;
  y: number;
};

/**
 * Global Tasks overview: Inbox / Upcoming / Complete (ENG-63).
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

  const noteById = new Map(notes.map((note) => [note.id, note]));
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
      // Drop from the current filter if it no longer matches.
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

  return (
    <section className="overview-pane tasks-pane" aria-label="Tasks">
      <div className="overview-header">
        <div className="overview-title-row">
          <h1 className="pane-title">Tasks</h1>
          <span className="overview-count">{String(tasks.length)}</span>
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

      {loading ? (
        <p className="muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">
          {filter === "inbox"
            ? "Inbox is empty."
            : filter === "upcoming"
              ? "No upcoming tasks."
              : "No completed tasks in the last 14 days."}
        </p>
      ) : (
        <ul className="tasks-list">
          {tasks.map((task) => {
            const note = noteById.get(task.note_id);
            const overdue = isTaskOverdue(task, today);
            const dot = priorityDotClass(task.priority);
            return (
              <li key={task.id}>
                <div
                  className={`tasks-row${overdue ? " is-overdue" : ""}${task.state === "done" || task.state === "cancelled" ? " is-terminal" : ""}`}
                >
                  <button
                    type="button"
                    className="tasks-row-toggle"
                    aria-label={
                      task.state === "done"
                        ? "Mark task open"
                        : "Mark task done"
                    }
                    onClick={() => {
                      toggleDone(task);
                    }}
                  >
                    <TaskStateIcon state={task.state} />
                  </button>
                  <button
                    type="button"
                    className="tasks-row-main"
                    onClick={() => {
                      if (!note) {
                        return;
                      }
                      onOpenTask(task, note);
                    }}
                    onContextMenu={(event) => {
                      openMeta(event, task);
                    }}
                  >
                    {dot ? (
                      <span
                        className={`task-priority-dot ${dot}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="task-priority-dot is-empty"
                        aria-hidden="true"
                      />
                    )}
                    <span className="tasks-row-title">
                      {task.title.trim() || "Untitled task"}
                    </span>
                    {task.due_date ? (
                      <span
                        className={`tasks-due-chip${overdue ? " is-overdue" : task.due_date === today ? " is-today" : ""}`}
                      >
                        {formatDueChip(task.due_date, today)}
                      </span>
                    ) : null}
                    <span className="tasks-source">
                      {note ? noteLabel(note) : "Missing note"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="tasks-row-more"
                    aria-label="Task details"
                    onClick={(event) => {
                      openMeta(event, task);
                    }}
                  >
                    ···
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {popover && popoverTask ? (
        <TaskMetaPopover
          task={popoverTask}
          anchor={{ x: popover.x, y: popover.y }}
          onClose={() => {
            setPopover(null);
          }}
          onUpdate={(patch) => {
            void applyUpdate(popoverTask, patch).then(() => {
              // Reload so Complete 14-day window / cross-filter moves stay correct.
              void reload();
            });
          }}
        />
      ) : null}
    </section>
  );
}
