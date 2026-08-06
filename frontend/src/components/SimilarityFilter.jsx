import React from "react";

/**
 * Dual-thumb range filter for similarity confidence (0–100%).
 * Filters client-side over ranked search results.
 */
export default function SimilarityFilter({
  minPercent,
  maxPercent,
  onChange,
  totalCount,
  visibleCount,
}) {
  const handleMin = (e) => {
    const next = Math.min(Number(e.target.value), maxPercent);
    onChange(next, maxPercent);
  };

  const handleMax = (e) => {
    const next = Math.max(Number(e.target.value), minPercent);
    onChange(minPercent, next);
  };

  const left = minPercent;
  const right = 100 - maxPercent;

  return (
    <div className="similarity-filter" role="group" aria-label="Similarity confidence filter">
      <div className="similarity-filter-header">
        <span className="filter-label">Similarity confidence</span>
        <span className="similarity-filter-values">
          {minPercent}% – {maxPercent}%
        </span>
      </div>

      <div className="similarity-range">
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
        <span className="similarity-filter-hint">Drag to set the match range you want to review</span>
        <span className="similarity-filter-count">
          Showing {visibleCount} of {totalCount}
        </span>
      </div>
    </div>
  );
}
