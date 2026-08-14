import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Note } from "../notes/types";
import { tasksApi } from "./api";
import { subscribeTasksChanged } from "./events";
import { isTaskOverdue, tasksDueOnOrBefore } from "./query";
import { TaskMetaPopover, type TaskMetaPatch } from "./TaskMetaPopover";
import { TaskRow } from "./TaskRow";
import type { Task, TaskState } from "./types";

export type DueSectionProps = {
  /** Daily note calendar day (`YYYY-MM-DD`). */
  date: string;
  /** Open daily note — same-note tasks stay in the body, not Due (ENG-144). */
  noteId: string;
  notes: Note[];
  onOpenTask: (task: Task, note: Note) => void;
};

type PopoverState = {
  taskId: string;
  x: number;
  y: number;
};

function dueExcludingNote(
  listed: Task[],
  date: string,
  noteId: string,
): Task[] {
  return tasksDueOnOrBefore(listed, date).filter(
    (task) => task.note_id !== noteId,
  );
}

/**
 * Read-only Due query below a daily note (ENG-64). Never written into markdown.
 * Always the live query for `date`: resolved tasks drop off past days too.
 */
export function DueSection({
  date,
  noteId,
  notes,
  onOpenTask,
}: DueSectionProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const load = useCallback(async () => {
    try {
      const listed = await tasksApi.listTasks("upcoming", date);
      setTasks(dueExcludingNote(listed, date, noteId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load due tasks");
    }
  }, [date, noteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => subscribeTasksChanged(() => void load()), [load]);

  const noteById = useMemo(
    () => new Map(notes.map((note) => [note.id, note])),
    [notes],
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
        dueExcludingNote(
          prev.map((item) => (item.id === updated.id ? updated : item)),
          date,
          noteId,
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

  if (error && tasks.length === 0) {
    return (
      <section className="due-section" aria-label="Due">
        <h2 className="due-heading">Due</h2>
        <p className="error-banner" role="alert">
          {error}
        </p>
      </section>
    );
  }

  if (tasks.length === 0) {
    return null;
  }

  return (
    <section className="due-section" aria-label="Due">
      <h2 className="due-heading">Due</h2>
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="tasks-list due-list">
        {tasks.map((task) => {
          const note = noteById.get(task.note_id);
          return (
            <li key={task.id}>
              <TaskRow
                task={task}
                note={note}
                today={date}
                showDue={isTaskOverdue(task, date)}
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
        })}
      </ul>
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
                void load();
              }
            });
          }}
        />
      ) : null}
    </section>
  );
}
