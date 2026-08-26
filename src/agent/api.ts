import { invoke } from "@tauri-apps/api/core";
import { formatShortDay } from "../notes/format";
import {
  createMemoryLlmApi,
  LLM_DONE_EVENT,
  LLM_TOKEN_EVENT,
  LlmError,
  type LlmChatMessage,
  type LlmChatResult,
  type LlmIpcError,
  type MemoryLlmOptions,
} from "../llm/api";

export {
  LLM_DONE_EVENT,
  LLM_ERROR_EVENT,
  LLM_TOKEN_EVENT,
  LlmError,
  subscribeLlmDone,
  subscribeLlmErrors,
  subscribeLlmTokens,
} from "../llm/api";
export type {
  LlmChatMessage,
  LlmChatResult,
  LlmDoneEvent,
  LlmIpcError,
  LlmTokenEvent,
} from "../llm/api";

/** Mockup 1i panel title. Baymax owns the chrome. */
export const ASSISTANT_PANEL_TITLE = "Assistant";
/** Native menu accelerator (⌥⌘A / Alt+Meta+A). */
export const ASSISTANT_SHORTCUT_ACCELERATOR = "Alt+CmdOrCtrl+A";
/** Shortcut chip label as drawn on mockup 1i. */
export const ASSISTANT_SHORTCUT_LABEL = "⌥⌘A";
export const AGENT_TOGGLE_EVENT = "agent://toggle";
export const AGENT_TOOL_EVENT = "agent://tool";
export const AGENT_TOOL_RESULT_EVENT = "agent://tool-result";
export const AGENT_PLAN_EVENT = "agent://plan";
export const AGENT_PLAN_REASSURANCE = "Nothing is written until you approve.";
export const AGENT_PLAN_DECLINE_LABEL = "Decline";
export const MAX_TOOL_ITERATIONS = 8;

/** Tauri 2 EventName: alphanumeric plus `-` `/` `:` `_`. A `.` is illegal. */
export function isLegalTauriEventName(name: string): boolean {
  if (!name) {
    return false;
  }
  for (const c of name) {
    const ok =
      (c >= "0" && c <= "9") ||
      (c >= "A" && c <= "Z") ||
      (c >= "a" && c <= "z") ||
      c === "-" ||
      c === "/" ||
      c === ":" ||
      c === "_";
    if (!ok) {
      return false;
    }
  }
  return true;
}

/** `listen` delivers `{ event, id, payload }`. Use `payload`, not the Event `id`. */
export function tauriListenPayload(event: unknown): unknown {
  if (event && typeof event === "object" && "payload" in event) {
    const payload = event.payload;
    if (payload !== undefined) {
      return payload;
    }
  }
  return event;
}

const TOOLS_SYSTEM =
  "You have tools for the user's notes, tasks, calendar, and daily notes. Read tools return live app data. Write tools (create_task, update_task, create_calendar_event) only stage a plan; nothing is written until the user approves. Use tools instead of guessing. The final reply must be note-ready: lead with the useful content (headings, lists, facts). No process narration. No closing offers or questions. Short tool-loop chatter is fine; the last assistant message is what gets copied into a note.";

export type SendAgentChatInput = {
  message: string;
  note_id: string | null;
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AgentToolEvent = {
  stream_id: string;
  id: string;
  name: string;
  arguments: string;
};

export type AgentToolResultEvent = {
  stream_id: string;
  id: string;
  name: string;
  result: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Tauri 2 invoke/events may use streamId; the domain type is stream_id. */
export function parseLlmChatResult(payload: unknown): LlmChatResult | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const stream_id = readString(record, ["stream_id", "streamId"]);
  if (!stream_id) {
    return null;
  }
  return {
    stream_id,
    text: typeof record.text === "string" ? record.text : "",
    engine_id: readString(record, ["engine_id", "engineId"]) ?? "",
  };
}

export function parseAgentToolEvent(payload: unknown): AgentToolEvent | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const stream_id = readString(record, ["stream_id", "streamId"]);
  const id = readString(record, ["id"]);
  const name = readString(record, ["name"]);
  const args = record.arguments;
  if (!stream_id || !id || !name || typeof args !== "string") {
    return null;
  }
  return { stream_id, id, name, arguments: args };
}

export function parseAgentToolResultEvent(
  payload: unknown,
): AgentToolResultEvent | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const stream_id = readString(record, ["stream_id", "streamId"]);
  const id = readString(record, ["id"]);
  const name = readString(record, ["name"]);
  if (!stream_id || !id || !name || !("result" in record)) {
    return null;
  }
  return { stream_id, id, name, result: record.result };
}

export type AgentChatMessage = LlmChatMessage & {
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
};

export type PlanIdInput = {
  plan_id: string;
};

export type AgentPlanItemView = {
  kind: string;
  title: string;
  time_range?: string;
  start?: string;
  end?: string;
  task_id?: string | null;
  id?: string;
  due_date?: string | null;
  state?: string;
  priority?: string;
};

export type AgentPlanEvent = {
  stream_id: string;
  plan_id: string;
  title: string;
  date_label: string | null;
  items: AgentPlanItemView[];
  approve_label: string;
  decline_label: string;
  reassurance: string;
};

export type AgentApi = {
  sendChat: (input: SendAgentChatInput) => Promise<LlmChatResult>;
  clearConversation: () => Promise<void>;
  approvePlan?: (input: PlanIdInput) => Promise<ApprovePlanResult>;
  declinePlan?: (input: PlanIdInput) => Promise<DeclinePlanResult>;
};

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) {
    return err;
  }
  if (err && typeof err === "object") {
    const rec = err as { code?: unknown; message?: unknown };
    if (typeof rec.code === "string" && typeof rec.message === "string") {
      return new LlmError(rec.code, rec.message);
    }
  }
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/^([a-z_]+):\s*(.*)$/);
  if (match?.[1] && match[2] !== undefined) {
    return new LlmError(match[1], match[2]);
  }
  return new LlmError("request_failed", raw || "The LLM request failed.");
}

async function invokeAgent<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return args === undefined
      ? await invoke<T>(cmd)
      : await invoke<T>(cmd, args);
  } catch (err) {
    throw toLlmError(err);
  }
}

const tauriAgentApi: AgentApi = {
  sendChat: async (input) => {
    const parsed = parseLlmChatResult(
      await invokeAgent<unknown>("send_agent_chat", { input }),
    );
    if (!parsed) {
      throw new LlmError("request_failed", "invalid chat result");
    }
    return parsed;
  },
  clearConversation: async () => {
    await invokeAgent<unknown>("clear_agent_conversation");
  },
  approvePlan: (input) =>
    invokeAgent<ApprovePlanResult>("approve_agent_plan", { input }),
  declinePlan: (input) =>
    invokeAgent<DeclinePlanResult>("decline_agent_plan", { input }),
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function formatNoteContext(title: string, body: string): string {
  return `The user has this note open. Use it when they refer to "this" or ask to proof-read.\n\n# ${title}\n\n${body}`;
}

export type MemoryNote = {
  title: string;
  body_markdown: string;
  note_type?: "regular" | "daily" | "meeting";
};

export type MemoryTask = {
  id: string;
  title: string;
  state: string;
  due_date: string | null;
  note_id?: string;
};

export type MemoryCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  task_id: string | null;
};

export type AppliedPlanItem =
  | { kind: "create_task"; task: MemoryTask }
  | { kind: "update_task"; task: MemoryTask }
  | { kind: "create_calendar_event"; event: MemoryCalendarEvent };

export type ApprovePlanResult = {
  plan_id: string;
  items: AppliedPlanItem[];
};

export type DeclinePlanResult = {
  plan_id: string;
  declined: boolean;
};

export type MemoryAgentTurn = {
  tokens?: string[];
  tool_calls?: AgentToolCall[];
};

export type MemoryAgentOptions = {
  tokens?: string[];
  fail?: LlmIpcError;
  notes?: Record<string, MemoryNote>;
  tasks?: MemoryTask[];
  events?: MemoryCalendarEvent[];
  turns?: MemoryAgentTurn[];
};

export type MemoryAgentApi = AgentApi & {
  history: () => AgentChatMessage[];
  lastOutgoing: () => AgentChatMessage[];
  pendingPlan: () => AgentPlanEvent | null;
  tasks: () => MemoryTask[];
  events: () => MemoryCalendarEvent[];
  approvePlan: (input: PlanIdInput) => Promise<ApprovePlanResult>;
  declinePlan: (input: PlanIdInput) => Promise<DeclinePlanResult>;
};

type MemoryStaged = {
  kind: "create_task" | "update_task" | "create_calendar_event";
  title?: string;
  today?: string;
  due_date?: string | null;
  priority?: string | null;
  id?: string;
  state?: string | null;
  start?: string;
  end?: string;
  task_id?: string | null;
};

function hmFromIso(iso: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) {
    return iso;
  }
  const minute = match[2] ?? "00";
  return `${String(Number(match[1]))}:${minute}`;
}

function summarizeMemoryPlan(items: MemoryStaged[]): {
  title: string;
  approve_label: string;
  date_ymd: string | null;
} {
  const blocks = items.filter(
    (item) => item.kind === "create_calendar_event",
  ).length;
  const tasks = items.filter((item) => item.kind === "create_task").length;
  const updates = items.filter((item) => item.kind === "update_task").length;
  let date_ymd: string | null = null;
  for (const item of items) {
    if (item.kind === "create_calendar_event" && item.start) {
      date_ymd = item.start.slice(0, 10);
      break;
    }
    if (item.kind === "create_task" && item.today) {
      date_ymd = item.today;
      break;
    }
  }
  if (blocks > 0 && tasks === 0 && updates === 0) {
    return {
      title: blocks === 1 ? "1 time block" : `${String(blocks)} time blocks`,
      approve_label:
        blocks === 1 ? "Add 1 block" : `Add ${String(blocks)} blocks`,
      date_ymd,
    };
  }
  if (tasks > 0 && blocks === 0 && updates === 0) {
    return {
      title: tasks === 1 ? "1 task" : `${String(tasks)} tasks`,
      approve_label: tasks === 1 ? "Add 1 task" : `Add ${String(tasks)} tasks`,
      date_ymd,
    };
  }
  return {
    title: `${String(items.length)} changes`,
    approve_label: `Apply ${String(items.length)} changes`,
    date_ymd,
  };
}

function memoryPlanItem(item: MemoryStaged): AgentPlanItemView {
  if (item.kind === "create_calendar_event") {
    const start = item.start ?? "";
    const end = item.end ?? "";
    return {
      kind: item.kind,
      title: item.title ?? "",
      time_range: `${hmFromIso(start)} – ${hmFromIso(end)}`,
      start,
      end,
      task_id: item.task_id ?? null,
    };
  }
  if (item.kind === "create_task") {
    const view: AgentPlanItemView = {
      kind: item.kind,
      title: item.title ?? "",
      due_date: item.due_date ?? null,
    };
    if (item.priority) {
      view.priority = item.priority;
    }
    return view;
  }
  const view: AgentPlanItemView = {
    kind: item.kind,
    title: "",
    due_date: item.due_date ?? null,
  };
  if (item.id) {
    view.id = item.id;
  }
  if (item.state) {
    view.state = item.state;
  }
  if (item.priority) {
    view.priority = item.priority;
  }
  return view;
}

function asStaged(result: unknown): MemoryStaged | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (record.staged !== true || typeof record.kind !== "string") {
    return null;
  }
  if (
    record.kind !== "create_task" &&
    record.kind !== "update_task" &&
    record.kind !== "create_calendar_event"
  ) {
    return null;
  }
  return record as MemoryStaged;
}

function emitWindow(name: string, detail: object) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function snippet(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 200)}…`;
}

function executeMemoryTool(
  name: string,
  argumentsJson: string,
  notes: Record<string, MemoryNote>,
  tasks: MemoryTask[],
  events: MemoryCalendarEvent[],
): unknown {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch (err) {
    return { error: `invalid arguments: ${String(err)}` };
  }
  const str = (...keys: string[]) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  };

  if (name === "search_notes") {
    const query = str("query").toLowerCase();
    if (!query) {
      return [];
    }
    return Object.entries(notes)
      .filter(([, note]) => note.title.toLowerCase().includes(query))
      .map(([id, note]) => ({
        id,
        title: note.title,
        note_type: note.note_type ?? "regular",
        snippet: snippet(note.body_markdown),
      }));
  }
  if (name === "get_note") {
    const idOrTitle = str("id_or_title", "id", "title");
    if (!idOrTitle) {
      return null;
    }
    if (notes[idOrTitle]) {
      return { id: idOrTitle, ...notes[idOrTitle] };
    }
    const match = Object.entries(notes).find(
      ([, note]) => note.title.toLowerCase() === idOrTitle.toLowerCase(),
    );
    return match ? { id: match[0], ...match[1] } : null;
  }
  if (name === "list_tasks") {
    const state = str("state");
    const dueFrom = str("due_from");
    const dueTo = str("due_to");
    const today = str("today") || new Date().toISOString().slice(0, 10);
    const overdue = args.overdue === true;
    return tasks.filter((task) => {
      if (state && task.state !== state) {
        return false;
      }
      if (dueFrom && (!task.due_date || task.due_date < dueFrom)) {
        return false;
      }
      if (dueTo && (!task.due_date || task.due_date > dueTo)) {
        return false;
      }
      if (
        overdue &&
        !(
          (task.state === "open" || task.state === "waiting") &&
          task.due_date &&
          task.due_date < today
        )
      ) {
        return false;
      }
      return true;
    });
  }
  if (name === "list_calendar_events") {
    const from = str("from");
    const to = str("to");
    const date = str("date");
    const start = from || (date ? `${date}T00:00:00.000Z` : "");
    const end = to || (date ? `${date}T23:59:59.999Z` : "");
    return events
      .filter((event) => {
        if (end && event.start >= end) {
          return false;
        }
        if (start && event.end <= start) {
          return false;
        }
        return true;
      })
      .map((event) => ({
        ...event,
        task: event.task_id
          ? (tasks.find((task) => task.id === event.task_id) ?? null)
          : null,
      }));
  }
  if (name === "get_daily_note") {
    const date = str("date");
    if (!date) {
      return null;
    }
    const match = Object.entries(notes).find(
      ([, note]) =>
        note.title === date && (note.note_type ?? "daily") === "daily",
    );
    return match ? { id: match[0], ...match[1] } : null;
  }
  if (name === "create_task") {
    const title = str("title");
    if (!title) {
      return { error: "title is required" };
    }
    const today = str("today") || new Date().toISOString().slice(0, 10);
    return {
      staged: true,
      kind: "create_task",
      title,
      due_date: str("due_date") || null,
      priority: str("priority") || null,
      today,
    };
  }
  if (name === "update_task") {
    const id = str("id");
    if (!id) {
      return { error: "id is required" };
    }
    const state = str("state") || null;
    const due = args.due_date === null ? null : str("due_date") || undefined;
    const priority =
      args.priority === null ? null : str("priority") || undefined;
    if (!state && due === undefined && priority === undefined) {
      return { error: "update_task needs state, due_date, or priority" };
    }
    return {
      staged: true,
      kind: "update_task",
      id,
      state,
      due_date: due ?? null,
      priority: priority ?? null,
    };
  }
  if (name === "create_calendar_event") {
    const title = str("title");
    const start = str("start");
    const end = str("end");
    if (!title || !start || !end) {
      return { error: "title, start, and end are required" };
    }
    if (end <= start) {
      return { error: "event end must be after start" };
    }
    return {
      staged: true,
      kind: "create_calendar_event",
      title,
      start,
      end,
      task_id: str("task_id") || null,
    };
  }
  return { error: `unknown tool: ${name}` };
}

/** In-memory AgentApi for tests / `npm run dev` (no live API). */
export function createMemoryAgentApi(
  options: MemoryAgentOptions = {},
): MemoryAgentApi {
  const llmOptions: MemoryLlmOptions = {};
  if (options.tokens) {
    llmOptions.tokens = options.tokens;
  }
  if (options.fail) {
    llmOptions.fail = options.fail;
  }
  const llm = createMemoryLlmApi(llmOptions);
  const history: AgentChatMessage[] = [];
  let lastOutgoing: AgentChatMessage[] = [];
  const notes: Record<string, MemoryNote> = { ...(options.notes ?? {}) };
  const tasks = [...(options.tasks ?? [])];
  const events = [...(options.events ?? [])];
  const queued = options.turns ? [...options.turns] : null;
  let streamSeq = 0;
  let seq = 0;
  let pending: AgentPlanEvent | null = null;
  let pendingItems: MemoryStaged[] = [];
  let applied: ApprovePlanResult | null = null;

  const nextTurn = (): MemoryAgentTurn => {
    if (queued && queued.length > 0) {
      return queued.shift() ?? {};
    }
    return { tokens: options.tokens ?? ["p", "ong"] };
  };

  return {
    history() {
      return history.map((message) => ({ ...message }));
    },
    lastOutgoing() {
      return lastOutgoing.map((message) => ({ ...message }));
    },
    pendingPlan() {
      return pending
        ? { ...pending, items: pending.items.map((item) => ({ ...item })) }
        : null;
    },
    tasks() {
      return tasks.map((task) => ({ ...task }));
    },
    events() {
      return events.map((event) => ({ ...event }));
    },
    approvePlan(input) {
      const planId = input.plan_id.trim();
      if (!planId) {
        throw new LlmError("invalid", "plan_id is required");
      }
      if (applied && applied.plan_id === planId) {
        return Promise.resolve(applied);
      }
      if (!pending || pending.plan_id !== planId) {
        throw new LlmError("invalid", "plan not found");
      }
      const items: AppliedPlanItem[] = [];
      for (const item of pendingItems) {
        if (item.kind === "create_task") {
          const date = item.today || new Date().toISOString().slice(0, 10);
          let noteId = Object.entries(notes).find(
            ([, note]) =>
              note.title === date && (note.note_type ?? "daily") === "daily",
          )?.[0];
          if (!noteId) {
            noteId = `daily-${date}`;
            notes[noteId] = {
              title: date,
              body_markdown: "",
              note_type: "daily",
            };
          }
          const task: MemoryTask = {
            id: `mem-task-${String((seq += 1))}`,
            title: item.title ?? "",
            state: "open",
            due_date: item.due_date ?? null,
            note_id: noteId,
          };
          tasks.push(task);
          items.push({ kind: "create_task", task });
        } else if (item.kind === "update_task") {
          const task = tasks.find((row) => row.id === item.id);
          if (!task) {
            throw new LlmError("invalid", "task not found");
          }
          if (item.state) {
            task.state = item.state;
          }
          if (item.due_date !== undefined) {
            task.due_date = item.due_date;
          }
          items.push({ kind: "update_task", task: { ...task } });
        } else {
          const event: MemoryCalendarEvent = {
            id: `mem-evt-${String((seq += 1))}`,
            title: item.title ?? "",
            start: item.start ?? "",
            end: item.end ?? "",
            task_id: item.task_id ?? null,
          };
          events.push(event);
          items.push({ kind: "create_calendar_event", event });
        }
      }
      applied = { plan_id: planId, items };
      pending = null;
      pendingItems = [];
      return Promise.resolve(applied);
    },
    declinePlan(input) {
      const planId = input.plan_id.trim();
      if (!planId) {
        throw new LlmError("invalid", "plan_id is required");
      }
      if (pending && pending.plan_id === planId) {
        pending = null;
        pendingItems = [];
        applied = null;
        return Promise.resolve({ plan_id: planId, declined: true });
      }
      throw new LlmError("invalid", "plan not found");
    },
    async sendChat(input) {
      const message = input.message.trim();
      if (!message) {
        throw new LlmError("invalid", "message cannot be empty");
      }
      history.push({ role: "user", content: message });
      const outgoing: AgentChatMessage[] = [
        { role: "system", content: TOOLS_SYSTEM },
      ];
      const noteId = input.note_id?.trim() ?? "";
      const note = noteId ? notes[noteId] : undefined;
      if (note) {
        outgoing.push({
          role: "system",
          content: formatNoteContext(note.title, note.body_markdown),
        });
      }
      outgoing.push(...history);
      lastOutgoing = outgoing.map((item) => ({ ...item }));

      if (options.fail) {
        try {
          await llm.streamChat({ messages: outgoing });
        } catch (err) {
          throw toLlmError(err);
        }
      }

      const streamId = `mem-${String((streamSeq += 1))}`;
      return new Promise((resolve, reject) => {
        queueMicrotask(() => {
          try {
            let text = "";
            const staged: MemoryStaged[] = [];
            for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
              const turn = nextTurn();
              lastOutgoing = outgoing.map((item) => ({ ...item }));
              const tokens = turn.tokens ?? [];
              text = tokens.join("");
              for (const token of tokens) {
                emitWindow(LLM_TOKEN_EVENT, {
                  stream_id: streamId,
                  text: token,
                });
              }
              const calls = turn.tool_calls ?? [];
              if (calls.length === 0) {
                break;
              }
              outgoing.push({
                role: "assistant",
                content: text,
                tool_calls: calls,
              });
              for (const call of calls) {
                emitWindow(AGENT_TOOL_EVENT, {
                  stream_id: streamId,
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                });
                const result = executeMemoryTool(
                  call.name,
                  call.arguments,
                  notes,
                  tasks,
                  events,
                );
                const stagedItem = asStaged(result);
                if (stagedItem) {
                  staged.push(stagedItem);
                }
                emitWindow(AGENT_TOOL_RESULT_EVENT, {
                  stream_id: streamId,
                  id: call.id,
                  name: call.name,
                  result,
                });
                outgoing.push({
                  role: "tool",
                  content: JSON.stringify(result),
                  tool_call_id: call.id,
                });
              }
            }
            if (staged.length > 0) {
              const summary = summarizeMemoryPlan(staged);
              const event: AgentPlanEvent = {
                stream_id: streamId,
                plan_id: `plan-${streamId}`,
                title: summary.title,
                date_label: summary.date_ymd
                  ? formatShortDay(summary.date_ymd)
                  : null,
                items: staged.map(memoryPlanItem),
                approve_label: summary.approve_label,
                decline_label: AGENT_PLAN_DECLINE_LABEL,
                reassurance: AGENT_PLAN_REASSURANCE,
              };
              pending = event;
              pendingItems = staged;
              applied = null;
              emitWindow(AGENT_PLAN_EVENT, event);
            }
            emitWindow(LLM_DONE_EVENT, { stream_id: streamId, text });
            history.push({ role: "assistant", content: text });
            lastOutgoing = outgoing.map((item) => ({ ...item }));
            resolve({
              stream_id: streamId,
              text,
              engine_id: "fake",
            });
          } catch (err) {
            reject(toLlmError(err));
          }
        });
      });
    },
    clearConversation() {
      history.length = 0;
      lastOutgoing = [];
      pending = null;
      pendingItems = [];
      applied = null;
      return Promise.resolve();
    },
  };
}

/** ⌥⌘A as drawn; Alt+Ctrl+A matches the native CmdOrCtrl accelerator. */
export function isAssistantShortcut(event: KeyboardEvent): boolean {
  if (event.repeat) {
    return false;
  }
  if (event.key.toLowerCase() !== "a") {
    return false;
  }
  if (!event.altKey) {
    return false;
  }
  return event.metaKey || event.ctrlKey;
}

export async function subscribeAgentTools(
  handler: (event: AgentToolEvent) => void,
): Promise<() => void> {
  return subscribeEvent(AGENT_TOOL_EVENT, (payload) => {
    const event = parseAgentToolEvent(payload);
    if (event) {
      handler(event);
    }
  });
}

export async function subscribeAgentToolResults(
  handler: (event: AgentToolResultEvent) => void,
): Promise<() => void> {
  return subscribeEvent(AGENT_TOOL_RESULT_EVENT, (payload) => {
    const event = parseAgentToolResultEvent(payload);
    if (event) {
      handler(event);
    }
  });
}

export function parseAgentPlanEvent(payload: unknown): AgentPlanEvent | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  const stream_id = readString(record, ["stream_id", "streamId"]);
  const plan_id = readString(record, ["plan_id", "planId"]);
  const title = readString(record, ["title"]);
  if (!stream_id || !plan_id || !title || !Array.isArray(record.items)) {
    return null;
  }
  const items: AgentPlanItemView[] = [];
  for (const raw of record.items) {
    const item = asRecord(raw);
    if (!item) {
      continue;
    }
    const kind = readString(item, ["kind"]);
    if (!kind) {
      continue;
    }
    const view: AgentPlanItemView = {
      kind,
      title: typeof item.title === "string" ? item.title : "",
    };
    const timeRange =
      typeof item.time_range === "string"
        ? item.time_range
        : typeof item.timeRange === "string"
          ? item.timeRange
          : null;
    if (timeRange) {
      view.time_range = timeRange;
    }
    if (typeof item.start === "string") {
      view.start = item.start;
    }
    if (typeof item.end === "string") {
      view.end = item.end;
    }
    const taskId =
      typeof item.task_id === "string"
        ? item.task_id
        : typeof item.taskId === "string"
          ? item.taskId
          : null;
    if (taskId) {
      view.task_id = taskId;
    }
    if (typeof item.id === "string") {
      view.id = item.id;
    }
    const due =
      typeof item.due_date === "string"
        ? item.due_date
        : typeof item.dueDate === "string"
          ? item.dueDate
          : null;
    if (due) {
      view.due_date = due;
    }
    if (typeof item.state === "string") {
      view.state = item.state;
    }
    if (typeof item.priority === "string") {
      view.priority = item.priority;
    }
    items.push(view);
  }
  const dateLabel = record.date_label ?? record.dateLabel;
  return {
    stream_id,
    plan_id,
    title,
    date_label: typeof dateLabel === "string" ? dateLabel : null,
    items,
    approve_label: readString(record, ["approve_label", "approveLabel"]) ?? "",
    decline_label:
      readString(record, ["decline_label", "declineLabel"]) ??
      AGENT_PLAN_DECLINE_LABEL,
    reassurance: readString(record, ["reassurance"]) ?? AGENT_PLAN_REASSURANCE,
  };
}

export async function subscribeAgentPlan(
  handler: (event: AgentPlanEvent) => void,
): Promise<() => void> {
  return subscribeEvent(AGENT_PLAN_EVENT, (payload) => {
    const event = parseAgentPlanEvent(payload);
    if (event) {
      handler(event);
    }
  });
}

export async function subscribeAssistantToggle(
  handler: () => void,
): Promise<() => void> {
  const unlistenEvent = await subscribeEvent(AGENT_TOGGLE_EVENT, () => {
    handler();
  });
  if (isTauriRuntime() || typeof window === "undefined") {
    return unlistenEvent;
  }
  const onKey = (event: KeyboardEvent) => {
    if (!isAssistantShortcut(event)) {
      return;
    }
    event.preventDefault();
    handler();
  };
  window.addEventListener("keydown", onKey);
  return () => {
    unlistenEvent();
    window.removeEventListener("keydown", onKey);
  };
}

async function subscribeEvent(
  name: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  if (isTauriRuntime()) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen(name, (event) => {
        handler(tauriListenPayload(event));
      });
    } catch {
      // jsdom tests stub `__TAURI_INTERNALS__` without listen.
    }
  }
  if (typeof window === "undefined") {
    return () => {};
  }
  const wrapped = (event: Event) => {
    handler((event as CustomEvent<unknown>).detail);
  };
  window.addEventListener(name, wrapped);
  return () => {
    window.removeEventListener(name, wrapped);
  };
}

/** Browser `npm run dev` has no Tauri IPC; use memory so chat can be previewed. */
export const agentApi: AgentApi = isTauriRuntime()
  ? tauriAgentApi
  : createMemoryAgentApi();
