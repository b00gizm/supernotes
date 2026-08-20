import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  createMemoryLlmApi,
  type LlmApi,
  type StreamLlmChatInput,
} from "../llm/api";
import {
  ASSISTANT_PLACEHOLDER,
  ASSISTANT_SHORTCUT_CHIP,
  AssistantSidebar,
} from "./AssistantSidebar";
import { ACT_ON_NOTE_PROMPT } from "./noteContext";

function wrapLlm(inner: LlmApi, sent: StreamLlmChatInput[]): LlmApi {
  return {
    ...inner,
    streamChat(input) {
      sent.push(input);
      return inner.streamChat(input);
    },
  };
}

describe("AssistantSidebar (ENG-72)", () => {
  it("matches mockup 1i chrome", () => {
    render(<AssistantSidebar open onClose={() => {}} note={null} />);

    const pane = screen.getByRole("complementary", { name: "Assistant" });
    const title = within(pane).getByRole("heading", { name: "Assistant" });
    expect(title).toHaveClass("pane-title", "assistant-title");
    expect(title.querySelector(".assistant-star")).toBeTruthy();
    expect(within(pane).getByText(ASSISTANT_SHORTCUT_CHIP)).toHaveClass(
      "search-chip",
    );
    expect(within(pane).queryByText("⌘⇧A")).not.toBeInTheDocument();
    expect(within(pane).queryByText("⌘J")).not.toBeInTheDocument();
    expect(
      within(pane).getByRole("button", { name: "Close Assistant" }),
    ).toBeInTheDocument();
    expect(
      within(pane).getByRole("button", { name: "Clear" }),
    ).toBeInTheDocument();
    expect(within(pane).getByLabelText("Ask the Assistant")).toHaveAttribute(
      "placeholder",
      ASSISTANT_PLACEHOLDER,
    );
  });

  it("proof-reads against the open note and streams markdown", async () => {
    const user = userEvent.setup();
    const sent: StreamLlmChatInput[] = [];
    const api = wrapLlm(
      createMemoryLlmApi({ tokens: ["Looks ", "**fine**", "."] }),
      sent,
    );
    render(
      <AssistantSidebar
        open
        onClose={() => {}}
        note={{ title: "Thursday, Aug 6", body: "Ths sentnce has typos." }}
        api={api}
      />,
    );

    await user.type(
      screen.getByLabelText("Ask the Assistant"),
      "Please proof-read this",
    );
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.messages[0]).toEqual({
      role: "system",
      content: "Current note: Thursday, Aug 6\n\nThs sentnce has typos.",
    });
    expect(sent[0]?.messages[1]).toEqual({
      role: "user",
      content: "Please proof-read this",
    });

    const pane = screen.getByRole("complementary", { name: "Assistant" });
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
    const sent: StreamLlmChatInput[] = [];
    const api = wrapLlm(createMemoryLlmApi({ tokens: ["Hi"] }), sent);
    render(<AssistantSidebar open onClose={() => {}} note={null} api={api} />);

    await user.type(screen.getByLabelText("Ask the Assistant"), "Hello");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.messages).toEqual([{ role: "user", content: "Hello" }]);
    await waitFor(() => {
      expect(screen.getByText("Hi")).toBeInTheDocument();
    });
  });

  it("keeps session history and Clear wipes it", async () => {
    const user = userEvent.setup();
    const sent: StreamLlmChatInput[] = [];
    const api = wrapLlm(createMemoryLlmApi({ tokens: ["pong"] }), sent);
    render(<AssistantSidebar open onClose={() => {}} note={null} api={api} />);

    const input = screen.getByLabelText("Ask the Assistant");
    await user.type(input, "first");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByText("pong")).toBeInTheDocument();
    });

    await user.type(input, "second");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent[1]?.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "pong" },
      { role: "user", content: "second" },
    ]);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.queryByText("pong")).not.toBeInTheDocument();
    expect(screen.queryByText("second")).not.toBeInTheDocument();
  });

  it("⌘↵ with an empty field acts on the open note", async () => {
    const user = userEvent.setup();
    const sent: StreamLlmChatInput[] = [];
    const api = wrapLlm(createMemoryLlmApi({ tokens: ["ok"] }), sent);
    render(
      <AssistantSidebar
        open
        onClose={() => {}}
        note={{ title: "Roadmap", body: "Ship importer" }}
        api={api}
      />,
    );

    screen.getByLabelText("Ask the Assistant").focus();
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: ACT_ON_NOTE_PROMPT,
    });
    expect(sent[0]?.messages[0]?.content).toContain("Ship importer");
  });

  it("surfaces a failed stream instead of keeping a silent bubble", async () => {
    const user = userEvent.setup();
    const api = createMemoryLlmApi({
      fail: { code: "unreachable", message: "down" },
    });
    render(<AssistantSidebar open onClose={() => {}} note={null} api={api} />);

    await user.type(screen.getByLabelText("Ask the Assistant"), "Hello");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the API",
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("stays mounted but hidden when closed", () => {
    const { rerender } = render(
      <AssistantSidebar open onClose={() => {}} note={null} />,
    );
    expect(
      screen.getByRole("complementary", { name: "Assistant" }),
    ).not.toHaveAttribute("hidden");

    rerender(<AssistantSidebar open={false} onClose={() => {}} note={null} />);
    expect(
      screen.queryByRole("complementary", { name: "Assistant" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".assistant-sidebar")).toHaveClass(
      "is-closed",
    );
  });
});
