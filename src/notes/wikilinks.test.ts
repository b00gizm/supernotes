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

  it("extracts tags and mentions into the same title list", () => {
    expect(
      extractWikilinkTitles(
        "See [[project]] and #project with @Priya Sharma and user@email.com",
      ),
    ).toEqual(["project", "project", "Priya Sharma"]);
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

  it("rewrites tags and mentions without prefix collisions", () => {
    expect(
      rewriteWikilinkTitle(
        "#Alpha and @Priya Sharma and #Alpha-x and @Priya",
        "Alpha",
        "Omega",
      ),
    ).toBe("#Omega and @Priya Sharma and #Alpha-x and @Priya");
    expect(
      rewriteWikilinkTitle(
        "#Alpha and @Priya Sharma and @Priya",
        "Priya Sharma",
        "Ada Lovelace",
      ),
    ).toBe("#Alpha and @Ada Lovelace and @Priya");
  });

  it("rewrites matching titles case-insensitively like resolution", () => {
    expect(
      rewriteWikilinkTitle(
        "See [[weekly review]] and #Project with @sam",
        "Weekly Review",
        "Done",
      ),
    ).toBe("See [[Done]] and #Project with @sam");
    expect(
      rewriteWikilinkTitle("#Project and [[project]]", "project", "meridian"),
    ).toBe("#meridian and [[meridian]]");
    expect(rewriteWikilinkTitle("Ask @Sam please", "sam", "Priya")).toBe(
      "Ask @Priya please",
    );
  });

  it("extract and rewrite parity fixture matches Rust", async () => {
    const fixture = (await import("./fixtures/wikilink-extract-parity.json"))
      .default as {
      extract: Array<{ body: string; titles: string[] }>;
      rewrite: Array<{
        body: string;
        oldTitle: string;
        newTitle: string;
        rewritten: string;
      }>;
    };
    for (const { body, titles } of fixture.extract) {
      expect(extractWikilinkTitles(body)).toEqual(titles);
    }
    for (const { body, oldTitle, newTitle, rewritten } of fixture.rewrite) {
      expect(rewriteWikilinkTitle(body, oldTitle, newTitle)).toBe(rewritten);
    }
  });

  it("finds notes by title case-insensitively preferring exact case", () => {
    const notes = [
      { title: "foo", id: "1" },
      { title: "Foo", id: "2" },
    ];
    expect(findNoteByTitle(notes, "Foo")?.id).toBe("2");
    expect(findNoteByTitle(notes, "FOO")?.id).toBe("1");
  });

  it("finds and rewrites non-ASCII titles with Unicode fold", () => {
    const notes = [
      { title: "Über plan", id: "1" },
      { title: "uber plan", id: "2" },
    ];
    expect(findNoteByTitle(notes, "über plan")?.id).toBe("1");
    expect(
      rewriteWikilinkTitle("See [[über plan]].", "Über plan", "Done"),
    ).toBe("See [[Done]].");
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
