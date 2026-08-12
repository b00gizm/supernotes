import type { Task, TaskListFilter, TaskPriority } from "./types";

/** Priority rank for Upcoming sort (lower = higher priority). */
export function priorityRank(
  priority: TaskPriority | null | undefined,
): number {
  switch (priority) {
    case "urgent":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    case "none":
      return 4;
    default:
      return 5;
  }
}

/** Overdue = due date before today and not Done/Cancelled. */
export function isTaskOverdue(task: Task, today: string): boolean {
  if (task.state === "done" || task.state === "cancelled") {
    return false;
  }
  if (!task.due_date) {
    return false;
  }
  return task.due_date < today;
}

function completeCutoff(today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) {
    return today;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  date.setDate(date.getDate() - 14);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

/** Mirror of backend `list_tasks` filters (memory API / unit checks). */
export function filterTasks(
  tasks: Task[],
  filter: TaskListFilter,
  today: string,
): Task[] {
  if (filter === "inbox") {
    return tasks
      .filter((task) => task.state === "open" && task.due_date == null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  if (filter === "upcoming") {
    return tasks
      .filter(
        (task) =>
          (task.state === "open" || task.state === "waiting") &&
          task.due_date != null,
      )
      .sort((a, b) => {
        const due = (a.due_date ?? "").localeCompare(b.due_date ?? "");
        if (due !== 0) {
          return due;
        }
        const priority = priorityRank(a.priority) - priorityRank(b.priority);
        if (priority !== 0) {
          return priority;
        }
        return a.created_at.localeCompare(b.created_at);
      });
  }
  const cutoff = completeCutoff(today);
  return tasks
    .filter((task) => {
      if (task.state !== "done" && task.state !== "cancelled") {
        return false;
      }
      if (!task.completed_at) {
        return false;
      }
      return task.completed_at.slice(0, 10) >= cutoff;
    })
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
}
