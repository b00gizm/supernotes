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

  it("recreates a task when a pill is cut from one editor and pasted in another (ENG-128)", async () => {
    const seed: Task[] = [
      {
        id: "t-cut",
        note_id: "note-a",
        title: "Buy milk",
        state: "open",
        due_date: "2026-08-21",
        priority: "high",
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    const source = create({
      noteId: "note-a",
      seed,
      content: "[[task:t-cut]] Buy milk",
    });
    expect(source.editor.getHTML()).toContain("t-cut");
    await vi.waitFor(() => {
      let due: unknown;
      source.editor.state.doc.descendants((node) => {
        if (node.type.name === "taskPill") {
          due = node.attrs.dueDate;
        }
      });
      expect(due).toBe("2026-08-21");
    });

    source.editor.commands.selectAll();
    source.editor.commands.deleteSelection();
    await vi.waitFor(async () => {
      const listed = await source.tasksApi.listTasksForNote("note-a");
      expect(listed).toHaveLength(0);
    });

    const sourceEl = source.editor.options.element;
    source.editor.destroy();
    if (sourceEl instanceof HTMLElement) {
      sourceEl.remove();
    }

    const dest = create({
      noteId: "note-b",
      tasks: source.tasksApi,
      content: "",
    });
    dest.editor.commands.insertContent({
      type: "taskPill",
      attrs: {
        taskId: "t-cut",
        title: "Buy milk",
        state: "open",
        dueDate: "2026-08-21",
        priority: "high",
      },
    });

    await vi.waitFor(async () => {
      const listed = await dest.tasksApi.listTasksForNote("note-b");
      expect(listed.length).toBeGreaterThanOrEqual(1);
      expect(listed.some((task) => task.title === "Buy milk")).toBe(true);
      expect(listed.some((task) => task.due_date === "2026-08-21")).toBe(true);
    });
  });

  it("strips [[wikilink]] brackets from the title on commit (ENG-147)", async () => {
    const user = userEvent.setup();
    render(
      createElement(NoteEditor, {
        markdown: "",
        onChange: () => {},
        currentNoteId: "note-wikilink-title",
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
    await user.keyboard("[[Foo]]{Enter}");
    await waitFor(async () => {
      const listed = await browserTasksApi.listTasksForNote(
        "note-wikilink-title",
      );
      expect(listed.some((task) => task.title === "Foo")).toBe(true);
      expect(listed.every((task) => !task.title.includes("[["))).toBe(true);
    });
    expect(input).toHaveValue("Foo");
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

  it("does not dirty onChange when pill hydrate updates attrs (ENG-139)", async () => {
    const onChange = vi.fn();
    const stamp = "2026-08-12T00:00:00.000Z";
    const seed: Task = {
      id: "t-ghost",
      note_id: "n-ghost",
      title: "Buy oat milk",
      state: "done",
      due_date: "2026-08-20",
      priority: "urgent",
      created_at: stamp,
      updated_at: stamp,
      completed_at: stamp,
    };
    const listSpy = vi
      .spyOn(browserTasksApi, "listTasksForNote")
      .mockResolvedValue([seed]);
    const markdown = "[[task:t-ghost]] Buy milk\n\nBody";
    try {
      const user = userEvent.setup();
      render(
        createElement(NoteEditor, {
          markdown,
          onChange,
          currentNoteId: "n-ghost",
        }),
      );
      const textbox = await screen.findByRole("textbox", { name: "Note body" });
      await waitFor(() => {
        const pill = textbox.querySelector(".task-pill");
        expect(pill).toBeInstanceOf(HTMLElement);
        expect(pill).toHaveClass("is-done");
        const title = pill?.querySelector(".task-pill-title");
        expect(title).toHaveValue("Buy oat milk");
      });
      await user.click(textbox);
      expect(
        onChange.mock.calls.filter(([next]) =>
          String(next).includes("Buy oat milk"),
        ),
      ).toEqual([]);

      await user.keyboard("!");
      await waitFor(() => {
        expect(
          onChange.mock.calls.some(([next]) => String(next).includes("!")),
        ).toBe(true);
      });
    } finally {
      listSpy.mockRestore();
    }
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

  it("onSetState sends only id+state so stale dueDate attrs cannot clobber (ENG-127)", async () => {
    const seed: Task[] = [
      {
        id: "t-stale",
        note_id: "note-1",
        title: "Has due",
        state: "open",
        due_date: "2026-08-20",
        priority: "high",
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    const tasksApi = createMemoryTasksApi(seed);
    const spy = vi.spyOn(tasksApi, "updateTask");
    const { editor: ed } = create({
      tasks: tasksApi,
      content: "[[task:t-stale]] Has due",
    });

    const setState = taskPillHandlers(ed).onSetState;
    expect(setState).toBeTypeOf("function");
    setState?.("t-stale", "done");

    expect(spy).toHaveBeenCalledWith({ id: "t-stale", state: "done" });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("due_date");
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("title");
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("priority");

    await vi.waitFor(async () => {
      const task = await tasksApi.getTask("t-stale");
      expect(task.state).toBe("done");
      expect(task.due_date).toBe("2026-08-20");
      expect(task.priority).toBe("high");
      expect(task.title).toBe("Has due");
    });
  });

  it("onTitleCommit sends only id+title so stale state cannot reopen (ENG-127)", async () => {
    const seed: Task[] = [
      {
        id: "t-done",
        note_id: "note-1",
        title: "Old title",
        state: "done",
        due_date: "2026-08-20",
        priority: "low",
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: "2026-08-12T01:00:00.000Z",
      },
    ];
    const tasksApi = createMemoryTasksApi(seed);
    const spy = vi.spyOn(tasksApi, "updateTask");
    const { editor: ed } = create({
      tasks: tasksApi,
      content: "[[task:t-done]] Old title",
    });

    const commit = taskPillHandlers(ed).onTitleCommit;
    expect(commit).toBeTypeOf("function");
    commit?.("t-done", "New title");

    expect(spy).toHaveBeenCalledWith({ id: "t-done", title: "New title" });
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("state");
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("due_date");

    await vi.waitFor(async () => {
      const task = await tasksApi.getTask("t-done");
      expect(task.title).toBe("New title");
      expect(task.state).toBe("done");
      expect(task.completed_at).toBe("2026-08-12T01:00:00.000Z");
      expect(task.due_date).toBe("2026-08-20");
    });
  });

  it("rehydrates pill attrs on tasks-changed (ENG-127)", async () => {
    const seed: Task[] = [
      {
        id: "t-hyd",
        note_id: "note-1",
        title: "Hydrate me",
        state: "open",
        due_date: null,
        priority: null,
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:00:00.000Z",
        completed_at: null,
      },
    ];
    const { editor: ed, tasksApi } = create({
      seed,
      content: "[[task:t-hyd]] Hydrate me",
    });

    await tasksApi.updateTask({
      id: "t-hyd",
      due_date: "2026-08-20",
      priority: "urgent",
    });

    await vi.waitFor(() => {
      let dueDate: unknown;
      let priority: unknown;
      ed.state.doc.descendants((node) => {
        if (node.type.name === "taskPill" && node.attrs.taskId === "t-hyd") {
          dueDate = node.attrs.dueDate;
          priority = node.attrs.priority;
        }
      });
      expect(dueDate).toBe("2026-08-20");
      expect(priority).toBe("urgent");
    });
  });
});
