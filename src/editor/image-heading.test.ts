import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";

function md(editor: Editor) {
  return (
    (
      editor.storage as { markdown?: { getMarkdown: () => string } }
    ).markdown?.getMarkdown() ?? ""
  );
}

describe("image + following block round-trip", () => {
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
    return editor;
  }

  it("keeps a heading after an image as a heading after reload", () => {
    const ed = create("![alt](images/x.png)\n\n## my header");
    expect(ed.getHTML()).toMatch(/<h2[^>]*>/);
    const saved = md(ed);
    expect(saved).toMatch(/!\[alt\]\(images\/x\.png\)/);
    expect(saved).toMatch(/## my header/);
    // Blank line (or equivalent block close) so CommonMark parses the heading.
    expect(saved).toMatch(/!\[alt\]\(images\/x\.png\)\n\n## /);

    ed.destroy();
    editor = create(saved);
    expect(editor.getHTML()).toMatch(/<h2[^>]*>my header/);
    expect(editor.getHTML()).not.toContain("## my header");
  });

  it("also round-trips a paragraph after an image", () => {
    const ed = create("![alt](images/x.png)\n\nhello");
    const saved = md(ed);
    ed.destroy();
    editor = create(saved);
    expect(editor.getHTML()).toMatch(/<p>hello<\/p>/);
  });
});
