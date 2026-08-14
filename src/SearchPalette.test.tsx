import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchPalette } from "./SearchPalette";
import type { Note } from "./notes/types";

const notes: Note[] = [
  {
    id: "n1",
    title: "Project plan",
    body_markdown: "",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-09T10:00:00.000Z",
    updated_at: "2026-08-09T10:00:00.000Z",
  },
];

describe("SearchPalette", () => {
  it("surfaces searchTasks failures instead of empty results (ENG-136)", async () => {
    const user = userEvent.setup();
    const searchNotes = vi.fn().mockResolvedValue([]);
    const searchTasks = vi
      .fn()
      .mockRejectedValue(new Error("search_tasks failed"));

    render(
      <SearchPalette
        open
        onClose={() => undefined}
        searchNotes={searchNotes}
        searchTasks={searchTasks}
        notes={notes}
        onOpenNote={() => undefined}
        onCreateNote={() => undefined}
      />,
    );

    await user.type(screen.getByLabelText("Search notes and tasks"), "milk");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "search_tasks failed",
    );
    expect(
      screen.queryByText("No matching notes or tasks"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /\+ Create note 'milk'/ }),
    ).toBeInTheDocument();
  });
});
