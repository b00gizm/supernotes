import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { NotesApi } from "./notes/api";
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
      listNotes: (...args: Parameters<NotesApi["listNotes"]>) =>
        apiRef.current.listNotes(...args),
      getNote: (...args: Parameters<NotesApi["getNote"]>) =>
        apiRef.current.getNote(...args),
      createNote: (...args: Parameters<NotesApi["createNote"]>) =>
        apiRef.current.createNote(...args),
      updateNote: (...args: Parameters<NotesApi["updateNote"]>) =>
        apiRef.current.updateNote(...args),
      deleteNote: (...args: Parameters<NotesApi["deleteNote"]>) =>
        apiRef.current.deleteNote(...args),
    },
  };
});

describe("App", () => {
  beforeEach(() => {
    apiRef.current = createMemoryNotesApi();
  });

  it("creates, edits, and deletes a note through the shell", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByText("Create a note to get started."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New note" }));
    expect(await screen.findByLabelText("Note title")).toHaveValue("Untitled");

    const title = screen.getByLabelText("Note title");
    const body = screen.getByLabelText("Note body");
    await user.clear(title);
    await user.type(title, "Shopping");
    await user.type(body, "milk");

    expect(title).toHaveValue("Shopping");
    expect(body).toHaveValue("milk");
    expect(
      screen.getByRole("button", { name: /Shopping/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("Create a note to get started."),
    ).toBeInTheDocument();
  });
});
