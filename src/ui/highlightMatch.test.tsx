import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightMatch } from "./highlightMatch";

describe("highlightMatch", () => {
  it("bolds the first case-insensitive match", () => {
    const { container } = render(
      <>{highlightMatch("Product analytics", "pro")}</>,
    );
    expect(container.textContent).toBe("Product analytics");
    expect(container.querySelector("strong")?.textContent).toBe("Pro");
  });

  it("returns the title unchanged when there is no match", () => {
    const { container } = render(<>{highlightMatch("Weekly review", "zzz")}</>);
    expect(container.textContent).toBe("Weekly review");
    expect(container.querySelector("strong")).toBeNull();
  });
});
