/** Shared note-link helpers (ENG-56/57). Mirrors `src-tauri/src/db/wikilinks.rs`. */

const WIKI_OPEN = "[[";
const WIKI_CLOSE = "]]";

function isWordyBefore(body: string, index: number): boolean {
  if (index <= 0) {
    return false;
  }
  return /[\w@]/.test(body.charAt(index - 1));
}

/** Shorthand `#tag` charset — titles outside this must use `[[…]]`. */
export const TAG_TITLE = /^[\w-]+$/;
/** Shorthand `@Name` / `@First Last` charset — titles outside this must use `[[…]]`. */
export const MENTION_TITLE = /^[A-Za-z][\w-]*(?: [A-Z][\w-]*)?$/;

/** Titles from `[[…]]`, `#tag`, and `@mention`, document order. Skips `[[task:…]]`. */
export function extractWikilinkTitles(body: string): string[] {
  const titles: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body.startsWith(WIKI_OPEN, i)) {
      const start = i + WIKI_OPEN.length;
      const close = body.indexOf(WIKI_CLOSE, start);
      // Unclosed `[[`: skip one char and keep scanning (same as Rust / rewrite).
      if (close >= 0) {
        i = close + WIKI_CLOSE.length;
        const title = body.slice(start, close).trim();
        if (!title || title.includes("\n")) {
          continue;
        }
        if (title.length >= 5 && title.slice(0, 5).toLowerCase() === "task:") {
          continue;
        }
        titles.push(title);
        continue;
      }
    }

    if (body.charAt(i) === "#" && !isWordyBefore(body, i)) {
      const match = body.slice(i + 1).match(/^([\w-]+)/);
      if (match?.[1]) {
        titles.push(match[1]);
        i += 1 + match[1].length;
        continue;
      }
    }

    if (body.charAt(i) === "@" && !isWordyBefore(body, i)) {
      const match = body
        .slice(i + 1)
        .match(/^([A-Za-z][\w-]*(?: [A-Z][\w-]*)?)/);
      if (match?.[1]) {
        titles.push(match[1]);
        i += 1 + match[1].length;
        continue;
      }
    }

    i += 1;
  }
  return titles;
}

/**
 * Replace `[[oldTitle]]` / `#old` / `@old` when the inner title matches
 * case-insensitively (same as link resolution). Tag/mention forms rewrite only
 * when both titles still fit that syntax (otherwise leave the shorthand unchanged).
 */
export function rewriteWikilinkTitle(
  body: string,
  oldTitle: string,
  newTitle: string,
): string {
  if (oldTitle === newTitle) {
    return body;
  }
  const oldLower = oldTitle.toLowerCase();
  const rewriteTag = TAG_TITLE.test(oldTitle) && TAG_TITLE.test(newTitle);
  const rewriteMention =
    MENTION_TITLE.test(oldTitle) && MENTION_TITLE.test(newTitle);
  let out = "";
  let i = 0;
  while (i < body.length) {
    if (body.startsWith(WIKI_OPEN, i)) {
      const start = i + WIKI_OPEN.length;
      const close = body.indexOf(WIKI_CLOSE, start);
      if (close >= 0) {
        const raw = body.slice(start, close);
        if (raw.trim().toLowerCase() === oldLower) {
          out += `${WIKI_OPEN}${newTitle}${WIKI_CLOSE}`;
          i = close + WIKI_CLOSE.length;
          continue;
        }
      }
    }

    if (rewriteTag && body.charAt(i) === "#" && !isWordyBefore(body, i)) {
      const match = body.slice(i + 1).match(/^([\w-]+)/);
      if (match?.[1]?.toLowerCase() === oldLower) {
        out += `#${newTitle}`;
        i += 1 + match[1].length;
        continue;
      }
    }

    if (rewriteMention && body.charAt(i) === "@" && !isWordyBefore(body, i)) {
      const match = body
        .slice(i + 1)
        .match(/^([A-Za-z][\w-]*(?: [A-Z][\w-]*)?)/);
      if (match?.[1]?.toLowerCase() === oldLower) {
        out += `@${newTitle}`;
        i += 1 + match[1].length;
        continue;
      }
    }

    out += body.charAt(i);
    i += 1;
  }
  return out;
}

export function findNoteByTitle<T extends { title: string }>(
  notes: T[],
  title: string,
): T | null {
  const needle = title.trim();
  if (!needle) {
    return null;
  }
  const lower = needle.toLowerCase();
  let fallback: T | null = null;
  for (const note of notes) {
    if (note.title.toLowerCase() !== lower) {
      continue;
    }
    if (note.title === needle) {
      return note;
    }
    fallback ??= note;
  }
  return fallback;
}

/**
 * Rank notes for `[[` / `#` / `@` autocomplete: exact → prefix → substring, then recency.
 * Excludes `excludeId` when set.
 */
export function rankNotesForWikiLink<
  T extends { id: string; title: string; updated_at: string },
>(notes: T[], query: string, excludeId?: string | null): T[] {
  const needle = query.trim().toLowerCase();
  const pool = excludeId
    ? notes.filter((note) => note.id !== excludeId)
    : notes;

  if (!needle) {
    return [...pool].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  type Ranked = { note: T; rank: number };
  const ranked: Ranked[] = [];
  for (const note of pool) {
    const title = note.title.toLowerCase();
    let rank: number;
    if (title === needle) {
      rank = 0;
    } else if (title.startsWith(needle)) {
      rank = 1;
    } else if (title.includes(needle)) {
      rank = 2;
    } else {
      continue;
    }
    ranked.push({ note, rank });
  }
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return b.note.updated_at.localeCompare(a.note.updated_at);
  });
  return ranked.map((item) => item.note);
}
