/** P1 red / P2 amber / P3 gray dots (design sheet). */
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
