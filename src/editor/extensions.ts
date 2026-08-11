import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import HighlightBase from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { ImageView } from "./ImageView";

const lowlight = createLowlight(common);

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
}).configure({
  openOnClick: false,
  markdownLinks: true,
  autolink: true,
  HTMLAttributes: {
    class: "note-link",
    rel: "noopener noreferrer nofollow",
  },
});

/** Image with dashed drop-slot when `src` is empty (mockup 1c). */
const NoteImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
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
