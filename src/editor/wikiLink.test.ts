import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import { getEditorMarkdown } from "./markdown";
import { findActiveWikiLinkQuery } from "./wikiLink";

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

describe("wikilink input", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    const el = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (el instanceof HTMLElement) {
      el.remove();
    }
  });

  function create(notes: { id: string; title: string }[] = []) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: noteEditorExtensions({
        getNotes: () =>
          notes.map((note) => ({
            ...note,
            body_markdown: "",
            note_type: "regular" as const,
            pinned: false,
            created_at: "2026-08-10T00:00:00.000Z",
            updated_at: "2026-08-10T00:00:00.000Z",
          })),
      }),
      content: "",
    });
    editor.commands.focus("end");
    return editor;
  }

  it("turns [[Title]] into a wikiLink atom", () => {
    editor = create([{ id: "1", title: "Weekly Review" }]);
    typeText(editor, "See [[Weekly Review]]");
    expect(editor.getHTML()).toContain('data-type="wiki-link"');
    expect(editor.getHTML()).toContain("Weekly Review");
    expect(getEditorMarkdown(editor)).toContain("[[Weekly Review]]");

    let found: { title: string; noteId: string | null } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "wikiLink") {
        found = {
          title: String(node.attrs.title),
          noteId: node.attrs.noteId as string | null,
        };
        return false;
      }
    });
    expect(found).toEqual({ title: "Weekly Review", noteId: "1" });
  });

  it("detects an open [[ query before the cursor", () => {
    editor = create();
    typeText(editor, "Hello [[fo");
    const q = findActiveWikiLinkQuery(
      editor.state.doc,
      editor.state.selection.from,
    );
    expect(q?.query).toBe("fo");
  });
});
