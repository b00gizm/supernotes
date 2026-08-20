import { invoke } from "@tauri-apps/api/core";
import {
  createMemoryLlmApi,
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

export type SendAgentChatInput = {
  message: string;
  note_id: string | null;
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
};

export type MemoryAgentOptions = {
  tokens?: string[];
  fail?: LlmIpcError;
  notes?: Record<string, MemoryNote>;
};

export type MemoryAgentApi = AgentApi & {
  history: () => LlmChatMessage[];
  lastOutgoing: () => LlmChatMessage[];
};

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
  const history: LlmChatMessage[] = [];
  let lastOutgoing: LlmChatMessage[] = [];
  const notes = options.notes ?? {};

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
      const outgoing: LlmChatMessage[] = [];
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
      try {
        const result = await llm.streamChat({ messages: outgoing });
        history.push({ role: "assistant", content: result.text });
        return result;
      } catch (err) {
        throw toLlmError(err);
      }
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
