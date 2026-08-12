import { describe, expect, it } from "vitest";
import { PRIORITY_SEGMENTS, priorityDotClass } from "./priority";

describe("priority mapping (ENG-62)", () => {
  it("maps DB priorities onto P1/P2/P3 dots", () => {
    expect(priorityDotClass("urgent")).toBe("is-p1");
    expect(priorityDotClass("high")).toBe("is-p1");
    expect(priorityDotClass("medium")).toBe("is-p2");
    expect(priorityDotClass("low")).toBe("is-p3");
    expect(priorityDotClass("none")).toBeNull();
    expect(priorityDotClass(null)).toBeNull();
  });

  it("applies compact segment values back to the DB enum", () => {
    expect(PRIORITY_SEGMENTS.map((s) => [s.label, s.apply])).toEqual([
      ["P1", "high"],
      ["P2", "medium"],
      ["P3", "low"],
      ["None", null],
    ]);
  });
});
