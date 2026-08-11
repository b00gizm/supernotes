import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { NotesApi } from "./notes/api";
import { formatDailyTitle } from "./notes/format";
import { createMemoryNotesApi } from "./notes/memoryApi";

const apiRef: { current: NotesApi } = {
  current: createMemoryNotesApi(),
};

vi.mock("./notes/api", async () => {
  const actual =
    await vi.importActual<typeof import("./notes/api")>("./notes/api");
  return {
    ...actual,
    notesApi: {
      listNotes: () => apiRef.current.listNotes(),
      searchNotes: (query: string) => apiRef.current.searchNotes(query),
      createNote: (input: Parameters<NotesApi["createNote"]>[0]) =>
        apiRef.current.createNote(input),
      updateNote: (input: Parameters<NotesApi["updateNote"]>[0]) =>
        apiRef.current.updateNote(input),
      deleteNote: (id: string) => apiRef.current.deleteNote(id),
    },
  };
});

describe("App shell", () => {
  beforeEach(() => {
    apiRef.current = createMemoryNotesApi();
  });

  it("opens today's daily note by default with shell chrome", async () => {
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Daily Note" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recent/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const title = formatDailyTitle();
    expect(await screen.findByLabelText("Note title")).toHaveValue(title);
  });

  it("opens Notes overview instead of the last note", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);

    render(<App />);
    expect(await screen.findByLabelText("Note title")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Notes" }));
    expect(
      await screen.findByRole("region", { name: "Notes overview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ New note" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();
  });

  it("lists recent notes with meeting waveform and supports edit/delete", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "m1",
        title: "Pricing sync",
        body_markdown: "Decided to keep the free tier",
        note_type: "meeting",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");

    const recent = screen.getByRole("button", { name: /Pricing sync/ });
    expect(within(recent).getByText(/Decided to keep/)).toBeInTheDocument();

    await user.click(recent);
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Pricing sync",
    );

    const body = screen.getByLabelText("Note body");
    await user.clear(body);
    await user.type(body, "Updated decision");
    expect(body).toHaveValue("Updated decision");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByRole("region", { name: "Notes overview" }),
    ).toBeInTheDocument();
  });

  it("collapses the Recent section and the whole sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("Note title");

    await user.click(screen.getByRole("button", { name: /Recent/i }));
    expect(screen.getByRole("button", { name: /Recent/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByLabelText("Supernotes")).toHaveClass(
      "is-sidebar-collapsed",
    );
  });

  it("opens title search with ⌘K, filters, and creates from the always-on row", async () => {
    const user = userEvent.setup();
    apiRef.current = createMemoryNotesApi([
      {
        id: "n1",
        title: "Pricing sync",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-09T10:00:00.000Z",
        updated_at: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "n2",
        title: "Weekly review",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: "2026-08-08T10:00:00.000Z",
        updated_at: "2026-08-08T10:00:00.000Z",
      },
    ]);

    render(<App />);
    await screen.findByLabelText("Note title");

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByLabelText("Search notes");
    expect(screen.getByText("esc")).toBeInTheDocument();
    expect(screen.getByText("↑↓ Navigate")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\+ Create note 'Untitled'/ }),
    ).toBeInTheDocument();

    await user.type(search, "pricing");
    const pricing = await screen.findByRole("option", {
      name: /Pricing sync/,
    });
    expect(pricing).toBeInTheDocument();
    expect(within(pricing).getByText("Pricing").tagName).toBe("STRONG");
    expect(
      screen.queryByRole("option", { name: /Weekly review/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\+ Create note 'pricing'/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("⌘+⏎")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByLabelText("Note title")).toHaveValue("pricing");
    expect(screen.queryByLabelText("Search notes")).not.toBeInTheDocument();
  });
});
