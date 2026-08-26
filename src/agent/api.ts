import { invoke } from "@tauri-apps/api/core";
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
export const MAX_TOOL_ITERATIONS = 8;

const TOOLS_SYSTEM =
  "You have read-only tools for the user's notes, tasks, calendar, and daily notes. Use them to answer from real app data instead of guessing.";

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

export type AgentChatMessage = LlmChatMessage & {
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
};

export type AgentApi = {
  sendChat: (input: SendAgentChatInput) => Promise<LlmChatResult>;
  clearConversation: () => Promise<void>;
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
  sendChat: (input) => invokeAgent<LlmChatResult>("send_agent_chat", { input }),
  clearConversation: async () => {
    await invokeAgent<unknown>("clear_agent_conversation");
  },
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
};

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
  const notes = options.notes ?? {};
  const tasks = options.tasks ?? [];
  const events = options.events ?? [];
  const queued = options.turns ? [...options.turns] : null;
  let streamSeq = 0;

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
    handler(payload as AgentToolEvent);
  });
}

export async function subscribeAgentToolResults(
  handler: (event: AgentToolResultEvent) => void,
): Promise<() => void> {
  return subscribeEvent(AGENT_TOOL_RESULT_EVENT, (payload) => {
    handler(payload as AgentToolResultEvent);
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
    const { listen } = await import("@tauri-apps/api/event");
    return listen(name, (event) => {
      handler(event.payload);
    });
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
