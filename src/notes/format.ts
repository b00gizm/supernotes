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

/** First non-empty body line; computed, not stored. */
export function noteSnippet(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "Empty note";
}

/** Daily note title matching mockup (`Monday, Aug 10`). */
export function formatDailyTitle(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
