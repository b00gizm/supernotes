import { useEffect, useId, useRef } from "react";
import { formatDailyTitle } from "../notes/format";
import type { Task, TaskPriority, TaskState } from "./types";
import { TaskStateIcon } from "./TaskStateIcon";

export type TaskMetaPopoverProps = {
  task: Task;
  anchor: { x: number; y: number };
  onClose: () => void;
  onUpdate: (patch: {
    state?: TaskState;
    due_date?: string | null;
    priority?: TaskPriority | null;
  }) => void;
};

const STATES: TaskState[] = ["open", "waiting", "done", "cancelled"];

const STATE_LABEL: Record<TaskState, string> = {
  open: "Open",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancel",
};

/** Compact P1/P2/P3/None control — urgent+high both map to P1 visually. */
const PRIORITY_SEGMENTS: Array<{
  values: Array<TaskPriority | null>;
  label: string;
  apply: TaskPriority | null;
}> = [
  { values: ["urgent", "high"], label: "P1", apply: "high" },
  { values: ["medium"], label: "P2", apply: "medium" },
  { values: ["low"], label: "P3", apply: "low" },
  { values: ["none", null], label: "None", apply: null },
];

function shiftDays(from: string, days: number): string {
  const base = new Date(`${from}T12:00:00`);
  base.setDate(base.getDate() + days);
  return formatDailyTitle(base);
}

/**
 * Shared task metadata popover (ENG-63 list + ENG-62 editor).
 * State → due shortcuts → priority segments.
 */
export function TaskMetaPopover({
  task,
  anchor,
  onClose,
  onUpdate,
}: TaskMetaPopoverProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const today = formatDailyTitle();

  useEffect(() => {
    const node = rootRef.current;
    node?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (!node?.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 280));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 320));

  return (
    <div
      ref={rootRef}
      className="task-meta-popover"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ left, top }}
    >
      <p id={titleId} className="task-meta-title">
        {task.title.trim() || "Task"}
      </p>

      <div className="task-meta-section" role="group" aria-label="State">
        {STATES.map((state) => (
          <button
            key={state}
            type="button"
            className={`task-meta-state${task.state === state ? " is-active" : ""}`}
            aria-pressed={task.state === state}
            onClick={() => {
              onUpdate({ state });
            }}
          >
            <TaskStateIcon state={state} />
            <span>{STATE_LABEL[state]}</span>
          </button>
        ))}
      </div>

      <div className="task-meta-section" role="group" aria-label="Due">
        <span className="task-meta-label">Due</span>
        <div className="task-meta-row">
          <button
            type="button"
            className={task.due_date === today ? "is-active" : undefined}
            onClick={() => {
              onUpdate({ due_date: today });
            }}
          >
            Today
          </button>
          <button
            type="button"
            className={
              task.due_date === shiftDays(today, 1) ? "is-active" : undefined
            }
            onClick={() => {
              onUpdate({ due_date: shiftDays(today, 1) });
            }}
          >
            Tomorrow
          </button>
          <button
            type="button"
            className={
              task.due_date === shiftDays(today, 7) ? "is-active" : undefined
            }
            onClick={() => {
              onUpdate({ due_date: shiftDays(today, 7) });
            }}
          >
            Next week
          </button>
          <button
            type="button"
            className={!task.due_date ? "is-active" : undefined}
            onClick={() => {
              onUpdate({ due_date: null });
            }}
          >
            Clear
          </button>
        </div>
        <input
          type="date"
          className="task-meta-date"
          aria-label="Due date"
          value={task.due_date ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onUpdate({ due_date: value ? value : null });
          }}
        />
      </div>

      <div className="task-meta-section" role="group" aria-label="Priority">
        <span className="task-meta-label">Priority</span>
        <div className="task-meta-priority">
          {PRIORITY_SEGMENTS.map((segment) => {
            const active = segment.values.includes(task.priority ?? null);
            return (
              <button
                key={segment.label}
                type="button"
                className={active ? "is-active" : undefined}
                aria-pressed={active}
                onClick={() => {
                  onUpdate({ priority: segment.apply });
                }}
              >
                {segment.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
