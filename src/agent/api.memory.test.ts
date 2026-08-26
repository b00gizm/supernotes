import { describe, expect, it } from "vitest";
import {
  AGENT_TOGGLE_EVENT,
  AGENT_TOOL_EVENT,
  AGENT_TOOL_RESULT_EVENT,
  ASSISTANT_PANEL_TITLE,
  ASSISTANT_SHORTCUT_ACCELERATOR,
  ASSISTANT_SHORTCUT_LABEL,
  createMemoryAgentApi,
  isAssistantShortcut,
  LLM_TOKEN_EVENT,
  LlmError,
  MAX_TOOL_ITERATIONS,
  subscribeAgentToolResults,
  subscribeAgentTools,
  subscribeAssistantToggle,
  subscribeLlmErrors,
  subscribeLlmTokens,
} from "./api";

describe("memory agent session (ENG-72)", () => {
  it("accumulates history across turns and clear wipes it", async () => {
    const seen: string[] = [];
    const unlisten = await subscribeLlmTokens((event) => {
      seen.push(event.text);
    });
    const agent = createMemoryAgentApi({ tokens: ["ok"] });

    const first = await agent.sendChat({ message: "hello", note_id: null });
    expect(first.text).toBe("ok");
    expect(seen).toEqual(["ok"]);
    expect(
      agent.lastOutgoing().filter((message) => message.role !== "system"),
    ).toEqual([{ role: "user", content: "hello" }]);
    expect(agent.lastOutgoing()[0]?.content).toContain("read-only tools");

    await agent.sendChat({ message: "again", note_id: null });
    expect(
      agent.lastOutgoing().filter((message) => message.role !== "system"),
    ).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "again" },
    ]);
    expect(agent.history()).toHaveLength(4);

    await agent.clearConversation();
    expect(agent.history()).toEqual([]);
    await agent.sendChat({ message: "fresh", note_id: null });
    expect(
      agent.lastOutgoing().filter((message) => message.role !== "system"),
    ).toEqual([{ role: "user", content: "fresh" }]);
    unlisten();
    expect(LLM_TOKEN_EVENT).toBe("llm://token");
  });

  it("includes note body when the id is known and skips missing/none", async () => {
    const agent = createMemoryAgentApi({
      tokens: ["pong"],
      notes: {
        "note-1": {
          title: "Pricing v2",
          body_markdown: "Three tiers, usage-based add-ons — café",
        },
      },
    });

    await agent.sendChat({
      message: "Please proof-read this",
      note_id: "note-1",
    });
    const withNote = agent.lastOutgoing();
    expect(withNote[0]?.role).toBe("system");
    expect(withNote[1]?.role).toBe("system");
    expect(withNote[1]?.content).toContain("Pricing v2");
    expect(withNote[1]?.content).toContain("usage-based add-ons — café");
    expect(withNote[2]).toEqual({
      role: "user",
      content: "Please proof-read this",
    });

    await agent.clearConversation();
    await agent.sendChat({ message: "hello", note_id: "missing-note" });
    expect(
      agent.lastOutgoing().filter((message) => message.role !== "system"),
    ).toEqual([{ role: "user", content: "hello" }]);

    await agent.clearConversation();
    await agent.sendChat({ message: "no note", note_id: null });
    expect(
      agent.lastOutgoing().filter((message) => message.role !== "system")[0]
        ?.role,
    ).toBe("user");
  });

  it("maps scripted failure to llm error codes without an assistant turn", async () => {
    const codes: string[] = [];
    const unlisten = await subscribeLlmErrors((error) => {
      codes.push(error.code);
    });
    const agent = createMemoryAgentApi({
      fail: {
        code: "unreachable",
        message: "Could not reach the LLM server.",
      },
    });
    await expect(
      agent.sendChat({ message: "hello", note_id: null }),
    ).rejects.toMatchObject({ code: "unreachable" });
    expect(codes).toEqual(["unreachable"]);
    expect(agent.history()).toEqual([{ role: "user", content: "hello" }]);
    unlisten();
  });

  it("scripts tool_calls, executes them, and emits tool events", async () => {
    const calls: string[] = [];
    const results: unknown[] = [];
    const unlistenTool = await subscribeAgentTools((event) => {
      calls.push(event.name);
    });
    const unlistenResult = await subscribeAgentToolResults((event) => {
      results.push(event.result);
    });
    const agent = createMemoryAgentApi({
      notes: {
        "note-1": {
          title: "Mike Q3 sync",
          body_markdown: "Mike said the Q3 numbers slipped to 4.2M",
        },
      },
      tasks: [
        {
          id: "t1",
          title: "Send Q3 deck",
          state: "open",
          due_date: "2026-08-25",
        },
      ],
      events: [
        {
          id: "e1",
          title: "Standup",
          start: "2026-08-25T09:00:00.000Z",
          end: "2026-08-25T09:30:00.000Z",
          task_id: "t1",
        },
      ],
      turns: [
        {
          tool_calls: [
            {
              id: "call_1",
              name: "list_calendar_events",
              arguments: '{"date":"2026-08-25"}',
            },
            {
              id: "call_2",
              name: "search_notes",
              arguments: '{"query":"Q3"}',
            },
          ],
        },
        { tokens: ["Standup, and Mike said 4.2M."] },
      ],
    });

    const result = await agent.sendChat({
      message: "What's on my agenda today?",
      note_id: null,
    });
    expect(result.text).toBe("Standup, and Mike said 4.2M.");
    expect(calls).toEqual(["list_calendar_events", "search_notes"]);
    const listed = results[0] as Array<{
      title: string;
      task: { title: string } | null;
    }>;
    expect(listed[0]?.title).toBe("Standup");
    expect(listed[0]?.task?.title).toBe("Send Q3 deck");
    const notes = results[1] as Array<{ title: string; snippet: string }>;
    expect(notes[0]?.title).toBe("Mike Q3 sync");
    expect(notes[0]?.snippet).toContain("Q3 numbers");
    expect(AGENT_TOOL_EVENT).toBe("agent://tool");
    expect(AGENT_TOOL_RESULT_EVENT).toBe("agent://tool-result");
    unlistenTool();
    unlistenResult();
  });

  it("caps tool iterations at 8 and still returns text", async () => {
    const agent = createMemoryAgentApi({
      turns: Array.from({ length: 20 }, (_, index) => ({
        tokens: ["looking"],
        tool_calls: [
          {
            id: `call_${String(index)}`,
            name: "search_notes",
            arguments: '{"query":"x"}',
          },
        ],
      })),
    });
    const result = await agent.sendChat({
      message: "loop forever",
      note_id: null,
    });
    expect(result.text).toBe("looking");
    expect(MAX_TOOL_ITERATIONS).toBe(8);
  });

  it("returns empty tool results instead of throwing", async () => {
    const results: unknown[] = [];
    const unlisten = await subscribeAgentToolResults((event) => {
      results.push(event.result);
    });
    const agent = createMemoryAgentApi({
      turns: [
        {
          tool_calls: [
            {
              id: "c1",
              name: "search_notes",
              arguments: '{"query":""}',
            },
            {
              id: "c2",
              name: "get_note",
              arguments: '{"id_or_title":"missing"}',
            },
            {
              id: "c3",
              name: "not_a_tool",
              arguments: "{}",
            },
          ],
        },
        { tokens: ["ok"] },
      ],
    });
    const first = await agent.sendChat({ message: "lookup", note_id: null });
    expect(first.text).toBe("ok");
    expect(results).toEqual([[], null, { error: "unknown tool: not_a_tool" }]);
    const second = await agent.sendChat({ message: "again", note_id: null });
    expect(second.text).toBe("pong");
    unlisten();
  });

  it("rejects an empty message", async () => {
    const agent = createMemoryAgentApi();
    await expect(
      agent.sendChat({ message: "   ", note_id: null }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(agent.history()).toEqual([]);
  });

  it("binds mockup 1i shortcut chrome and browser toggle", async () => {
    expect(ASSISTANT_PANEL_TITLE).toBe("Assistant");
    expect(ASSISTANT_SHORTCUT_ACCELERATOR).toBe("Alt+CmdOrCtrl+A");
    expect(ASSISTANT_SHORTCUT_LABEL).toBe("⌥⌘A");
    expect(AGENT_TOGGLE_EVENT).toBe("agent://toggle");
    expect(
      isAssistantShortcut(
        new KeyboardEvent("keydown", { key: "a", altKey: true, metaKey: true }),
      ),
    ).toBe(true);
    expect(
      isAssistantShortcut(
        new KeyboardEvent("keydown", { key: "a", altKey: true, ctrlKey: true }),
      ),
    ).toBe(true);
    expect(
      isAssistantShortcut(
        new KeyboardEvent("keydown", { key: "a", metaKey: true }),
      ),
    ).toBe(false);

    let toggles = 0;
    const unlisten = await subscribeAssistantToggle(() => {
      toggles += 1;
    });
    window.dispatchEvent(new CustomEvent(AGENT_TOGGLE_EVENT));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", altKey: true, metaKey: true }),
    );
    expect(toggles).toBe(2);
    unlisten();
  });
});
