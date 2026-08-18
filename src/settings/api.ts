/**
 * UI-owned LLM settings contract (ENG-70).
 *
 * Woz owns the Rust client, keychain, IPC, and TS wrapper. This file is the
 * memory stand-in so the settings screen can ship against chrome + events
 * before that wrapper is on a PR. Do not add `invoke` here.
 *
 * Expected Woz surface (from the ENG-70 split; names are his to finalize):
 * - get/save settings: `base_url` + `model` only (never the key)
 * - set/clear API key (keychain only)
 * - test connection
 * - streamed token / error events
 * - error codes: `unreachable` | `invalid_key` | `rate_limited`
 */

export const LLM_TOKEN_EVENT = "llm://token";
export const LLM_ERROR_EVENT = "llm://error";

export type LlmErrorCode = "unreachable" | "invalid_key" | "rate_limited";

export type LlmSettings = {
  base_url: string;
  model: string;
  has_api_key: boolean;
};

export type LlmSettingsInput = {
  base_url: string;
  model: string;
};

export type LlmTokenEvent = {
  token: string;
  done: boolean;
};

export type LlmErrorEvent = {
  code: LlmErrorCode;
  message: string;
};

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}

export type LlmSettingsApi = {
  getSettings: () => Promise<LlmSettings>;
  saveSettings: (input: LlmSettingsInput) => Promise<LlmSettings>;
  setApiKey: (apiKey: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  testConnection: () => Promise<void>;
};

export function llmErrorMessage(code: LlmErrorCode): string {
  switch (code) {
    case "unreachable":
      return "Could not reach the API. Check the base URL and that the server is running.";
    case "invalid_key":
      return "The API key was rejected. Check the key and try again.";
    case "rate_limited":
      return "The API rate limit was hit. Wait a moment and try again.";
  }
}

export function llmErrorFromUnknown(err: unknown): string {
  if (err instanceof LlmError) {
    return llmErrorMessage(err.code);
  }
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err.code === "unreachable" ||
      err.code === "invalid_key" ||
      err.code === "rate_limited")
  ) {
    return llmErrorMessage(err.code);
  }
  return err instanceof Error ? err.message : "Could not talk to the API";
}

export type MemoryLlmOptions = {
  settings?: Partial<LlmSettingsInput>;
  /** RAM-only. Never returned from getSettings. */
  apiKey?: string;
  testError?: LlmErrorCode;
  tokens?: string[];
  tokenDelayMs?: number;
};

function emit(name: string, detail: object): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** In-memory LlmSettingsApi for tests / `npm run dev`. Key stays in RAM. */
export function createMemoryLlmApi(
  options: MemoryLlmOptions = {},
): LlmSettingsApi {
  let baseUrl = options.settings?.base_url ?? "https://api.openai.com/v1";
  let model = options.settings?.model ?? "gpt-4o-mini";
  // ponytail: RAM-only until Woz's keychain wrapper lands. Never log this.
  let apiKey = options.apiKey ?? "";
  const tokens = options.tokens ?? ["Hello", " from", " the", " model."];
  const tokenDelayMs = options.tokenDelayMs ?? 0;

  const snapshot = (): LlmSettings => ({
    base_url: baseUrl,
    model,
    has_api_key: apiKey.length > 0,
  });

  const fail = (code: LlmErrorCode): never => {
    const error = new LlmError(code, llmErrorMessage(code));
    emit(LLM_ERROR_EVENT, { code: error.code, message: error.message });
    throw error;
  };

  return {
    getSettings() {
      return Promise.resolve(snapshot());
    },
    saveSettings(input) {
      baseUrl = input.base_url.trim();
      model = input.model.trim();
      return Promise.resolve(snapshot());
    },
    setApiKey(next) {
      apiKey = next;
      return Promise.resolve();
    },
    clearApiKey() {
      apiKey = "";
      return Promise.resolve();
    },
    async testConnection() {
      if (options.testError) {
        fail(options.testError);
      }
      if (!baseUrl) {
        fail("unreachable");
      }
      if (!apiKey) {
        fail("invalid_key");
      }
      for (const token of tokens) {
        await sleep(tokenDelayMs);
        emit(LLM_TOKEN_EVENT, { token, done: false });
      }
      emit(LLM_TOKEN_EVENT, { token: "", done: true });
    },
  };
}

export async function subscribeLlmTestTokens(
  handler: (event: LlmTokenEvent) => void,
): Promise<() => void> {
  return subscribeEvent(LLM_TOKEN_EVENT, (payload) => {
    handler(payload as LlmTokenEvent);
  });
}

export async function subscribeLlmTestErrors(
  handler: (event: LlmErrorEvent) => void,
): Promise<() => void> {
  return subscribeEvent(LLM_ERROR_EVENT, (payload) => {
    handler(payload as LlmErrorEvent);
  });
}

function subscribeEvent(
  name: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  if (typeof window === "undefined") {
    return Promise.resolve(() => {});
  }
  const wrapped = (event: Event) => {
    handler((event as CustomEvent<unknown>).detail);
  };
  window.addEventListener(name, wrapped);
  return Promise.resolve(() => {
    window.removeEventListener(name, wrapped);
  });
}

/** Browser / tests: memory only until Woz's wrapper is on a PR. */
export const llmApi: LlmSettingsApi = createMemoryLlmApi({
  tokenDelayMs: 40,
});
