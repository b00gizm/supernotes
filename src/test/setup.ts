import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// TipTap / ProseMirror call layout APIs that jsdom stubs incompletely.
Range.prototype.getBoundingClientRect = () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
});
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
document.elementFromPoint = () => null;
HTMLElement.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
});
