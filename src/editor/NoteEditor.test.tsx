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
});
