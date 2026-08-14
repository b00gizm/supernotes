import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { dueChip } from "../tasks/due";
import { PRIORITY_SEGMENTS, priorityDotClass } from "../tasks/priority";
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
 * Borderless task pill (component sheet 1a): circle + title + due/priority.
 * Clicking the circle resolves to Done; right-click / ··· opens metadata.
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
  const blurTimer = useRef<number | null>(null);
  const handlers = taskPillHandlers(editor);
  const terminal = state === "done" || state === "cancelled";
  const chip = dueChip(dueDate, undefined, { terminal });
  const dot = priorityDotClass(priority);
  const priorityLabel = PRIORITY_SEGMENTS.find((segment) =>
    segment.values.includes(priority),
  );
  const priorityName =
    priorityLabel && priorityLabel.tone !== "none"
      ? `Priority ${priorityLabel.label}`
      : null;

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

  useEffect(() => {
    return () => {
      if (blurTimer.current !== null) {
        window.clearTimeout(blurTimer.current);
      }
    };
  }, []);

  const clearAutofocus = () => {
    if (wantsFocus) {
      updateAttributes({ autofocus: false });
    }
  };

  const deleteThisPill = () => {
    if (editor.isDestroyed) {
      return;
    }
    let pos: number | undefined;
    try {
      pos = typeof getPos === "function" ? getPos() : undefined;
    } catch {
      return;
    }
    if (typeof pos !== "number") {
      return;
    }
    const current = editor.state.doc.nodeAt(pos);
    if (!current || current.type.name !== "taskPill") {
      return;
    }
    editor
      .chain()
      .deleteRange({ from: pos, to: pos + current.nodeSize })
      .focus()
      .run();
  };

  const commitTitle = (next: string) => {
    let trimmed = next.replace(/\s+/g, " ").trimStart();
    if (trimmed.includes("[[")) {
      trimmed = trimmed
        .replace(/\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g, "$1")
        .replace(/\[\[|\]\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!trimmed) {
        setDraft(title);
        return;
      }
    }
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

  const openMeta = (x: number, y: number) => {
    if (!taskId || taskId.startsWith("pending-")) {
      return;
    }
    setMetaAnchor({ x, y });
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
      data-due-date={dueDate || undefined}
      data-priority={priority || undefined}
      data-autofocus={wantsFocus ? "true" : undefined}
      data-drag-handle
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        openMeta(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        className="task-pill-toggle"
        aria-label={
          state === "done"
            ? "Mark task open (done)"
            : `Mark task done (${state})`
        }
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
        onFocus={() => {
          if (blurTimer.current !== null) {
            window.clearTimeout(blurTimer.current);
            blurTimer.current = null;
          }
        }}
        onBlur={() => {
          const empty = draft.trim() === "";
          // Autofocus reclaim (TipTap steals focus after `[]`) must not cancel.
          const delay = wantsFocus ? 150 : 0;
          if (blurTimer.current !== null) {
            window.clearTimeout(blurTimer.current);
          }
          blurTimer.current = window.setTimeout(() => {
            blurTimer.current = null;
            if (editor.isDestroyed) {
              return;
            }
            if (inputRef.current === document.activeElement) {
              return;
            }
            if (empty) {
              deleteThisPill();
              return;
            }
            commitTitle(draft);
          }, delay);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) {
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
              return;
            }
            if (draft.trim() === "") {
              deleteThisPill();
              return;
            }
            commitTitle(draft);
            const pos = typeof getPos === "function" ? getPos() : null;
            if (typeof pos === "number") {
              handlers.onInsertAfter?.(pos + node.nodeSize);
            }
          } else if (
            (event.key === "Backspace" || event.key === "Delete") &&
            draft.trim() === ""
          ) {
            event.preventDefault();
            deleteThisPill();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(title);
            inputRef.current?.blur();
          }
        }}
      />
      {chip ? (
        <span
          className={`task-due-chip is-${chip.tone}`}
          contentEditable={false}
        >
          {chip.label}
        </span>
      ) : null}
      {dot && priorityName ? (
        <span
          className={`task-priority-dot ${dot}`}
          title={priorityName}
          aria-label={priorityName}
          role="img"
          contentEditable={false}
        />
      ) : null}
      <button
        type="button"
        className="task-pill-meta"
        aria-label="Edit task metadata"
        contentEditable={false}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openMeta(rect.left, rect.bottom + 4);
        }}
      >
        ···
      </button>
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
