import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLlmApi, type LlmSettings } from "../llm/api";
import { LlmSettings as LlmSettingsScreen } from "./LlmSettings";

describe("LlmSettings (ENG-70 UI)", () => {
  it("shows base URL, write-only API key, model, and test connection", async () => {
    const api = createMemoryLlmApi();
    await api.saveSettings({
      base_url: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
    });
    render(<LlmSettingsScreen api={api} />);

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
    expect(await api.getSettings()).not.toHaveProperty("api_key");
  });

  it("saves a typed key without ever logging it or echoing it back", async () => {
    const user = userEvent.setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = createMemoryLlmApi();
    render(<LlmSettingsScreen api={api} />);

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

  it("shows generic success copy, not streamed tokens", async () => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({ tokens: ["ping", " pong"] });
    render(<LlmSettingsScreen api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    const output = await screen.findByLabelText("Test connection output");
    await waitFor(() => {
      expect(output).toHaveTextContent("Successfully connected");
    });
    expect(output).not.toHaveTextContent("ping");
    expect(output).not.toHaveTextContent("pong");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [
      "unreachable",
      "Could not reach the API. Check the base URL and that the server is running.",
    ],
    [
      "rate_limited",
      "The API rate limit was hit. Wait a moment and try again.",
    ],
  ] as const)("shows a human-readable %s error", async (code, message) => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({
      fail: { code, message: "engine raw copy" },
    });
    render(<LlmSettingsScreen api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).not.toHaveTextContent("engine raw copy");
  });

  it("shows the backend invalid_key message instead of a generic key rejection", async () => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({
      fail: {
        code: "invalid_key",
        message: "OpenCode: model not found (HTTP 200 body)",
      },
    });
    render(<LlmSettingsScreen api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenCode: model not found (HTTP 200 body)",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "The API key was rejected",
    );
    expect(
      screen.queryByLabelText("Test connection output"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the short invalid_key copy when the backend message is empty", async () => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({
      fail: { code: "invalid_key", message: "" },
    });
    render(<LlmSettingsScreen api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The API key was rejected. Check the key and try again.",
    );
  });

  it.each([
    ["invalid", "Base URL must start with http:// or https://."],
    ["request_failed", "The LLM server returned HTTP 500."],
  ] as const)("shows Woz's %s message", async (code, message) => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({ fail: { code, message } });
    render(<LlmSettingsScreen api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Test connection" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("persists base URL and model without sending a key when the field is empty", async () => {
    const user = userEvent.setup();
    const saved: LlmSettings[] = [];
    const api = createMemoryLlmApi();
    const innerSave = api.saveSettings.bind(api);
    api.saveSettings = async (input) => {
      const next = await innerSave(input);
      saved.push(next);
      return next;
    };
    const setKey = vi.fn(api.setApiKey);
    api.setApiKey = setKey;

    render(<LlmSettingsScreen api={api} />);
    const url = await screen.findByLabelText("Base URL");
    await user.clear(url);
    await user.type(url, "http://localhost:8080/v1");
    await user.tab();

    await waitFor(() => {
      expect(saved.at(-1)?.base_url).toBe("http://localhost:8080/v1");
    });
    expect(setKey).not.toHaveBeenCalled();
    expect(saved.at(-1)?.engine_id).toBe("fake");
  });
});
