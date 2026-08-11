import { describe, expect, it } from "vitest";
import {
  extractWikilinkTitles,
  findNoteByTitle,
  rankNotesForWikiLink,
  rewriteWikilinkTitle,
} from "./wikilinks";

describe("wikilinks helpers", () => {
  it("extracts titles and skips task pills", () => {
    expect(
      extractWikilinkTitles(
        "See [[Weekly Review]] and [[foo]].\n[[task:abc]] Buy milk\n[[  Bar  ]]",
      ),
    ).toEqual(["Weekly Review", "foo", "Bar"]);
  });

  it("rewrites matching titles only", () => {
    expect(
      rewriteWikilinkTitle(
        "[[Alpha]] and [[Alpha Beta]] and [[Alpha]]",
        "Alpha",
        "Omega",
      ),
    ).toBe("[[Omega]] and [[Alpha Beta]] and [[Omega]]");
  });

  it("finds notes by title case-insensitively preferring exact case", () => {
    const notes = [
      { title: "foo", id: "1" },
      { title: "Foo", id: "2" },
    ];
    expect(findNoteByTitle(notes, "Foo")?.id).toBe("2");
    expect(findNoteByTitle(notes, "FOO")?.id).toBe("1");
  });

  it("ranks autocomplete by relevance then recency", () => {
    const notes = [
      { id: "a", title: "Alpha", updated_at: "2026-08-01T00:00:00.000Z" },
      { id: "b", title: "Alphabet", updated_at: "2026-08-10T00:00:00.000Z" },
      { id: "c", title: "beta Alpha", updated_at: "2026-08-11T00:00:00.000Z" },
      { id: "d", title: "Other", updated_at: "2026-08-12T00:00:00.000Z" },
    ];
    expect(rankNotesForWikiLink(notes, "alp").map((n) => n.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(rankNotesForWikiLink(notes, "", "d").map((n) => n.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});
