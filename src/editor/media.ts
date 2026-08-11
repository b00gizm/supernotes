import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/** Relative markdown refs look like `images/<uuid>.png`. */
export const IMAGE_DIR = "images";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isImageDropSlot(src: string | null | undefined): boolean {
  return !src || src === "supernotes:slot";
}

export function extensionForFile(file: File): string {
  const dot = file.name.lastIndexOf(".");
  if (dot > 0) {
    const fromName = file.name.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]+$/.test(fromName) && fromName.length <= 8) {
      return fromName;
    }
  }
  const mime = file.type.toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  if (mime === "image/svg+xml") return "svg";
  return "png";
}

/**
 * Persist an image and return the markdown `src` (relative path in Tauri,
 * data URL in browser preview).
 */
export async function saveNoteImage(file: File): Promise<string> {
  const looksLikeImage =
    file.type.startsWith("image/") ||
    (!file.type && /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name));
  if (!looksLikeImage) {
    throw new Error("not an image");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("image too large");
  }

  if (!isTauriRuntime()) {
    // ponytail: browser preview only; Tauri writes files under app-data/images.
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("read failed"));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("read failed"));
      };
      reader.readAsDataURL(file);
    });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("save_note_image", {
    bytes: Array.from(buffer),
    extension: extensionForFile(file),
  });
}

/** Resolve a stored src to something an <img> can load. */
export async function resolveImageSrc(src: string): Promise<string> {
  if (isImageDropSlot(src)) {
    return "";
  }
  if (/^(https?:|data:|blob:|asset:)/i.test(src)) {
    return src;
  }
  if (!isTauriRuntime()) {
    return src;
  }
  const absolute = await invoke<string>("resolve_note_image_path", {
    relative: src,
  });
  return convertFileSrc(absolute);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) {
    return;
  }
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
