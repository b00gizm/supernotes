import { formatShortDay } from "../notes/format";

export type ToolRowCopy = {
  action: string;
  argument: string | null;
  summary: string | null;
};

const ACTIONS: Record<string, string> = {
  search_notes: "Searched notes",
  get_note: "Read note",
  list_tasks: "Listed tasks",
  list_calendar_events: "Read calendar",
  get_daily_note: "Read daily note",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function strField(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function ymdPrefix(raw: string): string | null {
  const ymd = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

function dateLabel(raw: string): string {
  const ymd = ymdPrefix(raw);
  return ymd ? formatShortDay(ymd) : raw;
}

function quoted(value: string): string {
  return `'${value}'`;
}

function countLabel(result: unknown): string | null {
  if (!Array.isArray(result)) {
    return null;
  }
  return result.length === 1 ? "1 result" : `${String(result.length)} results`;
}

function fallbackAction(name: string): string {
  const spaced = name.replaceAll("_", " ").trim();
  if (!spaced) {
    return name;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function calendarArgument(args: Record<string, unknown>): string | null {
  const date = strField(args, ["date", "from", "to"]);
  return date ? dateLabel(date) : null;
}

function tasksArgument(args: Record<string, unknown>): string | null {
  const filter = strField(args, ["filter", "state"]);
  if (filter) {
    return filter;
  }
  if (args.overdue === true) {
    return "overdue";
  }
  const due = strField(args, ["due_from", "due_to"]);
  return due ? dateLabel(due) : null;
}

export function formatToolRow(input: {
  name: string;
  arguments: string;
  result?: unknown;
}): ToolRowCopy {
  const args = parseArgs(input.arguments);
  const action = ACTIONS[input.name] ?? fallbackAction(input.name);
  if (input.name === "search_notes") {
    const query = strField(args, ["query"]);
    return {
      action,
      argument: query ? quoted(query) : null,
      summary: countLabel(input.result),
    };
  }
  if (input.name === "list_calendar_events") {
    return { action, argument: calendarArgument(args), summary: null };
  }
  if (input.name === "get_note") {
    const idOrTitle = strField(args, ["id_or_title", "id", "title"]);
    return {
      action,
      argument: idOrTitle ? quoted(idOrTitle) : null,
      summary: null,
    };
  }
  if (input.name === "list_tasks") {
    return {
      action,
      argument: tasksArgument(args),
      summary: countLabel(input.result),
    };
  }
  if (input.name === "get_daily_note") {
    const date = strField(args, ["date"]);
    return { action, argument: date ? dateLabel(date) : null, summary: null };
  }
  const first = strField(args, Object.keys(args));
  return {
    action,
    argument: first ? quoted(first) : null,
    summary: countLabel(input.result),
  };
}

export function formatToolRowLabel(input: {
  name: string;
  arguments: string;
  result?: unknown;
}): string {
  const copy = formatToolRow(input);
  return [copy.action, copy.argument, copy.summary]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export function formatToolResult(result: unknown): string {
  if (result === undefined) {
    return "null";
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return "null";
  }
}
