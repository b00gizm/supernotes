import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri meeting summary IPC arg keys (ENG-71)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("get / generate pass camelCase meetingNoteId", async () => {
    const { summaryApi } = await import("./summaryApi");
    await summaryApi.getSummary("note-1");
    await summaryApi.generateSummary("note-1");

    expect(invoke).toHaveBeenCalledWith("get_meeting_summary", {
      meetingNoteId: "note-1",
    });
    expect(invoke).toHaveBeenCalledWith("generate_meeting_summary", {
      meetingNoteId: "note-1",
    });
  });
});
