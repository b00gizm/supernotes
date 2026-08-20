import { invoke } from "@tauri-apps/api/core";

export const LLM_TOKEN_EVENT = "llm://token";
export const LLM_DONE_EVENT = "llm://done";
export const LLM_ERROR_EVENT = "llm://error";

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";

export type LlmErrorCode =
  "unreachable" | "invalid_key" | "rate_limited" | "invalid" | "request_failed";

export type LlmSettings = {
  base_url: string;
  model: string;
  has_api_key: boolean;
  engine_id: string;
};

export type SaveLlmSettingsInput = {
  base_url: string;
  model: string;
};

export type LlmChatMessage = {
  role: string;
  content: string;
};

export type StreamLlmChatInput = {
  messages: LlmChatMessage[];
};

export type LlmChatResult = {
  stream_id: string;
  text: string;
  engine_id: string;
};

export type LlmTokenEvent = {
  stream_id: string;
  text: string;
};

export type LlmDoneEvent = {
  stream_id: string;
  text: string;
};

export type LlmIpcError = {
  code: string;
  message: string;
};

export class LlmError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "LlmError";
    this.code = code;
  }
}

export type LlmApi = {
  getSettings: () => Promise<LlmSettings>;
  saveSettings: (input: SaveLlmSettingsInput) => Promise<LlmSettings>;
  setApiKey: (apiKey: string) => Promise<LlmSettings>;
  clearApiKey: () => Promise<LlmSettings>;
  testConnection: () => Promise<LlmChatResult>;
  streamChat: (input: StreamLlmChatInput) => Promise<LlmChatResult>;
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

async function invokeLlm<T>(
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

const tauriLlmApi: LlmApi = {
  getSettings: () => invokeLlm<LlmSettings>("get_llm_settings"),
  saveSettings: (input) =>
    invokeLlm<LlmSettings>("save_llm_settings", { input }),
  setApiKey: (apiKey) => invokeLlm<LlmSettings>("set_llm_api_key", { apiKey }),
  clearApiKey: () => invokeLlm<LlmSettings>("clear_llm_api_key"),
  testConnection: () => invokeLlm<LlmChatResult>("test_llm_connection"),
  streamChat: (input) => invokeLlm<LlmChatResult>("stream_llm_chat", { input }),
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function defaultSettings(engineId = "fake"): LlmSettings {
  return {
    base_url: DEFAULT_LLM_BASE_URL,
    model: DEFAULT_LLM_MODEL,
    has_api_key: false,
    engine_id: engineId,
  };
}

export type MemoryLlmOptions = {
  engineId?: string;
  tokens?: string[];
  fail?: LlmIpcError;
};

/** In-memory LlmApi for tests / browser preview (no live API, no keychain). */
export function createMemoryLlmApi(options: MemoryLlmOptions = {}): LlmApi {
  let settings = defaultSettings(options.engineId ?? "fake");
  let apiKey: string | null = null;
  const tokens = options.tokens ?? ["p", "ong"];

  const emit = (name: string, detail: object) => {
    if (typeof window === "undefined") {
      return;
    }
    window.dispatchEvent(new CustomEvent(name, { detail }));
  };

  const snapshot = (): LlmSettings => ({
    ...settings,
    has_api_key: apiKey !== null && apiKey.trim() !== "",
  });

  const runStream = (streamId: string): LlmChatResult => {
    if (options.fail) {
      emit(LLM_ERROR_EVENT, {
        stream_id: streamId,
        code: options.fail.code,
        message: options.fail.message,
      });
      throw new LlmError(options.fail.code, options.fail.message);
    }
    let text = "";
    for (const token of tokens) {
      text += token;
      emit(LLM_TOKEN_EVENT, { stream_id: streamId, text: token });
    }
    emit(LLM_DONE_EVENT, { stream_id: streamId, text });
    return { stream_id: streamId, text, engine_id: settings.engine_id };
  };

  // Yield so React can commit the empty assistant row before tokens land
  // (Tauri invoke is async; a sync emit races setState).
  const runStreamLater = (streamId: string): Promise<LlmChatResult> =>
    new Promise((resolve, reject) => {
      queueMicrotask(() => {
        try {
          resolve(runStream(streamId));
        } catch (err) {
          reject(toLlmError(err));
        }
      });
    });

  return {
    getSettings() {
      return Promise.resolve(snapshot());
    },
    saveSettings(input) {
      const base_url = input.base_url.trim();
      const model = input.model.trim();
      if (!base_url.startsWith("http://") && !base_url.startsWith("https://")) {
        return Promise.reject(
          new LlmError(
            "invalid",
            "Base URL must start with http:// or https://.",
          ),
        );
      }
      if (!model) {
        return Promise.reject(
          new LlmError("invalid", "Model name is required."),
        );
      }
      settings = { ...settings, base_url, model };
      return Promise.resolve(snapshot());
    },
    setApiKey(key) {
      const trimmed = key.trim();
      if (!trimmed) {
        return Promise.reject(
          new LlmError(
            "invalid",
            "API key cannot be empty. Use clear if you want to remove it.",
          ),
        );
      }
      apiKey = trimmed;
      return Promise.resolve(snapshot());
    },
    clearApiKey() {
      apiKey = null;
      return Promise.resolve(snapshot());
    },
    testConnection() {
      return runStreamLater(`mem-${String(Date.now())}`);
    },
    streamChat(input) {
      if (input.messages.length === 0) {
        return Promise.reject(
          new LlmError("invalid", "messages cannot be empty"),
        );
      }
      return runStreamLater(`mem-${String(Date.now())}`);
    },
  };
}

export async function subscribeLlmTokens(
  handler: (event: LlmTokenEvent) => void,
): Promise<() => void> {
  return subscribeEvent(LLM_TOKEN_EVENT, (payload) => {
    handler(payload as LlmTokenEvent);
  });
}

export async function subscribeLlmDone(
  handler: (event: LlmDoneEvent) => void,
): Promise<() => void> {
  return subscribeEvent(LLM_DONE_EVENT, (payload) => {
    handler(payload as LlmDoneEvent);
  });
}

export async function subscribeLlmErrors(
  handler: (error: LlmIpcError & { stream_id?: string }) => void,
): Promise<() => void> {
  return subscribeEvent(LLM_ERROR_EVENT, (payload) => {
    handler(payload as LlmIpcError & { stream_id?: string });
  });
}

async function subscribeEvent(
  name: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  if (isTauriRuntime()) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      return await listen(name, (event) => {
        handler(event.payload);
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

/** Browser `npm run dev` has no Tauri IPC; use memory so settings can be previewed. */
export const llmApi: LlmApi = isTauriRuntime()
  ? tauriLlmApi
  : createMemoryLlmApi();
