import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { todayYmd } from "./due";
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
    expect(onUpdate).toHaveBeenCalledWith({ due_date: todayYmd() });

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

  it("traps Tab in the dialog and moves calendar days with arrows", async () => {
    const user = userEvent.setup();
    render(
      <TaskMetaPopover
        task={{ ...task, due_date: "2026-08-14" }}
        anchor={{ x: 40, y: 40 }}
        onClose={() => {}}
        onUpdate={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    first?.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(last).toHaveFocus();

    screen.getByRole("gridcell", { name: "14" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: "15" })).toHaveFocus();
  });
});
