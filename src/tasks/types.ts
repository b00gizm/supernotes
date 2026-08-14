/** MVP task states. `pending` is reserved for future AI delegation — do not add yet. */
export type TaskState = "open" | "waiting" | "done" | "cancelled";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

/** Global Tasks sidebar filters (ENG-63). */
export type TaskListFilter = "inbox" | "upcoming" | "complete";

export type Task = {
  id: string;
  note_id: string;
  title: string;
  state: TaskState;
  due_date: string | null;
  priority: TaskPriority | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CreateTaskInput = {
  note_id: string;
  title?: string;
  state?: TaskState;
  due_date?: string | null;
  priority?: TaskPriority | null;
};

export type UpdateTaskInput = {
  id: string;
  title?: string;
  state?: TaskState;
  due_date?: string | null;
  priority?: TaskPriority | null;
};
