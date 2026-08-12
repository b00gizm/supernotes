import { filterTasks } from "./query";
import { emitTasksChanged } from "./events";
import type {
  CreateTaskInput,
  Task,
  TaskListFilter,
  TaskState,
  UpdateTaskInput,
} from "./types";
import type { TasksApi } from "./api";

function stamp(): string {
  return new Date().toISOString();
}

/** In-memory TasksApi for tests / browser preview. */
export function createMemoryTasksApi(seed: Task[] = []): TasksApi {
  let tasks = [...seed];
  let seq = 0;

  return {
    createTask(input: CreateTaskInput) {
      seq += 1;
      const now = stamp();
      const state: TaskState = input.state ?? "open";
      const task: Task = {
        id: `task-${String(seq)}`,
        note_id: input.note_id,
        title: input.title ?? "",
        state,
        due_date: input.due_date ?? null,
        priority: input.priority ?? null,
        created_at: now,
        updated_at: now,
        completed_at: state === "done" || state === "cancelled" ? now : null,
      };
      tasks = [...tasks, task];
      emitTasksChanged(task.note_id);
      return Promise.resolve(task);
    },
    getTask(id: string) {
      const task = tasks.find((item) => item.id === id);
      if (!task) {
        return Promise.reject(new Error("not found"));
      }
      return Promise.resolve(task);
    },
    listTasks(filter: TaskListFilter, today: string) {
      return Promise.resolve(filterTasks(tasks, filter, today));
    },
    listTasksForNote(noteId: string) {
      return Promise.resolve(
        tasks
          .filter((task) => task.note_id === noteId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      );
    },
    searchTasks(query: string) {
      const needle = query.trim().toLowerCase();
      const listed = [...tasks].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
      if (!needle) {
        return Promise.resolve(listed);
      }
      return Promise.resolve(
        listed.filter((task) => task.title.toLowerCase().includes(needle)),
      );
    },
    updateTask(input: UpdateTaskInput) {
      const current = tasks.find((item) => item.id === input.id);
      if (!current) {
        return Promise.reject(new Error("not found"));
      }
      const now = stamp();
      const completed_at =
        input.state === "done" || input.state === "cancelled"
          ? (current.completed_at ?? now)
          : null;
      const updated: Task = {
        ...current,
        title: input.title,
        state: input.state,
        due_date:
          input.due_date === undefined ? current.due_date : input.due_date,
        priority:
          input.priority === undefined ? current.priority : input.priority,
        updated_at: now,
        completed_at,
      };
      tasks = tasks.map((item) => (item.id === input.id ? updated : item));
      emitTasksChanged(updated.note_id);
      return Promise.resolve(updated);
    },
    deleteTask(id: string) {
      const before = tasks.length;
      tasks = tasks.filter((task) => task.id !== id);
      if (tasks.length === before) {
        return Promise.reject(new Error("not found"));
      }
      emitTasksChanged();
      return Promise.resolve();
    },
  };
}
