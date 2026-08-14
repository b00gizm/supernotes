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

  it("rewrites differently-cased wikilinks on rename (ENG-92)", async () => {
    const api = createMemoryNotesApi([
      seed({
        id: "src",
        title: "Source",
        body_markdown: "See [[weekly review]] and #Project.",
      }),
      seed({ id: "wr", title: "Weekly review" }),
      seed({ id: "proj", title: "project" }),
    ]);
    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "See [[weekly review]] and #Project.",
    });
    expect(
      (await api.listLinksFrom("src")).map((l) => l.target_note_id).sort(),
    ).toEqual(["proj", "wr"]);

    await api.updateNote({
      id: "wr",
      title: "Monthly review",
      body_markdown: "",
    });
    await api.updateNote({ id: "proj", title: "meridian", body_markdown: "" });
    const source = (await api.listNotes()).find((note) => note.id === "src");
    expect(source?.body_markdown).toBe("See [[Monthly review]] and #meridian.");
    expect(
      (await api.listLinksFrom("src")).map((l) => l.target_note_id).sort(),
    ).toEqual(["proj", "wr"]);
  });

  it("syncs and rewrites Unicode-folded wikilinks (ENG-134)", async () => {
    const api = createMemoryNotesApi([
      seed({
        id: "src",
        title: "Source",
        body_markdown: "See [[über plan]].",
      }),
      seed({ id: "plan", title: "Über plan" }),
    ]);
    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "See [[über plan]].",
    });
    expect(await api.listLinksFrom("src")).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: "plan",
      }),
    ]);

    await api.updateNote({ id: "plan", title: "Done plan", body_markdown: "" });
    const source = (await api.listNotes()).find((note) => note.id === "src");
    expect(source?.body_markdown).toBe("See [[Done plan]].");
  });

  it("syncs and rewrites #tag / @mention like wikilinks", async () => {
    const api = createMemoryNotesApi([
      seed({ id: "src", title: "Source" }),
      seed({ id: "project", title: "project" }),
      seed({ id: "priya", title: "Priya" }),
    ]);

    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "Track #project with @Priya and [[project]].",
    });
    const links = await api.listLinksFrom("src");
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.target_note_id).sort()).toEqual([
      "priya",
      "project",
    ]);

    expect(await api.listLinksTo("project")).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: "project",
      }),
    ]);
    expect(await api.listLinksTo("priya")).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: "priya",
      }),
    ]);

    await api.updateNote({
      id: "project",
      title: "meridian",
      body_markdown: "",
    });
    const source = (await api.listNotes()).find((note) => note.id === "src");
    expect(source?.body_markdown).toBe(
      "Track #meridian with @Priya and [[meridian]].",
    );
  });

  it("backfills inbound links when a mentioned note is created later", async () => {
    const api = createMemoryNotesApi([
      seed({
        id: "src",
        title: "Source",
        body_markdown: "Ask @Sam about #project.",
      }),
    ]);
    // Seed body had unresolved mentions; sync only runs on create/update.
    await api.updateNote({
      id: "src",
      title: "Source",
      body_markdown: "Ask @Sam about #project.",
    });
    expect(await api.listLinksFrom("src")).toEqual([]);

    const sam = await api.createNote({ title: "Sam" });
    const project = await api.createNote({ title: "project" });

    expect(await api.listLinksTo(sam.id)).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: sam.id,
      }),
    ]);
    expect(await api.listLinksTo(project.id)).toEqual([
      expect.objectContaining({
        source_note_id: "src",
        target_note_id: project.id,
      }),
    ]);
  });
});
