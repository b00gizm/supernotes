import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AGENT_TOOL_EVENT,
  AGENT_TOOL_RESULT_EVENT,
  ASSISTANT_PANEL_TITLE,
  type AgentApi,
} from "../agent/api";
import { AssistantSidebar } from "./AssistantSidebar";

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

describe("AssistantSidebar Tauri listen path (ENG-73)", () => {
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

  it("expands a listen-delivered search_notes payload to 4 hits", async () => {
    const user = userEvent.setup();
    const api: AgentApi = {
      sendChat() {
        emitTauriListen(AGENT_TOOL_EVENT, {
          stream_id: "late-1",
          id: "search-1",
          name: "search_notes",
          arguments: '{"query":"pricing"}',
        });
        return Promise.resolve({
          stream_id: "late-1",
          text: "Four hits.",
          engine_id: "fake",
        });
      },
      clearConversation() {
        return Promise.resolve();
      },
    };
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    await waitFor(() => {
      expect(listeners.has(AGENT_TOOL_RESULT_EVENT)).toBe(true);
    });

    await user.type(screen.getByLabelText("Ask the Assistant"), "pricing?");
    await user.keyboard("{Enter}");

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    const row = await waitFor(() => {
      const found = pane.querySelector(".assistant-tool-row");
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    await user.click(within(row).getByText(/Searched notes/));

    emitTauriListen(AGENT_TOOL_RESULT_EVENT, {
      stream_id: "late-1",
      id: "search-1",
      name: "search_notes",
      result: hits,
    });
    await waitFor(() => {
      expect(
        row.querySelector(".assistant-tool-result")?.textContent,
      ).toContain("pricing north");
    });
    const body = row.querySelector(".assistant-tool-result")?.textContent;
    expect(body).not.toBe("");
    expect(body).not.toBe("null");
    expect(body).toContain("pricing south");
    expect(body).toContain("pricing east");
    expect(body).toContain("pricing west");
  });
});
