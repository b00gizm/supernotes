import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import HighlightBase from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";

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

/** Shared TipTap extensions for the note body editor (ENG-53). */
export function noteEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Replaced by CodeBlockLowlight below.
      codeBlock: false,
    }),
    Highlight,
    CodeBlockLowlight.configure({ lowlight }),
    Placeholder.configure({ placeholder: "Start writing…" }),
    // ponytail: StarterKit markdown bridge only; ENG-55 owns golden-file
    // round-trip and remaining custom nodes (wikilinks / tags / tasks).
    Markdown.configure({
      html: false,
      transformPastedText: true,
    }),
  ];
}
