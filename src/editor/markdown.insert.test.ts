import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import { appendMarkdown, getEditorMarkdown, replaceMarkdown } from "./markdown";

function createEditor(content = ""): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: noteEditorExtensions(),
    content,
  });
}

describe("appendMarkdown / replaceMarkdown", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    const element = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (element instanceof HTMLElement) {
      element.remove();
    }
  });

  it("appends a formatted heading and list after existing body", () => {
    editor = createEditor("Roadmap notes");
    expect(
      appendMarkdown(
        editor,
        "## Executive summary\n\n- Ship importer\n- Lock H2 dates",
      ),
    ).toBe(true);
    expect(editor.getHTML()).toMatch(/<h2[^>]*>Executive summary<\/h2>/);
    expect(editor.getHTML()).toMatch(/<li[^>]*>.*Ship importer.*<\/li>/);
    expect(getEditorMarkdown(editor)).toContain("Roadmap notes");
    expect(getEditorMarkdown(editor)).toContain("## Executive summary");
    expect(getEditorMarkdown(editor)).toContain("- Ship importer");
  });

  it("replace is one undo step back to the previous body", () => {
    editor = createEditor("Keep this body");
    expect(replaceMarkdown(editor, "## New plan\n\nDone.")).toBe(true);
    expect(editor.getHTML()).toMatch(/<h2[^>]*>New plan<\/h2>/);
    expect(getEditorMarkdown(editor)).not.toContain("Keep this body");
    expect(editor.commands.undo()).toBe(true);
    expect(getEditorMarkdown(editor)).toBe("Keep this body");
    expect(editor.getHTML()).not.toMatch(/<h2[^>]*>New plan<\/h2>/);
  });

  it("appends after a task pill whose textContent is empty", () => {
    editor = createEditor("[[task:t-keep]]");
    expect(editor.state.doc.textContent.trim()).toBe("");
    expect(appendMarkdown(editor, "More after the pill")).toBe(true);
    const md = getEditorMarkdown(editor);
    expect(md).toContain("[[task:t-keep]]");
    expect(md).toContain("More after the pill");
  });

  it("append on an empty doc is still formatted and undoable", () => {
    editor = createEditor("");
    expect(appendMarkdown(editor, "# Title\n\nParagraph")).toBe(true);
    expect(editor.getHTML()).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent.trim()).toBe("");
  });
});
