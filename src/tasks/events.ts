/** Window event so Due / Tasks views reload after pill mutations (ENG-120). */
export const TASKS_CHANGED_EVENT = "supernotes:tasks-changed";

export type TasksChangedDetail = { noteId?: string };

export function emitTasksChanged(noteId?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<TasksChangedDetail>(TASKS_CHANGED_EVENT, {
      detail: { noteId },
    }),
  );
}

export function subscribeTasksChanged(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(TASKS_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(TASKS_CHANGED_EVENT, handler);
  };
}
