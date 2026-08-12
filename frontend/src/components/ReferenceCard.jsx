import React from "react";
import { resolveImageUrl } from "../api/client";

/**
 * Catalog-style card for Library browse and image-search results.
 * Search: ID alone; identification↔%; type↔run.
 * Browse: left = ID / identification; right = type + run.
 */
export default function ReferenceCard({
  image,
  imageUrl,
  onClick,
  similarityScore = null,
  animationDelay = 0,
  footer = null,
}) {
  const anomalyId = image?.anomaly_id || null;
  const identification = image?.identification || image?.diagnosis || null;
  const anomalyType = image?.anomaly_type || null;
  const runNumber = image?.run_number || null;
  const isSearch = similarityScore != null;
  const scorePct = isSearch ? `${(similarityScore * 100).toFixed(1)}%` : null;

  return (
    <article
      className={`ref-card${isSearch ? " ref-card-search" : ""}`}
      style={{ animationDelay: `${animationDelay}ms` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.(e);
        }
      }}
    >
      <div className="ref-card-media">
        <img
          src={resolveImageUrl(imageUrl)}
          alt={anomalyId || identification || "Reference entry"}
          className="ref-card-image"
          loading="lazy"
        />
      </div>
      <div className="ref-card-body">
        {isSearch ? (
          <div className="ref-card-search-stack">
            <div className="ref-card-id">{anomalyId || "No Anomaly ID"}</div>
            <div className="ref-card-pair">
              <h3 className="ref-card-title">
                {identification || "Untitled reference"}
              </h3>
              <div className="ref-card-score-text">{scorePct}</div>
            </div>
            <div className="ref-card-pair">
              {anomalyType ? (
                <span className="ref-card-type">{anomalyType}</span>
              ) : (
                <span />
              )}
              <div className="ref-card-run">{runNumber || "—"}</div>
            </div>
          </div>
        ) : (
          <div className="ref-card-top">
            <div className="ref-card-copy">
              <div className="ref-card-id">{anomalyId || "No Anomaly ID"}</div>
              <h3 className="ref-card-title">
                {identification || "Untitled reference"}
              </h3>
            </div>
            {(anomalyType || runNumber) && (
              <div className="ref-card-aside">
                {anomalyType && (
                  <span className="ref-card-type">{anomalyType}</span>
                )}
                {runNumber && (
                  <span className="ref-card-run">{runNumber}</span>
                )}
              </div>
            )}
          </div>
        )}
        {footer}
      </div>
    </article>
  );
}
