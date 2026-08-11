import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

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

/**
 * Inline wikilink node. Autocomplete / navigation / links-table sync are ENG-56;
 * this issue only needs lossless `[[…]]` parse + serialize.
 */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: "" },
      // Filled when ENG-56 resolves the target note; never written to markdown.
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
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "wiki-link",
        "data-title": title,
        class: "wiki-link",
      }),
      title,
    ];
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
