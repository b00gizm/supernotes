import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";

const lowlight = createLowlight(common);

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
    // round-trip + custom nodes (wikilinks / tags / tasks).
    Markdown.configure({
      html: false,
      transformPastedText: true,
    }),
  ];
}
