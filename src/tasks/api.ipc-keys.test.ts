import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri task IPC arg keys (ENG-61)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("listTasksForNote passes camelCase noteId for Tauri 2", async () => {
    const { tasksApi } = await import("./api");
    await tasksApi.listTasksForNote("note-1");

    expect(invoke).toHaveBeenCalledWith("list_tasks_for_note", {
      noteId: "note-1",
    });
  });

  it("createTask/updateTask pass snake_case fields inside input", async () => {
    const { tasksApi } = await import("./api");
    await tasksApi.createTask({ note_id: "note-1", title: "Buy milk" });
    await tasksApi.updateTask({
      id: "task-1",
      title: "Buy milk",
      state: "done",
      due_date: null,
      priority: null,
    });

    expect(invoke).toHaveBeenCalledWith("create_task", {
      input: { note_id: "note-1", title: "Buy milk" },
    });
    expect(invoke).toHaveBeenCalledWith("update_task", {
      input: {
        id: "task-1",
        title: "Buy milk",
        state: "done",
        due_date: null,
        priority: null,
      },
    });
  });
});
