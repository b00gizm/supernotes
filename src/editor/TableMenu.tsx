import type { Editor } from "@tiptap/react";

/** Table controls — insert when outside a table; edit when inside. */
export function TableMenu({ editor }: { editor: Editor }) {
  if (!editor.isActive("table")) {
    return (
      <div className="table-menu" role="toolbar" aria-label="Table">
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          }}
        >
          Insert table
        </button>
      </div>
    );
  }

  return (
    <div className="table-menu" role="toolbar" aria-label="Table">
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.chain().focus().addRowAfter().run();
        }}
      >
        + Row
      </button>
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.chain().focus().addColumnAfter().run();
        }}
      >
        + Col
      </button>
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.chain().focus().deleteRow().run();
        }}
      >
        − Row
      </button>
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.chain().focus().deleteColumn().run();
        }}
      >
        − Col
      </button>
      <button
        type="button"
        className="danger"
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          editor.chain().focus().deleteTable().run();
        }}
      >
        Delete table
      </button>
    </div>
  );
}
