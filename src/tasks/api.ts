import { invoke } from "@tauri-apps/api/core";
import { formatDailyTitle } from "../notes/format";
import { shiftYmd } from "./due";
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

/** Browser preview seed so Tasks overview has Inbox / Upcoming / Complete rows. */
function demoTasks(): Task[] {
  const today = formatDailyTitle();
  const now = new Date().toISOString();
  return [
    {
      id: "demo-task-inbox",
      note_id: "demo-roadmap",
      title: "Draft pricing brief",
      state: "open",
      due_date: null,
      priority: "high",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-meeting",
      note_id: "demo-sync",
      title: "Send recap to team",
      state: "open",
      due_date: null,
      priority: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-overdue",
      note_id: "demo-roadmap",
      title: "Land design review",
      state: "open",
      due_date: shiftYmd(today, -4),
      priority: "urgent",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-overdue-2",
      note_id: "demo-pricing",
      title: "Legal review of annual terms",
      state: "waiting",
      due_date: shiftYmd(today, -2),
      priority: "medium",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-today",
      note_id: "demo-daily",
      title: "Prep standup notes",
      state: "open",
      due_date: today,
      priority: "high",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-daily",
      note_id: "demo-daily",
      title: "Follow up with design",
      state: "waiting",
      due_date: shiftYmd(today, 1),
      priority: "medium",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-friday",
      note_id: "demo-interview",
      title: "Send Priya take-home",
      state: "open",
      due_date: shiftYmd(today, 2),
      priority: "low",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-next-week",
      note_id: "demo-roadmap",
      title: "Ship pricing v2",
      state: "open",
      due_date: shiftYmd(today, 7),
      priority: "urgent",
      created_at: now,
      updated_at: now,
      completed_at: null,
    },
    {
      id: "demo-task-done",
      note_id: "demo-weekly",
      title: "Ship the importer",
      state: "done",
      due_date: shiftYmd(today, -5),
      priority: "low",
      created_at: now,
      updated_at: now,
      completed_at: now,
    },
  ];
}

/** Browser `npm run dev` has no Tauri IPC; use memory so the shell is previewable. */
export const tasksApi: TasksApi = isTauriRuntime()
  ? tauriTasksApi
  : createMemoryTasksApi(demoTasks());
