import type { MouseEvent as ReactMouseEvent } from "react";
import { parseDailyTitle } from "../notes/format";
import type { Note } from "../notes/types";
import { formatShortDue } from "./due";
import { isTaskOverdue } from "./query";
import { priorityDotClass } from "./priority";
import { TaskStateIcon } from "./TaskStateIcon";
import type { Task } from "./types";

export function noteLabel(note: Note): string {
  if (note.note_type === "daily") {
    const parsed = parseDailyTitle(note.title);
    if (parsed) {
      const month = parsed.toLocaleDateString("en-US", { month: "short" });
      return `${month} ${String(parsed.getDate())}`;
    }
  }
  return note.title.trim() || "Untitled";
}

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

export function TaskRow({
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
    <div className={`tasks-row${terminal ? " is-terminal" : ""}`}>
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
            {formatShortDue(task.due_date)}
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
