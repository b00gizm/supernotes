import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import {
  isImageDropSlot,
  resolveImageSrc,
  saveNoteImage,
} from "./media";

export function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const empty = isImageDropSlot(src);
  const [resolved, setResolved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (empty) {
      setResolved("");
      return;
    }
    void resolveImageSrc(src).then((url) => {
      if (!cancelled) {
        setResolved(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [src, empty]);

  async function fillFromFile(file: File | undefined) {
    if (!file) {
      return;
    }
    setError(null);
    try {
      const next = await saveNoteImage(file);
      updateAttributes({
        src: next,
        alt: alt || file.name.replace(/\.[^.]+$/, ""),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save image");
    }
  }

  if (empty) {
    const label = alt.trim() || "image";
    return (
      <NodeViewWrapper
        className={`note-image-slot${selected ? " is-selected" : ""}`}
        data-drag-handle
      >
        <div
          className="note-image-slot-inner"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const file = event.dataTransfer.files[0];
            void fillFromFile(file);
          }}
        >
          <p className="note-image-slot-title">Drop the {label}</p>
          <button
            type="button"
            className="note-image-slot-browse"
            onClick={() => inputRef.current?.click()}
          >
            or browse files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              void fillFromFile(file);
              event.target.value = "";
            }}
          />
          {error ? <p className="note-image-slot-error">{error}</p> : null}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className={`note-image${selected ? " is-selected" : ""}`}
      data-drag-handle
    >
      {resolved ? (
        <img src={resolved} alt={alt} className="note-image-img" />
      ) : (
        <div className="note-image-loading">Loading image…</div>
      )}
    </NodeViewWrapper>
  );
}
