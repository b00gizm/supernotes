import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_TOOL_EVENT,
  AGENT_TOOL_RESULT_EVENT,
  isLegalTauriEventName,
  subscribeAgentToolResults,
  subscribeAgentTools,
  tauriListenPayload,
} from "./api";

const listeners = new Map<string, (event: unknown) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: unknown) => void) => {
    listeners.set(name, handler);
    return Promise.resolve(() => {
      listeners.delete(name);
    });
  }),
}));

const hits = [
  { id: "a", title: "pricing north", snippet: "N" },
  { id: "b", title: "pricing south", snippet: "S" },
  { id: "c", title: "pricing east", snippet: "E" },
  { id: "d", title: "pricing west", snippet: "W" },
];

function emitTauriListen(name: string, payload: unknown) {
  const handler = listeners.get(name);
  if (!handler) {
    throw new Error(`no listen handler for ${name}`);
  }
  handler({
    event: name,
    id: 7,
    payload,
  });
}

describe("tauri listen unwrap (ENG-73)", () => {
  beforeEach(() => {
    listeners.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reads payload from the Tauri 2 Event object, not Event.id", () => {
    const event = {
      event: AGENT_TOOL_RESULT_EVENT,
      id: 7,
      payload: {
        stream_id: "s1",
        id: "search-1",
        name: "search_notes",
        result: hits,
      },
    };
    expect(tauriListenPayload(event)).toEqual(event.payload);
    expect(tauriListenPayload(event)).not.toHaveProperty("event");
  });

  it("delivers a search_notes result with 4 hits through listen", async () => {
    const seen: unknown[] = [];
    const unlisten = await subscribeAgentToolResults((event) => {
      seen.push(event);
    });
    emitTauriListen(AGENT_TOOL_RESULT_EVENT, {
      stream_id: "s1",
      id: "search-1",
      name: "search_notes",
      result: hits,
    });
    expect(seen).toEqual([
      {
        stream_id: "s1",
        id: "search-1",
        name: "search_notes",
        result: hits,
      },
    ]);
    unlisten();
  });

  it("still parses camelCase payload fields on the listen path", async () => {
    const names: string[] = [];
    const unlisten = await subscribeAgentTools((event) => {
      names.push(`${event.stream_id}:${event.name}`);
    });
    emitTauriListen(AGENT_TOOL_EVENT, {
      streamId: "s1",
      id: "search-1",
      name: "search_notes",
      arguments: '{"query":"pricing"}',
    });
    expect(names).toEqual(["s1:search_notes"]);
    unlisten();
  });
});

describe("tauri event name charset", () => {
  it("marks agent://tool.result illegal because of the dot", () => {
    expect(isLegalTauriEventName(AGENT_TOOL_EVENT)).toBe(true);
    expect(isLegalTauriEventName("llm://token")).toBe(true);
    expect(isLegalTauriEventName(AGENT_TOOL_RESULT_EVENT)).toBe(false);
    expect(AGENT_TOOL_RESULT_EVENT.includes(".")).toBe(true);
  });
});
