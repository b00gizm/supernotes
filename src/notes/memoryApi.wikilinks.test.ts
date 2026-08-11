import { describe, expect, it } from "vitest";
import { createMemoryNotesApi } from "./memoryApi";
import type { Note } from "./types";

function seed(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Alpha",
    body_markdown: "",
    note_type: "regular",
    pinned: false,
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("memoryApi wikilink sync", () => {
  it("syncs links on save and drops removed ones", async () => {
    const api = createMemoryNotesApi([
      seed({ id: "src", title: "Source" }),
      seed({ id: "foo", title: "Foo" }),
      seed({ id: "bar", title: "Bar" }),
    ]);

    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "See [[Foo]] and [[Missing]].",
    });
    expect(await api.listLinksFrom("src")).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: "foo",
      }),
    ]);

    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "Only [[Bar]]",
    });
    expect(await api.listLinksFrom("src")).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: "bar",
      }),
    ]);
  });

  it("rewrites incoming wikilink titles on rename", async () => {
    const api = createMemoryNotesApi([
      seed({ id: "src", title: "Source", body_markdown: "See [[Foo]]." }),
      seed({ id: "foo", title: "Foo" }),
    ]);
    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "See [[Foo]].",
    });
    await api.updateNote({ id: "foo", title: "Baz", body_markdown: "" });
    const source = (await api.listNotes()).find((note) => note.id === "src");
    expect(source?.body_markdown).toBe("See [[Baz]].");
  });
});
