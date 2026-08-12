import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import type { TaskState } from "../tasks/types";
import { taskPillHandlers } from "./taskPill";

function parseState(value: unknown): TaskState {
  if (value === "waiting" || value === "done" || value === "cancelled") {
    return value;
  }
  return "open";
}

/** Circle glyphs per component sheet 1a. */
function StateIcon({ state }: { state: TaskState }) {
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

/**
 * Borderless task pill (component sheet 1a): circle + editable title.
 * Clicking the circle resolves to Done (click again reopens).
 */
export function TaskPillView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const state = parseState(node.attrs.state);
  const title = String(node.attrs.title ?? "");
  const taskId = String(node.attrs.taskId ?? "");
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const handlers = taskPillHandlers(editor);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  const commitTitle = (next: string) => {
    const trimmed = next.replace(/\s+/g, " ").trimStart();
    if (trimmed === title) {
      setDraft(title);
      return;
    }
    updateAttributes({ title: trimmed });
    if (taskId) {
      handlers.onTitleCommit?.(taskId, trimmed);
    }
  };

  const toggleDone = () => {
    if (!taskId) {
      return;
    }
    const next: TaskState = state === "done" ? "open" : "done";
    updateAttributes({ state: next });
    handlers.onSetState?.(taskId, next);
  };

  return (
    <NodeViewWrapper
      as="div"
      className={`task-pill is-${state}${selected ? " is-selected" : ""}`}
      data-type="task-pill"
      data-task-id={taskId || undefined}
      data-state={state}
      data-drag-handle
    >
      <button
        type="button"
        className="task-pill-toggle"
        aria-label={state === "done" ? "Mark task open" : "Mark task done"}
        contentEditable={false}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleDone();
        }}
      >
        <StateIcon state={state} />
      </button>
      <input
        ref={inputRef}
        className="task-pill-title"
        value={draft}
        aria-label="Task title"
        placeholder="Task"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          commitTitle(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitTitle(draft);
            const pos = typeof getPos === "function" ? getPos() : null;
            if (typeof pos === "number") {
              editor
                .chain()
                .focus()
                .setTextSelection(pos + node.nodeSize)
                .createParagraphNear()
                .run();
            }
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(title);
            inputRef.current?.blur();
          }
        }}
      />
    </NodeViewWrapper>
  );
}
