import { invoke } from "@tauri-apps/api/core";
import { createMemoryTasksApi } from "./memoryApi";
import type {
  CreateTaskInput,
  Task,
  TaskListFilter,
  UpdateTaskInput,
} from "./types";

export type TasksApi = {
  createTask: (input: CreateTaskInput) => Promise<Task>;
  getTask: (id: string) => Promise<Task>;
  listTasks: (filter: TaskListFilter, today: string) => Promise<Task[]>;
  listTasksForNote: (noteId: string) => Promise<Task[]>;
  updateTask: (input: UpdateTaskInput) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
};

const tauriTasksApi: TasksApi = {
  createTask: (input) => invoke<Task>("create_task", { input }),
  getTask: (id) => invoke<Task>("get_task", { id }),
  // Tauri 2 deserializes multi-word command args as camelCase by default.
  listTasks: (filter, today) => invoke<Task[]>("list_tasks", { filter, today }),
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

/** Browser preview seed so Tasks overview is demonstrable without Tauri. */
const DEMO_TASKS: Task[] = [
  {
    id: "demo-task-inbox",
    note_id: "demo-roadmap",
    title: "Draft pricing brief",
    state: "open",
    due_date: null,
    priority: "high",
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    completed_at: null,
  },
  {
    id: "demo-task-meeting",
    note_id: "demo-sync",
    title: "Send recap to team",
    state: "open",
    due_date: null,
    priority: null,
    created_at: "2026-08-11T16:00:00.000Z",
    updated_at: "2026-08-11T16:00:00.000Z",
    completed_at: null,
  },
  {
    id: "demo-task-overdue",
    note_id: "demo-roadmap",
    title: "Land design review",
    state: "open",
    due_date: "2026-08-10",
    priority: "urgent",
    created_at: "2026-08-08T10:00:00.000Z",
    updated_at: "2026-08-08T10:00:00.000Z",
    completed_at: null,
  },
  {
    id: "demo-task-daily",
    note_id: "demo-daily",
    title: "Follow up with design",
    state: "waiting",
    due_date: "2026-08-13",
    priority: "medium",
    created_at: "2026-08-12T08:30:00.000Z",
    updated_at: "2026-08-12T08:30:00.000Z",
    completed_at: null,
  },
  {
    id: "demo-task-done",
    note_id: "demo-weekly",
    title: "Ship the importer",
    state: "done",
    due_date: "2026-08-07",
    priority: "low",
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-11T14:00:00.000Z",
    completed_at: "2026-08-11T14:00:00.000Z",
  },
];

/** Browser `npm run dev` has no Tauri IPC; use memory so the shell is previewable. */
export const tasksApi: TasksApi = isTauriRuntime()
  ? tauriTasksApi
  : createMemoryTasksApi(DEMO_TASKS);
