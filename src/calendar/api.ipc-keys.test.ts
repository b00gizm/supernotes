import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("tauri calendar IPC arg keys (ENG-65)", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  it("listEvents passes camelCase from/to for Tauri 2", async () => {
    const { calendarApi } = await import("./api");
    await calendarApi.listEvents(
      "2026-08-10T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
    );

    expect(invoke).toHaveBeenCalledWith("list_calendar_events", {
      from: "2026-08-10T00:00:00.000Z",
      to: "2026-08-17T00:00:00.000Z",
    });
  });

  it("create/update pass snake_case fields inside input", async () => {
    const { calendarApi } = await import("./api");
    await calendarApi.createEvent({
      title: "Standup",
      start: "2026-08-10T09:30:00.000Z",
      end: "2026-08-10T09:45:00.000Z",
    });
    await calendarApi.updateEvent({
      id: "evt-1",
      title: "Standup",
      start: "2026-08-10T10:00:00.000Z",
      end: "2026-08-10T10:15:00.000Z",
      task_id: null,
    });
    await calendarApi.deleteEvent("evt-1");
    await calendarApi.getEvent("evt-1");

    expect(invoke).toHaveBeenCalledWith("create_calendar_event", {
      input: {
        title: "Standup",
        start: "2026-08-10T09:30:00.000Z",
        end: "2026-08-10T09:45:00.000Z",
      },
    });
    expect(invoke).toHaveBeenCalledWith("update_calendar_event", {
      input: {
        id: "evt-1",
        title: "Standup",
        start: "2026-08-10T10:00:00.000Z",
        end: "2026-08-10T10:15:00.000Z",
        task_id: null,
      },
    });
    expect(invoke).toHaveBeenCalledWith("delete_calendar_event", {
      id: "evt-1",
    });
    expect(invoke).toHaveBeenCalledWith("get_calendar_event", { id: "evt-1" });
  });

  it("createEvent forwards task_id for time-blocking", async () => {
    const { calendarApi } = await import("./api");
    await calendarApi.createEvent({
      title: "Focus",
      start: "2026-08-10T16:00:00.000Z",
      end: "2026-08-10T16:15:00.000Z",
      task_id: "t-1",
    });
    expect(invoke).toHaveBeenCalledWith("create_calendar_event", {
      input: {
        title: "Focus",
        start: "2026-08-10T16:00:00.000Z",
        end: "2026-08-10T16:15:00.000Z",
        task_id: "t-1",
      },
    });
  });
});
