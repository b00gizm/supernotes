import { describe, expect, it } from "vitest";
import {
  createMemoryLlmApi,
  LLM_TOKEN_EVENT,
  LlmError,
  subscribeLlmErrors,
  subscribeLlmTokens,
} from "./api";

describe("memory llm (ENG-70)", () => {
  it("persists base URL + model and never returns the key", async () => {
    const llm = createMemoryLlmApi();
    const saved = await llm.saveSettings({
      base_url: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
    });
    expect(saved.base_url).toBe("http://127.0.0.1:11434/v1");
    expect(saved.model).toBe("llama3.2");
    expect(saved.has_api_key).toBe(false);
    expect(saved).not.toHaveProperty("api_key");

    const withKey = await llm.setApiKey("sk-secret-xyz");
    expect(withKey.has_api_key).toBe(true);
    expect(JSON.stringify(withKey)).not.toContain("sk-secret");

    const cleared = await llm.clearApiKey();
    expect(cleared.has_api_key).toBe(false);
    expect(cleared.base_url).toBe("http://127.0.0.1:11434/v1");
  });

  it("streams test-connection tokens incrementally", async () => {
    const seen: string[] = [];
    const unlisten = await subscribeLlmTokens((event) => {
      seen.push(event.text);
    });
    const llm = createMemoryLlmApi({ tokens: ["p", "ong"] });
    const result = await llm.testConnection();
    expect(seen).toEqual(["p", "ong"]);
    expect(result.text).toBe("pong");
    expect(result.engine_id).toBe("fake");
    unlisten();
    expect(LLM_TOKEN_EVENT).toBe("llm://token");
  });

  it("maps scripted test-connection failure to error codes", async () => {
    const seen: string[] = [];
    const unlisten = await subscribeLlmErrors((error) => {
      seen.push(error.code);
    });
    const llm = createMemoryLlmApi({
      fail: {
        code: "invalid_key",
        message: "The API key was rejected.",
      },
    });
    await expect(llm.testConnection()).rejects.toMatchObject({
      code: "invalid_key",
    });
    expect(seen).toEqual(["invalid_key"]);
    unlisten();
  });

  it("rejects an empty API key", async () => {
    const llm = createMemoryLlmApi();
    await expect(llm.setApiKey("   ")).rejects.toBeInstanceOf(LlmError);
  });
});
