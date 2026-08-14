import type { Note } from "./types";
import { extractWikilinkTitles } from "./wikilinks";

/** Relative updated label for Recent rows (mockup 1b: `2h`, `1d`, `Fri`). */
export function formatRelativeUpdated(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }

  const diffMs = Math.max(0, nowMs - then);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) {
    return "now";
  }
  if (mins < 60) {
    return `${String(mins)}m`;
  }

  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${String(hours)}h`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return "1d";
  }

  const date = new Date(then);
  if (days < 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Strip inline/block markdown markers for preview text (keep #tags / @mentions). */
function stripMarkdownMarkers(line: string): string {
  return (
    line
      // ATX headings / blockquotes / list markers at line start only.
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      // Skip bare fence openers.
      .replace(/^```\w*$/, "")
      // Images / links → alt/label text.
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Inline marks; longer delimiters first so `**` wins over `*`.
      .replace(/(`+)(.*?)\1/g, "$2")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(?<!\w)(\*|_)(?!\s)(.+?)(?<!\s)\1(?!\w)/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/==(.*?)==/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** First non-empty body line as plain text; computed, not stored. */
export function noteSnippet(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = stripMarkdownMarkers(line.trim())
      // Task pills serialize as `[[task:id]] Title`; drop the token, keep the title.
      .replace(/\[\[task:[^\]]+\]\]\s*/gi, "")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "Empty note";
}

/** Line that links to `targetTitle` (via `[[…]]` / `#` / `@`); falls back to first line. */
export function backlinkSnippet(body: string, targetTitle: string): string {
  const needle = targetTitle.trim().toLowerCase();
  if (needle) {
    for (const line of body.split(/\r?\n/)) {
      const titles = extractWikilinkTitles(line);
      if (!titles.some((title) => title.toLowerCase() === needle)) {
        continue;
      }
      const trimmed = stripMarkdownMarkers(line.trim());
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return noteSnippet(body);
}

export type BacklinkSnippetPart =
  { type: "text"; value: string } | { type: "match"; value: string };

function isWordyBefore(body: string, index: number): boolean {
  if (index <= 0) {
    return false;
  }
  return /[\w@]/.test(body.charAt(index - 1));
}

/** Split a backlink snippet so the matching `[[…]]` / `#` / `@` can be highlighted. */
export function parseBacklinkSnippetParts(
  body: string,
  targetTitle: string,
): BacklinkSnippetPart[] {
  const snippet = backlinkSnippet(body, targetTitle);
  const needle = targetTitle.trim().toLowerCase();
  if (!needle || snippet === "Empty note") {
    return [{ type: "text", value: snippet }];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < snippet.length) {
    if (snippet.startsWith("[[", i)) {
      const innerStart = i + 2;
      const close = snippet.indexOf("]]", innerStart);
      if (close < 0) {
        break;
      }
      const title = snippet.slice(innerStart, close).trim();
      if (title.toLowerCase() === needle) {
        ranges.push({ start: i, end: close + 2 });
      }
      i = close + 2;
      continue;
    }

    if (snippet.charAt(i) === "#" && !isWordyBefore(snippet, i)) {
      const match = snippet.slice(i + 1).match(/^([\w-]+)/);
      if (match?.[1] && match[1].toLowerCase() === needle) {
        ranges.push({ start: i, end: i + 1 + match[1].length });
        i += 1 + match[1].length;
        continue;
      }
    }

    if (snippet.charAt(i) === "@" && !isWordyBefore(snippet, i)) {
      const match = snippet
        .slice(i + 1)
        .match(/^([A-Za-z][\w-]*(?:\s+[A-Z][\w-]*)?)/);
      if (match?.[1] && match[1].toLowerCase() === needle) {
        ranges.push({ start: i, end: i + 1 + match[1].length });
        i += 1 + match[1].length;
        continue;
      }
    }

    i += 1;
  }

  if (ranges.length === 0) {
    return [{ type: "text", value: snippet }];
  }

  const parts: BacklinkSnippetPart[] = [];
  let last = 0;
  for (const range of ranges) {
    if (range.start > last) {
      parts.push({ type: "text", value: snippet.slice(last, range.start) });
    }
    parts.push({ type: "match", value: snippet.slice(range.start, range.end) });
    last = range.end;
  }
  if (last < snippet.length) {
    parts.push({ type: "text", value: snippet.slice(last) });
  }
  return parts;
}

/** Canonical daily note title (`2026-08-10`), local calendar day. */
export function formatDailyTitle(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

/** Display form for a daily note (`Sunday, Aug 10 2026`). */
export function formatDailyDisplayTitle(date: Date = new Date()): string {
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}, ${month} ${String(date.getDate())} ${String(date.getFullYear())}`;
}

/** Parse a canonical daily title into a local Date, or null if invalid. */
export function parseDailyTitle(title: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(title.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function dailyDisplayTitle(title: string): string {
  const date = parseDailyTitle(title);
  return date ? formatDailyDisplayTitle(date) : title;
}

/** Shift a canonical daily title by `deltaDays` (local calendar). */
export function shiftDailyTitle(title: string, deltaDays: number): string {
  const date = parseDailyTitle(title) ?? new Date();
  date.setDate(date.getDate() + deltaDays);
  return formatDailyTitle(date);
}

/**
 * Add `days` to a YYYY-MM-DD. Invalid input is returned unchanged
 * (unlike `shiftDailyTitle`, which falls back to today).
 */
export function addDays(ymd: string, days: number): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  date.setDate(date.getDate() + days);
  return formatDailyTitle(date);
}

/** Monday of the calendar week containing `ymd` (local). */
export function startOfWeekMonday(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const day = date.getDay(); // 0 Sun … 6 Sat
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return formatDailyTitle(date);
}

/** Short month-day (`Aug 14`). */
export function formatMonthDay(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${String(date.getDate())}`;
}

/** `Mon, Aug 10`. */
export function formatShortDay(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday}, ${month} ${String(date.getDate())}`;
}

/** `Monday Aug 10`. */
export function formatWeekdayMonthDay(ymd: string): string {
  const date = parseDailyTitle(ymd);
  if (!date) {
    return ymd;
  }
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${weekday} ${month} ${String(date.getDate())}`;
}

export function formatWeekRange(start: string, end: string): string {
  const startDate = parseDailyTitle(start);
  const endDate = parseDailyTitle(end);
  if (!startDate || !endDate) {
    return `${start} – ${end}`;
  }
  if (startDate.getMonth() === endDate.getMonth()) {
    return `${formatMonthDay(start)} – ${String(endDate.getDate())}`;
  }
  return `${formatMonthDay(start)} – ${formatMonthDay(end)}`;
}

export type OverviewGroupId = "pinned" | "today" | "yesterday" | "earlier";

export type OverviewGroup = {
  id: OverviewGroupId;
  label: string;
  notes: Note[];
};

export type SnippetPart =
  | { type: "text"; value: string }
  | { type: "tag"; value: string }
  | { type: "mention"; value: string };

export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function byUpdatedAtDesc(a: Note, b: Note): number {
  return b.updated_at.localeCompare(a.updated_at);
}

/** Mockup 2a groups: Pinned first, then calendar-day buckets for the rest. */
export function groupNotesForOverview(
  notes: Note[],
  nowMs: number = Date.now(),
): OverviewGroup[] {
  const browseable = notes.filter((note) => note.note_type !== "daily");
  const pinned = browseable.filter((note) => note.pinned).sort(byUpdatedAtDesc);
  const todayStart = startOfLocalDay(nowMs);
  // setDate handles DST days (23h/25h); a fixed 86_400_000 offset does not.
  const yesterdayDate = new Date(todayStart);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStart = yesterdayDate.getTime();
  const today: Note[] = [];
  const yesterday: Note[] = [];
  const earlier: Note[] = [];

  for (const note of browseable) {
    if (note.pinned) {
      continue;
    }
    const updated = Date.parse(note.updated_at);
    if (Number.isNaN(updated)) {
      earlier.push(note);
      continue;
    }
    const day = startOfLocalDay(updated);
    if (day === todayStart) {
      today.push(note);
    } else if (day === yesterdayStart) {
      yesterday.push(note);
    } else {
      earlier.push(note);
    }
  }

  today.sort(byUpdatedAtDesc);
  yesterday.sort(byUpdatedAtDesc);
  earlier.sort(byUpdatedAtDesc);

  return (
    [
      { id: "pinned", label: "Pinned", notes: pinned },
      { id: "today", label: "Today", notes: today },
      { id: "yesterday", label: "Yesterday", notes: yesterday },
      { id: "earlier", label: "Earlier", notes: earlier },
    ] satisfies OverviewGroup[]
  ).filter((group) => group.notes.length > 0);
}

/** Overview timestamps: relative in Pinned, clock time for day groups, month-day for Earlier. */
export function formatOverviewWhen(
  iso: string,
  group: OverviewGroupId,
  nowMs: number = Date.now(),
): string {
  if (group === "pinned") {
    return formatRelativeUpdated(iso, nowMs);
  }

  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }

  const date = new Date(then);
  if (group === "today" || group === "yesterday") {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Split the first body line so `#tags` / `@mentions` render as chips (mockup 2a).
 * Overview-only; editor nodes live in `wikiLink.ts`.
 */
export function parseSnippetParts(body: string): SnippetPart[] {
  const line = noteSnippet(body);
  if (line === "Empty note") {
    return [{ type: "text", value: line }];
  }

  const parts: SnippetPart[] = [];
  // Left boundary keeps emails intact; mentions take one optional
  // capitalized surname ("@Priya Sharma") instead of swallowing the line.
  const pattern =
    /(?<![\w@])(?:#([\w-]+)|@([A-Za-z][\w-]*(?:\s+[A-Z][\w-]*)?))/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index;
    if (index > last) {
      parts.push({ type: "text", value: line.slice(last, index) });
    }
    if (match[1] !== undefined) {
      parts.push({ type: "tag", value: `#${match[1]}` });
    } else if (match[2] !== undefined) {
      parts.push({ type: "mention", value: `@${match[2]}` });
    }
    last = index + match[0].length;
  }
  if (last < line.length) {
    parts.push({ type: "text", value: line.slice(last) });
  }
  return parts.length > 0 ? parts : [{ type: "text", value: line }];
}
