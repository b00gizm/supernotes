import type { AgentPlanEvent, AgentPlanItemView } from "../agent/api";

export type PlanUi =
  | { status: "idle" }
  | { status: "ready"; plan: AgentPlanEvent }
  | { status: "busy"; plan: AgentPlanEvent }
  | { status: "error"; plan: AgentPlanEvent; message: string };

export function planCardHeader(
  plan: Pick<AgentPlanEvent, "title" | "date_label">,
): string {
  return plan.date_label ? `${plan.title} · ${plan.date_label}` : plan.title;
}

export function planItemLabel(item: AgentPlanItemView): string {
  if (item.title) {
    return item.title;
  }
  return [item.id, item.state, item.due_date, item.priority]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join(" · ");
}
