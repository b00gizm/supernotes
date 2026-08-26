import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() =>
    Promise.resolve({
      streamId: "ipc-1",
      text: "",
      engineId: "fake",
    }),
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri agent IPC arg keys (ENG-72)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("send / clear pass camelCase top-level keys", async () => {
    const { agentApi } = await import("./api");
    const first = await agentApi.sendChat({
      message: "Please proof-read this",
      note_id: "note-1",
    });
    expect(first.stream_id).toBe("ipc-1");
    await agentApi.sendChat({ message: "no note", note_id: null });
    await agentApi.clearConversation();

    expect(invoke).toHaveBeenCalledWith("send_agent_chat", {
      input: {
        message: "Please proof-read this",
        note_id: "note-1",
      },
    });
    expect(invoke).toHaveBeenCalledWith("send_agent_chat", {
      input: {
        message: "no note",
        note_id: null,
      },
    });
    expect(invoke).toHaveBeenCalledWith("clear_agent_conversation");
  });
});
