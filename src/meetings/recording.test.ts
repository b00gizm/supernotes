import { describe, expect, it } from "vitest";
import { formatTranscriptClock, micPermissionMessage } from "./recording";

describe("recording helpers (ENG-69 UI)", () => {
  it("formats segment clocks as HH:MM", () => {
    expect(formatTranscriptClock(new Date(2026, 7, 10, 14, 2))).toBe("14:02");
    expect(formatTranscriptClock(new Date(2026, 7, 10, 9, 5))).toBe("09:05");
  });

  it("explains a denied mic with macOS Settings copy", () => {
    expect(
      micPermissionMessage(new DOMException("denied", "NotAllowedError"), {
        mac: true,
      }),
    ).toMatch(/System Settings → Privacy & Security → Microphone/);
  });

  it("explains a denied mic without macOS-specific copy on other platforms", () => {
    expect(
      micPermissionMessage(new DOMException("denied", "NotAllowedError"), {
        mac: false,
      }),
    ).toBe(
      "Microphone access is required to record. Allow microphone access and try again.",
    );
  });

  it("explains a missing microphone", () => {
    expect(
      micPermissionMessage(new DOMException("missing", "NotFoundError")),
    ).toBe("No microphone found.");
  });
});
