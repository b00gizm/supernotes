import { Editor } from "@tiptap/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryTasksApi } from "../tasks/memoryApi";
import { tasksApi as browserTasksApi } from "../tasks/api";
import type { Task } from "../tasks/types";
import { NoteEditor } from "./NoteEditor";
import { noteEditorExtensions } from "./extensions";
import { getEditorMarkdown } from "./markdown";
import { taskPillHandlers } from "./taskPill";

function typeText(editor: Editor, text: string) {
  for (const char of text) {
    const pos = editor.state.selection.from;
    const handled = editor.view.someProp("handleTextInput", (f) => {
      return (
        f as (
          view: typeof editor.view,
          from: number,
          to: number,
          text: string,
        ) => boolean | undefined
      )(editor.view, pos, pos, char);
    });
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(char, pos));
    }
  }
}

describe("task pill (ENG-61)", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    const el = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (el instanceof HTMLElement) el.remove();
  });

  function create(opts?: {
    noteId?: string;
    tasks?: ReturnType<typeof createMemoryTasksApi>;
    seed?: Task[];
    content?: string;
  }) {
    const tasksApi = opts?.tasks ?? createMemoryTasksApi(opts?.seed ?? []);
    const noteId = opts?.noteId ?? "note-1";
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: noteEditorExtensions(
        {},
        {
          getNoteId: () => noteId,
          createTask: (input) => tasksApi.createTask(input),
          updateTask: (input) => tasksApi.updateTask(input),
          deleteTask: (id) => tasksApi.deleteTask(id),
          listTasksForNote: (id) => tasksApi.listTasksForNote(id),
        },
      ),
      content: opts?.content ?? "",
    });
    editor.commands.focus("end");
    return { editor, tasksApi };
  }

  it("types [] at line start into a task pill + DB row", async () => {
    const { editor: ed, tasksApi } = create();
    typeText(ed, "[] ");
    // Wait for async createTask to replace pending id.
    await vi.waitFor(async () => {
      const listed = await tasksApi.listTasksForNote("note-1");
      expect(listed.length).toBe(1);
      const md = getEditorMarkdown(ed);
      expect(md).toMatch(/^\[\[task:task-\d+\]\]$/m);
      expect(md).not.toContain("pending-");
    });
    expect(ed.getHTML()).toContain('data-type="task-pill"');
    expect(ed.isActive("taskItem")).toBe(false);
  });

  it("focuses the title input after typing []", async () => {
    const user = userEvent.setup();
    render(
      createElement(NoteEditor, {
        markdown: "",
        onChange: () => {},
        currentNoteId: "note-focus",
      }),
    );
    const textbox = await screen.findByRole("textbox", { name: "Note body" });
    await user.click(textbox);
    // user-event: `[[` → literal `[`, then `]` and space → `[] `.
    await user.keyboard("[[] ");
    await waitFor(() => {
      const input = textbox.querySelector(".task-pill-title");
      expect(input).toBeInstanceOf(HTMLInputElement);
      expect(document.activeElement).toBe(input);
    });
  });

  it("parses and serializes [[task:id]] Title", () => {
    const { editor: ed } = create();
    const input = "[[task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]] Buy milk";
    ed.commands.setContent(input);
    expect(ed.getHTML()).toContain('data-type="task-pill"');
    expect(ed.getHTML()).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(getEditorMarkdown(ed)).toBe(
      "[[task:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]] Buy milk",
    );
  });

  it("click-to-done updates DB state via storage callback", async () => {
    const seed: Task[] = [
      {
        id: "t-done",
        note_id: "note-1",
        title: "Ship it",
        state: "open",
        due_date: null,
        priority: null,
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    const { editor: ed, tasksApi } = create({ seed });
    ed.commands.setContent("[[task:t-done]] Ship it");
    expect(ed.getHTML()).toContain("t-done");

    const setState = taskPillHandlers(ed).onSetState;
    expect(setState).toBeTypeOf("function");
    if (!setState) {
      return;
    }

    let pos = -1;
    ed.state.doc.descendants((node, nodePos) => {
      if (node.type.name === "taskPill" && node.attrs.taskId === "t-done") {
        pos = nodePos;
      }
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    const node = ed.state.doc.nodeAt(pos);
    expect(node).toBeTruthy();
    if (!node) {
      return;
    }
    ed.view.dispatch(
      ed.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        state: "done",
      }),
    );
    setState("t-done", "done");

    await vi.waitFor(async () => {
      const task = await tasksApi.getTask("t-done");
      expect(task.state).toBe("done");
      expect(task.completed_at).toBeTruthy();
    });
  });

  it("deleting the pill deletes the DB row", async () => {
    const seed: Task[] = [
      {
        id: "t-del",
        note_id: "note-1",
        title: "Remove me",
        state: "open",
        due_date: null,
        priority: null,
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    const { editor: ed, tasksApi } = create({ seed });
    ed.commands.setContent("[[task:t-del]] Remove me\n");
    await vi.waitFor(() => {
      expect(ed.getHTML()).toContain("t-del");
    });

    ed.commands.selectAll();
    ed.commands.deleteSelection();

    await vi.waitFor(async () => {
      const listed = await tasksApi.listTasksForNote("note-1");
      expect(listed).toHaveLength(0);
    });
  });

  it("metadata popover updates persist state/due/priority", async () => {
    const seed: Task[] = [
      {
        id: "t-meta",
        note_id: "note-1",
        title: "Ship onboarding fix",
        state: "open",
        due_date: null,
        priority: null,
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    const { editor: ed, tasksApi } = create({ seed });
    ed.commands.setContent("[[task:t-meta]] Ship onboarding fix");

    let pos = -1;
    ed.state.doc.descendants((node, nodePos) => {
      if (node.type.name === "taskPill" && node.attrs.taskId === "t-meta") {
        pos = nodePos;
      }
    });
    const node = ed.state.doc.nodeAt(pos);
    expect(node).toBeTruthy();
    if (!node) {
      return;
    }

    ed.view.dispatch(
      ed.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        state: "waiting",
        dueDate: "2026-08-12",
        priority: "high",
      }),
    );

    const onMeta = taskPillHandlers(ed).onMetaUpdate;
    expect(onMeta).toBeTypeOf("function");
    onMeta?.("t-meta", {
      state: "waiting",
      due_date: "2026-08-12",
      priority: "high",
    });

    await vi.waitFor(async () => {
      const task = await tasksApi.getTask("t-meta");
      expect(task.state).toBe("waiting");
      expect(task.due_date).toBe("2026-08-12");
      expect(task.priority).toBe("high");
    });

    onMeta?.("t-meta", { due_date: null, priority: null });
    await vi.waitFor(async () => {
      const task = await tasksApi.getTask("t-meta");
      expect(task.due_date).toBeNull();
      expect(task.priority).toBeNull();
    });
  });

  it("shows an alert when createTask fails (ENG-119)", async () => {
    const spy = vi
      .spyOn(browserTasksApi, "createTask")
      .mockRejectedValue(new Error("disk full"));
    const user = userEvent.setup();
    try {
      render(
        createElement(NoteEditor, {
          markdown: "",
          onChange: () => {},
          currentNoteId: "note-err",
        }),
      );
      const textbox = await screen.findByRole("textbox", { name: "Note body" });
      await user.click(textbox);
      await user.keyboard("[[] ");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("disk full");
    } finally {
      spy.mockRestore();
    }
  });

  it("Enter after a titled pill creates the next task (ENG-123)", async () => {
    const user = userEvent.setup();
    render(
      createElement(NoteEditor, {
        markdown: "",
        onChange: () => {},
        currentNoteId: "note-enter",
      }),
    );
    const textbox = await screen.findByRole("textbox", { name: "Note body" });
    await user.click(textbox);
    await user.keyboard("[[] ");
    await waitFor(() => {
      const input = textbox.querySelector(".task-pill-title");
      expect(input).toBeInstanceOf(HTMLInputElement);
      expect(document.activeElement).toBe(input);
    });
    await user.keyboard("One{Enter}");
    await waitFor(() => {
      const pills = textbox.querySelectorAll(".task-pill");
      expect(pills).toHaveLength(2);
      const titles = textbox.querySelectorAll(".task-pill-title");
      expect(titles).toHaveLength(2);
      expect(document.activeElement).toBe(titles[1]);
    });
  });

  it("undo after deleting a pill restores a DB row (ENG-124)", async () => {
    const seed: Task[] = [
      {
        id: "t-undo",
        note_id: "note-1",
        title: "Bring back",
        state: "waiting",
        due_date: "2026-08-20",
        priority: "high",
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    // Seed as initial content so delete is its own history step (setContent
    // + delete otherwise collapse into one undo group).
    const { editor: ed, tasksApi: api } = create({
      seed,
      content: "[[task:t-undo]] Bring back",
    });
    expect(ed.getHTML()).toContain("t-undo");

    ed.commands.selectAll();
    ed.commands.deleteSelection();
    await vi.waitFor(async () => {
      const listed = await api.listTasksForNote("note-1");
      expect(listed).toHaveLength(0);
    });

    expect(ed.commands.undo()).toBe(true);
    expect(ed.getHTML()).toContain("task-pill");
    await vi.waitFor(async () => {
      const listed = await api.listTasksForNote("note-1");
      expect(listed.length).toBeGreaterThanOrEqual(1);
      expect(listed.some((task) => task.title === "Bring back")).toBe(true);
    });
  });

  it("blurring an empty title deletes the pill", async () => {
    const user = userEvent.setup();
    render(
      createElement(NoteEditor, {
        markdown: "",
        onChange: () => {},
        currentNoteId: "note-empty",
      }),
    );
    const textbox = await screen.findByRole("textbox", { name: "Note body" });
    await user.click(textbox);
    await user.keyboard("[[] ");
    const input = await waitFor(() => {
      const el = textbox.querySelector(".task-pill-title");
      expect(el).toBeInstanceOf(HTMLInputElement);
      expect(document.activeElement).toBe(el);
      return el as HTMLInputElement;
    });
    await user.type(input, "x");
    await user.clear(input);
    input.blur();
    await waitFor(() => {
      expect(textbox.querySelector(".task-pill")).toBeNull();
    });
  });

  it("Backspace on an empty title deletes the pill", async () => {
    const user = userEvent.setup();
    render(
      createElement(NoteEditor, {
        markdown: "",
        onChange: () => {},
        currentNoteId: "note-backspace",
      }),
    );
    const textbox = await screen.findByRole("textbox", { name: "Note body" });
    await user.click(textbox);
    await user.keyboard("[[] ");
    const input = await waitFor(() => {
      const el = textbox.querySelector(".task-pill-title");
      expect(el).toBeInstanceOf(HTMLInputElement);
      expect(document.activeElement).toBe(el);
      return el as HTMLInputElement;
    });
    await user.type(input, "x");
    await user.clear(input);
    expect(document.activeElement).toBe(input);
    await user.keyboard("{Backspace}");
    await waitFor(() => {
      expect(textbox.querySelector(".task-pill")).toBeNull();
    });
  });

  it("does not select a leading task pill when the note opens", async () => {
    render(
      createElement(NoteEditor, {
        markdown: "[[task:t-lead]] First task\n\nBody",
        onChange: () => {},
        currentNoteId: "note-lead",
      }),
    );
    const textbox = await screen.findByRole("textbox", { name: "Note body" });
    await waitFor(() => {
      const el = textbox.querySelector(".task-pill");
      expect(el).toBeInstanceOf(HTMLElement);
      expect(el).not.toHaveClass("is-selected");
    });
  });
});
