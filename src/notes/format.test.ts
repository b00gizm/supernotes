import { describe, expect, it } from "vitest";
import { formatDailyTitle, formatRelativeUpdated, noteSnippet } from "./format";

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
});

describe("formatDailyTitle", () => {
  it("formats like the daily note mockup", () => {
    expect(formatDailyTitle(new Date("2026-08-10T12:00:00.000Z"))).toBe(
      "Monday, Aug 10",
    );
  });
});
