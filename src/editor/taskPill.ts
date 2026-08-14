import { mergeAttributes, Node, InputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type {
  CreateTaskInput,
  Task,
  TaskPriority,
  TaskState,
  UpdateTaskInput,
} from "../tasks/types";
import { subscribeTasksChanged } from "../tasks/events";
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
  onMetaUpdate?: (
    id: string,
    patch: {
      state?: TaskState;
      due_date?: string | null;
      priority?: TaskPriority | null;
    },
  ) => void;
  /** Insert a new pending pill at `pos` (Enter-to-next-task). */
  onInsertAfter?: (pos: number) => void;
  onError?: (message: string) => void;
};

export type TaskPillOptions = {
  /** Note that owns new tasks created via `[]`. */
  getNoteId?: () => string | null;
  createTask?: (input: CreateTaskInput) => Promise<Task>;
  updateTask?: (input: UpdateTaskInput) => Promise<Task>;
  deleteTask?: (id: string) => Promise<void>;
  /** Hydrate state/title from DB after markdown load. */
  listTasksForNote?: (noteId: string) => Promise<Task[]>;
  onError?: (message: string) => void;
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

type TaskSnapshot = {
  title: string;
  state: TaskState;
  dueDate: string | null;
  priority: TaskPriority | null;
};

function snapshotFrom(node: ProseMirrorNode): TaskSnapshot {
  return {
    title: String(node.attrs.title ?? ""),
    state: parseState(String(node.attrs.state ?? "open")),
    dueDate: typeof node.attrs.dueDate === "string" ? node.attrs.dueDate : null,
    priority: parsePriority(node.attrs.priority),
  };
}

function taskPillsInDoc(doc: ProseMirrorNode): Map<string, ProseMirrorNode> {
  const pills = new Map<string, ProseMirrorNode>();
  doc.descendants((node) => {
    if (node.type.name === "taskPill") {
      const id = String(node.attrs.taskId ?? "");
      if (id) {
        pills.set(id, node);
      }
    }
  });
  return pills;
}

function reportTaskError(options: TaskPillOptions, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  options.onError?.(message.trim() || "Could not save task");
}

let pendingSeq = 0;
function nextPendingId(): string {
  pendingSeq += 1;
  return `pending-${String(pendingSeq)}`;
}

function findTaskPillPos(editor: Editor, taskId: string): number {
  let foundPos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      foundPos < 0 &&
      node.type.name === "taskPill" &&
      node.attrs.taskId === taskId
    ) {
      foundPos = pos;
    }
  });
  return foundPos;
}

/** Opening a note must not NodeSelect a leading pill (looks "active"). */
function clearLeadingTaskPillSelection(editor: Editor): void {
  if (editor.isDestroyed) {
    return;
  }
  const { selection, doc } = editor.state;
  if (
    !(selection instanceof NodeSelection) ||
    selection.node.type.name !== "taskPill"
  ) {
    return;
  }
  const next = TextSelection.near(doc.resolve(selection.to), 1);
  if (next instanceof NodeSelection) {
    return;
  }
  editor.view.dispatch(
    editor.state.tr.setSelection(next).setMeta("addToHistory", false),
  );
}

function focusTaskPillTitle(editor: Editor, pendingId: string): void {
  const focusTitle = () => {
    if (editor.isDestroyed) {
      return;
    }
    try {
      const input = editor.view.dom.querySelector(
        `.task-pill[data-autofocus="true"] .task-pill-title, [data-task-id="${CSS.escape(pendingId)}"] .task-pill-title`,
      );
      if (input instanceof HTMLInputElement) {
        editor.view.dom.blur();
        input.focus();
      }
    } catch {
      // view may be unmounted in tests
    }
  };
  for (const ms of [0, 16, 50, 100]) {
    window.setTimeout(focusTitle, ms);
  }
}

const skipDeleteByEditor = new WeakMap<Editor, Set<string>>();
// Shared across NoteEditor remounts so cut in note A can paste in note B (ENG-128).
const taskPillSnapshots = new Map<string, TaskSnapshot>();

function skipDeleteSet(editor: Editor): Set<string> {
  let set = skipDeleteByEditor.get(editor);
  if (!set) {
    set = new Set();
    skipDeleteByEditor.set(editor, set);
  }
  return set;
}

function rewriteTaskPillId(editor: Editor, oldId: string, task: Task): void {
  if (editor.isDestroyed) {
    return;
  }
  const foundPos = findTaskPillPos(editor, oldId);
  if (foundPos < 0) {
    return;
  }
  const { state, view } = editor;
  const node = state.doc.nodeAt(foundPos);
  if (!node) {
    return;
  }
  const skipDelete = skipDeleteSet(editor);
  skipDelete.add(oldId);
  try {
    const tr = state.tr.setNodeMarkup(foundPos, undefined, {
      ...node.attrs,
      taskId: task.id,
      title: task.title,
      state: task.state,
      dueDate: task.due_date,
      priority: task.priority,
    });
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
  } finally {
    skipDelete.delete(oldId);
  }
}

/** Shared pending→real id swap used by `[]` and Enter-to-next-task. */
function bindPendingTask(
  editor: Editor,
  options: TaskPillOptions,
  pendingId: string,
  noteId: string,
): void {
  if (!options.createTask) {
    return;
  }
  void options
    .createTask({ note_id: noteId, title: "" })
    .then((task) => {
      if (editor.isDestroyed) {
        return;
      }
      const foundPos = findTaskPillPos(editor, pendingId);
      if (foundPos < 0) {
        // User deleted the placeholder — drop the orphaned DB row.
        void options.deleteTask?.(task.id).catch(() => {});
        return;
      }
      rewriteTaskPillId(editor, pendingId, task);
    })
    .catch((err: unknown) => {
      reportTaskError(options, err);
      if (editor.isDestroyed) {
        return;
      }
      const foundPos = findTaskPillPos(editor, pendingId);
      if (foundPos < 0) {
        return;
      }
      const { state, view } = editor;
      const node = state.doc.nodeAt(foundPos);
      if (node) {
        view.dispatch(state.tr.delete(foundPos, foundPos + node.nodeSize));
      }
    });
}

function insertPendingTaskPill(
  editor: Editor,
  options: TaskPillOptions,
  insert: (attrs: Record<string, unknown>) => boolean,
): void {
  const noteId = options.getNoteId?.() ?? null;
  if (!noteId || !options.createTask || editor.isDestroyed) {
    return;
  }
  const pendingId = nextPendingId();
  const inserted = insert({
    taskId: pendingId,
    title: "",
    state: "open",
    dueDate: null,
    priority: null,
    autofocus: true,
  });
  if (!inserted) {
    return;
  }
  focusTaskPillTitle(editor, pendingId);
  bindPendingTask(editor, options, pendingId, noteId);
}

/**
 * When a task pill node is removed from the doc, delete the DB row.
 * Decision (ENG-61): delete, do not orphan. Undo recreates from a snapshot (ENG-124).
 */
function taskPillDeletePlugin(
  options: TaskPillOptions,
  editor: Editor,
): Plugin {
  // ponytail: in-memory snapshots until undo/paste consumes them; no recycle bin.
  return new Plugin({
    key: taskPillDeleteKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }
      if (!options.deleteTask) {
        return null;
      }
      const skipDelete = skipDeleteSet(editor);
      const before = taskPillsInDoc(oldState.doc);
      const after = taskPillsInDoc(newState.doc);
      for (const [id, node] of before) {
        if (after.has(id) || id.startsWith("pending-") || skipDelete.has(id)) {
          continue;
        }
        taskPillSnapshots.set(id, snapshotFrom(node));
        void options.deleteTask(id).catch((err: unknown) => {
          reportTaskError(options, err);
        });
      }
      for (const id of after.keys()) {
        if (before.has(id) || id.startsWith("pending-")) {
          continue;
        }
        const snap = taskPillSnapshots.get(id);
        if (!snap) {
          continue;
        }
        taskPillSnapshots.delete(id);
        const noteId = options.getNoteId?.() ?? null;
        if (!noteId || !options.createTask) {
          continue;
        }
        void options
          .createTask({
            note_id: noteId,
            title: snap.title,
            state: snap.state,
            due_date: snap.dueDate,
            priority: snap.priority,
          })
          .then((task) => {
            if (task.id !== id) {
              rewriteTaskPillId(editor, id, task);
            }
          })
          .catch((err: unknown) => {
            reportTaskError(options, err);
          });
      }
      return null;
    },
  });
}

function priorityOf(task: Task): TaskPriority | null {
  return task.priority;
}

function hydrateTaskPills(editor: Editor, options: TaskPillOptions): void {
  if (editor.isDestroyed) {
    return;
  }
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
        // Attr-only hydrate must not dirty the note body / bump updated_at (ENG-139).
        tr.setMeta("preventUpdate", true);
        tr.setMeta("addToHistory", false);
        view.dispatch(tr);
      }
    })
    .catch((err: unknown) => {
      reportTaskError(options, err);
    });
}

const unsubscribeByEditor = new WeakMap<Editor, () => void>();

function bindTasksChanged(editor: Editor, options: TaskPillOptions): void {
  unsubscribeByEditor.get(editor)?.();
  const unsubscribe = subscribeTasksChanged(() => {
    hydrateTaskPills(editor, options);
  });
  unsubscribeByEditor.set(editor, unsubscribe);
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
      // Runtime only — set on `[]` create so the title input grabs focus.
      autofocus: { default: false },
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
    const dueDate =
      typeof node.attrs.dueDate === "string" ? node.attrs.dueDate : null;
    const priority = parsePriority(node.attrs.priority);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "task-pill",
        "data-task-id": taskId,
        "data-state": state,
        "data-title": title,
        ...(dueDate ? { "data-due-date": dueDate } : {}),
        ...(priority ? { "data-priority": priority } : {}),
        class: `task-pill is-${state}`,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskPillView, {
      // Keep key events inside the title input (don't let PM steal them).
      stopEvent: ({ event }) => {
        const target = event.target;
        if (
          target instanceof HTMLInputElement &&
          target.classList.contains("task-pill-title")
        ) {
          return true;
        }
        // Keep meta / toggle clicks out of ProseMirror selection churn.
        return (
          target instanceof HTMLElement &&
          Boolean(
            target.closest(
              ".task-pill-meta, .task-pill-toggle, .task-due-chip",
            ),
          )
        );
      },
    });
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
          insertPendingTaskPill(editor, options, (attrs) =>
            chain()
              .deleteRange(range)
              .insertContent({ type: this.name, attrs })
              .run(),
          );
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    // Wire sync here — TipTap defers onCreate until after mount (setTimeout 0).
    // Mutate editor.storage (snapshot), not this.options (fresh each access).
    wireTaskPillHandlers(this.options, this.editor);
    bindTasksChanged(this.editor, this.options);
    return [taskPillDeletePlugin(this.options, this.editor)];
  },

  onCreate() {
    clearLeadingTaskPillSelection(this.editor);
    hydrateTaskPills(this.editor, this.options);
  },

  onDestroy() {
    unsubscribeByEditor.get(this.editor)?.();
    unsubscribeByEditor.delete(this.editor);
  },
});

function wireTaskPillHandlers(options: TaskPillOptions, editor: Editor): void {
  const bag = taskPillHandlers(editor);
  if (options.onError) {
    bag.onError = options.onError;
  }
  bag.onInsertAfter = (pos) => {
    insertPendingTaskPill(editor, options, (attrs) =>
      editor.chain().insertContentAt(pos, { type: "taskPill", attrs }).run(),
    );
  };
  bag.onSetState = (id, state) => {
    if (!findTaskNode(editor, id) || !options.updateTask) {
      return;
    }
    void options.updateTask({ id, state }).catch((err: unknown) => {
      reportTaskError(options, err);
    });
  };
  bag.onTitleCommit = (id, title) => {
    if (!findTaskNode(editor, id) || !options.updateTask) {
      return;
    }
    void options.updateTask({ id, title }).catch((err: unknown) => {
      reportTaskError(options, err);
    });
  };
  bag.onMetaUpdate = (id, patch) => {
    if (!findTaskNode(editor, id) || !options.updateTask) {
      return;
    }
    void options.updateTask({ id, ...patch }).catch((err: unknown) => {
      reportTaskError(options, err);
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
