export type NoteTarget = { kind: "current" } | { kind: "none" };

export type AnswerActionId = "append" | "replace" | "copy" | "append-daily";

export function noteTargetFromId(noteId: string | null): NoteTarget {
  return noteId ? { kind: "current" } : { kind: "none" };
}

export function actionsFor(target: NoteTarget): AnswerActionId[] {
  return target.kind === "current"
    ? ["append", "replace", "copy"]
    : ["append-daily", "copy"];
}

export const ANSWER_ACTION_LABEL: Record<AnswerActionId, string> = {
  append: "Append to current note",
  replace: "Replace current note",
  copy: "Copy",
  "append-daily": "Append to today's daily note",
};
