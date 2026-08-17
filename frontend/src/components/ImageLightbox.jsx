import React, { useEffect } from "react";
import ZoomableImage from "./ZoomableImage";

export default function ImageLightbox({ src, alt = "Image", onClose }) {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  if (!src) return null;

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt || "Image preview"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <button
        type="button"
        className="image-lightbox-close"
        onClick={onClose}
        aria-label="Close image preview"
      >
        ✕
      </button>
      <div
        className="image-lightbox-stage"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <ZoomableImage
          src={src}
          alt={alt}
          className="in-lightbox"
          minScale={1}
          maxScale={8}
        />
      </div>
      <span className="image-lightbox-hint">
        Scroll to zoom · Drag to pan · Double-click to reset · Esc to close
      </span>
    </div>
  );
}
