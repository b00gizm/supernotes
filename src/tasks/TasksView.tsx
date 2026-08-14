import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { calendarApi, subscribeCalendarChanged } from "../calendar/api";
import { scheduledTaskIds } from "../calendar/taskDrag";
import { formatDailyTitle } from "../notes/format";
import type { Note } from "../notes/types";
import { tasksApi } from "./api";
import { subscribeTasksChanged } from "./events";
import { filterTasks, groupUpcomingTasks } from "./query";
import { TaskMetaPopover, type TaskMetaPatch } from "./TaskMetaPopover";
import { TaskRow } from "./TaskRow";
import type { Task, TaskListFilter, TaskState } from "./types";

export type TasksViewProps = {
  notes: Note[];
  today?: string;
  onOpenTask: (task: Task, note: Note) => void;
  onCreateTask: () => void;
};

const FILTERS: Array<{ id: TaskListFilter; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "upcoming", label: "Upcoming" },
  { id: "complete", label: "Complete" },
];

type PopoverState = {
  taskId: string;
  x: number;
  y: number;
};

/**
 * Global Tasks overview: Inbox / Upcoming / Complete (ENG-63).
 * Upcoming layout follows the design mockup (date-grouped sections).
 */
export function TasksView({
  notes,
  today: todayProp,
  onOpenTask,
  onCreateTask,
}: TasksViewProps) {
  const today = todayProp ?? formatDailyTitle();
  const [filter, setFilter] = useState<TaskListFilter>("inbox");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const reload = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
      }
      try {
        const [listed, events] = await Promise.all([
          tasksApi.listTasks(filter, today),
          // ponytail: unbounded list to hide time-blocked inbox rows in the
          // browser mock. Tauri `list_tasks(inbox)` already uses NOT EXISTS.
          calendarApi.listEvents(),
        ]);
        const scheduled = scheduledTaskIds(events);
        setScheduledIds(scheduled);
        setTasks(
          filter === "inbox"
            ? listed.filter((task) => !scheduled.has(task.id))
            : listed,
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tasks");
      } finally {
        setLoading(false);
      }
    },
    [filter, today],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => subscribeTasksChanged(() => void reload(true)), [reload]);
  useEffect(() => subscribeCalendarChanged(() => void reload(true)), [reload]);

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
    patch: TaskMetaPatch,
  ): Promise<boolean> => {
    try {
      const updated = await tasksApi.updateTask({
        id: task.id,
        title: task.title,
        state: patch.state ?? task.state,
        due_date: patch.due_date === undefined ? task.due_date : patch.due_date,
        priority: patch.priority === undefined ? task.priority : patch.priority,
      });
      setTasks((prev) =>
        filterTasks(
          prev.map((item) => (item.id === updated.id ? updated : item)),
          filter,
          today,
          scheduledIds,
        ),
      );
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
      return false;
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
          ? "Inbox is empty. Type [] at the start of a line in a note."
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
        <div className="tasks-header-actions">
          <div
            className="tasks-filter"
            role="tablist"
            aria-label="Task views"
            onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
              if (
                event.key !== "ArrowLeft" &&
                event.key !== "ArrowRight" &&
                event.key !== "Home" &&
                event.key !== "End"
              ) {
                return;
              }
              const index = FILTERS.findIndex((item) => item.id === filter);
              if (index < 0) {
                return;
              }
              event.preventDefault();
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? FILTERS.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % FILTERS.length
                      : (index - 1 + FILTERS.length) % FILTERS.length;
              const next = FILTERS[nextIndex];
              if (!next) {
                return;
              }
              setFilter(next.id);
              setPopover(null);
              const tabs =
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              tabs[nextIndex]?.focus();
            }}
          >
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                tabIndex={filter === item.id ? 0 : -1}
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
          <button
            type="button"
            className="new-note-button"
            onClick={onCreateTask}
          >
            + New task
          </button>
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
            const current =
              tasks.find((item) => item.id === popoverTask.id) ?? popoverTask;
            void applyUpdate(current, patch).then((ok) => {
              if (ok) {
                void reload(true);
              }
            });
          }}
        />
      ) : null}
    </section>
  );
}
