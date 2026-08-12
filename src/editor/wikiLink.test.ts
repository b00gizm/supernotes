import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import { getEditorMarkdown } from "./markdown";
import {
  findActiveWikiLinkQuery,
  insertWikiLink,
  sameWikiLinkQuery,
} from "./wikiLink";

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

  function create(notes: { id: string; title: string }[] = [], content = "") {
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
      content,
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
    expect(q?.kind).toBe("wiki");
  });

  it("turns #tag into a tag atom on trailing space", () => {
    editor = create([{ id: "1", title: "project" }]);
    typeText(editor, "See #project ");
    expect(editor.getHTML()).toContain('data-kind="tag"');
    expect(editor.getHTML()).toContain("is-tag");
    expect(getEditorMarkdown(editor)).toContain("#project");

    let found: {
      title: string;
      noteId: string | null;
      kind: string;
    } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "wikiLink") {
        found = {
          title: String(node.attrs.title),
          noteId: node.attrs.noteId as string | null,
          kind: String(node.attrs.kind),
        };
        return false;
      }
    });
    expect(found).toEqual({ title: "project", noteId: "1", kind: "tag" });
  });

  it("detects open # and @ queries", () => {
    editor = create();
    typeText(editor, "Hello #pro");
    expect(
      findActiveWikiLinkQuery(editor.state.doc, editor.state.selection.from),
    ).toMatchObject({ query: "pro", kind: "tag" });

    editor.commands.clearContent();
    editor.commands.focus("end");
    typeText(editor, "Hi @Pri");
    expect(
      findActiveWikiLinkQuery(editor.state.doc, editor.state.selection.from),
    ).toMatchObject({ query: "Pri", kind: "mention" });
  });

  it("parses #tag and @mention from markdown to the same note title as [[]]", () => {
    editor = create(
      [
        { id: "1", title: "project" },
        { id: "2", title: "Priya Sharma" },
      ],
      "See [[project]] and #project with @Priya Sharma",
    );
    const links: Array<{ title: string; kind: string }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "wikiLink") {
        links.push({
          title: String(node.attrs.title),
          kind: String(node.attrs.kind),
        });
      }
    });
    expect(links).toEqual([
      { title: "project", kind: "wiki" },
      { title: "project", kind: "tag" },
      { title: "Priya Sharma", kind: "mention" },
    ]);
    expect(getEditorMarkdown(editor)).toBe(
      "See [[project]] and #project with @Priya Sharma",
    );
  });

  it("falls back to [[wikilink]] when mention/tag title is invalid shorthand (ENG-89)", () => {
    editor = create([
      { id: "1", title: "Interview — Priya Sharma" },
      { id: "2", title: "Weekly review" },
    ]);
    const pos = editor.state.selection.from;
    insertWikiLink(
      editor,
      { from: pos, to: pos },
      "Interview — Priya Sharma",
      "1",
      "mention",
    );
    insertWikiLink(
      editor,
      {
        from: editor.state.selection.from,
        to: editor.state.selection.from,
      },
      "Weekly review",
      "2",
      "tag",
    );

    const links: Array<{ title: string; kind: string }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "wikiLink") {
        links.push({
          title: String(node.attrs.title),
          kind: String(node.attrs.kind),
        });
      }
    });
    expect(links).toEqual([
      { title: "Interview — Priya Sharma", kind: "wiki" },
      { title: "Weekly review", kind: "wiki" },
    ]);
    expect(getEditorMarkdown(editor)).toBe(
      "[[Interview — Priya Sharma]][[Weekly review]]",
    );
  });
});

describe("sameWikiLinkQuery (ENG-87)", () => {
  const base = { from: 1, to: 5, query: "ab", kind: "wiki" as const };

  it("treats nulls and identical field sets as equal", () => {
    expect(sameWikiLinkQuery(null, null)).toBe(true);
    expect(sameWikiLinkQuery(base, { ...base })).toBe(true);
    expect(sameWikiLinkQuery(base, null)).toBe(false);
    expect(sameWikiLinkQuery(base, { ...base, query: "ac" })).toBe(false);
    expect(sameWikiLinkQuery(base, { ...base, kind: "tag" })).toBe(false);
  });
});
