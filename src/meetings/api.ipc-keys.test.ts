import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri meeting IPC arg keys (ENG-68)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("get/create/update use camelCase command args and snake_case fields", async () => {
    const { meetingsApi } = await import("./api");
    await meetingsApi.getMeeting("note-1");
    await meetingsApi.createMeeting({
      note_id: "note-1",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });
    await meetingsApi.updateMeeting({
      note_id: "note-1",
      meeting_date: "2026-08-11",
      start_time: "10:00",
      end_time: "10:30",
      transcript_note_id: null,
    });

    expect(invoke).toHaveBeenCalledWith("get_meeting", { noteId: "note-1" });
    expect(invoke).toHaveBeenCalledWith("create_meeting", {
      input: {
        note_id: "note-1",
        meeting_date: "2026-08-10",
        start_time: "14:00",
        end_time: "14:23",
      },
    });
    expect(invoke).toHaveBeenCalledWith("update_meeting", {
      input: {
        note_id: "note-1",
        meeting_date: "2026-08-11",
        start_time: "10:00",
        end_time: "10:30",
        transcript_note_id: null,
      },
    });
  });
});
