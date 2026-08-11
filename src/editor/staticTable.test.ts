import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import {
  handleStaticTableBackspace,
  tablePosBeforeCursor,
} from "./staticTable";

const DOC = `| A | B |
| --- | --- |
| 1 | 2 |

after`;

describe("static markdown table", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    const el = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (el instanceof HTMLElement) el.remove();
  });

  function create(content = DOC) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: noteEditorExtensions(),
      content,
    });
    return editor;
  }

  function posAtStartOfAfter(ed: Editor): number {
    let found = -1;
    ed.state.doc.descendants((node, pos) => {
      if (found >= 0) return false;
      if (node.isTextblock && node.textContent === "after") {
        found = pos + 1;
        return false;
      }
    });
    if (found < 0) throw new Error("after block not found");
    return found;
  }

  it("finds the table before the following paragraph", () => {
    const ed = create();
    ed.commands.setTextSelection(posAtStartOfAfter(ed));
    const tablePos = tablePosBeforeCursor(ed.state);
    expect(typeof tablePos).toBe("number");
    if (typeof tablePos !== "number") return;
    expect(ed.state.doc.nodeAt(tablePos)?.type.name).toBe("table");
  });

  it("Backspace after a table selects it, then deletes it", () => {
    const ed = create();
    ed.commands.setTextSelection(posAtStartOfAfter(ed));

    expect(handleStaticTableBackspace(ed)).toBe(true);
    expect(ed.state.selection).toBeInstanceOf(NodeSelection);
    expect((ed.state.selection as NodeSelection).node.type.name).toBe("table");
    expect(ed.getHTML()).toContain("<table");

    expect(handleStaticTableBackspace(ed)).toBe(true);
    expect(ed.getHTML()).not.toContain("<table");
    expect(ed.getText()).toContain("after");
  });

  it("Tab at the last cell adds a row", () => {
    const ed = create(DOC);
    let lastCellPos = -1;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && node.firstChild?.isTextblock) {
        lastCellPos = pos + 2;
      }
    });
    expect(lastCellPos).toBeGreaterThan(0);
    ed.commands.setTextSelection(lastCellPos);

    const rowsBefore = ed.getHTML().match(/<tr/g)?.length ?? 0;
    const handled = ed.view.someProp("handleKeyDown", (f) =>
      (
        f as (view: typeof ed.view, event: KeyboardEvent) => boolean | undefined
      )(ed.view, new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
    );
    expect(handled).toBe(true);
    const rowsAfter = ed.getHTML().match(/<tr/g)?.length ?? 0;
    expect(rowsAfter).toBe(rowsBefore + 1);
  });
});
