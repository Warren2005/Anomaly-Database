import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Image area with scroll-to-zoom and double-click reset (no lightbox).
 */
export default function ZoomableImage({ src, alt, className = "" }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

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
        const next = Math.min(6, Math.max(1, +(s + delta).toFixed(2)));
        if (next === 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e) => {
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
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    });
  };

  const onPointerUp = (e) => {
    if (dragRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    dragRef.current = null;
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
      title="Scroll to zoom · Double-click to reset"
    >
      <img
        src={src}
        alt={alt}
        className="detail-image zoomable-image"
        draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? "grab" : "zoom-in",
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
