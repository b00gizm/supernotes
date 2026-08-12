import { mergeAttributes, Node, InputRule } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Note } from "../notes/types";
import { findNoteByTitle, MENTION_TITLE, TAG_TITLE } from "../notes/wikilinks";

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

export type NoteLinkKind = "wiki" | "tag" | "mention";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isWordyBefore(src: string, pos: number): boolean {
  if (pos <= 0) {
    return false;
  }
  return /[\w@]/.test(src.charAt(pos - 1));
}

/** Partial mention text after `@` while the caret is still in the token. */
function isMentionQuery(after: string): boolean {
  return /^(?:|[A-Za-z][\w-]*|[A-Za-z][\w-]* |[A-Za-z][\w-]* [A-Z][\w-]*)$/.test(
    after,
  );
}

function linkClass(kind: NoteLinkKind, resolved = true): string {
  let base = "wiki-link";
  if (kind === "tag") {
    base = "wiki-link is-tag";
  } else if (kind === "mention") {
    base = "wiki-link is-mention";
  }
  return resolved ? base : `${base} is-unresolved`;
}

function displayText(kind: NoteLinkKind, title: string): string {
  if (kind === "tag") {
    return `#${title}`;
  }
  if (kind === "mention") {
    return `@${title}`;
  }
  return title;
}

function serializeLink(kind: NoteLinkKind, title: string): string {
  // Fall back to [[Title]] when shorthand would not round-trip (ENG-89).
  if (kind === "tag" && TAG_TITLE.test(title)) {
    return `#${title}`;
  }
  if (kind === "mention" && MENTION_TITLE.test(title)) {
    return `@${title}`;
  }
  return `[[${title}]]`;
}

/** Tag/mention only when the title fits that shorthand charset; else wiki. */
function effectiveLinkKind(kind: NoteLinkKind, title: string): NoteLinkKind {
  if (kind === "tag" && TAG_TITLE.test(title)) {
    return "tag";
  }
  if (kind === "mention" && MENTION_TITLE.test(title)) {
    return "mention";
  }
  return "wiki";
}

function parseKind(value: string | null): NoteLinkKind {
  if (value === "tag" || value === "mention") {
    return value;
  }
  return "wiki";
}

/**
 * markdown-it: `[[Title]]` / `#tag` / `@Name` → `<span data-type="wiki-link" …>`.
 * `[[task:…]]` is owned by the task-pill block parser (ENG-61).
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
    // Task pills are a separate block node — never a note wikilink.
    if (title.toLowerCase().startsWith("task:")) {
      return false;
    }
    if (!silent) {
      const token = state.push("wiki_link", "span", 0);
      token.content = title;
      token.attrs = [
        ["data-type", "wiki-link"],
        ["data-kind", "wiki"],
        ["data-title", title],
        ["class", "wiki-link"],
      ];
    }
    state.pos = close + 2;
    return true;
  });

  md.inline.ruler.before("link", "note_tag", (state, silent) => {
    const start = state.pos;
    if (state.src.charAt(start) !== "#" || isWordyBefore(state.src, start)) {
      return false;
    }
    const rest = state.src.slice(start + 1, state.posMax);
    const match = rest.match(/^([\w-]+)/);
    if (!match?.[1]) {
      return false;
    }
    const title = match[1];
    if (!silent) {
      const token = state.push("wiki_link", "span", 0);
      token.content = title;
      token.attrs = [
        ["data-type", "wiki-link"],
        ["data-kind", "tag"],
        ["data-title", title],
        ["class", "wiki-link is-tag"],
      ];
    }
    state.pos = start + 1 + title.length;
    return true;
  });

  md.inline.ruler.before("link", "note_mention", (state, silent) => {
    const start = state.pos;
    if (state.src.charAt(start) !== "@" || isWordyBefore(state.src, start)) {
      return false;
    }
    const rest = state.src.slice(start + 1, state.posMax);
    const match = rest.match(/^([A-Za-z][\w-]*(?: [A-Z][\w-]*)?)/);
    if (!match?.[1]) {
      return false;
    }
    const title = match[1];
    if (!silent) {
      const token = state.push("wiki_link", "span", 0);
      token.content = title;
      token.attrs = [
        ["data-type", "wiki-link"],
        ["data-kind", "mention"],
        ["data-title", title],
        ["class", "wiki-link is-mention"],
      ];
    }
    state.pos = start + 1 + title.length;
    return true;
  });

  md.renderer.rules.wiki_link = (tokens, idx) => {
    const token = tokens[idx];
    const title = token?.content ?? "";
    const kind = parseKind(
      token?.attrs?.find((attr) => attr[0] === "data-kind")?.[1] ?? null,
    );
    return `<span data-type="wiki-link" data-kind="${kind}" data-title="${escapeHtml(title)}" class="${linkClass(kind)}">${escapeHtml(displayText(kind, title))}</span>`;
  };
}

export type WikiLinkQuery = {
  from: number;
  to: number;
  query: string;
  kind: NoteLinkKind;
};

/** Structural equality for query payloads (fresh objects each plugin update). */
export function sameWikiLinkQuery(
  a: WikiLinkQuery | null,
  b: WikiLinkQuery | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.query === b.query &&
    a.kind === b.kind
  );
}

export type WikiLinkOptions = {
  /** Live note list for autocomplete + noteId resolution. */
  getNotes?: () => Note[];
  /** Hide the note currently being edited from suggestions. */
  getExcludeNoteId?: () => string | null;
  onQueryChange?: (query: WikiLinkQuery | null) => void;
};

export const wikiLinkSuggestKey = new PluginKey("wikiLinkSuggest");

/** Active `[[` / `#` / `@` query range ending at the cursor, or null. */
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
  if (open >= 0) {
    const afterOpen = textBefore.slice(open + 2);
    if (!afterOpen.includes("]]") && !afterOpen.includes("\0")) {
      // Don't treat `[[task:` as a note wikilink query (ENG-61).
      if (!afterOpen.toLowerCase().startsWith("task:")) {
        return {
          from: parentStart + open,
          to: pos,
          query: afterOpen,
          kind: "wiki",
        };
      }
    }
  }

  const tag = /(?<![\w@])#([\w-]*)$/.exec(textBefore);
  // Bare `#` alone must not open autocomplete — Enter would swallow the newline (ENG-114).
  if (tag && (tag[1] ?? "").length > 0) {
    return {
      from: parentStart + tag.index,
      to: pos,
      query: tag[1] ?? "",
      kind: "tag",
    };
  }

  const mentionAt = /(?<![\w@])@(.*)$/.exec(textBefore);
  const mentionQuery = mentionAt?.[1] ?? "";
  // Same for bare `@`: require at least one character before suggesting.
  if (mentionAt && mentionQuery.length > 0 && isMentionQuery(mentionQuery)) {
    return {
      from: parentStart + mentionAt.index,
      to: pos,
      query: mentionQuery,
      kind: "mention",
    };
  }

  return null;
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
/** `#tag` + trailing space → tag atom (space re-inserted). */
const tagInputRegex = /#([\w-]+)\s$/;
/**
 * `@Name` + punctuation, or `@Name Surname` + space → mention atom.
 * ponytail: single-name mentions don't complete on space (keeps surname typing);
 * use autocomplete or trailing punctuation; upgrade with a proper tokenizer later.
 */
const mentionInputRegex =
  /@([A-Za-z][\w-]* [A-Z][\w-]*)\s$|@([A-Za-z][\w-]*)([.,;:!?])$/;

function resolveNoteId(title: string, getNotes?: () => Note[]): string | null {
  const notes = getNotes?.() ?? [];
  return findNoteByTitle(notes, title)?.id ?? null;
}

export function insertWikiLink(
  editor: Editor,
  range: { from: number; to: number },
  title: string,
  noteId: string | null = null,
  kind: NoteLinkKind = "wiki",
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
      attrs: {
        title: trimmed,
        noteId,
        kind: effectiveLinkKind(kind, trimmed),
      },
    })
    .run();
}

/**
 * Inline note-link node: `[[wikilink]]`, `#tag`, or `@mention`.
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
      kind: { default: "wiki" },
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
            el.textContent?.trim().replace(/^[#@]/, "") ||
            "";
          if (!title) {
            return false;
          }
          return {
            title,
            noteId: el.getAttribute("data-note-id"),
            kind: parseKind(el.getAttribute("data-kind")),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = String(node.attrs.title ?? "");
    const noteId = (node.attrs.noteId as string | null) || null;
    const kind = parseKind(String(node.attrs.kind ?? "wiki"));
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wiki-link",
        "data-kind": kind,
        "data-title": title,
        ...(noteId ? { "data-note-id": noteId } : {}),
        class: linkClass(kind, Boolean(noteId)),
      }),
      displayText(kind, title),
    ];
  },

  renderText({ node }) {
    const title = String(node.attrs.title ?? "");
    const kind = parseKind(String(node.attrs.kind ?? "wiki"));
    return displayText(kind, title);
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
              attrs: { title, noteId, kind: "wiki" },
            })
            .run();
        },
      }),
      new InputRule({
        find: tagInputRegex,
        handler: ({ range, match, chain }) => {
          const title = (match[1] ?? "").trim();
          if (!title) {
            return;
          }
          const noteId = resolveNoteId(title, getNotes);
          chain()
            .deleteRange(range)
            .insertContent([
              {
                type: this.name,
                attrs: { title, noteId, kind: "tag" },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
      }),
      new InputRule({
        find: mentionInputRegex,
        handler: ({ range, match, chain }) => {
          const title = (match[1] ?? match[2] ?? "").trim();
          const trailing = match[3] ?? " ";
          if (!title) {
            return;
          }
          const noteId = resolveNoteId(title, getNotes);
          chain()
            .deleteRange(range)
            .insertContent([
              {
                type: this.name,
                attrs: { title, noteId, kind: "mention" },
              },
              { type: "text", text: trailing },
            ])
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
          const title = String(node.attrs.title ?? "");
          const kind = parseKind(String(node.attrs.kind ?? "wiki"));
          state.write(serializeLink(kind, title));
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

/** Coords for positioning the autocomplete popup under the query. */
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
