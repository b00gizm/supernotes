import { EditorContent, useEditor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { noteEditorExtensions } from "./extensions";
import { openExternalUrl, saveNoteImage } from "./media";

export type NoteEditorProps = {
  /** Initial markdown; remount (via `key`) when switching notes. */
  markdown: string;
  onChange: (markdown: string) => void;
};

function firstImageFile(data: DataTransfer | null): File | null {
  if (!data || data.files.length === 0) {
    return null;
  }
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) {
      return file;
    }
    // Some OS drops (esp. older webviews) omit MIME; fall back on extension.
    if (!file.type && /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
      return file;
    }
  }
  return null;
}

function insertImageAt(
  view: EditorView,
  src: string,
  alt: string,
  pos?: number,
) {
  const type = view.state.schema.nodes.image;
  if (!type) {
    return;
  }
  const node = type.create({ src, alt });
  const tr =
    pos === undefined
      ? view.state.tr.replaceSelectionWith(node)
      : view.state.tr.insert(pos, node);
  view.dispatch(tr);
}

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
      handleClick: (_view, _pos, event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return false;
        }
        const anchor = target.closest("a");
        if (!(anchor instanceof HTMLAnchorElement)) {
          return false;
        }
        const href = anchor.getAttribute("href");
        if (!href || !/^https?:\/\//i.test(href)) {
          return false;
        }
        event.preventDefault();
        void openExternalUrl(href);
        return true;
      },
      handlePaste: (view, event) => {
        const file = firstImageFile(event.clipboardData);
        if (!file) {
          return false;
        }
        event.preventDefault();
        void saveNoteImage(file).then((src) => {
          insertImageAt(view, src, file.name.replace(/\.[^.]+$/, ""));
        });
        return true;
      },
      handleDrop: (view, event) => {
        const file = firstImageFile(event.dataTransfer);
        if (!file) {
          return false;
        }
        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        void saveNoteImage(file).then((src) => {
          insertImageAt(
            view,
            src,
            file.name.replace(/\.[^.]+$/, ""),
            coords?.pos,
          );
        });
        return true;
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
