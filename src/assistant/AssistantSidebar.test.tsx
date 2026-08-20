import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
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
    expect(title).toHaveClass("pane-title", "assistant-title");
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
    expect(outgoing[0]?.role).toBe("system");
    expect(outgoing[0]?.content).toContain("Thursday, Aug 6");
    expect(outgoing[0]?.content).toContain("Ths sentnce has typos.");
    expect(outgoing[1]).toEqual({
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
      expect(api.lastOutgoing()).toEqual([{ role: "user", content: "Hello" }]);
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
      expect(api.lastOutgoing()).toEqual([
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
    expect(api.lastOutgoing()[0]?.content).toContain("Ship importer");
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
