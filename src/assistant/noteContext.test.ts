import { describe, expect, it } from "vitest";
import {
  ACT_ON_NOTE_PROMPT,
  buildChatMessages,
  noteContextMessage,
} from "./noteContext";

describe("noteContext (ENG-72)", () => {
  it("includes the open note as a system message", () => {
    expect(
      noteContextMessage({
        title: "Thursday, Aug 6",
        body: "Ths sentnce has typos.",
      }),
    ).toEqual({
      role: "system",
      content: "Current note: Thursday, Aug 6\n\nThs sentnce has typos.",
    });
  });

  it("omits note context when none is open", () => {
    expect(noteContextMessage(null)).toBeNull();
    expect(
      buildChatMessages({
        note: null,
        history: [],
        user: "Hello",
      }),
    ).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("prepends current note, then history, then the new user turn", () => {
    expect(
      buildChatMessages({
        note: { title: "Pricing", body: "Draft v2" },
        history: [
          { role: "user", content: "Please proof-read this" },
          { role: "assistant", content: "Looks good." },
        ],
        user: ACT_ON_NOTE_PROMPT,
      }),
    ).toEqual([
      { role: "system", content: "Current note: Pricing\n\nDraft v2" },
      { role: "user", content: "Please proof-read this" },
      { role: "assistant", content: "Looks good." },
      { role: "user", content: ACT_ON_NOTE_PROMPT },
    ]);
  });
});
