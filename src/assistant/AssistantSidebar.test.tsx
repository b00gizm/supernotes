import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_TOOL_EVENT,
  AGENT_TOOL_RESULT_EVENT,
  ASSISTANT_PANEL_TITLE,
  ASSISTANT_SHORTCUT_LABEL,
  createMemoryAgentApi,
  type AgentApi,
  type SendAgentChatInput,
} from "../agent/api";
import {
  ACT_ON_NOTE_PROMPT,
  ASSISTANT_PLACEHOLDER,
  AssistantSidebar,
} from "./AssistantSidebar";
import { AssistantMarkdown } from "./markdown";

describe("AssistantSidebar (ENG-72)", () => {
  it("matches mockup 1i chrome", () => {
    render(<AssistantSidebar open onClose={() => {}} noteId={null} />);

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    const title = within(pane).getByRole("heading", {
      name: ASSISTANT_PANEL_TITLE,
    });
    expect(title).toHaveClass("assistant-title");
    expect(title).not.toHaveClass("pane-title");
    expect(title.querySelector(".assistant-star")).toBeTruthy();
    expect(within(pane).getByText(ASSISTANT_SHORTCUT_LABEL)).toHaveClass(
      "search-chip",
    );
    expect(within(pane).queryByText("⌘⇧A")).not.toBeInTheDocument();
    expect(within(pane).queryByText("⌘J")).not.toBeInTheDocument();
    expect(
      within(pane).getByRole("button", {
        name: `Close ${ASSISTANT_PANEL_TITLE}`,
      }),
    ).toBeInTheDocument();
    const actions = pane.querySelector(".assistant-header-actions");
    expect(actions).toBeTruthy();
    expect(
      [...(actions?.children ?? [])].map((node) => {
        if (node.classList.contains("assistant-clear")) {
          return "Clear";
        }
        if (node.classList.contains("search-chip")) {
          return node.textContent;
        }
        if (node.classList.contains("assistant-close")) {
          return "X";
        }
        return node.textContent;
      }),
    ).toEqual(["Clear", ASSISTANT_SHORTCUT_LABEL, "X"]);
    expect(within(pane).getByLabelText("Ask the Assistant")).toHaveAttribute(
      "placeholder",
      ASSISTANT_PLACEHOLDER,
    );
  });

  it("renders numbered lists in the same markdown subset", () => {
    const { container } = render(
      <AssistantMarkdown text={"1. first\n2. **second**\n3. third"} />,
    );
    const items = container.querySelectorAll("ol.assistant-md-list li");
    expect([...items].map((item) => item.textContent)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(items[1]?.querySelector("strong")?.textContent).toBe("second");
    expect(container.innerHTML).not.toMatch(/<script/i);
  });

  it("proof-reads against the open note and streams markdown", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      tokens: ["Looks ", "**fine**", "."],
      notes: {
        "note-1": {
          title: "Thursday, Aug 6",
          body_markdown: "Ths sentnce has typos.",
        },
      },
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId="note-1" api={api} />,
    );

    await user.type(
      screen.getByLabelText("Ask the Assistant"),
      "Please proof-read this",
    );
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(api.lastOutgoing().length).toBeGreaterThan(0);
    });
    const outgoing = api.lastOutgoing();
    const noteCtx = outgoing.find((message) =>
      message.content.includes("Ths sentnce has typos."),
    );
    expect(noteCtx?.role).toBe("system");
    expect(noteCtx?.content).toContain("Thursday, Aug 6");
    expect(outgoing.at(-1)).toEqual({
      role: "user",
      content: "Please proof-read this",
    });

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    expect(
      within(pane)
        .getByText("Please proof-read this")
        .closest(".assistant-user-bubble"),
    ).toBeTruthy();
    await waitFor(() => {
      expect(within(pane).getByText("fine")).toBeInTheDocument();
    });
    expect(within(pane).getByText("fine").tagName).toBe("STRONG");
    expect(
      within(pane)
        .getByText("Looks ", { exact: false })
        .closest(".assistant-user-bubble"),
    ).toBeNull();
  });

  it("sends without note context when none is open", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({ tokens: ["Hi"] });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    await user.type(screen.getByLabelText("Ask the Assistant"), "Hello");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        api.lastOutgoing().filter((message) => message.role !== "system"),
      ).toEqual([{ role: "user", content: "Hello" }]);
    });
    await waitFor(() => {
      expect(screen.getByText("Hi")).toBeInTheDocument();
    });
  });

  it("keeps session history and Clear wipes it", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({ tokens: ["pong"] });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    const input = screen.getByLabelText("Ask the Assistant");
    await user.type(input, "first");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByText("pong")).toBeInTheDocument();
    });

    await user.type(input, "second");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(
        api.lastOutgoing().filter((message) => message.role !== "system"),
      ).toEqual([
        { role: "user", content: "first" },
        { role: "assistant", content: "pong" },
        { role: "user", content: "second" },
      ]);
    });

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => {
      expect(api.history()).toEqual([]);
    });
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.queryByText("pong")).not.toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();
  });

  it("⌘↵ with an empty field acts on the open note", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      tokens: ["ok"],
      notes: {
        "note-2": { title: "Roadmap", body_markdown: "Ship importer" },
      },
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId="note-2" api={api} />,
    );

    screen.getByLabelText("Ask the Assistant").focus();
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(api.lastOutgoing().at(-1)).toEqual({
        role: "user",
        content: ACT_ON_NOTE_PROMPT,
      });
    });
    expect(
      api
        .lastOutgoing()
        .some((message) => message.content.includes("Ship importer")),
    ).toBe(true);
  });

  it("surfaces a failed stream instead of keeping a silent bubble", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      fail: { code: "unreachable", message: "down" },
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    await user.type(screen.getByLabelText("Ask the Assistant"), "Hello");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the API",
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(document.querySelector(".assistant-turn.is-assistant")).toBeNull();
  });

  it("clears mid-stream and ignores leftover tokens", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = createMemoryAgentApi({ tokens: ["pong"] });
    const sent: SendAgentChatInput[] = [];
    let clearCalls = 0;
    const api: AgentApi = {
      async sendChat(input) {
        sent.push(input);
        await gate;
        return inner.sendChat(input);
      },
      clearConversation() {
        clearCalls += 1;
        return inner.clearConversation();
      },
    };
    render(
      <AssistantSidebar open onClose={() => {}} noteId="note-9" api={api} />,
    );

    await user.type(screen.getByLabelText("Ask the Assistant"), "Hello");
    await user.keyboard("{Enter}");
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear).toBeEnabled();
    expect(sent).toEqual([{ message: "Hello", note_id: "note-9" }]);
    expect(sent[0]).not.toHaveProperty("noteId");

    await user.click(clear);
    await waitFor(() => {
      expect(clearCalls).toBe(1);
    });
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();

    release();
    await waitFor(() => {
      expect(inner.history().some((turn) => turn.content === "pong")).toBe(
        true,
      );
    });
    expect(screen.queryByText("pong")).not.toBeInTheDocument();
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("does not steal printable keys from the rest of the workspace", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Outside" />
        <AssistantSidebar open onClose={() => {}} noteId={null} />
      </>,
    );
    const outside = screen.getByLabelText("Outside");
    await user.type(outside, "abc");
    expect(outside).toHaveValue("abc");
    expect(screen.getByLabelText("Ask the Assistant")).toHaveValue("");
  });

  it("closes on Escape when focus is in the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AssistantSidebar open onClose={onClose} noteId={null} />);
    screen.getByLabelText("Ask the Assistant").focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays mounted but hidden when closed", () => {
    const { rerender } = render(
      <AssistantSidebar open onClose={() => {}} noteId={null} />,
    );
    expect(
      screen.getByRole("complementary", { name: ASSISTANT_PANEL_TITLE }),
    ).not.toHaveAttribute("hidden");

    rerender(
      <AssistantSidebar open={false} onClose={() => {}} noteId={null} />,
    );
    expect(
      screen.queryByRole("complementary", { name: ASSISTANT_PANEL_TITLE }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".assistant-sidebar")).toHaveClass(
      "is-closed",
    );
  });
});

describe("AssistantSidebar tool-read rows (ENG-73)", () => {
  const pricingNotes = {
    a: { title: "pricing north", body_markdown: "N" },
    b: { title: "pricing south", body_markdown: "S" },
    c: { title: "pricing east", body_markdown: "E" },
    d: { title: "pricing west", body_markdown: "W" },
  };

  it("renders search_notes copy, count, and expand of the paired result", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      notes: pricingNotes,
      turns: [
        {
          tool_calls: [
            {
              id: "search-1",
              name: "search_notes",
              arguments: '{"query":"pricing"}',
            },
          ],
        },
        { tokens: ["Four hits."] },
      ],
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

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
    expect(row.querySelector(".assistant-tool-summary")).toHaveTextContent(
      "Searched notes · 'pricing' · 4 results",
    );
    expect(row.querySelector(".assistant-tool-chevron")?.textContent).toBe(">");
    expect(row.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(row.querySelector(".assistant-tool-result")).toBeNull();

    await waitFor(() => {
      expect(within(pane).getByText("Four hits.")).toBeInTheDocument();
    });
    const turns = [...pane.querySelectorAll(".assistant-turn")].map(
      (node) => node.className,
    );
    expect(turns).toEqual([
      "assistant-turn is-user",
      "assistant-turn is-tool",
      "assistant-turn is-assistant",
    ]);

    await user.click(within(row).getByText(/Searched notes/));
    expect(row.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const result = row.querySelector(".assistant-tool-result");
    expect(result?.textContent).not.toBe("");
    expect(result?.textContent).not.toBe("null");
    expect(result?.textContent).toContain("pricing north");
    expect(result?.textContent).toContain("pricing south");
    expect(result?.textContent).toContain("pricing east");
    expect(result?.textContent).toContain("pricing west");
  });

  it("labels list_calendar_events with the short day and pairs by id", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      notes: pricingNotes,
      events: [
        {
          id: "e1",
          title: "Pricing review",
          start: "2026-08-13T14:00:00.000Z",
          end: "2026-08-13T15:00:00.000Z",
          task_id: null,
        },
      ],
      turns: [
        {
          tool_calls: [
            {
              id: "cal-1",
              name: "list_calendar_events",
              arguments: '{"date":"2026-08-13"}',
            },
            {
              id: "search-2",
              name: "search_notes",
              arguments: '{"query":"pricing"}',
            },
            {
              id: "search-miss",
              name: "search_notes",
              arguments: '{"query":"zzzz"}',
            },
          ],
        },
        { tokens: ["Calendar first."] },
      ],
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    await user.type(screen.getByLabelText("Ask the Assistant"), "agenda");
    await user.keyboard("{Enter}");

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    await waitFor(() => {
      expect(pane.querySelectorAll(".assistant-tool-row")).toHaveLength(3);
    });
    const rows = [...pane.querySelectorAll(".assistant-tool-row")];
    const labels = rows.map(
      (row) => row.querySelector(".assistant-tool-summary")?.textContent,
    );
    expect(labels).toEqual([
      ">Read calendar · Thu, Aug 13",
      ">Searched notes · 'pricing' · 4 results",
      ">Searched notes · 'zzzz' · 0 results",
    ]);

    await user.click(within(rows[0] as HTMLElement).getByText(/Read calendar/));
    expect(rows[0]?.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      rows[0]?.querySelector(".assistant-tool-result")?.textContent,
    ).toContain("Pricing review");
    expect(rows[1]?.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(rows[1]?.querySelector(".assistant-tool-result")).toBeNull();
  });

  it("uses the same row chrome for the other read tools", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      notes: {
        "note-9": {
          title: "Mike Q3 sync",
          body_markdown: "4.2M",
          note_type: "regular",
        },
        "2026-08-13": {
          title: "2026-08-13",
          body_markdown: "daily",
          note_type: "daily",
        },
      },
      tasks: [
        {
          id: "t1",
          title: "Send deck",
          state: "open",
          due_date: "2026-08-13",
        },
        {
          id: "t2",
          title: "Wait",
          state: "waiting",
          due_date: "2026-08-14",
        },
      ],
      turns: [
        {
          tool_calls: [
            {
              id: "note-1",
              name: "get_note",
              arguments: '{"id_or_title":"Mike Q3 sync"}',
            },
            {
              id: "tasks-1",
              name: "list_tasks",
              arguments: '{"state":"open"}',
            },
            {
              id: "daily-1",
              name: "get_daily_note",
              arguments: '{"date":"2026-08-13"}',
            },
          ],
        },
        { tokens: ["Brief."] },
      ],
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    await user.type(screen.getByLabelText("Ask the Assistant"), "brief");
    await user.keyboard("{Enter}");

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    await waitFor(() => {
      expect(pane.querySelectorAll(".assistant-tool-row")).toHaveLength(3);
    });
    const rows = [...pane.querySelectorAll(".assistant-tool-row")];
    expect(
      rows.map(
        (row) => row.querySelector(".assistant-tool-summary")?.textContent,
      ),
    ).toEqual([
      ">Read note · 'Mike Q3 sync'",
      ">Listed tasks · open · 1 result",
      ">Read daily note · Thu, Aug 13",
    ]);
    for (const row of rows) {
      expect(row.querySelector(".assistant-tool-chevron")?.textContent).toBe(
        ">",
      );
      expect(row).toHaveClass("assistant-tool-row");
      expect(row.querySelector(".assistant-tool-summary")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(
        row.querySelector(".assistant-tool-summary")?.textContent,
      ).toContain(" · ");
    }
    expect(within(pane).queryByText("Append to daily note")).toBeNull();
    expect(within(pane).queryByText("Add 3 blocks")).toBeNull();
    expect(
      within(pane).queryByText("Nothing is written until you approve."),
    ).toBeNull();
  });

  it("toggles the paired result from the chevron even when the result is empty", async () => {
    const user = userEvent.setup();
    const api = createMemoryAgentApi({
      turns: [
        {
          tool_calls: [
            {
              id: "miss-1",
              name: "get_note",
              arguments: '{"id_or_title":"missing"}',
            },
            {
              id: "empty-1",
              name: "search_notes",
              arguments: '{"query":""}',
            },
          ],
        },
        { tokens: ["Nothing found."] },
      ],
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId={null} api={api} />,
    );

    await user.type(screen.getByLabelText("Ask the Assistant"), "lookup");
    await user.keyboard("{Enter}");

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    await waitFor(() => {
      expect(pane.querySelectorAll(".assistant-tool-row")).toHaveLength(2);
    });
    const [miss, empty] = [...pane.querySelectorAll(".assistant-tool-row")];
    expect(miss).toBeTruthy();
    expect(empty).toBeTruthy();

    const missChevron = miss?.querySelector(".assistant-tool-chevron");
    expect(missChevron).toBeTruthy();
    await user.click(missChevron as HTMLElement);
    expect(miss?.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(miss?.querySelector(".assistant-tool-result")?.textContent).toBe(
      "null",
    );

    await user.click(missChevron as HTMLElement);
    expect(miss?.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(miss?.querySelector(".assistant-tool-result")).toBeNull();

    const emptyLabel = empty?.querySelector(".assistant-tool-label");
    expect(emptyLabel).toHaveTextContent("Searched notes · 0 results");
    await user.click(emptyLabel as HTMLElement);
    expect(empty?.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(empty?.querySelector(".assistant-tool-result")?.textContent).toBe(
      "[]",
    );
    await user.click(
      empty?.querySelector(".assistant-tool-summary") as HTMLElement,
    );
    expect(empty?.querySelector(".assistant-tool-summary")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(empty?.querySelector(".assistant-tool-result")).toBeNull();
  });

  it("pairs a search_notes payload that arrives after sendChat resolves", async () => {
    const user = userEvent.setup();
    const hits = [
      { id: "a", title: "pricing north", snippet: "N" },
      { id: "b", title: "pricing south", snippet: "S" },
      { id: "c", title: "pricing east", snippet: "E" },
      { id: "d", title: "pricing west", snippet: "W" },
    ];
    const api: AgentApi = {
      sendChat() {
        const stream_id = "late-1";
        window.dispatchEvent(
          new CustomEvent(AGENT_TOOL_EVENT, {
            detail: {
              stream_id,
              id: "search-late",
              name: "search_notes",
              arguments: '{"query":"pricing"}',
            },
          }),
        );
        return Promise.resolve({
          stream_id,
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
    expect(row.querySelector(".assistant-tool-result")?.textContent).toBe("");
    expect(row.querySelector(".assistant-tool-result")?.textContent).not.toBe(
      "null",
    );

    window.dispatchEvent(
      new CustomEvent(AGENT_TOOL_RESULT_EVENT, {
        detail: {
          stream_id: "late-1",
          id: "search-late",
          name: "search_notes",
          result: hits,
        },
      }),
    );
    await waitFor(() => {
      expect(
        row.querySelector(".assistant-tool-result")?.textContent,
      ).toContain("pricing north");
    });
    const body = row.querySelector(".assistant-tool-result")?.textContent;
    expect(body).not.toBe("null");
    expect(body).toContain("pricing south");
    expect(body).toContain("pricing east");
    expect(body).toContain("pricing west");
  });

  it("pairs a camelCase tool.result payload after sendChat resolves", async () => {
    const user = userEvent.setup();
    const hits = [
      { id: "a", title: "pricing north", snippet: "N" },
      { id: "b", title: "pricing south", snippet: "S" },
      { id: "c", title: "pricing east", snippet: "E" },
      { id: "d", title: "pricing west", snippet: "W" },
    ];
    const api: AgentApi = {
      sendChat() {
        window.dispatchEvent(
          new CustomEvent(AGENT_TOOL_EVENT, {
            detail: {
              streamId: "late-camel",
              id: "search-camel",
              name: "search_notes",
              arguments: '{"query":"pricing"}',
            },
          }),
        );
        return Promise.resolve({
          stream_id: "late-camel",
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

    window.dispatchEvent(
      new CustomEvent(AGENT_TOOL_RESULT_EVENT, {
        detail: {
          streamId: "late-camel",
          id: "search-camel",
          name: "search_notes",
          result: hits,
        },
      }),
    );
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

  it("does not print the word null when no tool result has arrived", async () => {
    const user = userEvent.setup();
    const api: AgentApi = {
      sendChat() {
        window.dispatchEvent(
          new CustomEvent(AGENT_TOOL_EVENT, {
            detail: {
              stream_id: "pending-1",
              id: "pending-note",
              name: "get_note",
              arguments: '{"id_or_title":"x"}',
            },
          }),
        );
        return Promise.resolve({
          stream_id: "pending-1",
          text: "ok",
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

    await user.type(screen.getByLabelText("Ask the Assistant"), "x");
    await user.keyboard("{Enter}");

    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    const row = await waitFor(() => {
      const found = pane.querySelector(".assistant-tool-row");
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    await user.click(within(row).getByText(/Read note/));
    expect(row.querySelector(".assistant-tool-result")?.textContent).toBe("");
    expect(row.textContent).not.toMatch(/(^|[^a-z])null([^a-z]|$)/i);
  });
});

describe("AssistantSidebar answer actions (ENG-74)", () => {
  const summary = "## Executive summary\n\n- Ship importer";

  async function completeAnswer(
    user: ReturnType<typeof userEvent.setup>,
    noteId: string | null,
    handlers: {
      onAppendToNote?: (markdown: string) => void;
      onReplaceNote?: (markdown: string) => void;
      onAppendToDaily?: (markdown: string) => void;
    } = {},
  ) {
    const api = createMemoryAgentApi({ tokens: [summary] });
    render(
      <AssistantSidebar
        open
        onClose={() => {}}
        noteId={noteId}
        api={api}
        {...handlers}
      />,
    );
    await user.type(
      screen.getByLabelText("Ask the Assistant"),
      "Create an executive summary for the H2 roadmap planning meeting",
    );
    await user.keyboard("{Enter}");
    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    await waitFor(() => {
      expect(within(pane).getByText("Executive summary")).toBeInTheDocument();
    });
    return pane;
  }

  it("shows append, replace, and copy when a note is open", async () => {
    const user = userEvent.setup();
    const pane = await completeAnswer(user, "note-1");
    expect(
      within(pane).getByRole("button", { name: "Append to current note" }),
    ).toBeInTheDocument();
    expect(
      within(pane).getByRole("button", { name: "Replace current note" }),
    ).toBeInTheDocument();
    expect(
      within(pane).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(pane).queryByRole("button", {
        name: "Append to today's daily note",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows daily append and copy when no note is open", async () => {
    const user = userEvent.setup();
    const pane = await completeAnswer(user, null);
    expect(
      within(pane).getByRole("button", {
        name: "Append to today's daily note",
      }),
    ).toBeInTheDocument();
    expect(
      within(pane).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(
      within(pane).queryByRole("button", { name: "Append to current note" }),
    ).not.toBeInTheDocument();
    expect(
      within(pane).queryByRole("button", { name: "Replace current note" }),
    ).not.toBeInTheDocument();
  });

  it("does not show actions while the last answer is still streaming", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = createMemoryAgentApi({ tokens: [summary] });
    const api: AgentApi = {
      async sendChat(input) {
        await gate;
        return inner.sendChat(input);
      },
      clearConversation() {
        return inner.clearConversation();
      },
    };
    render(
      <AssistantSidebar open onClose={() => {}} noteId="note-1" api={api} />,
    );
    await user.type(screen.getByLabelText("Ask the Assistant"), "summary");
    await user.keyboard("{Enter}");
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();
    release();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });
  });

  it("shows actions only on the last assistant turn after a tool loop", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const finalAnswer = "## Banff tips\n\nPack layers.";
    const api = createMemoryAgentApi({
      notes: { a: { title: "Banff", body_markdown: "lake" } },
      turns: [
        {
          tokens: ["Let me check your tasks and calendar…"],
          tool_calls: [
            {
              id: "search-banff",
              name: "search_notes",
              arguments: '{"query":"Banff"}',
            },
          ],
        },
        { tokens: [finalAnswer] },
      ],
    });
    render(
      <AssistantSidebar open onClose={() => {}} noteId="note-1" api={api} />,
    );
    await user.type(screen.getByLabelText("Ask the Assistant"), "Banff tips");
    await user.keyboard("{Enter}");
    const pane = screen.getByRole("complementary", {
      name: ASSISTANT_PANEL_TITLE,
    });
    await waitFor(() => {
      expect(within(pane).getByText("Pack layers.")).toBeInTheDocument();
    });
    const assistantTurns = [
      ...pane.querySelectorAll(".assistant-turn.is-assistant"),
    ];
    expect(assistantTurns).toHaveLength(2);
    expect(
      within(assistantTurns[0] as HTMLElement).queryByRole("button", {
        name: "Copy",
      }),
    ).not.toBeInTheDocument();
    const last = assistantTurns[1] as HTMLElement;
    expect(
      within(last).getByRole("button", { name: "Copy" }),
    ).toBeInTheDocument();
    expect(within(pane).getAllByRole("button", { name: "Copy" })).toHaveLength(
      1,
    );
    await user.click(within(last).getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(finalAnswer);
    });
  });

  it("copy writes the answer markdown", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const pane = await completeAnswer(user, "note-1");
    await user.click(within(pane).getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(summary);
    });
  });

  it("append and confirmed replace call through with the answer markdown", async () => {
    const user = userEvent.setup();
    const onAppendToNote = vi.fn();
    const onReplaceNote = vi.fn();
    const pane = await completeAnswer(user, "note-1", {
      onAppendToNote,
      onReplaceNote,
    });
    await user.click(
      within(pane).getByRole("button", { name: "Append to current note" }),
    );
    expect(onAppendToNote).toHaveBeenCalledWith(summary);
    await user.click(
      within(pane).getByRole("button", { name: "Replace current note" }),
    );
    expect(onReplaceNote).not.toHaveBeenCalled();
    await user.click(within(pane).getByRole("button", { name: "Replace" }));
    expect(onReplaceNote).toHaveBeenCalledWith(summary);
  });

  it("declining replace does not call onReplaceNote", async () => {
    const user = userEvent.setup();
    const onReplaceNote = vi.fn();
    const pane = await completeAnswer(user, "note-1", { onReplaceNote });
    await user.click(
      within(pane).getByRole("button", { name: "Replace current note" }),
    );
    await user.click(within(pane).getByRole("button", { name: "Cancel" }));
    expect(onReplaceNote).not.toHaveBeenCalled();
    expect(
      within(pane).getByRole("button", { name: "Replace current note" }),
    ).toBeInTheDocument();
  });

  it("daily append calls onAppendToDaily", async () => {
    const user = userEvent.setup();
    const onAppendToDaily = vi.fn();
    const pane = await completeAnswer(user, null, { onAppendToDaily });
    await user.click(
      within(pane).getByRole("button", {
        name: "Append to today's daily note",
      }),
    );
    expect(onAppendToDaily).toHaveBeenCalledWith(summary);
  });
});
