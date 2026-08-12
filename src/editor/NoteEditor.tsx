import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Note } from "../notes/types";
import { rankNotesForWikiLink } from "../notes/wikilinks";
import { noteEditorExtensions } from "./extensions";
import { getEditorMarkdown } from "./markdown";
import { openExternalUrl, saveNoteImage } from "./media";
import {
  insertWikiLink,
  sameWikiLinkQuery,
  wikiLinkQueryRect,
  type WikiLinkQuery,
} from "./wikiLink";

export type NoteEditorProps = {
  /** Initial markdown; remount (via `key`) when switching notes. */
  markdown: string;
  /** Second arg is the note this editor belongs to (ignore stale updates). */
  onChange: (markdown: string, noteId: string | null) => void;
  notes?: Note[];
  currentNoteId?: string | null;
  /** Navigate to an existing note or create-on-click when missing. */
  onOpenWikiLink?: (link: { title: string; noteId: string | null }) => void;
};

function firstImageFile(data: DataTransfer | null): File | null {
  if (!data || data.files.length === 0) {
    return null;
  }
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) {
      return file;
    }
    // Some OS drops (esp. older webviews) omit MIME; fall back on extension.
    if (!file.type && /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
      return file;
    }
  }
  return null;
}

/** Drop stale/out-of-range positions so insert never throws RangeError (ENG-96). */
export function resolveInsertPos(
  docSize: number,
  pos: number | undefined,
): number | undefined {
  if (pos === undefined || pos < 0 || pos > docSize) {
    return undefined;
  }
  return pos;
}

function insertImageAt(
  view: EditorView,
  src: string,
  alt: string,
  pos?: number,
) {
  if (view.isDestroyed) {
    return;
  }
  const type = view.state.schema.nodes.image;
  if (!type) {
    return;
  }
  const node = type.create({ src, alt });
  const safePos = resolveInsertPos(view.state.doc.content.size, pos);
  const tr =
    safePos === undefined
      ? view.state.tr.replaceSelectionWith(node)
      : view.state.tr.insert(safePos, node);
  view.dispatch(tr);
}

function imageSaveErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/too large/i.test(message)) {
    return "Image is too large (max 15 MB).";
  }
  return message || "Could not save image";
}

const SUGGEST_LIMIT = 8;

export function NoteEditor({
  markdown,
  onChange,
  notes = [],
  currentNoteId = null,
  onOpenWikiLink,
}: NoteEditorProps) {
  const notesRef = useRef(notes);
  const currentNoteIdRef = useRef(currentNoteId);
  const onOpenWikiLinkRef = useRef(onOpenWikiLink);
  notesRef.current = notes;
  currentNoteIdRef.current = currentNoteId;
  onOpenWikiLinkRef.current = onOpenWikiLink;

  const [query, setQuery] = useState<WikiLinkQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupPos, setPopupPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const dismissedFromRef = useRef<number | null>(null);
  const setImageErrorRef = useRef(setImageError);
  setImageErrorRef.current = setImageError;

  const onQueryChange = (next: WikiLinkQuery | null) => {
    if (next && dismissedFromRef.current === next.from) {
      setQuery(null);
      return;
    }
    dismissedFromRef.current = null;
    // Fresh object every plugin update — skip setState when fields match (ENG-87).
    setQuery((prev) => (sameWikiLinkQuery(prev, next) ? prev : next));
  };

  const suggestions = query
    ? rankNotesForWikiLink(
        notesRef.current,
        query.query,
        currentNoteIdRef.current,
      ).slice(0, SUGGEST_LIMIT)
    : [];

  const createTitle = query?.query.trim() ?? "";
  const showCreate =
    Boolean(createTitle) &&
    !suggestions.some(
      (note) => note.title.toLowerCase() === createTitle.toLowerCase(),
    );
  const itemCount = suggestions.length + (showCreate ? 1 : 0);

  const editorRef = useRef<Editor | null>(null);
  const suggestRef = useRef({
    query,
    suggestions,
    showCreate,
    createTitle,
    itemCount,
    activeIndex,
  });
  suggestRef.current = {
    query,
    suggestions,
    showCreate,
    createTitle,
    itemCount,
    activeIndex,
  };

  useEffect(() => {
    setActiveIndex(0);
  }, [query?.query, query?.from]);

  const editor = useEditor({
    extensions: noteEditorExtensions({
      getNotes: () => notesRef.current,
      getExcludeNoteId: () => currentNoteIdRef.current,
      onQueryChange,
    }),
    content: markdown,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "note-editor-content",
        "aria-label": "Note body",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return false;
        }
        const wiki = target.closest(".wiki-link");
        if (wiki instanceof HTMLElement) {
          const title = wiki.getAttribute("data-title")?.trim() ?? "";
          if (!title) {
            return false;
          }
          event.preventDefault();
          onOpenWikiLinkRef.current?.({
            title,
            noteId: wiki.getAttribute("data-note-id"),
          });
          return true;
        }
        const anchor = target.closest("a");
        if (!(anchor instanceof HTMLAnchorElement)) {
          return false;
        }
        const href = anchor.getAttribute("href");
        if (!href || !/^https?:\/\//i.test(href)) {
          return false;
        }
        event.preventDefault();
        void openExternalUrl(href);
        return true;
      },
      handleKeyDown: (_view, event) => {
        const state = suggestRef.current;
        const current = editorRef.current;
        const active = state.query;
        if (!current || !active || state.itemCount === 0) {
          return false;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % state.itemCount);
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex(
            (index) => (index - 1 + state.itemCount) % state.itemCount,
          );
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          dismissedFromRef.current = active.from;
          setQuery(null);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          // Empty `[[` may still commit; bare `#`/`@` never open a popup (ENG-114).
          // If somehow open with an empty query, let Enter insert a newline.
          if (event.key === "Enter" && !active.query.trim()) {
            dismissedFromRef.current = active.from;
            setQuery(null);
            return false;
          }
          event.preventDefault();
          if (state.activeIndex < state.suggestions.length) {
            const note = state.suggestions[state.activeIndex];
            if (note) {
              insertWikiLink(current, active, note.title, note.id, active.kind);
            }
          } else if (state.showCreate && state.createTitle) {
            insertWikiLink(
              current,
              active,
              state.createTitle,
              null,
              active.kind,
            );
          }
          setQuery(null);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const file = firstImageFile(event.clipboardData);
        if (!file) {
          return false;
        }
        event.preventDefault();
        setImageErrorRef.current(null);
        void saveNoteImage(file)
          .then((src) => {
            // Insert at current selection after await — doc may have changed.
            insertImageAt(view, src, file.name.replace(/\.[^.]+$/, ""));
          })
          .catch((err: unknown) => {
            setImageErrorRef.current(imageSaveErrorMessage(err));
          });
        return true;
      },
      handleDrop: (view, event) => {
        const file = firstImageFile(event.dataTransfer);
        if (!file) {
          return false;
        }
        event.preventDefault();
        setImageErrorRef.current(null);
        const { clientX, clientY } = event;
        void saveNoteImage(file)
          .then((src) => {
            if (view.isDestroyed) {
              return;
            }
            // Re-resolve drop coords after await so we never insert a stale pos.
            const coords = view.posAtCoords({ left: clientX, top: clientY });
            insertImageAt(
              view,
              src,
              file.name.replace(/\.[^.]+$/, ""),
              coords?.pos,
            );
          })
          .catch((err: unknown) => {
            setImageErrorRef.current(imageSaveErrorMessage(err));
          });
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      if (current.isDestroyed) {
        return;
      }
      onChange(
        getEditorMarkdown(current) || current.getText(),
        currentNoteIdRef.current,
      );
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor || !query) {
      setPopupPos(null);
      return;
    }
    const rect = wikiLinkQueryRect(editor.view, query);
    if (!rect) {
      setPopupPos(null);
      return;
    }
    setPopupPos({ top: rect.bottom + 6, left: rect.left });
  }, [editor, query]);

  const pickSuggestion = (note: Note) => {
    if (!editor || !query) {
      return;
    }
    insertWikiLink(editor, query, note.title, note.id, query.kind);
    setQuery(null);
  };

  const pickCreate = () => {
    if (!editor || !query || !createTitle) {
      return;
    }
    insertWikiLink(editor, query, createTitle, null, query.kind);
    setQuery(null);
  };

  /** Click empty space below the last block → focus end (ENG-114). */
  const focusEndIfBelowContent = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const pm = editor.view.dom;
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    // Clicks on real content (text, links, widgets) keep default caret placement.
    if (pm.contains(target) && target !== pm) {
      return;
    }
    const last = pm.lastElementChild;
    if (last && event.clientY <= last.getBoundingClientRect().bottom) {
      return;
    }
    event.preventDefault();
    editor.commands.focus("end");
  };

  return (
    <div
      className="body-input note-editor"
      onMouseDown={focusEndIfBelowContent}
    >
      <EditorContent editor={editor} />
      {imageError ? (
        <p className="note-image-insert-error" role="alert">
          {imageError}
        </p>
      ) : null}
      {query && popupPos && itemCount > 0 ? (
        <div
          className="wiki-link-suggest"
          role="listbox"
          aria-label="Note links"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
          <ul className="wiki-link-suggest-list">
            {suggestions.map((note, index) => (
              <li key={note.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? "wiki-link-suggest-item is-active"
                      : "wiki-link-suggest-item"
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pickSuggestion(note);
                  }}
                >
                  {note.title}
                </button>
              </li>
            ))}
            {showCreate ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={activeIndex === suggestions.length}
                  className={
                    activeIndex === suggestions.length
                      ? "wiki-link-suggest-item is-create is-active"
                      : "wiki-link-suggest-item is-create"
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pickCreate();
                  }}
                >
                  Create “{createTitle}”
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
