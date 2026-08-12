import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import {
  looksLikeGfmTable,
  withTablePipeEscaping,
  type TablePipeEscapeState,
} from "./markdownTable";

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

const MISMATCH = `| A | B | C |
| --- | --- |
| 1 | 2 |`;

function hardBreakParagraph(lines: string[]) {
  const content: Array<{ type: "text"; text: string } | { type: "hardBreak" }> =
    [];
  lines.forEach((line, index) => {
    if (index > 0) {
      content.push({ type: "hardBreak" });
    }
    content.push({ type: "text", text: line });
  });
  return { type: "paragraph" as const, content };
}

function hasHardBreak(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "hardBreak") {
      found = true;
      return false;
    }
  });
  return found;
}

describe("looksLikeGfmTable", () => {
  it("detects a basic pipe table", () => {
    expect(looksLikeGfmTable(TABLE)).toBe(true);
  });

  it("rejects non-tables", () => {
    expect(looksLikeGfmTable("| just a row |")).toBe(false);
    expect(looksLikeGfmTable("hello")).toBe(false);
  });

  it("rejects header/separator column mismatch (ENG-95)", () => {
    expect(looksLikeGfmTable(MISMATCH)).toBe(false);
  });
});

describe("withTablePipeEscaping", () => {
  it("sets escapeExtraCharacters only while in a table", () => {
    const state: TablePipeEscapeState = {
      inTable: true,
      options: {},
    };
    withTablePipeEscaping(state, () => {
      expect(state.options.escapeExtraCharacters).toEqual(/\|/g);
    });
    expect(state.options.escapeExtraCharacters).toBeUndefined();
  });

  it("is a no-op outside tables", () => {
    const state: TablePipeEscapeState = { options: {} };
    withTablePipeEscaping(state, () => {
      expect(state.options.escapeExtraCharacters).toBeUndefined();
    });
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

  function create(content: string | object = "") {
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
    // Typing leaves a trailing `|` in the last cell (pre-existing); ENG-88
    // escapes it so we assert cell text rather than an exact pipe row.
    expect(editor.getHTML()).toMatch(/<p>1<\/p>/);
    expect(md(editor)).toMatch(/^\| A \| B \|$/m);
  });

  it("escapes pipes in cells on serialize (ENG-88)", () => {
    editor = create("| A | B |\n| --- | --- |\n| 1\\|x | 2 |");
    expect(editor.getHTML()).toMatch(/1\|x/);
    expect(md(editor)).toBe("| A | B |\n| --- | --- |\n| 1\\|x | 2 |\n");
  });

  it("serializes hard breaks in cells as <br> (ENG-88)", () => {
    editor = create("| A | B |\n| --- | --- |\n| a | 2 |");
    let from = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && from === 0) {
        from = pos + 2;
      }
    });
    editor
      .chain()
      .setTextSelection(from + 1)
      .setHardBreak()
      .insertContent("b")
      .run();
    expect(md(editor)).toContain("a<br>b");
    expect(md(editor)).not.toContain("[hardBreak]");
  });

  it("keeps hard breaks when column counts mismatch (ENG-95)", () => {
    const lines = MISMATCH.split("\n");
    editor = create({
      type: "doc",
      content: [hardBreakParagraph(lines)],
    });
    expect(editor.getHTML()).not.toContain("<table");
    expect(hasHardBreak(editor)).toBe(true);
    const before = editor.getText();
    // Trigger appendTransaction.
    editor.commands.insertContent("x");
    editor.commands.undo();
    expect(editor.getHTML()).not.toContain("<table");
    expect(editor.getText()).toBe(before);
    expect(hasHardBreak(editor)).toBe(true);
  });

  it("places caret in first cell after live conversion (ENG-95)", () => {
    editor = create();
    typeText(editor, "| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(editor.getHTML()).toContain("<table");
    expect(editor.isActive("table")).toBe(true);
    const $from = editor.state.selection.$from;
    let inCell = false;
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === "tableCell" || name === "tableHeader") {
        inCell = true;
        break;
      }
    }
    expect(inCell).toBe(true);
  });

  it("does not convert pipe tables inside blockquotes (ENG-95)", () => {
    const lines = TABLE.split("\n");
    editor = create({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [hardBreakParagraph(lines)],
        },
      ],
    });
    expect(editor.getHTML()).toContain("<blockquote");
    expect(hasHardBreak(editor)).toBe(true);
    editor.commands.insertContent("x");
    editor.commands.undo();
    expect(editor.getHTML()).toContain("<blockquote");
    expect(editor.getHTML()).not.toContain("<table");
    expect(hasHardBreak(editor)).toBe(true);
  });
});
