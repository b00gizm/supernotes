import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";

/** Position of a table that is the previous sibling of the cursor's textblock. */
export function tablePosBeforeCursor(state: EditorState): number | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 1) {
    return null;
  }
  const containerDepth = $from.depth - 1;
  const index = $from.index(containerDepth);
  if (index === 0) {
    return null;
  }
  const prev = $from.node(containerDepth).child(index - 1);
  if (prev.type.name !== "table") {
    return null;
  }
  return $from.posAtIndex(index - 1, containerDepth);
}

function isTableNodeSelection(state: EditorState): boolean {
  const { selection } = state;
  return (
    selection instanceof NodeSelection && selection.node.type.name === "table"
  );
}

/** First Backspace/Delete after a table selects it; second deletes. */
export function handleStaticTableBackspace(editor: Editor): boolean {
  if (isTableNodeSelection(editor.state)) {
    return editor.commands.deleteSelection();
  }
  const tablePos = tablePosBeforeCursor(editor.state);
  if (tablePos == null) {
    return false;
  }
  return editor.commands.setNodeSelection(tablePos);
}

export function handleStaticTableDelete(editor: Editor): boolean {
  // Same select-then-delete as Backspace when the caret sits on the line after.
  return handleStaticTableBackspace(editor);
}

/**
 * Markdown tables: TipTap Tab still adds a row at the end; Backspace/Delete on
 * the line after selects then deletes the whole table (no row/col chrome).
 */
export const StaticMarkdownTable = Extension.create({
  name: "staticMarkdownTable",
  // Beat TipTap Table / default join-on-Backspace when after a table.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => handleStaticTableBackspace(this.editor),
      "Mod-Backspace": () => handleStaticTableBackspace(this.editor),
      Delete: () => handleStaticTableDelete(this.editor),
      "Mod-Delete": () => handleStaticTableDelete(this.editor),
    };
  },
});
