import { describe, expect, it } from "vitest";
import {
  ANSWER_ACTION_LABEL,
  actionsFor,
  noteTargetFromId,
} from "./answerActions";

describe("answerActions", () => {
  it("current note gets append, replace, copy", () => {
    expect(actionsFor(noteTargetFromId("note-1"))).toEqual([
      "append",
      "replace",
      "copy",
    ]);
    expect(ANSWER_ACTION_LABEL.append).toBe("Append to current note");
    expect(ANSWER_ACTION_LABEL.replace).toBe("Replace current note");
  });

  it("no note gets daily append and copy", () => {
    expect(actionsFor(noteTargetFromId(null))).toEqual([
      "append-daily",
      "copy",
    ]);
    expect(ANSWER_ACTION_LABEL["append-daily"]).toBe(
      "Append to today's daily note",
    );
  });
});
