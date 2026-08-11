import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";

function typeText(editor: Editor, text: string) {
  for (const char of text) {
    const pos = editor.state.selection.from;
    const handled = editor.view.someProp("handleTextInput", (f) => {
      return (
        f as (
          view: typeof editor.view,
          from: number,
          to: number,
          text: string,
        ) => boolean | undefined
      )(editor.view, pos, pos, char);
    });
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(char, pos));
    }
  }
}

function md(editor: Editor) {
  return (
    (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown
      ?.getMarkdown() ?? ""
  );
}

describe("checkbox vs bullet input", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    const el = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (el instanceof HTMLElement) el.remove();
  });

  function create() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: noteEditorExtensions(),
      content: "",
    });
    editor.commands.focus("end");
    return editor;
  }

  it("types [ ] at line start into task item", () => {
    editor = create();
    typeText(editor, "[ ] buy milk");
    expect(editor.isActive("taskItem")).toBe(true);
    expect(md(editor)).toMatch(/- \[ \] buy milk/);
  });

  it("types - [ ] into a checkbox after bullet rule steals the dash", () => {
    editor = create();
    typeText(editor, "- [ ] buy milk");
    expect(editor.isActive("taskItem")).toBe(true);
    expect(editor.isActive("taskList")).toBe(true);
    expect(editor.isActive("bulletList")).toBe(false);
    expect(md(editor)).toMatch(/- \[ \] buy milk/);
  });

  it("types - [] into a checkbox", () => {
    editor = create();
    // Trailing space after ] is required (same as TipTap's task input rule).
    typeText(editor, "- [] buy milk");
    expect(editor.isActive("taskItem")).toBe(true);
    expect(md(editor)).toMatch(/- \[ \] buy milk/);
  });

  it("types - [x] into a checked checkbox", () => {
    editor = create();
    typeText(editor, "- [x] done");
    expect(editor.isActive("taskItem")).toBe(true);
    expect(md(editor)).toMatch(/- \[x\] done/);
  });
});
