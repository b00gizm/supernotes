import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLlmApi, type LlmErrorCode, type LlmSettings } from "./api";
import { LlmSettings } from "./LlmSettings";

describe("memory LLM settings (ENG-70 UI)", () => {
  it("never returns the API key from getSettings", async () => {
    const api = createMemoryLlmApi({ apiKey: "sk-secret-never-read" });
    const settings = await api.getSettings();
    expect(settings.has_api_key).toBe(true);
    expect(settings).not.toHaveProperty("api_key");
    expect(JSON.stringify(settings)).not.toContain("sk-secret");
  });

  it("stores a new key in RAM only after setApiKey", async () => {
    const api = createMemoryLlmApi();
    expect((await api.getSettings()).has_api_key).toBe(false);
    await api.setApiKey("sk-new");
    const settings = await api.getSettings();
    expect(settings.has_api_key).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("sk-new");
    await api.clearApiKey();
    expect((await api.getSettings()).has_api_key).toBe(false);
  });
});

describe("LlmSettings (ENG-70 UI)", () => {
  it("shows base URL, write-only API key, model, and test connection", async () => {
    const api = createMemoryLlmApi({
      settings: {
        base_url: "http://127.0.0.1:11434/v1",
        model: "llama3.2",
      },
    });
    render(<LlmSettings api={api} />);

    expect(await screen.findByLabelText("Base URL")).toHaveValue(
      "http://127.0.0.1:11434/v1",
    );
    expect(screen.getByLabelText("Model")).toHaveValue("llama3.2");
    const key = screen.getByLabelText("API key");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("placeholder", "API key");
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeInTheDocument();
  });

  it("saves a typed key without ever logging it or echoing it back", async () => {
    const user = userEvent.setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = createMemoryLlmApi();
    render(<LlmSettings api={api} />);

    const key = await screen.findByLabelText("API key");
    await user.type(key, "sk-do-not-log");
    await user.tab();

    await waitFor(async () => {
      expect((await api.getSettings()).has_api_key).toBe(true);
    });
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("placeholder", "Key saved");
    expect(JSON.stringify(await api.getSettings())).not.toContain(
      "sk-do-not-log",
    );

    const leaked = [
      ...log.mock.calls,
      ...info.mock.calls,
      ...debug.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]
      .flat()
      .map(String)
      .join("\n");
    expect(leaked).not.toContain("sk-do-not-log");
    log.mockRestore();
    info.mockRestore();
    debug.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it("streams test tokens as they arrive", async () => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({
      apiKey: "sk-ok",
      tokens: ["ping", " pong"],
    });
    render(<LlmSettings api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    const output = await screen.findByLabelText("Test connection output");
    await waitFor(() => {
      expect(output).toHaveTextContent("ping pong");
    });
  });

  it.each<[LlmErrorCode, string]>([
    [
      "unreachable",
      "Could not reach the API. Check the base URL and that the server is running.",
    ],
    ["invalid_key", "The API key was rejected. Check the key and try again."],
    [
      "rate_limited",
      "The API rate limit was hit. Wait a moment and try again.",
    ],
  ])("shows a human-readable %s error", async (code, message) => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({ apiKey: "sk-ok", testError: code });
    render(<LlmSettings api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("persists base URL and model without sending a key when the field is empty", async () => {
    const user = userEvent.setup();
    const saved: LlmSettings[] = [];
    const api = createMemoryLlmApi({
      settings: { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    });
    const innerSave = api.saveSettings.bind(api);
    api.saveSettings = async (input) => {
      const next = await innerSave(input);
      saved.push(next);
      return next;
    };
    const setKey = vi.fn(api.setApiKey);
    api.setApiKey = setKey;

    render(<LlmSettings api={api} />);
    const url = await screen.findByLabelText("Base URL");
    await user.clear(url);
    await user.type(url, "http://localhost:8080/v1");
    await user.tab();

    await waitFor(() => {
      expect(saved.at(-1)?.base_url).toBe("http://localhost:8080/v1");
    });
    expect(setKey).not.toHaveBeenCalled();
  });
});
