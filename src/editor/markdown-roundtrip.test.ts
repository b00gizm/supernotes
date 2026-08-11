import { Editor } from "@tiptap/core";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "./extensions";
import { getEditorMarkdown } from "./markdown";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "roundtrip",
);

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: noteEditorExtensions(),
    content,
  });
}

describe("markdown golden round-trip", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    const element = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (element instanceof HTMLElement) {
      element.remove();
    }
  });

  const files = readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".md"))
    .sort();

  it("discovers at least one fixture", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    it(`${name}: markdown → doc → markdown is byte-stable`, () => {
      const input = readFileSync(join(fixturesDir, name), "utf8");
      editor = createEditor(input);
      const once = getEditorMarkdown(editor);
      expect(once, "first serialize must match fixture").toBe(input);

      editor.destroy();
      editor = createEditor(once);
      const twice = getEditorMarkdown(editor);
      expect(twice, "second serialize must stay stable").toBe(once);
    });
  }

  it("splits mixed bullet + checkbox lists without an empty task", () => {
    editor = createEditor("- bullet\n  - nested\n\n- [ ] open task");
    const md = getEditorMarkdown(editor);
    expect(md).not.toMatch(/^- \[ \] \n/m);
    expect(md).toContain("- bullet");
    expect(md).toContain("- [ ] open task");
    expect(editor.getHTML()).toContain('data-type="taskList"');
    expect(editor.getHTML()).toContain("<ul");
  });

  it("renders externally edited wikilinks and tags without raw escapes", () => {
    editor = createEditor(
      "Meet [[Launch Plan]] about #launch with @Ada Lovelace",
    );
    const html = editor.getHTML();
    expect(html).toContain('data-type="wiki-link"');
    expect(html).toContain("Launch Plan");
    expect(editor.getText()).toContain("#launch");
    expect(editor.getText()).toContain("@Ada Lovelace");
    expect(getEditorMarkdown(editor)).toBe(
      "Meet [[Launch Plan]] about #launch with @Ada Lovelace",
    );
  });
});
