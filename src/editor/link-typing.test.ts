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

function insertText(editor: Editor, text: string, paste = false) {
  const { from, to } = editor.state.selection;
  let tr = editor.state.tr.insertText(text, from, to);
  if (paste) {
    tr = tr.setMeta("paste", true);
  }
  editor.view.dispatch(tr);
}

function md(editor: Editor) {
  return (
    (
      editor.storage as { markdown?: { getMarkdown: () => string } }
    ).markdown?.getMarkdown() ?? ""
  );
}

describe("markdown link fixup", () => {
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

  it("converts [label](url) typed start-to-finish", () => {
    editor = create();
    typeText(editor, "[Google](https://google.com)");
    expect(editor.getHTML()).toMatch(
      /<a[^>]+href="https:\/\/google\.com"[^>]*>Google<\/a>/,
    );
    expect(md(editor)).toContain("[Google](https://google.com)");
  });

  it("converts when () is typed first then a URL is pasted in", () => {
    editor = create();
    typeText(editor, "[Google]()");
    const end = editor.state.selection.from;
    editor.commands.setTextSelection(end - 1);
    insertText(editor, "https://google.com", true);
    expect(editor.getHTML()).toMatch(
      /<a[^>]+href="https:\/\/google\.com"[^>]*>Google<\/a>/,
    );
    expect(editor.getHTML()).not.toContain("[Google]");
    expect(md(editor)).toContain("[Google](https://google.com)");
  });

  it("converts when () is filled letter-by-letter then caret leaves", () => {
    editor = create();
    typeText(editor, "[Google]()");
    const end = editor.state.selection.from;
    editor.commands.setTextSelection(end - 1);
    typeText(editor, "https://google.com");
    // Move caret past the closing paren to confirm the completed link.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.getHTML()).toMatch(
      /<a[^>]+href="https:\/\/google\.com"[^>]*>Google<\/a>/,
    );
    expect(md(editor)).toContain("[Google](https://google.com)");
  });

  it("does not convert incomplete href while typing inside ()", () => {
    editor = create();
    typeText(editor, "[Google]()");
    const end = editor.state.selection.from;
    editor.commands.setTextSelection(end - 1);
    typeText(editor, "http");
    expect(editor.getHTML()).toContain("[Google]");
    expect(editor.getHTML()).not.toMatch(/<a[^>]+>Google<\/a>/);
  });

  it("does not convert images into links", () => {
    editor = create();
    typeText(editor, "![logo](https://example.com/a.png)");
    expect(editor.getHTML()).toMatch(
      /<img[^>]+src="https:\/\/example\.com\/a\.png"/,
    );
    expect(editor.getHTML()).not.toMatch(/<a[^>]*>logo<\/a>/);
  });
});
