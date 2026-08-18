import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri llm IPC arg keys (ENG-70)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("save / set / stream pass camelCase top-level keys", async () => {
    const { llmApi } = await import("./api");
    await llmApi.getSettings();
    await llmApi.saveSettings({
      base_url: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
    });
    await llmApi.setApiKey("sk-test");
    await llmApi.clearApiKey();
    await llmApi.testConnection();
    await llmApi.streamChat({
      messages: [{ role: "user", content: "ping" }],
    });

    expect(invoke).toHaveBeenCalledWith("get_llm_settings");
    expect(invoke).toHaveBeenCalledWith("save_llm_settings", {
      input: {
        base_url: "http://127.0.0.1:11434/v1",
        model: "llama3.2",
      },
    });
    expect(invoke).toHaveBeenCalledWith("set_llm_api_key", {
      apiKey: "sk-test",
    });
    expect(invoke).toHaveBeenCalledWith("clear_llm_api_key");
    expect(invoke).toHaveBeenCalledWith("test_llm_connection");
    expect(invoke).toHaveBeenCalledWith("stream_llm_chat", {
      input: {
        messages: [{ role: "user", content: "ping" }],
      },
    });
  });
});
