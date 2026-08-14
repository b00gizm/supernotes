import type { MouseEvent as ReactMouseEvent } from "react";
import { parseDailyTitle } from "../notes/format";
import type { Note } from "../notes/types";
import { formatShortDue } from "./due";
import { isTaskOverdue } from "./query";
import { priorityDotClass } from "./priority";
import { TaskStateIcon } from "./TaskStateIcon";
import type { Task } from "./types";

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

function CalendarGlyph() {
  return (
    <svg className="tasks-schedule-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="10.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M5 2v3M11 2v3M2.5 7h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
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

function toggleLabel(state: Task["state"]): string {
  if (state === "done") {
    return "Mark task open";
  }
  if (state === "waiting") {
    return "Mark waiting task done";
  }
  if (state === "cancelled") {
    return "Mark cancelled task done";
  }
  return "Mark task done";
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

export function TaskRow({
  task,
  note,
  today,
  showDue,
  scheduleLabel,
  onToggle,
  onOpen,
  onMeta,
}: {
  task: Task;
  note: Note | undefined;
  today: string;
  showDue: boolean;
  scheduleLabel?: string | undefined;
  onToggle: () => void;
  onOpen: () => void;
  onMeta: (event: ReactMouseEvent) => void;
}) {
  const overdue = isTaskOverdue(task, today);
  const dot = priorityDotClass(task.priority);
  const terminal = task.state === "done" || task.state === "cancelled";
  const missingNote = !note;

  return (
    <div className={`tasks-row${terminal ? " is-terminal" : ""}`}>
      <button
        type="button"
        className="tasks-row-toggle"
        aria-label={toggleLabel(task.state)}
        onClick={onToggle}
      >
        <TaskStateIcon state={task.state} />
      </button>
      <button
        type="button"
        className="tasks-row-main"
        disabled={missingNote}
        onClick={onOpen}
        onContextMenu={onMeta}
      >
        <span className="tasks-row-title">
          {task.title.trim() || "Untitled task"}
        </span>
        {scheduleLabel ? (
          <span className="tasks-schedule-chip" title="Scheduled">
            <CalendarGlyph />
            {scheduleLabel}
          </span>
        ) : null}
        {showDue && task.due_date ? (
          <span className={`tasks-due-chip${overdue ? " is-overdue" : ""}`}>
            {`(Due: ${formatShortDue(task.due_date)})`}
          </span>
        ) : null}
        {dot ? (
          <span
            className={`task-priority-dot ${dot}`}
            title={priorityName(dot)}
            aria-label={priorityName(dot)}
          />
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
