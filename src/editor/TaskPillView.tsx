import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { TaskMetaPopover } from "../tasks/TaskMetaPopover";
import { TaskStateIcon } from "../tasks/TaskStateIcon";
import type { Task, TaskPriority, TaskState } from "../tasks/types";
import { taskPillHandlers } from "./taskPill";

function parseState(value: unknown): TaskState {
  if (value === "waiting" || value === "done" || value === "cancelled") {
    return value;
  }
  return "open";
}

function parsePriority(value: unknown): TaskPriority | null {
  if (
    value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "urgent"
  ) {
    return value;
  }
  return null;
}

/**
 * Borderless task pill (component sheet 1a): circle + editable title.
 * Clicking the circle resolves to Done (click again reopens).
 * Right-click / ··· opens the shared metadata popover (ENG-62/63).
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
  const dueDate =
    typeof node.attrs.dueDate === "string" ? node.attrs.dueDate : null;
  const priority = parsePriority(node.attrs.priority);
  const wantsFocus = Boolean(node.attrs.autofocus);
  const [draft, setDraft] = useState(title);
  const [metaAnchor, setMetaAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const handlers = taskPillHandlers(editor);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  // `[]` create sets autofocus; keep claiming focus across TipTap's post-rule
  // editor focus and the pending→real id attr swap. Don't clear autofocus here
  // via updateAttributes — that transaction refocuses the editor.
  useEffect(() => {
    if (!wantsFocus) {
      return;
    }
    const focus = () => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      try {
        editor.view.dom.blur();
      } catch {
        // ignore
      }
      input.focus();
    };
    focus();
    const timers = [0, 16, 50, 100].map((ms) => window.setTimeout(focus, ms));
    return () => {
      for (const id of timers) {
        window.clearTimeout(id);
      }
    };
  }, [wantsFocus, taskId, editor]);

  const clearAutofocus = () => {
    if (wantsFocus) {
      updateAttributes({ autofocus: false });
    }
  };

  const commitTitle = (next: string) => {
    const trimmed = next.replace(/\s+/g, " ").trimStart();
    if (trimmed === title) {
      setDraft(title);
      return;
    }
    updateAttributes({ title: trimmed, autofocus: false });
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

  const metaTask: Task = {
    id: taskId,
    note_id: "",
    title,
    state,
    due_date: dueDate,
    priority,
    created_at: "",
    updated_at: "",
    completed_at: null,
  };

  return (
    <NodeViewWrapper
      as="div"
      className={`task-pill is-${state}${selected ? " is-selected" : ""}`}
      data-type="task-pill"
      data-task-id={taskId || undefined}
      data-state={state}
      data-autofocus={wantsFocus ? "true" : undefined}
      data-drag-handle
      onContextMenu={(event: MouseEvent) => {
        if (!taskId || taskId.startsWith("pending-")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setMetaAnchor({ x: event.clientX, y: event.clientY });
      }}
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
        <TaskStateIcon state={state} />
      </button>
      <input
        ref={inputRef}
        className="task-pill-title"
        value={draft}
        aria-label="Task title"
        placeholder="Task"
        onChange={(event) => {
          clearAutofocus();
          setDraft(event.target.value);
        }}
        onBlur={() => {
          clearAutofocus();
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
      {metaAnchor
        ? createPortal(
            <TaskMetaPopover
              task={metaTask}
              anchor={metaAnchor}
              onClose={() => {
                setMetaAnchor(null);
              }}
              onUpdate={(patch) => {
                updateAttributes({
                  state: patch.state ?? state,
                  dueDate:
                    patch.due_date === undefined ? dueDate : patch.due_date,
                  priority:
                    patch.priority === undefined ? priority : patch.priority,
                });
                handlers.onMetaUpdate?.(taskId, patch);
              }}
            />,
            document.body,
          )
        : null}
    </NodeViewWrapper>
  );
}
