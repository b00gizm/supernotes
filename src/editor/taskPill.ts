import { mergeAttributes, Node, InputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Task, TaskPriority, TaskState } from "../tasks/types";
import { TaskPillView } from "./TaskPillView";

/** Minimal surface used by tiptap-markdown node serializers. */
type MarkdownWriteState = {
  write: (text: string) => void;
  closeBlock: (node: ProseMirrorNode) => void;
};

type MarkdownItLike = {
  block: {
    ruler: {
      before: (
        prev: string,
        name: string,
        rule: (
          state: BlockState,
          startLine: number,
          endLine: number,
          silent: boolean,
        ) => boolean,
      ) => void;
    };
  };
  renderer: {
    rules: Record<
      string,
      (
        tokens: Array<{
          content: string;
          attrs?: Array<[string, string]>;
        }>,
        idx: number,
      ) => string
    >;
  };
};

type BlockState = {
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  sCount: number[];
  blkIndent: number;
  line: number;
  lineMax: number;
  parentType: string;
  level: number;
  src: string;
  push: (
    type: string,
    tag: string,
    nesting: number,
  ) => {
    content: string;
    attrs: Array<[string, string]> | null;
    map: [number, number] | null;
  };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseState(value: string | null | undefined): TaskState {
  if (value === "waiting" || value === "done" || value === "cancelled") {
    return value;
  }
  return "open";
}

/** `[[task:<id>]] optional title` — id has no `]` / whitespace. */
const TASK_PILL_LINE = /^\[\[task:([^\]\s]+)\]\](?:[ \t]+(.*))?$/i;

/**
 * markdown-it block: a line `[[task:id]] Title` → HTML task-pill div.
 * Runs before paragraph so wiki-link inline never claims the token.
 */
function markdownItTaskPill(md: MarkdownItLike): void {
  md.block.ruler.before(
    "paragraph",
    "task_pill",
    (state, startLine, _endLine, silent) => {
      const shift = state.sCount[startLine] ?? 0;
      if (shift - state.blkIndent >= 4) {
        return false;
      }
      const start =
        (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
      const max = state.eMarks[startLine] ?? start;
      const line = state.src.slice(start, max).trimEnd();
      const match = TASK_PILL_LINE.exec(line);
      if (!match) {
        return false;
      }
      if (silent) {
        return true;
      }
      const taskId = match[1] ?? "";
      const title = (match[2] ?? "").trimEnd();
      const token = state.push("task_pill", "div", 0);
      token.content = title;
      token.map = [startLine, startLine + 1];
      token.attrs = [
        ["data-type", "task-pill"],
        ["data-task-id", taskId],
        ["data-state", "open"],
        ["data-title", title],
        ["class", "task-pill is-open"],
      ];
      state.line = startLine + 1;
      return true;
    },
  );

  md.renderer.rules.task_pill = (tokens, idx) => {
    const token = tokens[idx];
    const title = token?.content ?? "";
    const taskId =
      token?.attrs?.find((attr) => attr[0] === "data-task-id")?.[1] ?? "";
    return `<div data-type="task-pill" data-task-id="${escapeHtml(taskId)}" data-state="open" data-title="${escapeHtml(title)}" class="task-pill is-open"></div>`;
  };
}

export type TaskPillHandlers = {
  onSetState?: (id: string, state: TaskState) => void;
  onTitleCommit?: (id: string, title: string) => void;
};

export type TaskPillOptions = {
  /** Note that owns new tasks created via `[]`. */
  getNoteId?: () => string | null;
  createTask?: (input: { note_id: string; title: string }) => Promise<Task>;
  updateTask?: (input: {
    id: string;
    title: string;
    state: TaskState;
    due_date: string | null;
    priority: TaskPriority | null;
  }) => Promise<Task>;
  deleteTask?: (id: string) => Promise<void>;
  /** Hydrate state/title from DB after markdown load. */
  listTasksForNote?: (noteId: string) => Promise<Task[]>;
};

/**
 * Runtime callbacks live on `editor.storage.taskPill` (snapshotted once).
 * TipTap's `extension.options` getter returns a fresh object every access, so
 * mutating `options.handlers` does not stick.
 */
export function taskPillHandlers(editor: Editor): TaskPillHandlers {
  return (editor.storage as { taskPill?: TaskPillHandlers }).taskPill ?? {};
}

/** Bare `[]` + space at line start → first-class task pill (ENG-61). */
const taskPillInputRegex = /^\[\]\s$/;

const taskPillDeleteKey = new PluginKey("taskPillDelete");

function taskIdsInDoc(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "taskPill") {
      const id = String(node.attrs.taskId ?? "");
      if (id) {
        ids.add(id);
      }
    }
  });
  return ids;
}

/**
 * When a task pill node is removed from the doc, delete the DB row.
 * Decision (ENG-61): delete, do not orphan.
 */
function taskPillDeletePlugin(options: TaskPillOptions): Plugin {
  return new Plugin({
    key: taskPillDeleteKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      if (!options.deleteTask) {
        return null;
      }
      const before = taskIdsInDoc(oldState.doc);
      const after = taskIdsInDoc(newState.doc);
      for (const id of before) {
        if (after.has(id) || id.startsWith("pending-")) {
          continue;
        }
        void options.deleteTask(id).catch((err: unknown) => {
          console.error("Failed to delete task", id, err);
        });
      }
      return null;
    },
  });
}

function priorityOf(task: Task): TaskPriority | null {
  return task.priority;
}

export const TaskPill = Node.create<TaskPillOptions>({
  name: "taskPill",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {};
  },

  addAttributes() {
    return {
      taskId: { default: "" },
      title: { default: "" },
      state: { default: "open" },
      dueDate: { default: null },
      priority: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="task-pill"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) {
            return false;
          }
          const taskId = el.getAttribute("data-task-id")?.trim() ?? "";
          if (!taskId) {
            return false;
          }
          const title =
            el.getAttribute("data-title")?.trim() ||
            el.textContent?.trim() ||
            "";
          return {
            taskId,
            title,
            state: parseState(el.getAttribute("data-state")),
            dueDate: el.getAttribute("data-due-date"),
            priority: el.getAttribute("data-priority"),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const taskId = String(node.attrs.taskId ?? "");
    const title = String(node.attrs.title ?? "");
    const state = parseState(String(node.attrs.state ?? "open"));
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "task-pill",
        "data-task-id": taskId,
        "data-state": state,
        "data-title": title,
        class: `task-pill is-${state}`,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskPillView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: ProseMirrorNode) {
          const taskId = String(node.attrs.taskId ?? "");
          const title = String(node.attrs.title ?? "");
          state.write(
            title ? `[[task:${taskId}]] ${title}` : `[[task:${taskId}]]`,
          );
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownItLike) {
            markdownItTaskPill(md);
          },
        },
      },
    };
  },

  addInputRules() {
    const options = this.options;
    return [
      new InputRule({
        find: taskPillInputRegex,
        handler: ({ range, chain }) => {
          const editor = this.editor;
          // Lists keep square checkboxes (`- []`); bare `[]` is a task pill.
          if (
            editor.isActive("listItem") ||
            editor.isActive("taskItem") ||
            editor.isActive("bulletList") ||
            editor.isActive("orderedList") ||
            editor.isActive("taskList")
          ) {
            return;
          }
          const noteId = options.getNoteId?.() ?? null;
          if (!noteId || !options.createTask) {
            return;
          }
          // Placeholder id until the DB row returns — replaced in place.
          const pendingId = `pending-${String(Date.now())}`;
          chain()
            .deleteRange(range)
            .insertContent({
              type: this.name,
              attrs: {
                taskId: pendingId,
                title: "",
                state: "open",
                dueDate: null,
                priority: null,
              },
            })
            .run();

          void options
            .createTask({ note_id: noteId, title: "" })
            .then((task) => {
              if (editor.isDestroyed) {
                return;
              }
              const { state, view } = editor;
              let foundPos = -1;
              state.doc.descendants((node, pos) => {
                if (
                  foundPos < 0 &&
                  node.type.name === "taskPill" &&
                  node.attrs.taskId === pendingId
                ) {
                  foundPos = pos;
                }
              });
              if (foundPos < 0) {
                // User deleted the placeholder — drop the orphaned DB row.
                void options.deleteTask?.(task.id).catch(() => {});
                return;
              }
              const node = state.doc.nodeAt(foundPos);
              if (!node) {
                return;
              }
              view.dispatch(
                state.tr.setNodeMarkup(foundPos, undefined, {
                  ...node.attrs,
                  taskId: task.id,
                  title: task.title,
                  state: task.state,
                  dueDate: task.due_date,
                  priority: task.priority,
                }),
              );
            })
            .catch((err: unknown) => {
              console.error("Failed to create task", err);
              if (editor.isDestroyed) {
                return;
              }
              // Remove the placeholder so the UI doesn't keep a dead pill.
              const { state, view } = editor;
              let foundPos = -1;
              state.doc.descendants((node, pos) => {
                if (
                  foundPos < 0 &&
                  node.type.name === "taskPill" &&
                  node.attrs.taskId === pendingId
                ) {
                  foundPos = pos;
                }
              });
              if (foundPos >= 0) {
                const node = state.doc.nodeAt(foundPos);
                if (node) {
                  view.dispatch(
                    state.tr.delete(foundPos, foundPos + node.nodeSize),
                  );
                }
              }
            });
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    // Wire sync here — TipTap defers onCreate until after mount (setTimeout 0).
    // Mutate editor.storage (snapshot), not this.options (fresh each access).
    wireTaskPillHandlers(this.options, this.editor);
    return [taskPillDeletePlugin(this.options)];
  },

  onCreate() {
    const options = this.options;
    const editor = this.editor;
    const noteId = options.getNoteId?.() ?? null;
    if (!noteId || !options.listTasksForNote) {
      return;
    }
    void options
      .listTasksForNote(noteId)
      .then((tasks) => {
        if (editor.isDestroyed) {
          return;
        }
        const byId = new Map(tasks.map((task) => [task.id, task]));
        const { state, view } = editor;
        let tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "taskPill") {
            return;
          }
          const id = String(node.attrs.taskId ?? "");
          const task = byId.get(id);
          if (!task) {
            return;
          }
          const next = {
            ...node.attrs,
            title: task.title,
            state: task.state,
            dueDate: task.due_date,
            priority: priorityOf(task),
          };
          if (
            next.title !== node.attrs.title ||
            next.state !== node.attrs.state ||
            next.dueDate !== node.attrs.dueDate ||
            next.priority !== node.attrs.priority
          ) {
            tr = tr.setNodeMarkup(pos, undefined, next);
          }
        });
        if (tr.docChanged) {
          view.dispatch(tr);
        }
      })
      .catch((err: unknown) => {
        console.error("Failed to hydrate tasks", err);
      });
  },
});

function wireTaskPillHandlers(options: TaskPillOptions, editor: Editor): void {
  const bag = taskPillHandlers(editor);
  bag.onSetState = (id, state) => {
    const node = findTaskNode(editor, id);
    if (!node || !options.updateTask) {
      return;
    }
    const dueDate =
      typeof node.attrs.dueDate === "string" ? node.attrs.dueDate : null;
    const priority = parsePriority(node.attrs.priority);
    void options
      .updateTask({
        id,
        title: String(node.attrs.title ?? ""),
        state,
        due_date: dueDate,
        priority,
      })
      .catch((err: unknown) => {
        console.error("Failed to update task state", err);
      });
  };
  bag.onTitleCommit = (id, title) => {
    const node = findTaskNode(editor, id);
    if (!node || !options.updateTask) {
      return;
    }
    const dueDate =
      typeof node.attrs.dueDate === "string" ? node.attrs.dueDate : null;
    const priority = parsePriority(node.attrs.priority);
    void options
      .updateTask({
        id,
        title,
        state: parseState(String(node.attrs.state ?? "open")),
        due_date: dueDate,
        priority,
      })
      .catch((err: unknown) => {
        console.error("Failed to update task title", err);
      });
  };
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

function findTaskNode(editor: Editor, taskId: string): ProseMirrorNode | null {
  let found: ProseMirrorNode | null = null;
  editor.state.doc.descendants((node) => {
    if (
      !found &&
      node.type.name === "taskPill" &&
      node.attrs.taskId === taskId
    ) {
      found = node;
    }
  });
  return found;
}
