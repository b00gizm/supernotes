import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskMetaPopover } from "./TaskMetaPopover";
import type { Task } from "./types";

const task: Task = {
  id: "t1",
  note_id: "n1",
  title: "Ship onboarding fix",
  state: "open",
  due_date: null,
  priority: null,
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
  completed_at: null,
};

describe("TaskMetaPopover (ENG-62)", () => {
  it("emits state, due shortcut, and priority segments", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    render(
      <TaskMetaPopover
        task={task}
        anchor={{ x: 40, y: 40 }}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Waiting/i }));
    expect(onUpdate).toHaveBeenCalledWith({ state: "waiting" });

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );

    await user.click(screen.getByRole("button", { name: "P1" }));
    expect(onUpdate).toHaveBeenCalledWith({ priority: "high" });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("clears an existing due date", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <TaskMetaPopover
        task={{ ...task, due_date: "2026-08-14" }}
        anchor={{ x: 40, y: 40 }}
        onClose={() => {}}
        onUpdate={onUpdate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onUpdate).toHaveBeenCalledWith({ due_date: null });
  });
});
