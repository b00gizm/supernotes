import type { Editor } from "@tiptap/core";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Table } from "@tiptap/extension-table";
import Text from "@tiptap/extension-text";
import type { Node as PmNode } from "@tiptap/pm/model";
import { DOMParser as PmDOMParser } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";

const tableFixupKey = new PluginKey("markdownTableFixup");

/** Serializer state fields used when escaping `|` inside GFM table cells (ENG-88). */
export type TablePipeEscapeState = {
  inTable?: boolean;
  options: { escapeExtraCharacters?: RegExp };
};

/**
 * While `state.inTable`, make prosemirror-markdown `esc()` also escape `|`
 * so cell text like `x|y` round-trips as `x\|y` instead of splitting columns.
 */
export function withTablePipeEscaping<T>(
  state: TablePipeEscapeState,
  write: () => T,
): T {
  if (!state.inTable) {
    return write();
  }
  const prev = state.options.escapeExtraCharacters;
  state.options.escapeExtraCharacters = /\|/g;
  try {
    return write();
  } finally {
    if (prev) {
      state.options.escapeExtraCharacters = prev;
    } else {
      delete state.options.escapeExtraCharacters;
    }
  }
}

type MarkdownItLike = {
  inline: {
    ruler: {
      before: (
        prev: string,
        name: string,
        rule: (state: InlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
};

type InlineState = {
  pos: number;
  posMax: number;
  src: string;
  push: (type: string, tag: string, nesting: number) => unknown;
};

type HardBreakMarkdownState = TablePipeEscapeState & {
  write: (text: string) => void;
};

/** tiptap-markdown serializer state used while writing a GFM table (ENG-155). */
export type TableMarkdownState = TablePipeEscapeState & {
  out: string;
  write: (text: string) => void;
  renderInline: (node: PmNode) => void;
  ensureNewLine: () => void;
  closeBlock: (node: PmNode) => void;
};

/** `<br>` / `<br/>` / `<br />` — table-cell hard breaks (ENG-88) with html:false. */
const BR_TAG = /^<br\s*\/?>/i;

/**
 * markdown-it only tokenizes HTML tags when `html:true`. We keep html off so
 * unknown tags stay literal text (ENG-129), and only lift `<br>` to hardbreak.
 */
function markdownItBr(md: MarkdownItLike): void {
  md.inline.ruler.before("html_inline", "hardbreak_br", (state, silent) => {
    const rest = state.src.slice(state.pos, state.posMax);
    const match = BR_TAG.exec(rest);
    if (!match) {
      return false;
    }
    if (silent) {
      return true;
    }
    state.push("hardbreak", "br", 0);
    state.pos += match[0].length;
    return true;
  });
}

/**
 * TipTap text node with pipe-escaping inside tables (ENG-88).
 * Do not HTML-escape `<>` — with html:false those chars are literal text and
 * must round-trip (ENG-129). StarterKit must disable its `text`.
 */
export const TablePipeSafeText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: TablePipeEscapeState & { text: (value: string) => void },
          node: PmNode,
        ) {
          withTablePipeEscaping(state, () => {
            state.text(node.text ?? "");
          });
        },
        parse: {},
      },
    };
  },
});

/**
 * tiptap-markdown writes `[hardBreak]` in tables when html is off. Write `<br>`
 * instead, and parse those tags back (ENG-88 / ENG-129). StarterKit must disable
 * its `hardBreak`.
 */
export const TableHardBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: HardBreakMarkdownState,
          node: PmNode,
          parent: PmNode,
          index: number,
        ) {
          // Same skip-trailing-breaks loop as tiptap-markdown's hard-break.js.
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write(state.inTable ? "<br>" : "\\\n");
              return;
            }
          }
        },
        parse: {
          setup(md: MarkdownItLike) {
            markdownItBr(md);
          },
        },
      },
    };
  },
});

const UL_LINE = /^[-*+][ \t]+(.+)$/;
const OL_LINE = /^(\d+)[.)][ \t]+(.+)$/;

/**
 * GFM tables are one line per row. Turn `<br>`-separated list markers in a
 * cell back into a real list so WYSIWYG bullets survive save/reload (ENG-155).
 */
export function listHtmlFromBrLines(html: string): string | null {
  const lines = html.split(/<br\s*\/?>/i).map((line) => line.trim());
  if (lines.length < 2 || lines.some((line) => line.length === 0)) {
    return null;
  }
  const ulItems: string[] = [];
  for (const line of lines) {
    const text = UL_LINE.exec(line)?.[1];
    if (text == null) {
      break;
    }
    ulItems.push(`<li><p>${text}</p></li>`);
  }
  if (ulItems.length === lines.length) {
    return `<ul>${ulItems.join("")}</ul>`;
  }
  const olItems: string[] = [];
  for (const line of lines) {
    const text = OL_LINE.exec(line)?.[2];
    if (text == null) {
      return null;
    }
    olItems.push(`<li><p>${text}</p></li>`);
  }
  return `<ol>${olItems.join("")}</ol>`;
}

/** Rewrite list-shaped table cells in markdown-it HTML before TipTap parses it. */
export function reconstructTableCellLists(root: HTMLElement): void {
  for (const cell of root.querySelectorAll("td, th")) {
    if (!(cell instanceof HTMLElement)) {
      continue;
    }
    if (cell.querySelector("ul, ol, pre, table")) {
      continue;
    }
    const paragraphs = [...cell.querySelectorAll("p")];
    if (paragraphs.length > 1) {
      continue;
    }
    const source =
      paragraphs.length === 1
        ? (paragraphs[0]?.innerHTML ?? "")
        : cell.innerHTML;
    const rebuilt = listHtmlFromBrLines(source);
    if (!rebuilt) {
      continue;
    }
    cell.innerHTML = rebuilt;
  }
}

function isListNode(node: PmNode): boolean {
  const name = node.type.name;
  return name === "bulletList" || name === "orderedList" || name === "taskList";
}

function flattenLeakedCellNewlines(cellOut: string): string {
  return cellOut.replace(/\n+/g, "<br>").replace(/(?:<br>)+$/g, "");
}

/**
 * Write a table cell as a single GFM line. Block children become `<br>`-joined
 * inlines; lists keep `- ` / `1. ` markers so parse can rebuild them.
 * Nested lists flatten to one level (ponytail: reconstruct indent if cells
 * grow real nested editing).
 */
function serializeTableCell(state: TableMarkdownState, cell: PmNode): void {
  let pendingBr = false;
  const emitBr = () => {
    if (pendingBr) {
      state.write("<br>");
    }
    pendingBr = true;
  };

  const writeTextblock = (block: PmNode, prefix: string) => {
    if (!block.textContent) {
      return;
    }
    emitBr();
    if (prefix) {
      state.write(prefix);
    }
    state.renderInline(block);
  };

  const walkListItem = (item: PmNode, marker: string) => {
    let first = true;
    item.forEach((child) => {
      if (isListNode(child)) {
        walk(child);
        first = false;
        return;
      }
      if (child.isTextblock) {
        writeTextblock(child, first ? marker : "");
        first = false;
        return;
      }
      walk(child);
      first = false;
    });
  };

  const walk = (node: PmNode) => {
    if (node.type.name === "bulletList") {
      node.forEach((item) => {
        walkListItem(item, "- ");
      });
      return;
    }
    if (node.type.name === "orderedList") {
      let n = Number(node.attrs.start ?? 1) || 1;
      node.forEach((item) => {
        walkListItem(item, `${String(n)}. `);
        n += 1;
      });
      return;
    }
    if (node.type.name === "taskList") {
      node.forEach((item) => {
        const checked = item.attrs.checked ? "x" : " ";
        walkListItem(item, `- [${checked}] `);
      });
      return;
    }
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      walkListItem(node, "- ");
      return;
    }
    if (node.isTextblock) {
      writeTextblock(node, "");
      return;
    }
    node.forEach((child) => {
      walk(child);
    });
  };

  const start = state.out.length;
  cell.forEach((child) => {
    walk(child);
  });
  const leaked = state.out.slice(start);
  if (leaked.includes("\n")) {
    state.out = state.out.slice(0, start) + flattenLeakedCellNewlines(leaked);
  }
}

export function serializeGfmTable(
  state: TableMarkdownState,
  node: PmNode,
): void {
  state.inTable = true;
  try {
    node.forEach((row, _offset, rowIndex) => {
      state.write("| ");
      row.forEach((cell, _cellOffset, colIndex) => {
        if (colIndex > 0) {
          state.write(" | ");
        }
        serializeTableCell(state, cell);
      });
      state.write(" |");
      state.ensureNewLine();
      if (rowIndex === 0) {
        const delimiter = Array.from(
          { length: row.childCount },
          () => "---",
        ).join(" | ");
        state.write(`| ${delimiter} |`);
        state.ensureNewLine();
      }
    });
    state.closeBlock(node);
  } finally {
    state.inTable = false;
  }
}

/**
 * TipTap table with GFM-safe cell serialize. tiptap-markdown's default writes
 * raw newlines for lists / extra paragraphs, which GFM cannot parse back.
 */
export const NoteTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TableMarkdownState, node: PmNode) {
          serializeGfmTable(state, node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            reconstructTableCellLists(element);
          },
        },
      },
    };
  },
});

/** GFM separator row: `| --- | --- |` (TipTap table tokenizer uses the same idea). */
export function isGfmTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^[ \t|:]*-[ \t|:-]*$/.test(trimmed) && trimmed.includes("|");
}

export function isGfmTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

/** Pipe-split column count (leading/trailing pipes optional). */
export function gfmColumnCount(line: string): number {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split("|").length;
}

/**
 * At least two cells with content — avoids converting a lone `|` mid-typing.
 * Require leading+trailing `|` so live conversion waits until the row is fully
 * typed; converting on `| 1 | 2` (no trailing pipe) leaves leftover keystrokes
 * that land in the first cell after ENG-95 caret handoff.
 */
export function isCompleteGfmTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return false;
  }
  const pipes = trimmed.match(/\|/g)?.length ?? 0;
  if (pipes < 3) {
    return false;
  }
  const cells = trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  return cells.length >= 2;
}

/** True when plain text looks like a GFM pipe table (header + separator). */
export function looksLikeGfmTable(text: string): boolean {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return false;
  }
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const prev = lines[i - 1];
    if (
      row !== undefined &&
      prev !== undefined &&
      isGfmTableSeparator(row) &&
      isGfmTableRow(prev) &&
      gfmColumnCount(prev) === gfmColumnCount(row) &&
      gfmColumnCount(prev) >= 2
    ) {
      return true;
    }
  }
  return false;
}

function paragraphPlainText(node: PmNode): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) {
      text += child.text ?? "";
    } else if (child.type.name === "hardBreak") {
      text += "\n";
    }
  });
  return text;
}

function elementFromHtml(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html.trim();
  return el;
}

function parseMarkdownToNode(editor: Editor, markdown: string): PmNode | null {
  const storage = editor.storage as {
    markdown?: { parser?: { parse: (md: string) => string } };
  };
  const parser = storage.markdown?.parser;
  if (!parser) {
    return null;
  }
  const html = parser.parse(markdown);
  const dom = elementFromHtml(html);
  const parsed = PmDOMParser.fromSchema(editor.schema).parse(dom);
  return parsed;
}

type ParagraphRun = {
  from: number;
  to: number;
  lines: string[];
};

/**
 * Find top-level paragraph runs that form a GFM table (header + sep + ≥1 body).
 */
function findGfmTableParagraphRuns(doc: PmNode): ParagraphRun[] {
  const runs: ParagraphRun[] = [];
  type Item = { from: number; to: number; text: string };
  let current: Item[] = [];

  const flush = () => {
    if (current.length >= 3) {
      for (let i = 1; i < current.length; i++) {
        const sep = current[i];
        const header = current[i - 1];
        if (
          sep &&
          header &&
          isGfmTableSeparator(sep.text) &&
          isCompleteGfmTableRow(header.text) &&
          gfmColumnCount(header.text) === gfmColumnCount(sep.text) &&
          gfmColumnCount(header.text) >= 2
        ) {
          const cols = gfmColumnCount(header.text);
          let end = i;
          while (end + 1 < current.length) {
            const next = current[end + 1];
            if (
              !next ||
              !isCompleteGfmTableRow(next.text) ||
              gfmColumnCount(next.text) !== cols
            ) {
              break;
            }
            end += 1;
          }
          if (end > i) {
            const slice = current.slice(i - 1, end + 1);
            const first = slice[0];
            const last = slice[slice.length - 1];
            if (first && last) {
              runs.push({
                from: first.from,
                to: last.to,
                lines: slice.map((item) => item.text),
              });
            }
          }
          break;
        }
      }
    }
    current = [];
  };

  doc.forEach((node, pos) => {
    if (node.type.name === "paragraph") {
      const text = paragraphPlainText(node);
      if (isGfmTableRow(text) || isGfmTableSeparator(text)) {
        current.push({ from: pos, to: pos + node.nodeSize, text });
        return;
      }
    }
    flush();
  });
  flush();
  return runs;
}

function firstTableNode(doc: PmNode): PmNode | null {
  let table: PmNode | null = null;
  doc.forEach((child) => {
    if (!table && child.type.name === "table") {
      table = child;
    }
  });
  return table;
}

function replaceWithMarkdownTable(
  editor: Editor,
  tr: Transaction,
  from: number,
  to: number,
  markdown: string,
): boolean {
  const mappedFrom = tr.mapping.map(from);
  const mappedTo = tr.mapping.map(to);
  const node = parseMarkdownToNode(editor, markdown);
  if (!node) {
    return false;
  }
  // Only convert when re-parse actually yields a table (ENG-95).
  const table = firstTableNode(node);
  if (!table) {
    return false;
  }
  tr.replaceWith(mappedFrom, mappedTo, table);

  // Caret into first cell so continued typing stays inside the table.
  // Object bag: callback assignment isn't visible to control-flow analysis on `let`.
  const found = { cellPos: null as number | null };
  tr.doc.nodesBetween(mappedFrom, mappedFrom + table.nodeSize, (n, pos) => {
    if (found.cellPos != null) {
      return false;
    }
    if (n.type.name === "tableHeader" || n.type.name === "tableCell") {
      found.cellPos = pos + 1;
      if (n.firstChild?.isTextblock) {
        found.cellPos += 1;
      }
      return false;
    }
  });
  if (found.cellPos != null) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(found.cellPos)));
  }
  return true;
}

/**
 * Paste/typing fixup: turn GFM pipe tables into TipTap table nodes.
 * Clipboard HTML often wins over markdown text (raw `|` in `<p>`s); we prefer
 * text/plain when it looks like a table. Typing Enter between rows becomes
 * consecutive paragraphs — convert once header+sep+body are present.
 */
export function markdownTableFixupPlugin(editor: Editor): Plugin {
  return new Plugin({
    key: tableFixupKey,
    props: {
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!looksLikeGfmTable(text)) {
          return false;
        }
        const html = event.clipboardData?.getData("text/html") ?? "";
        // If the clipboard already has a real <table>, let PM handle it.
        if (/<table[\s>]/i.test(html)) {
          return false;
        }
        event.preventDefault();
        editor.commands.insertContent(text);
        return true;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }
      if (
        transactions.some((transaction) => transaction.getMeta(tableFixupKey))
      ) {
        return null;
      }

      const { tr } = newState;
      let changed = false;

      type BlockReplace = { from: number; to: number; markdown: string };
      const replaces: BlockReplace[] = [];

      // Single paragraph (or hard-broken) containing a full table.
      // Skip nested contexts — converting inside blockquotes/cells corrupts them.
      newState.doc.descendants((node, pos) => {
        if (node.type.name === "blockquote" || node.type.name === "table") {
          return false;
        }
        if (node.type.name !== "paragraph") {
          return;
        }
        const text = paragraphPlainText(node);
        if (!text.includes("\n") || !looksLikeGfmTable(text)) {
          return;
        }
        const lines = text
          .split(/\n/)
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0);
        if (lines.length < 3) {
          return;
        }
        replaces.push({
          from: pos,
          to: pos + node.nodeSize,
          markdown: lines.join("\n"),
        });
      });

      // Consecutive paragraphs: | A | B | / | --- | / | 1 | 2 |
      for (const run of findGfmTableParagraphRuns(newState.doc)) {
        replaces.push({
          from: run.from,
          to: run.to,
          markdown: run.lines.join("\n"),
        });
      }

      for (const { from, to, markdown } of replaces.reverse()) {
        if (replaceWithMarkdownTable(editor, tr, from, to, markdown)) {
          changed = true;
        }
      }

      if (!changed || !tr.docChanged) {
        return null;
      }
      tr.setMeta(tableFixupKey, true);
      return tr;
    },
  });
}
