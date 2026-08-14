import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../notes/types";
import { TaskRow } from "./TaskRow";
import type { Task } from "./types";

const note: Note = {
  id: "n1",
  title: "Roadmap",
  body_markdown: "",
  note_type: "regular",
  pinned: false,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};

const task: Task = {
  id: "t1",
  note_id: "n1",
  title: "Buy milk",
  state: "open",
  due_date: null,
  priority: null,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
  completed_at: null,
};

describe("TaskRow accessible names", () => {
  it("names the title button and keeps the toggle labeled", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <TaskRow
        task={task}
        note={note}
        today="2026-08-14"
        showDue={false}
        onToggle={onToggle}
        onOpen={onOpen}
        onMeta={vi.fn()}
      />,
    );

    const title = screen.getByRole("button", { name: "Buy milk" });
    expect(title).toHaveAttribute("aria-label", "Buy milk");
    await user.click(title);
    expect(onOpen).toHaveBeenCalledOnce();

    const toggle = screen.getByRole("button", { name: "Mark task done" });
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("falls back to Untitled task when the title is blank", () => {
    render(
      <TaskRow
        task={{ ...task, title: "   " }}
        note={note}
        today="2026-08-14"
        showDue={false}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
        onMeta={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Untitled task" }),
    ).toBeInTheDocument();
  });
});
