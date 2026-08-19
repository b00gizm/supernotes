import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteEditor } from "./NoteEditor";
import { demoMeetingSummary } from "../meetings/summaryApi";
import { renderSummaryMarkdown } from "../meetings/summaryMarkdown";

describe("NoteEditor markdown render", () => {
  it("renders links and images from initial markdown", async () => {
    const md =
      "See [Example](https://example.com) now.\n\n![logo](https://example.com/logo.png)\n\n![chart]()";
    render(<NoteEditor markdown={md} onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Note body" })).toBeTruthy();
    });

    const root = screen.getByRole("textbox", { name: "Note body" });
    await waitFor(() => {
      const link = root.querySelector("a.note-link, a[href]");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("href")).toBe("https://example.com");
      expect(link?.textContent).toBe("Example");
    });

    await waitFor(() => {
      // filled image via NodeView or img
      const img =
        root.querySelector("img.note-image-img, .note-image img, img[src]") ??
        null;
      const slot = root.querySelector(".note-image-slot");
      // At least one image-related node should exist; drop slot for empty
      expect(slot || img).toBeTruthy();
      expect(root.querySelector(".note-image-slot-title")?.textContent).toMatch(
        /Drop the chart/,
      );
    });

    // Must not leave raw markdown visible
    expect(root.textContent).not.toContain("[Example](https://example.com)");
    expect(root.textContent).not.toContain("![chart]()");
  });

  it("applies an external markdown write while the editor is open", async () => {
    const { rerender } = render(
      <NoteEditor markdown="Agenda notes" onChange={() => {}} />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "Note body" }),
      ).toHaveTextContent("Agenda notes");
    });

    rerender(
      <NoteEditor
        markdown={renderSummaryMarkdown(demoMeetingSummary("m1"))}
        onChange={() => {}}
      />,
    );
    const root = screen.getByRole("textbox", { name: "Note body" });
    await waitFor(() => {
      expect(root).toHaveTextContent("Purpose");
      expect(root).toHaveTextContent("@Sara Kim");
      expect(root).toHaveTextContent("(Maybe) Steve");
      expect(root.querySelector("[data-task-id='mem-task-1']")).toBeTruthy();
    });
    expect(
      screen.getByDisplayValue("Send updated tier table"),
    ).toBeInTheDocument();
  });
});
