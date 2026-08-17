import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Image area with scroll-to-zoom, drag-to-pan, and double-click reset.
 * Optional onOpen fires on a click that is not a drag (opens lightbox).
 */
export default function ZoomableImage({
  src,
  alt,
  className = "",
  onOpen = null,
  minScale = 1,
  maxScale = 6,
}) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const pointerRef = useRef(null);

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [src, resetView]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      setScale((s) => {
        const next = Math.min(maxScale, Math.max(minScale, +(s + delta).toFixed(2)));
        if (next <= 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [minScale, maxScale]);

  const onPointerDown = (e) => {
    pointerRef.current = { x: e.clientX, y: e.clientY, moved: false };
    if (scale <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const onPointerMove = (e) => {
    if (pointerRef.current) {
      const dx = e.clientX - pointerRef.current.x;
      const dy = e.clientY - pointerRef.current.y;
      if (Math.hypot(dx, dy) > 6) pointerRef.current.moved = true;
    }
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    });
  };

  const onPointerUp = (e) => {
    const wasClick = pointerRef.current && !pointerRef.current.moved;
    pointerRef.current = null;
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    dragRef.current = null;
    if (wasClick && typeof onOpen === "function") {
      onOpen();
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`zoomable-image-wrap ${className}`.trim()}
      onDoubleClick={(e) => {
        e.preventDefault();
        resetView();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      title={onOpen ? "Click to open · Scroll to zoom" : "Scroll to zoom · Double-click to reset"}
    >
      <img
        src={src}
        alt={alt}
        className="detail-image zoomable-image"
        draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : onOpen ? "zoom-in" : "zoom-in",
        }}
      />
      {scale > 1 && (
        <span className="zoomable-hint" aria-hidden="true">
          {Math.round(scale * 100)}% · double-click to reset
        </span>
      )}
    </div>
  );
}
