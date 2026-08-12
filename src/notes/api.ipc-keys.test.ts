import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(() => Promise.resolve([]));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe("tauri link IPC arg keys (ENG-86)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("listLinksTo/From pass camelCase keys for Tauri 2", async () => {
    const { notesApi } = await import("./api");
    await notesApi.listLinksTo("target-1");
    await notesApi.listLinksFrom("source-1");

    expect(invoke).toHaveBeenCalledWith("list_links_to", {
      targetNoteId: "target-1",
    });
    expect(invoke).toHaveBeenCalledWith("list_links_from", {
      sourceNoteId: "source-1",
    });
  });
});
