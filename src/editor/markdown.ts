import type { Editor } from "@tiptap/core";

/** Read markdown from a TipTap editor that has the `Markdown` extension. */
export function getEditorMarkdown(editor: Editor): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}
