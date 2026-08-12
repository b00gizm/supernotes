import { invoke } from "@tauri-apps/api/core";
import { createMemoryTasksApi } from "./memoryApi";
import type { CreateTaskInput, Task, UpdateTaskInput } from "./types";

export type TasksApi = {
  createTask: (input: CreateTaskInput) => Promise<Task>;
  getTask: (id: string) => Promise<Task>;
  listTasksForNote: (noteId: string) => Promise<Task[]>;
  updateTask: (input: UpdateTaskInput) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
};

const tauriTasksApi: TasksApi = {
  createTask: (input) => invoke<Task>("create_task", { input }),
  getTask: (id) => invoke<Task>("get_task", { id }),
  // Tauri 2 deserializes multi-word command args as camelCase by default.
  listTasksForNote: (noteId) =>
    invoke<Task[]>("list_tasks_for_note", { noteId }),
  updateTask: (input) => invoke<Task>("update_task", { input }),
  deleteTask: async (id) => {
    await invoke("delete_task", { id });
  },
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Browser `npm run dev` has no Tauri IPC; use memory so the shell is previewable. */
export const tasksApi: TasksApi = isTauriRuntime()
  ? tauriTasksApi
  : createMemoryTasksApi();
