import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import { looksLikeGfmTable } from "./markdownTable";

function typeText(editor: Editor, text: string) {
  for (const char of text) {
    if (char === "\n") {
      editor.commands.splitBlock();
      continue;
    }
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
    (
      editor.storage as { markdown?: { getMarkdown: () => string } }
    ).markdown?.getMarkdown() ?? ""
  );
}

const TABLE = `| A | B |
| --- | --- |
| 1 | 2 |`;

describe("looksLikeGfmTable", () => {
  it("detects a basic pipe table", () => {
    expect(looksLikeGfmTable(TABLE)).toBe(true);
  });

  it("rejects non-tables", () => {
    expect(looksLikeGfmTable("| just a row |")).toBe(false);
    expect(looksLikeGfmTable("hello")).toBe(false);
  });
});

describe("markdown table fixup", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    const el = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (el instanceof HTMLElement) el.remove();
  });

  function create(content = "") {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: noteEditorExtensions(),
      content,
    });
    editor.commands.focus("end");
    return editor;
  }

  it("loads GFM table via setContent", () => {
    editor = create(TABLE);
    expect(editor.getHTML()).toContain("<table");
    expect(md(editor)).toContain("| A | B |");
  });

  it("insertContent parses a pasted GFM table string", () => {
    editor = create();
    editor.commands.insertContent(TABLE);
    expect(editor.getHTML()).toContain("<table");
  });

  it("converts consecutive typed paragraphs into a table", () => {
    editor = create();
    typeText(editor, "| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(editor.getHTML()).toContain("<table");
    expect(editor.getHTML()).not.toMatch(/\| A \| B \|/);
    expect(md(editor)).toContain("| 1 | 2 |");
  });
});
