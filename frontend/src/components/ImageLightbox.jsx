import React, { useEffect } from "react";

/**
 * Full-screen lightbox to view the entire image without cropping.
 */
export default function ImageLightbox({ src, alt = "Full image", onClose }) {
  useEffect(() => {
    if (!src) return undefined;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Full image view"
      onClick={onClose}
    >
      <button
        type="button"
        className="image-lightbox-close"
        onClick={onClose}
        aria-label="Close full image"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="image-lightbox-image"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
