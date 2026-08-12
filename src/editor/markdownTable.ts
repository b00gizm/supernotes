import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { DOMParser as PmDOMParser } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";

const tableFixupKey = new PluginKey("markdownTableFixup");

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

/** At least two cells with content — avoids converting a lone `|` mid-typing. */
export function isCompleteGfmTableRow(line: string): boolean {
  const trimmed = line.trim();
  const pipes = trimmed.match(/\|/g)?.length ?? 0;
  if (pipes < 2) {
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
  let cellPos: number | null = null;
  tr.doc.nodesBetween(mappedFrom, mappedFrom + table.nodeSize, (n, pos) => {
    if (cellPos != null) {
      return false;
    }
    if (n.type.name === "tableHeader" || n.type.name === "tableCell") {
      cellPos = pos + 1;
      if (n.firstChild?.isTextblock) {
        cellPos += 1;
      }
      return false;
    }
  });
  if (cellPos != null) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos)));
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
