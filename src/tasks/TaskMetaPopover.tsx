import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { parseDailyTitle } from "../notes/format";
import { shiftYmd, todayYmd } from "./due";
import { PRIORITY_SEGMENTS } from "./priority";
import { TaskStateIcon } from "./TaskStateIcon";
import type { Task, TaskPriority, TaskState } from "./types";

export type TaskMetaPatch = {
  state?: TaskState;
  due_date?: string | null;
  priority?: TaskPriority | null;
};

export type TaskMetaPopoverProps = {
  task: Pick<Task, "title" | "state" | "due_date" | "priority">;
  anchor: { x: number; y: number };
  onClose: () => void;
  onUpdate: (patch: TaskMetaPatch) => void;
};

const STATES: TaskState[] = ["open", "waiting", "done", "cancelled"];

const STATE_LABEL: Record<TaskState, string> = {
  open: "Open",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancel",
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function monthCursorFrom(ymd: string | null): string {
  if (ymd && parseDailyTitle(ymd)) {
    return ymd.slice(0, 8) + "01";
  }
  return todayYmd().slice(0, 8) + "01";
}

function monthLabel(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function daysInMonth(ymd: string): Array<string | null> {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return [];
  }
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const count = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array.from(
    { length: first.getDay() },
    () => null,
  );
  for (let day = 1; day <= count; day += 1) {
    cells.push(
      `${String(year)}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

/**
 * Task metadata popover (component sheet 1a / ENG-62):
 * state row → DUE shortcuts + month calendar → PRIORITY segments.
 */
export function TaskMetaPopover({
  task,
  anchor,
  onClose,
  onUpdate,
}: TaskMetaPopoverProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const today = todayYmd();
  const [month, setMonth] = useState(() => monthCursorFrom(task.due_date));

  useEffect(() => {
    setMonth(monthCursorFrom(task.due_date));
  }, [task.due_date]);

  useEffect(() => {
    const node = rootRef.current;
    // Skip leftover contextmenu/mousedown that opened us (WebKit/Tauri).
    const openedAt = Date.now();
    node?.querySelector<HTMLElement>("button")?.focus();

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) {
        return;
      }
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>("button"),
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !node.contains(active)) {
          event.preventDefault();
          last?.focus();
        }
      } else if (active === last || !node.contains(active)) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (Date.now() - openedAt < 100) {
        return;
      }
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

  const cells = useMemo(() => daysInMonth(month), [month]);
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 300));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 420));

  const moveMonth = (delta: number) => {
    const date = parseDailyTitle(month) ?? new Date();
    date.setMonth(date.getMonth() + delta);
    setMonth(monthCursorFrom(todayYmd(date)));
  };

  const onCalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button[role='gridcell']",
      ),
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) {
      return;
    }
    const cols = 7;
    let next = index;
    if (event.key === "ArrowLeft") {
      next = (index - 1 + buttons.length) % buttons.length;
    } else if (event.key === "ArrowRight") {
      next = (index + 1) % buttons.length;
    } else if (event.key === "ArrowUp") {
      next = index - cols;
    } else {
      next = index + cols;
    }
    if (next < 0 || next >= buttons.length) {
      return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  };

  const onGroupKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    selector: string,
  ) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(selector),
    );
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) {
      return;
    }
    event.preventDefault();
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % buttons.length
        : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="task-meta-popover"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ left, top }}
    >
      <span id={titleId} className="sr-only">
        {task.title.trim() || "Task"} metadata
      </span>

      <div
        className="task-meta-states"
        role="group"
        aria-label="State"
        onKeyDown={(event) => {
          onGroupKeyDown(event, ".task-meta-state");
        }}
      >
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
        <div
          className="task-meta-shortcuts"
          onKeyDown={(event) => {
            onGroupKeyDown(event, "button");
          }}
        >
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
              task.due_date === shiftYmd(today, 1) ? "is-active" : undefined
            }
            onClick={() => {
              onUpdate({ due_date: shiftYmd(today, 1) });
            }}
          >
            Tomorrow
          </button>
          <button
            type="button"
            className={
              task.due_date === shiftYmd(today, 7) ? "is-active" : undefined
            }
            onClick={() => {
              onUpdate({ due_date: shiftYmd(today, 7) });
            }}
          >
            Next week
          </button>
          {task.due_date ? (
            <button
              type="button"
              className="is-ghost"
              onClick={() => {
                onUpdate({ due_date: null });
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="task-meta-cal">
          <div className="task-meta-cal-head">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => {
                moveMonth(-1);
              }}
            >
              ‹
            </button>
            <span>{monthLabel(month)}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => {
                moveMonth(1);
              }}
            >
              ›
            </button>
          </div>
          <div className="task-meta-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div
            className="task-meta-cal-grid"
            role="grid"
            aria-label="Calendar"
            onKeyDown={onCalKeyDown}
          >
            {cells.map((day, index) =>
              day ? (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  className={[
                    task.due_date === day ? "is-selected" : "",
                    day === today ? "is-today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-selected={task.due_date === day}
                  onClick={() => {
                    onUpdate({ due_date: day });
                  }}
                >
                  {Number(day.slice(8))}
                </button>
              ) : (
                <span key={`pad-${String(index)}`} />
              ),
            )}
          </div>
        </div>
      </div>

      <div className="task-meta-section" role="group" aria-label="Priority">
        <span className="task-meta-label">Priority</span>
        <div
          className="task-meta-priority"
          onKeyDown={(event) => {
            onGroupKeyDown(event, "button");
          }}
        >
          {PRIORITY_SEGMENTS.map((segment) => {
            const active = segment.values.includes(task.priority ?? null);
            return (
              <button
                key={segment.label}
                type="button"
                className={`is-${segment.tone}${active ? " is-active" : ""}`}
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
