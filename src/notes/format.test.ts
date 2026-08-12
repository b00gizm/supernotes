import { describe, expect, it } from "vitest";
import {
  backlinkSnippet,
  formatDailyTitle,
  formatOverviewWhen,
  formatRelativeUpdated,
  groupNotesForOverview,
  noteSnippet,
  parseSnippetParts,
} from "./format";
import type { Note } from "./types";

function note(overrides: Partial<Note>): Note {
  return {
    id: "n",
    title: "Note",
    body_markdown: "",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("formatRelativeUpdated", () => {
  const now = Date.parse("2026-08-10T18:00:00.000Z");

  it("formats minutes, hours, and one day ago", () => {
    expect(formatRelativeUpdated("2026-08-10T17:40:00.000Z", now)).toBe("20m");
    expect(formatRelativeUpdated("2026-08-10T16:00:00.000Z", now)).toBe("2h");
    expect(formatRelativeUpdated("2026-08-09T18:00:00.000Z", now)).toBe("1d");
  });

  it("uses weekday within the week and month-day beyond", () => {
    expect(formatRelativeUpdated("2026-08-07T18:00:00.000Z", now)).toBe("Fri");
    expect(formatRelativeUpdated("2026-07-20T18:00:00.000Z", now)).toBe(
      "Jul 20",
    );
  });
});

describe("noteSnippet", () => {
  it("returns the first non-empty line", () => {
    expect(noteSnippet("\n\n  Ship pricing v2\nmore")).toBe("Ship pricing v2");
    expect(noteSnippet("   ")).toBe("Empty note");
  });

  it("strips markdown markers so previews stay plain text", () => {
    expect(noteSnippet("Hello **world**.")).toBe("Hello world.");
    expect(noteSnippet("# Title with *emphasis*")).toBe("Title with emphasis");
    expect(noteSnippet("> quoted ~~old~~ and ==glow==")).toBe(
      "quoted old and glow",
    );
    expect(noteSnippet("See [docs](https://example.com) and `code`")).toBe(
      "See docs and code",
    );
    // Tags / mentions stay intact for overview chips.
    expect(noteSnippet("Draft for #meridian with @Priya")).toBe(
      "Draft for #meridian with @Priya",
    );
  });
});

describe("backlinkSnippet", () => {
  it("returns the line that links to the target title", () => {
    expect(backlinkSnippet("Intro\nSee [[Foo]] tomorrow.\nOutro", "Foo")).toBe(
      "See [[Foo]] tomorrow.",
    );
    expect(backlinkSnippet("Track #project next", "project")).toBe(
      "Track #project next",
    );
    expect(backlinkSnippet("Ask @Priya later", "Priya")).toBe(
      "Ask @Priya later",
    );
  });

  it("falls back to the first body line when no link line matches", () => {
    expect(backlinkSnippet("Just a note\nmore", "Missing")).toBe("Just a note");
  });
});

describe("formatDailyTitle", () => {
  it("formats like the daily note mockup", () => {
    expect(formatDailyTitle(new Date("2026-08-10T12:00:00.000Z"))).toBe(
      "Monday, Aug 10",
    );
  });
});

describe("groupNotesForOverview", () => {
  // Local calendar days relative to this "now".
  const now = new Date(2026, 7, 10, 18, 0, 0, 0).getTime();

  it("puts pinned notes first and buckets the rest by local day", () => {
    const groups = groupNotesForOverview(
      [
        note({
          id: "daily",
          note_type: "daily",
          updated_at: new Date(2026, 7, 10, 17, 0).toISOString(),
        }),
        note({
          id: "pin-old",
          title: "Pinned old",
          pinned: true,
          updated_at: new Date(2026, 6, 1, 12, 0).toISOString(),
        }),
        note({
          id: "today",
          title: "Today note",
          updated_at: new Date(2026, 7, 10, 9, 40).toISOString(),
        }),
        note({
          id: "yesterday",
          title: "Yesterday note",
          note_type: "meeting",
          updated_at: new Date(2026, 7, 9, 14, 0).toISOString(),
        }),
        note({
          id: "earlier",
          title: "Earlier note",
          updated_at: new Date(2026, 7, 4, 12, 0).toISOString(),
        }),
      ],
      now,
    );

    expect(groups.map((group) => group.id)).toEqual([
      "pinned",
      "today",
      "yesterday",
      "earlier",
    ]);
    expect(groups[0]?.notes.map((item) => item.id)).toEqual(["pin-old"]);
    expect(groups[1]?.notes.map((item) => item.id)).toEqual(["today"]);
    expect(groups[2]?.notes.map((item) => item.id)).toEqual(["yesterday"]);
    expect(groups[3]?.notes.map((item) => item.id)).toEqual(["earlier"]);
  });
});

describe("formatOverviewWhen", () => {
  const now = new Date(2026, 7, 10, 18, 0, 0, 0).getTime();

  it("uses relative time for pinned and clock/date for day buckets", () => {
    expect(
      formatOverviewWhen(
        new Date(2026, 7, 10, 16, 0).toISOString(),
        "pinned",
        now,
      ),
    ).toBe("2h");
    expect(
      formatOverviewWhen(
        new Date(2026, 7, 10, 9, 40).toISOString(),
        "today",
        now,
      ),
    ).toBe("09:40");
    expect(
      formatOverviewWhen(
        new Date(2026, 7, 4, 12, 0).toISOString(),
        "earlier",
        now,
      ),
    ).toBe("Aug 4");
  });
});

describe("parseSnippetParts", () => {
  it("turns #tags and @mentions into chips", () => {
    expect(parseSnippetParts("Draft for #meridian with @Priya Sharma")).toEqual(
      [
        { type: "text", value: "Draft for " },
        { type: "tag", value: "#meridian" },
        { type: "text", value: " with " },
        { type: "mention", value: "@Priya Sharma" },
      ],
    );
  });

  it("keeps mentions bounded instead of swallowing the rest of the line", () => {
    expect(parseSnippetParts("Met @john today about pricing v2")).toEqual([
      { type: "text", value: "Met " },
      { type: "mention", value: "@john" },
      { type: "text", value: " today about pricing v2" },
    ]);
  });

  it("leaves email addresses alone", () => {
    expect(parseSnippetParts("ping john@example.com now")).toEqual([
      { type: "text", value: "ping john@example.com now" },
    ]);
  });
});
