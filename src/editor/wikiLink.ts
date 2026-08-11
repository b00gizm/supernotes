import { mergeAttributes, Node, InputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Note } from "../notes/types";
import { findNoteByTitle } from "../notes/wikilinks";

/** Minimal surface used by tiptap-markdown node serializers. */
type MarkdownWriteState = {
  write: (text: string) => void;
};

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
  renderer: {
    rules: Record<
      string,
      (
        tokens: Array<{ content: string; attrs?: Array<[string, string]> }>,
        idx: number,
      ) => string
    >;
  };
};

type InlineState = {
  pos: number;
  posMax: number;
  src: string;
  push: (
    type: string,
    tag: string,
    nesting: number,
  ) => {
    content: string;
    attrs: Array<[string, string]> | null;
  };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * markdown-it: `[[Title]]` → `<span data-type="wiki-link" …>`.
 * Reserved `[[task:…]]` still matches so round-trip stays stable until ENG-61.
 */
function markdownItWikiLink(md: MarkdownItLike): void {
  md.inline.ruler.before("link", "wiki_link", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== "[[") {
      return false;
    }
    const close = state.src.indexOf("]]", start + 2);
    if (close < 0 || close > state.posMax) {
      return false;
    }
    const title = state.src.slice(start + 2, close).trim();
    if (!title || title.includes("\n")) {
      return false;
    }
    if (!silent) {
      const token = state.push("wiki_link", "span", 0);
      token.content = title;
      token.attrs = [
        ["data-type", "wiki-link"],
        ["data-title", title],
        ["class", "wiki-link"],
      ];
    }
    state.pos = close + 2;
    return true;
  });

  md.renderer.rules.wiki_link = (tokens, idx) => {
    const token = tokens[idx];
    const title = token?.content ?? "";
    return `<span data-type="wiki-link" data-title="${escapeHtml(title)}" class="wiki-link">${escapeHtml(title)}</span>`;
  };
}

export type WikiLinkQuery = {
  from: number;
  to: number;
  query: string;
};

export type WikiLinkOptions = {
  /** Live note list for autocomplete + noteId resolution. */
  getNotes?: () => Note[];
  /** Hide the note currently being edited from suggestions. */
  getExcludeNoteId?: () => string | null;
  onQueryChange?: (query: WikiLinkQuery | null) => void;
};

export const wikiLinkSuggestKey = new PluginKey("wikiLinkSuggest");

/** Active `[[query` range ending at the cursor, or null. */
export function findActiveWikiLinkQuery(
  doc: ProseMirrorNode,
  pos: number,
): WikiLinkQuery | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) {
    return null;
  }
  const parentStart = $pos.start();
  const textBefore = parent.textBetween(0, $pos.parentOffset, "\0", "\0");
  const open = textBefore.lastIndexOf("[[");
  if (open < 0) {
    return null;
  }
  const afterOpen = textBefore.slice(open + 2);
  if (afterOpen.includes("]]") || afterOpen.includes("\0")) {
    return null;
  }
  // Don't treat `[[task:` as a note wikilink query (ENG-61).
  if (afterOpen.toLowerCase().startsWith("task:")) {
    return null;
  }
  return {
    from: parentStart + open,
    to: pos,
    query: afterOpen,
  };
}

function wikiLinkSuggestPlugin(options: WikiLinkOptions): Plugin {
  return new Plugin({
    key: wikiLinkSuggestKey,
    view() {
      return {
        update(view) {
          const query = findActiveWikiLinkQuery(
            view.state.doc,
            view.state.selection.from,
          );
          options.onQueryChange?.(query);
        },
        destroy() {
          options.onQueryChange?.(null);
        },
      };
    },
  });
}

/** Convert a completed `[[Title]]` typed in the editor into a wikiLink atom. */
const wikiLinkInputRegex = /\[\[([^[\]]+)\]\]$/;

function resolveNoteId(title: string, getNotes?: () => Note[]): string | null {
  const notes = getNotes?.() ?? [];
  return findNoteByTitle(notes, title)?.id ?? null;
}

export function insertWikiLink(
  editor: Editor,
  range: { from: number; to: number },
  title: string,
  noteId: string | null = null,
): boolean {
  const trimmed = title.trim();
  if (!trimmed) {
    return false;
  }
  return editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({
      type: "wikiLink",
      attrs: { title: trimmed, noteId },
    })
    .run();
}

/**
 * Inline wikilink node with `[[` autocomplete hooks and clickable render.
 */
export const WikiLink = Node.create<WikiLinkOptions>({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {};
  },

  addAttributes() {
    return {
      title: { default: "" },
      // Runtime only — never written to markdown.
      noteId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="wiki-link"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) {
            return false;
          }
          const title =
            el.getAttribute("data-title")?.trim() ||
            el.textContent?.trim() ||
            "";
          if (!title) {
            return false;
          }
          return {
            title,
            noteId: el.getAttribute("data-note-id"),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = String(node.attrs.title ?? "");
    const noteId = node.attrs.noteId as string | null;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wiki-link",
        "data-title": title,
        ...(noteId ? { "data-note-id": noteId } : {}),
        class: "wiki-link",
      }),
      title,
    ];
  },

  addInputRules() {
    const getNotes = this.options.getNotes;
    return [
      new InputRule({
        find: wikiLinkInputRegex,
        handler: ({ range, match, chain }) => {
          const title = (match[1] ?? "").trim();
          if (!title || title.toLowerCase().startsWith("task:")) {
            return;
          }
          const noteId = resolveNoteId(title, getNotes);
          chain()
            .deleteRange(range)
            .insertContent({
              type: this.name,
              attrs: { title, noteId },
            })
            .run();
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [wikiLinkSuggestPlugin(this.options)];
  },

  onCreate() {
    // Resolve noteId attrs after markdown load so clicks can use IDs.
    const getNotes = this.options.getNotes;
    if (!getNotes) {
      return;
    }
    const { state, view } = this.editor;
    const updates: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name !== this.name) {
        return;
      }
      const title = String(node.attrs.title ?? "");
      const noteId = resolveNoteId(title, getNotes);
      if (noteId !== node.attrs.noteId) {
        updates.push({ pos, attrs: { ...node.attrs, noteId } });
      }
    });
    if (updates.length === 0) {
      return;
    }
    let tr = state.tr;
    for (const update of updates) {
      tr = tr.setNodeMarkup(update.pos, undefined, update.attrs);
    }
    view.dispatch(tr);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: ProseMirrorNode) {
          state.write(`[[${String(node.attrs.title ?? "")}]]`);
        },
        parse: {
          setup(md: MarkdownItLike) {
            markdownItWikiLink(md);
          },
        },
      },
    };
  },
});

/** Coords for positioning the autocomplete popup under the `[[` query. */
export function wikiLinkQueryRect(
  view: EditorView,
  query: WikiLinkQuery,
): DOMRect | null {
  try {
    const start = view.coordsAtPos(query.from);
    const end = view.coordsAtPos(query.to);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    return new DOMRect(left, top, Math.max(right - left, 1), bottom - top);
  } catch {
    return null;
  }
}
