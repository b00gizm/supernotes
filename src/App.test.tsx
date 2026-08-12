import { render, screen, waitFor, within } from "@testing-library/react";
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
      setPinned: (id: string, pinned: boolean) =>
        apiRef.current.setPinned(id, pinned),
      deleteNote: (id: string) => apiRef.current.deleteNote(id),
      listLinksFrom: (sourceNoteId: string) =>
        apiRef.current.listLinksFrom(sourceNoteId),
      listLinksTo: (targetNoteId: string) =>
        apiRef.current.listLinksTo(targetNoteId),
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

  it("opens Notes overview with Pinned/Today groups and pin action", async () => {
    const user = userEvent.setup();
    const now = new Date();
    const todayIso = now.toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "p1",
        title: "Meridian Q3 roadmap",
        body_markdown: "Draft outline for #meridian",
        note_type: "regular",
        pinned: true,
        created_at: todayIso,
        updated_at: todayIso,
      },
      {
        id: "t1",
        title: "Interview — Priya Sharma",
        body_markdown: "Notes with @Priya Sharma",
        note_type: "regular",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
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
    const overview = await screen.findByRole("region", {
      name: "Notes overview",
    });
    expect(
      within(overview).getByRole("button", { name: "+ New note" }),
    ).toBeInTheDocument();
    expect(within(overview).getByText("3")).toBeInTheDocument();
    expect(
      within(overview).getByRole("region", { name: "Pinned" }),
    ).toBeInTheDocument();
    expect(
      within(overview).getByRole("region", { name: "Today" }),
    ).toBeInTheDocument();
    expect(within(overview).getByText("#meridian")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note title")).not.toBeInTheDocument();

    const pinnedRow = within(overview).getByRole("button", {
      name: /Meridian Q3 roadmap/,
    });
    await user.pointer({ keys: "[MouseRight>]", target: pinnedRow });
    // Leftover mouse event from the opening gesture must not dismiss the menu.
    window.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    const unpin = await screen.findByRole("menuitem", { name: "Unpin" });
    await user.click(unpin);
    expect(
      within(overview).queryByRole("region", { name: "Pinned" }),
    ).not.toBeInTheDocument();
  });

  it("pins a note from the overview context menu", async () => {
    const user = userEvent.setup();
    const todayIso = new Date().toISOString();
    apiRef.current = createMemoryNotesApi([
      {
        id: "t1",
        title: "Interview — Priya Sharma",
        body_markdown: "Notes",
        note_type: "regular",
        pinned: false,
        created_at: todayIso,
        updated_at: todayIso,
      },
    ]);

    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Notes" }));
    const overview = await screen.findByRole("region", {
      name: "Notes overview",
    });
    const row = within(overview).getByRole("button", {
      name: /Interview/,
    });
    await user.pointer({ keys: "[MouseRight>]", target: row });
    await user.click(await screen.findByRole("menuitem", { name: "Pin" }));
    expect(
      within(overview).getByRole("region", { name: "Pinned" }),
    ).toBeInTheDocument();
  });

  it("shows Notes breadcrumb on regular notes, not daily notes", async () => {
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
    expect(
      screen.queryByRole("button", { name: "Back to Notes" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Pricing sync/ }));
    const crumb = await screen.findByRole("button", { name: "Back to Notes" });
    await user.click(crumb);
    expect(
      await screen.findByRole("region", { name: "Notes overview" }),
    ).toBeInTheDocument();
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

    const body = await screen.findByLabelText("Note body");
    // Contenteditable: select-all + replace (user.clear is textarea-oriented).
    await user.click(body);
    await user.keyboard("{Control>}a{/Control}Updated decision");
    expect(body).toHaveTextContent("Updated decision");

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

  it("shows backlinks from the links index and hides when empty", async () => {
    const user = userEvent.setup();
    const stamp = "2026-08-09T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "foo",
        title: "Foo",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: "src",
        title: "Source note",
        body_markdown: "See [[Foo]] tomorrow.",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    // Seed link rows (createMemoryNotesApi only syncs on create/update).
    await apiRef.current.updateNote({
      id: "src",
      title: "Source note",
      body_markdown: "See [[Foo]] tomorrow.",
    });

    render(<App />);
    await screen.findByLabelText("Note title");

    await user.click(screen.getByRole("button", { name: /^Foo\b/ }));
    const backlinks = await screen.findByRole("region", { name: "Backlinks" });
    expect(
      within(backlinks).getByRole("button", { name: /Source note/ }),
    ).toBeInTheDocument();
    const match = within(backlinks).getByText("[[Foo]]");
    expect(match.tagName).toBe("MARK");
    expect(match).toHaveClass("backlink-match");
    expect(match.parentElement).toHaveTextContent("See [[Foo]] tomorrow.");

    await user.click(
      within(backlinks).getByRole("button", { name: /Source note/ }),
    );
    expect(await screen.findByLabelText("Note title")).toHaveValue(
      "Source note",
    );
    expect(
      screen.queryByRole("region", { name: "Backlinks" }),
    ).not.toBeInTheDocument();
  });

  it("create-on-click @Person keeps an empty Person note selected", async () => {
    // From the daily surface, create-on-click must open Person in one click
    // (ensureDaily used to steal selection when notes.length bumped).
    const user = userEvent.setup();
    const dailyTitle = formatDailyTitle();
    const dailyBody = "Discuss [[Existing]] with @Person";
    const stamp = "2026-08-10T10:00:00.000Z";
    apiRef.current = createMemoryNotesApi([
      {
        id: "daily",
        title: dailyTitle,
        body_markdown: dailyBody,
        note_type: "daily",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: "existing",
        title: "Existing",
        body_markdown: "",
        note_type: "regular",
        pinned: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ]);
    await apiRef.current.updateNote({
      id: "daily",
      title: dailyTitle,
      body_markdown: dailyBody,
    });

    render(<App />);
    expect(await screen.findByLabelText("Note title")).toHaveValue(dailyTitle);
    await screen.findByLabelText("Note body");

    const personLink = await waitFor(() => {
      const el = document.querySelector('.wiki-link[data-title="Person"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    await user.click(personLink);

    expect(await screen.findByLabelText("Note title")).toHaveValue("Person");
    expect(await screen.findByLabelText("Note body")).toHaveTextContent("");
    expect(
      await screen.findByRole("button", { name: "Back to Notes" }),
    ).toBeInTheDocument();

    const person = (await apiRef.current.listNotes()).find(
      (note) => note.title === "Person",
    );
    expect(person?.body_markdown).toBe("");
  });
});
