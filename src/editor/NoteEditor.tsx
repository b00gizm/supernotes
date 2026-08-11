import { EditorContent, useEditor } from "@tiptap/react";
import { noteEditorExtensions } from "./extensions";

export type NoteEditorProps = {
  /** Initial markdown; remount (via `key`) when switching notes. */
  markdown: string;
  onChange: (markdown: string) => void;
};

export function NoteEditor({ markdown, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: noteEditorExtensions(),
    content: markdown,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "note-editor-content",
        "aria-label": "Note body",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      const storage = current.storage as {
        markdown?: { getMarkdown: () => string };
      };
      onChange(storage.markdown?.getMarkdown() ?? current.getText());
    },
  });

  return (
    <div className="body-input note-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
