import { useCallback, useEffect, useState } from "react";
import { notesApi } from "./api";
import { parseBacklinkSnippetParts, type BacklinkSnippetPart } from "./format";
import type { Note } from "./types";

export type BacklinkItem = {
  note: Note;
  parts: BacklinkSnippetPart[];
};

type BacklinksProps = {
  noteId: string;
  noteTitle: string;
  notes: Note[];
  onOpen: (note: Note) => void;
};

/** Read-only inbound links from the `links` table (ENG-58). Never part of markdown. */
export function Backlinks({
  noteId,
  noteTitle,
  notes,
  onOpen,
}: BacklinksProps) {
  const [items, setItems] = useState<BacklinkItem[]>([]);

  const load = useCallback(async () => {
    try {
      const links = await notesApi.listLinksTo(noteId);
      const byId = new Map(notes.map((note) => [note.id, note]));
      const next: BacklinkItem[] = [];
      for (const link of links) {
        const source = byId.get(link.source_note_id);
        if (!source) {
          continue;
        }
        next.push({
          note: source,
          parts: parseBacklinkSnippetParts(source.body_markdown, noteTitle),
        });
      }
      setItems(next);
    } catch {
      setItems([]);
    }
  }, [noteId, noteTitle, notes]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="backlinks" aria-label="Backlinks">
      <h2 className="backlinks-heading">Backlinks</h2>
      <ul className="backlinks-list">
        {items.map(({ note, parts }) => (
          <li key={note.id}>
            <button
              type="button"
              className="backlink-item"
              onClick={() => {
                onOpen(note);
              }}
            >
              <span className="backlink-title">{note.title}</span>
              <span className="backlink-snippet">
                {parts.map((part, index) =>
                  part.type === "match" ? (
                    <mark key={`m-${String(index)}`} className="backlink-match">
                      {part.value}
                    </mark>
                  ) : (
                    <span key={`t-${String(index)}`}>{part.value}</span>
                  ),
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
