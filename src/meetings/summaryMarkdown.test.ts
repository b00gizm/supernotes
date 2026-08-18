import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorExtensions } from "../editor/extensions";
import { getEditorMarkdown } from "../editor/markdown";
import { demoMeetingSummary } from "./summaryApi";
import {
  mentionMarkdown,
  renderSummaryMarkdown,
  upsertSummaryMarkdown,
} from "./summaryMarkdown";

function createEditor(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: noteEditorExtensions(),
    content,
  });
}

describe("summaryMarkdown", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    const element = editor?.options.element;
    editor?.destroy();
    editor = null;
    if (element instanceof HTMLElement) {
      element.remove();
    }
  });

  it("renders five sections with @mentions and task pills", () => {
    const md = renderSummaryMarkdown(demoMeetingSummary("m1"));
    expect(md).toContain("## Purpose");
    expect(md).toContain("## Participants");
    expect(md).toContain("## Key points");
    expect(md).toContain("## Outcome / next steps");
    expect(md).toContain("## Action items");
    expect(md).toContain("- @Sara Kim");
    expect(md).toContain("- @Marcus Webb");
    expect(md).toContain("- (Maybe) Steve");
    expect(md).not.toContain("@Steve");
    expect(md).toContain(
      "- Free tier stays; importer moves behind the paid line `14:02`",
    );
    expect(md).toContain(
      "  - revisit only if activation dips, September at the earliest `14:05`",
    );
    expect(md).toContain("- Annual pricing blocked on refund language `14:11`");
    expect(md).not.toMatch(/paid line 14:02(?!`)/);
    expect(md).toContain("[[task:mem-task-1]] Send updated tier table");
    expect(md).toContain("[[task:mem-task-2]] Legal review of annual terms");
    expect(mentionMarkdown("Ada Lovelace")).toBe("@Ada Lovelace");
    expect(mentionMarkdown("Interview — Priya")).toBe("[[Interview — Priya]]");
  });

  it("inserts the block and replaces only that block on regenerate", () => {
    const first = renderSummaryMarkdown(demoMeetingSummary("m1"));
    const inserted = upsertSummaryMarkdown("Agenda notes", first);
    expect(inserted.startsWith("Agenda notes\n\n## Purpose")).toBe(true);

    const second = first.replace("mem-task-1", "mem-task-9");
    const withAfter = `${inserted}\n\n## Follow-up\n\nKeep this`;
    const replaced = upsertSummaryMarkdown(withAfter, second);
    expect(replaced).toContain("Agenda notes");
    expect(replaced).toContain("## Follow-up");
    expect(replaced).toContain("Keep this");
    expect(replaced).toContain("[[task:mem-task-9]]");
    expect(replaced).not.toContain("[[task:mem-task-1]]");
    expect(replaced.indexOf("## Purpose")).toBe(
      replaced.lastIndexOf("## Purpose"),
    );
  });

  it("round-trips through the note editor", () => {
    const md = renderSummaryMarkdown(demoMeetingSummary("m1"));
    editor = createEditor(md);
    const once = getEditorMarkdown(editor);
    expect(once).toContain("## Purpose");
    expect(once).toContain("@Sara Kim");
    expect(once).toContain("(Maybe) Steve");
    expect(once).toContain(
      "- Free tier stays; importer moves behind the paid line `14:02`",
    );
    expect(once).toContain(
      "  - revisit only if activation dips, September at the earliest `14:05`",
    );
    expect(once).toContain("[[task:mem-task-1]] Send updated tier table");
    editor.destroy();
    editor = createEditor(once);
    expect(getEditorMarkdown(editor)).toBe(once);
  });
});
