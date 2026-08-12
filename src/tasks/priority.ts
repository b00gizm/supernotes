import type { TaskPriority } from "./types";

/** P1 red / P2 amber / P3 gray dots (component sheet 1a). */
export function priorityDotClass(
  priority: string | null | undefined,
): string | null {
  if (priority === "urgent" || priority === "high") {
    return "is-p1";
  }
  if (priority === "medium") {
    return "is-p2";
  }
  if (priority === "low") {
    return "is-p3";
  }
  return null;
}

/** Compact popover segments: DB keeps none/low/medium/high/urgent. */
export const PRIORITY_SEGMENTS: Array<{
  values: Array<TaskPriority | null>;
  label: string;
  apply: TaskPriority | null;
  tone: "p1" | "p2" | "p3" | "none";
}> = [
  { values: ["urgent", "high"], label: "P1", apply: "high", tone: "p1" },
  { values: ["medium"], label: "P2", apply: "medium", tone: "p2" },
  { values: ["low"], label: "P3", apply: "low", tone: "p3" },
  { values: ["none", null], label: "None", apply: null, tone: "none" },
];
