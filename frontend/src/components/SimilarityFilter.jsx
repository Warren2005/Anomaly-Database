import React, { useCallback, useRef } from "react";

/**
 * Dual-thumb range filter for similarity confidence (0–100%).
 * Click the track to move the nearest thumb; drag a thumb to adjust it.
 */
export default function SimilarityFilter({
  minPercent,
  maxPercent,
  onChange,
  totalCount,
  visibleCount,
  showRangeLabel = false,
}) {
  const trackRef = useRef(null);

  const handleMin = (e) => {
    const next = Math.min(Number(e.target.value), maxPercent);
    onChange(next, maxPercent);
  };

  const handleMax = (e) => {
    const next = Math.max(Number(e.target.value), minPercent);
    onChange(minPercent, next);
  };

  const valueFromClientX = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.round(Math.min(100, Math.max(0, ratio * 100)));
  }, []);

  const moveNearestThumb = useCallback(
    (clientX) => {
      const value = valueFromClientX(clientX);
      if (value == null) return;

      const distMin = Math.abs(value - minPercent);
      const distMax = Math.abs(value - maxPercent);

      if (distMin <= distMax) {
        onChange(Math.min(value, maxPercent), maxPercent);
      } else {
        onChange(minPercent, Math.max(value, minPercent));
      }
    },
    [valueFromClientX, minPercent, maxPercent, onChange]
  );

  const handleTrackPointerDown = (e) => {
    if (e.target.closest?.("input[type='range']")) return;
    e.preventDefault();
    moveNearestThumb(e.clientX);
  };

  const left = minPercent;
  const right = 100 - maxPercent;

  return (
    <div className="similarity-filter" role="group" aria-label="Similarity confidence filter">
      {showRangeLabel && (
        <div className="similarity-filter-header">
          <span className="similarity-filter-values">
            {minPercent}% – {maxPercent}%
          </span>
        </div>
      )}

      <div
        className="similarity-range"
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
      >
        <div className="similarity-range-track">
          <div
            className="similarity-range-fill"
            style={{ left: `${left}%`, right: `${right}%` }}
          />
        </div>
        <input
          type="range"
          className="similarity-range-input similarity-range-input-min"
          min={0}
          max={100}
          step={1}
          value={minPercent}
          onChange={handleMin}
          aria-label="Minimum similarity percent"
          style={{ zIndex: minPercent > 100 - maxPercent ? 5 : 3 }}
        />
        <input
          type="range"
          className="similarity-range-input similarity-range-input-max"
          min={0}
          max={100}
          step={1}
          value={maxPercent}
          onChange={handleMax}
          aria-label="Maximum similarity percent"
          style={{ zIndex: maxPercent < minPercent + 10 ? 5 : 4 }}
        />
      </div>

      <div className="similarity-filter-footer">
        <span className="similarity-filter-count">
          Showing {visibleCount} of {totalCount}
        </span>
      </div>
    </div>
  );
}
