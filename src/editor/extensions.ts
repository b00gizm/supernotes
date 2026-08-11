import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import HighlightBase from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { nodeInputRule, type Extensions } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { ImageView } from "./ImageView";

const lowlight = createLowlight(common);

/** Allow empty src so `![chart]()` becomes a drop slot (TipTap default needs \\S+). */
const imageInputRegex =
  /(?:^|\s)(!\[([^\]]*)\]\(([^)\s]*)(?:(?:\s+)["']([^"']+)["'])?\))$/;

/**
 * Complete markdown links only (needs closing `)` + a real host). Stricter than
 * TipTap's isAllowedUri so we don't convert `[label](https://g)` mid-typing.
 */
const markdownLinkFixupRegex =
  /\[([^[\]]+)\]\((https?:\/\/(?:[^)\s/]+\.[^)\s]*|localhost(?:[:/][^)\s]*)?)|mailto:[^)\s]+)(?:\s+"[^"]*")?\)/g;

const markdownLinkFixupKey = new PluginKey("markdownLinkFixup");

/**
 * Convert `[label](url)` even when built out of order (type `()` first, then
 * fill/paste the URL). TipTap's input rule only fires as you type the final `)`.
 */
function markdownLinkFixupPlugin(markType: MarkType): Plugin {
  return new Plugin({
    key: markdownLinkFixupKey,
    appendTransaction(transactions, oldState, newState) {
      const docChanged = transactions.some(
        (transaction) => transaction.docChanged,
      );
      const selectionChanged = !oldState.selection.eq(newState.selection);
      if (!docChanged && !selectionChanged) {
        return null;
      }
      if (
        transactions.some((transaction) =>
          transaction.getMeta(markdownLinkFixupKey),
        )
      ) {
        return null;
      }

      type Replacement = {
        from: number;
        to: number;
        label: string;
        href: string;
      };
      const replacements: Replacement[] = [];
      const sel = newState.selection;
      const isPaste = transactions.some(
        (transaction) => transaction.getMeta("paste") === true,
      );

      newState.doc.descendants((node, pos) => {
        if (!node.isTextblock) {
          return;
        }
        const text = node.textContent;
        markdownLinkFixupRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = markdownLinkFixupRegex.exec(text)) !== null) {
          // Don't turn images `![alt](url)` into links.
          if (match.index > 0 && text[match.index - 1] === "!") {
            continue;
          }
          const from = pos + 1 + match.index;
          const to = from + match[0].length;
          // Letter-by-letter fill inside `()`: wait until caret leaves the
          // syntax (or a paste inserts the whole URL at once).
          if (!isPaste && sel.from > from && sel.from < to) {
            continue;
          }
          const $from = newState.doc.resolve(from);
          if (
            newState.schema.marks.code &&
            newState.schema.marks.code.isInSet($from.marks())
          ) {
            continue;
          }
          replacements.push({
            from,
            to,
            label: match[1],
            href: match[2],
          });
        }
      });

      if (replacements.length === 0) {
        return null;
      }

      const { tr } = newState;
      for (const { from, to, label, href } of replacements.reverse()) {
        const between = tr.doc.textBetween(from, to);
        // Exact `[label](href)` or titled `[label](href "…")`.
        if (
          between !== `[${label}](${href})` &&
          !(between.startsWith(`[${label}](${href}`) && between.endsWith(")"))
        ) {
          continue;
        }
        const mark = markType.create({ href });
        tr.replaceWith(from, to, newState.schema.text(label, [mark]));
      }

      if (!tr.docChanged) {
        return null;
      }
      tr.setMeta(markdownLinkFixupKey, true);
      tr.setMeta("preventAutolink", true);
      return tr;
    },
  });
}

type MarkdownItLike = {
  inline: {
    ruler: {
      after: (
        prev: string,
        name: string,
        rule: (state: InlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
};

type InlineState = {
  pos: number;
  src: string;
  push: (
    type: string,
    tag: string,
    nesting: number,
  ) => { markup: string; content: string };
};

/**
 * markdown-it plugin: ==text== → <mark>text</mark>
 * ponytail: flat text inside marks (no nested emphasis); enough for ENG-53.
 */
function markdownItMark(md: MarkdownItLike): void {
  md.inline.ruler.after("emphasis", "mark", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== "==") {
      return false;
    }
    const close = state.src.indexOf("==", start + 2);
    if (close < 0) {
      return false;
    }
    if (!silent) {
      const open = state.push("mark_open", "mark", 1);
      open.markup = "==";
      const text = state.push("text", "", 0);
      text.content = state.src.slice(start + 2, close);
      const end = state.push("mark_close", "mark", -1);
      end.markup = "==";
    }
    state.pos = close + 2;
    return true;
  });
}

/** Highlight with `==…==` markdown round-trip (tiptap-markdown has no built-in). */
const Highlight = HighlightBase.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "==",
          close: "==",
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup(md: MarkdownItLike) {
            markdownItMark(md);
          },
        },
      },
    };
  },
});

/**
 * Link: markdown `[text](url)`, Cmd/Ctrl+K on selection, external → OS browser.
 * Empty selection returns false so App search can claim Mod-k.
 */
const NoteLink = Link.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        const { from, to } = this.editor.state.selection;
        if (from === to) {
          return false;
        }
        const prev = this.editor.getAttributes("link").href as
          string | undefined;
        const url = window.prompt("Link URL", prev ?? "https://");
        if (url === null) {
          return true;
        }
        if (url.trim() === "") {
          return this.editor.commands.unsetLink();
        }
        return this.editor
          .chain()
          .focus()
          .extendMarkRange("link")
          .setLink({ href: url.trim() })
          .run();
      },
    };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), markdownLinkFixupPlugin(this.type)];
  },
}).configure({
  openOnClick: false,
  markdownLinks: true,
  autolink: true,
  defaultProtocol: "https",
  HTMLAttributes: {
    class: "note-link",
    rel: "noopener noreferrer nofollow",
    target: "_blank",
  },
});

/** Image with dashed drop-slot when `src` is empty (mockup 1c). */
const NoteImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addInputRules() {
    return [
      nodeInputRule({
        find: imageInputRegex,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;
          return { src: src ?? "", alt: alt ?? "", title };
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-i": () =>
        this.editor.commands.setImage({ src: "", alt: "image" }),
    };
  },
}).configure({
  allowBase64: true,
});

/** Shared TipTap extensions for the note body editor (ENG-53 + ENG-54). */
export function noteEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: false,
    }),
    NoteLink,
    Highlight,
    CodeBlockLowlight.configure({ lowlight }),
    // Square checklist items (`- [ ]`); M4 task pills are a separate node.
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: false },
    }),
    NoteImage,
    Placeholder.configure({ placeholder: "Start writing…" }),
    // ponytail: ENG-55 owns golden-file round-trip + wikilinks / tags / task pills.
    Markdown.configure({
      html: false,
      transformPastedText: true,
    }),
  ];
}
