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

  it("getMeeting / getMeetingForEvent / from-event pass camelCase ids", async () => {
    const { meetingsApi } = await import("./meetings");
    await meetingsApi.getMeeting("note-1");
    await meetingsApi.getMeetingForEvent("evt-1");
    await meetingsApi.createMeetingNoteFromEvent("evt-1");

    expect(invoke).toHaveBeenCalledWith("get_meeting", { noteId: "note-1" });
    expect(invoke).toHaveBeenCalledWith("get_meeting_for_event", {
      eventId: "evt-1",
    });
    expect(invoke).toHaveBeenCalledWith("create_meeting_note_from_event", {
      eventId: "evt-1",
    });
  });

  it("create/update pass snake_case fields inside input", async () => {
    const { meetingsApi } = await import("./meetings");
    await meetingsApi.createMeetingNote({
      title: "Pricing sync",
      meeting_date: "2026-08-10",
      start_time: "14:00",
      end_time: "14:23",
    });
    await meetingsApi.updateMeeting({
      note_id: "note-1",
      meeting_date: "2026-08-11",
      start_time: "10:00",
      end_time: "10:30",
    });

    expect(invoke).toHaveBeenCalledWith("create_meeting_note", {
      input: {
        title: "Pricing sync",
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
      },
    });
  });
});
