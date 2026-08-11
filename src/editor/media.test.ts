import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extensionForFile,
  isImageDropSlot,
  resolveImageSrc,
  saveNoteImage,
} from "./media";

describe("editor media helpers", () => {
  it("treats empty and slot protocol as drop slots", () => {
    expect(isImageDropSlot("")).toBe(true);
    expect(isImageDropSlot(null)).toBe(true);
    expect(isImageDropSlot("supernotes:slot")).toBe(true);
    expect(isImageDropSlot("images/a.png")).toBe(false);
  });

  it("picks extension from filename or mime", () => {
    expect(
      extensionForFile(new File([], "chart.PNG", { type: "image/png" })),
    ).toBe("png");
    expect(
      extensionForFile(new File([], "x", { type: "image/jpeg" })),
    ).toBe("jpg");
  });

  it("stores browser images as data URLs", async () => {
    const file = new File([Uint8Array.from([1, 2, 3])], "dot.png", {
      type: "image/png",
    });
    const src = await saveNoteImage(file);
    expect(src.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("passes through http srcs when resolving", async () => {
    await expect(resolveImageSrc("https://example.com/a.png")).resolves.toBe(
      "https://example.com/a.png",
    );
  });

  it("rejects non-images", async () => {
    const file = new File(["hi"], "notes.txt", { type: "text/plain" });
    await expect(saveNoteImage(file)).rejects.toThrow(/not an image/);
  });
});

describe("prompted link shortcut contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes window.prompt for Mod-k (jsdom)", () => {
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "https://example.com"),
    );
    expect(window.prompt("Link URL", "https://")).toBe("https://example.com");
  });
});
