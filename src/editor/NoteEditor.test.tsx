import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";

/**
 * Drive ProseMirror input rules the same way TipTap's own tests do:
 * call handleTextInput per character, and insert when no rule claims it.
 */
function typeText(editor: Editor, text: string) {
  for (const char of text) {
    const pos = editor.state.selection.from;
    const handled = editor.view.someProp("handleTextInput", (f) => {
      // TipTap's suite still calls the 4-arg form; cast for PM's newer type.
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

function createEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: noteEditorExtensions(),
    content: "",
  });
  editor.commands.focus("end");
  return editor;
}

function markdownOf(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

describe("note editor input rules", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    const element = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (element instanceof HTMLElement) {
      element.remove();
    }
  });

  it("turns #␠ into an h1 and strips the markdown markers", () => {
    editor = createEditor();
    typeText(editor, "# Hello");
    expect(editor.isActive("heading", { level: 1 })).toBe(true);
    expect(editor.getText().trim()).toBe("Hello");
    expect(editor.getHTML()).toMatch(/<h1[^>]*>Hello<\/h1>/);
  });

  it("turns **bold** into a strong mark", () => {
    editor = createEditor();
    typeText(editor, "**bold**");
    // Cursor lands after the mark once the rule fires — assert the doc, not isActive.
    expect(editor.getHTML()).toMatch(/<(strong|b)>bold<\/(strong|b)>/);
    expect(editor.getText().trim()).toBe("bold");
  });

  it("turns *italic* into an em mark", () => {
    editor = createEditor();
    typeText(editor, "*italic*");
    expect(editor.getHTML()).toMatch(/<(em|i)>italic<\/(em|i)>/);
    expect(editor.getText().trim()).toBe("italic");
  });

  it("turns >␠ into a blockquote", () => {
    editor = createEditor();
    typeText(editor, "> quoted");
    expect(editor.isActive("blockquote")).toBe(true);
    expect(editor.getHTML()).toContain("<blockquote>");
    expect(editor.getText().trim()).toBe("quoted");
  });

  it("turns ==highlight== into a mark", () => {
    editor = createEditor();
    typeText(editor, "==glow==");
    expect(editor.getHTML()).toMatch(/<mark[^>]*>glow<\/mark>/);
    expect(editor.getText().trim()).toBe("glow");
  });

  it("turns ~~strike~~ into a strike mark", () => {
    editor = createEditor();
    typeText(editor, "~~old~~");
    expect(editor.getHTML()).toMatch(/<(s|del|strike)>old<\/(s|del|strike)>/);
    expect(editor.getText().trim()).toBe("old");
  });

  it("serializes edited content back to markdown", () => {
    editor = createEditor();
    typeText(editor, "# Title");
    expect(markdownOf(editor)).toMatch(/^#\s+Title/);
  });

  it("round-trips ==highlight== through markdown save/load", () => {
    editor = createEditor();
    typeText(editor, "==glow==");
    const md = markdownOf(editor);
    expect(md).toContain("==glow==");

    editor.destroy();
    editor = createEditor();
    editor.commands.setContent(md);
    expect(editor.getHTML()).toMatch(/<mark[^>]*>glow<\/mark>/);
    expect(editor.getText().trim()).toBe("glow");
  });

  it("turns [ ] into a task item (square checkbox)", () => {
    editor = createEditor();
    // TipTap task input rule: `[ ]␠` at line start (not `- [ ]`).
    typeText(editor, "[ ] buy milk");
    expect(editor.isActive("taskItem")).toBe(true);
    expect(editor.getHTML()).toContain('data-type="taskItem"');
    expect(markdownOf(editor)).toMatch(/- \[ \] buy milk/);
  });

  it("round-trips nested lists and checkboxes", () => {
    editor = createEditor();
    const input = "- parent\n  - child\n- [ ] todo\n- [x] done";
    editor.commands.setContent(input);
    const md = markdownOf(editor);
    expect(md).toContain("- parent");
    expect(md).toContain("child");
    expect(md).toMatch(/- \[ \] todo/);
    expect(md).toMatch(/- \[x\] done/);

    editor.destroy();
    editor = createEditor();
    editor.commands.setContent(md);
    expect(editor.getHTML()).toContain("<ul");
    expect(editor.getHTML()).toContain('data-type="taskList"');
    expect(markdownOf(editor)).toMatch(/- \[ \] todo/);
  });

  it("round-trips GFM tables", () => {
    editor = createEditor();
    const input = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    editor.commands.setContent(input);
    expect(editor.getHTML()).toContain("<table");
    const md = markdownOf(editor);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");

    editor.destroy();
    editor = createEditor();
    editor.commands.setContent(md);
    expect(
      editor.isActive("table") || editor.getHTML().includes("<table"),
    ).toBe(true);
    expect(markdownOf(editor)).toContain("| 1 | 2 |");
  });

  it("inserts tables via command and keeps cell text", () => {
    editor = createEditor();
    editor
      .chain()
      .focus()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run();
    expect(editor.getHTML()).toContain("<table");
    editor.commands.insertContent("Hi");
    expect(markdownOf(editor)).toContain("Hi");
  });

  it("round-trips markdown links", () => {
    editor = createEditor();
    editor.commands.setContent("[docs](https://example.com/path)");
    expect(editor.getHTML()).toMatch(
      /<a[^>]+href="https:\/\/example.com\/path"/,
    );
    const md = markdownOf(editor);
    expect(md).toContain("[docs](https://example.com/path)");

    editor.destroy();
    editor = createEditor();
    editor.commands.setContent(md);
    expect(markdownOf(editor)).toContain("[docs](https://example.com/path)");
  });

  it("sets a link on selection via setLink (Cmd+K path)", () => {
    editor = createEditor();
    typeText(editor, "hello");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setLink({ href: "https://example.com" });
    expect(markdownOf(editor)).toContain("[hello](https://example.com)");
  });

  it("round-trips filled images and empty drop slots", () => {
    editor = createEditor();
    editor.commands.setContent("![chart]()\n\n![alt](images/x.png)");
    const md = markdownOf(editor);
    expect(md).toContain("![chart]()");
    expect(md).toContain("![alt](images/x.png)");

    editor.destroy();
    editor = createEditor();
    editor.commands.setContent(md);
    expect(markdownOf(editor)).toContain("![chart]()");
    expect(markdownOf(editor)).toContain("![alt](images/x.png)");
  });
});
