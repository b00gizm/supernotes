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

/** First Backspace/Delete after a table selects it; second deletes. Tab never adds rows. */
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
 * Markdown tables stay fixed-size: no Tab-spawned rows, select-then-delete
 * with Backspace on the line after the table.
 */
export const StaticMarkdownTable = Extension.create({
  name: "staticMarkdownTable",
  // Beat TipTap Table's Tab → addRowAfter and join-on-Backspace.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isActive("table")) {
          return false;
        }
        this.editor.commands.goToNextCell();
        return true;
      },
      "Shift-Tab": () => {
        if (!this.editor.isActive("table")) {
          return false;
        }
        this.editor.commands.goToPreviousCell();
        return true;
      },
      Backspace: () => handleStaticTableBackspace(this.editor),
      "Mod-Backspace": () => handleStaticTableBackspace(this.editor),
      Delete: () => handleStaticTableDelete(this.editor),
      "Mod-Delete": () => handleStaticTableDelete(this.editor),
    };
  },
});
