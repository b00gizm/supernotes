import type { TaskState } from "./types";

/** Circle glyphs per component sheet 1a. */
export function TaskStateIcon({ state }: { state: TaskState }) {
  if (state === "done") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="task-pill-icon">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path
          d="M4.5 8.2l2.2 2.2 4.8-5"
          fill="none"
          stroke="#fff"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "cancelled") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="task-pill-icon">
        <circle cx="8" cy="8" r="6.25" fill="currentColor" opacity="0.45" />
        <path
          d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6"
          fill="none"
          stroke="#fff"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (state === "waiting") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="task-pill-icon">
        <circle
          cx="8"
          cy="8"
          r="6.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M8 4.75V8l2 1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="task-pill-icon">
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
