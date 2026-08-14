import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { calendarApi, subscribeCalendarChanged } from "../calendar/api";
import { formatDailyTitle } from "../notes/format";
import type { Note } from "../notes/types";
import { tasksApi } from "./api";
import { formatScheduleSpan } from "./due";
import { subscribeTasksChanged } from "./events";
import {
  groupUpcomingTasks,
  schedulesFromEvents,
  type TaskSchedule,
} from "./query";
import { TaskMetaPopover, type TaskMetaPatch } from "./TaskMetaPopover";
import { TaskRow } from "./TaskRow";
import type { Task, TaskState } from "./types";

export type TasksViewProps = {
  notes: Note[];
  today?: string;
  onOpenTask: (task: Task, note: Note) => void;
  onCreateTask: () => void;
};

type PopoverState = {
  taskId: string;
  x: number;
  y: number;
};

function mergeById(groups: Task[][]): Task[] {
  const byId = new Map<string, Task>();
  for (const group of groups) {
    for (const task of group) {
      byId.set(task.id, task);
    }
  }
  return [...byId.values()];
}

/**
 * Open tasks grouped by unscheduled callout, then overdue / day.
 * Time blocks sit on their slot day unless the due date is already overdue.
 */
export function TasksView({
  notes,
  today: todayProp,
  onOpenTask,
  onCreateTask,
}: TasksViewProps) {
  const today = todayProp ?? formatDailyTitle();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedules, setSchedules] = useState<Map<string, TaskSchedule>>(
    () => new Map(),
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const readyRef = useRef(false);

  const reload = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
      }
      try {
        const [inbox, upcoming, events, complete] = await Promise.all([
          tasksApi.listTasks("inbox", today),
          tasksApi.listTasks("upcoming", today),
          calendarApi.listEvents(),
          showCompleted
            ? tasksApi.listTasks("complete", today)
            : Promise.resolve([] as Task[]),
        ]);
        setTasks(mergeById([inbox, upcoming, complete]));
        setSchedules(schedulesFromEvents(events));
        setError(null);
        readyRef.current = true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tasks");
      } finally {
        setLoading(false);
      }
    },
    [showCompleted, today],
  );

  useEffect(() => {
    void reload(readyRef.current);
  }, [reload]);

  useEffect(() => subscribeTasksChanged(() => void reload(true)), [reload]);
  useEffect(() => subscribeCalendarChanged(() => void reload(true)), [reload]);

  const noteById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
  );
  const groups = useMemo(
    () => groupUpcomingTasks(tasks, today, schedules),
    [tasks, today, schedules],
  );
  const popoverTask = popover
    ? (tasks.find((item) => item.id === popover.taskId) ?? null)
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
      setTasks((prev) => {
        const next = prev.map((item) =>
          item.id === updated.id ? updated : item,
        );
        if (
          updated.state === "open" ||
          updated.state === "waiting" ||
          showCompleted
        ) {
          return next;
        }
        return next.filter((item) => item.id !== updated.id);
      });
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

  const renderRow = (task: Task): ReactNode => {
    const note = noteById.get(task.note_id);
    const slot = schedules.get(task.id);
    return (
      <li key={task.id}>
        <TaskRow
          task={task}
          note={note}
          today={today}
          showDue={Boolean(task.due_date)}
          scheduleLabel={
            slot ? formatScheduleSpan(slot.start, slot.end) : undefined
          }
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
  } else if (groups.length === 0) {
    body = (
      <p className="muted">
        No open tasks. Type [] at the start of a line in a note.
      </p>
    );
  } else {
    body = (
      <div className="tasks-groups">
        {groups.map((group) => (
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
              {group.tasks.map((task) => renderRow(task))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <section className="overview-pane tasks-pane" aria-label="Tasks">
      <div className="overview-header">
        <div className="overview-title-row">
          <h1 className="pane-title">Tasks</h1>
        </div>
        <div className="tasks-header-actions">
          <button
            type="button"
            className={`tasks-completed-toggle${showCompleted ? " is-active" : ""}`}
            aria-pressed={showCompleted}
            aria-label="Show completed"
            onClick={() => {
              setShowCompleted((on) => !on);
            }}
          >
            Completed
          </button>
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
