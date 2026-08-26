import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { DOMParser as PmDOMParser } from "@tiptap/pm/model";

/** Read markdown from a TipTap editor that has the `Markdown` extension. */
export function getEditorMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

function parseMarkdown(editor: Editor, markdown: string): PmNode | null {
  const storage = editor.storage as {
    markdown?: { parser?: { parse: (md: string) => string } };
  };
  const parser = storage.markdown?.parser;
  if (!parser) {
    return null;
  }
  const html = parser.parse(markdown);
  const el = document.createElement("div");
  el.innerHTML = html.trim();
  return PmDOMParser.fromSchema(editor.schema).parse(el);
}

/** Insert parsed markdown at the end of the doc. One undo step. */
export function appendMarkdown(editor: Editor, markdown: string): boolean {
  if (editor.isDestroyed) {
    return false;
  }
  if (!getEditorMarkdown(editor).trim()) {
    return replaceMarkdown(editor, markdown);
  }
  const parsed = parseMarkdown(editor, markdown);
  if (!parsed) {
    return false;
  }
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.insert(tr.doc.content.size, parsed.content);
      }
      return true;
    })
    .run();
}

/** Replace the whole doc with parsed markdown. One undo step. */
export function replaceMarkdown(editor: Editor, markdown: string): boolean {
  if (editor.isDestroyed) {
    return false;
  }
  const parsed = parseMarkdown(editor, markdown);
  if (!parsed) {
    return false;
  }
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.replaceWith(0, tr.doc.content.size, parsed.content);
      }
      return true;
    })
    .run();
}
