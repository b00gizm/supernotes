import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveTranscript } from "./LiveTranscript";

describe("LiveTranscript (ENG-69 UI)", () => {
  it("renders timestamped lines without speaker names", () => {
    render(
      <LiveTranscript
        live
        segments={[
          {
            id: "1",
            clock: "14:02",
            meeting_note_id: "m1",
            start_ms: 120_000,
            end_ms: 128_000,
            text: "Let's lock the Q3 pricing before the board deck goes out.",
          },
          {
            id: "2",
            clock: "14:05",
            meeting_note_id: "m1",
            start_ms: 300_000,
            end_ms: 308_000,
            text: "I still think we should keep the free tier.",
          },
        ]}
      />,
    );

    const panel = screen.getByLabelText("Live transcript");
    expect(panel).toHaveTextContent(/live transcript/i);
    expect(panel).toHaveTextContent("14:02");
    expect(panel).toHaveTextContent("Let's lock the Q3 pricing");
    expect(panel).toHaveTextContent("Transcribing locally · summary on stop");
    expect(panel.textContent).not.toMatch(/\bSara\b|\bMarcus\b|\bYou\b/);
    expect(panel.querySelector(".live-transcript-cursor")).toBeTruthy();
  });

  it("hides the live cursor when the session is not live", () => {
    render(
      <LiveTranscript
        live={false}
        segments={[
          {
            id: "1",
            clock: "14:02",
            meeting_note_id: "m1",
            start_ms: 0,
            end_ms: 8000,
            text: "Done.",
          },
        ]}
      />,
    );
    expect(document.querySelector(".live-transcript-cursor")).toBeNull();
  });
});
