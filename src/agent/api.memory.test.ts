import { describe, expect, it } from "vitest";
import {
  AGENT_TOGGLE_EVENT,
  ASSISTANT_PANEL_TITLE,
  ASSISTANT_SHORTCUT_ACCELERATOR,
  ASSISTANT_SHORTCUT_LABEL,
  createMemoryAgentApi,
  isAssistantShortcut,
  LLM_TOKEN_EVENT,
  LlmError,
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
    expect(agent.lastOutgoing()).toEqual([{ role: "user", content: "hello" }]);

    await agent.sendChat({ message: "again", note_id: null });
    expect(agent.lastOutgoing()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "again" },
    ]);
    expect(agent.history()).toHaveLength(4);

    await agent.clearConversation();
    expect(agent.history()).toEqual([]);
    await agent.sendChat({ message: "fresh", note_id: null });
    expect(agent.lastOutgoing()).toEqual([{ role: "user", content: "fresh" }]);
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
    expect(withNote[0]?.content).toContain("Pricing v2");
    expect(withNote[0]?.content).toContain("usage-based add-ons — café");
    expect(withNote[1]).toEqual({
      role: "user",
      content: "Please proof-read this",
    });

    await agent.clearConversation();
    await agent.sendChat({ message: "hello", note_id: "missing-note" });
    expect(agent.lastOutgoing()).toEqual([{ role: "user", content: "hello" }]);

    await agent.clearConversation();
    await agent.sendChat({ message: "no note", note_id: null });
    expect(agent.lastOutgoing()[0]?.role).toBe("user");
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
