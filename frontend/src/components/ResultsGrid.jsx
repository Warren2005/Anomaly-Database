import React, { useState } from "react";
import { submitFeedback, resolveImageUrl } from "../api/client";

export default function ResultsGrid({ results, onResultClick, queryImageId }) {
  const [votes, setVotes] = useState({});

  if (!results || results.length === 0) {
    return (
      <div className="no-results">
        <p>No similar images in this confidence range. Try widening the similarity filter.</p>
      </div>
    );
  }

  const handleVote = async (e, resultImageId, vote) => {
    e.stopPropagation();
    const key = `${resultImageId}_${vote}`;
    if (votes[resultImageId] === vote) return;
    try {
      await submitFeedback(queryImageId || null, resultImageId, vote);
      setVotes((prev) => ({ ...prev, [resultImageId]: vote }));
    } catch (err) {
      console.error("Failed to submit feedback:", err);
    }
  };

  return (
    <div className="results-grid">
      {results.map((result, index) => (
        <div
          key={result.image.id}
          className="result-card"
          style={{ animationDelay: `${Math.min(index, 7) * 55}ms` }}
          onClick={() => onResultClick(result)}
        >
          <div className="result-rank">#{index + 1}</div>
          <img
            src={resolveImageUrl(result.image_url)}
            alt={result.image.diagnosis || "Inspection image"}
            className="result-image"
            loading="lazy"
          />
          <div className="score-bar-track">
            <div className="score-bar-fill" style={{ width: `${(result.similarity_score * 100).toFixed(1)}%` }} />
          </div>
          <div className="result-info">
            <div className="result-score">
              {(result.similarity_score * 100).toFixed(1)}% match
            </div>
            {result.image.anomaly_name || result.image.diagnosis ? (
              <div className="result-diagnosis">
                {result.image.anomaly_name || result.image.diagnosis}
              </div>
            ) : null}
            <div className="result-info-row">
              {result.image.anomaly_type && (
                <span className="badge badge-anomaly">
                  {result.image.anomaly_type}
                </span>
              )}
              {result.image.run_number && (
                <span className="badge">{result.image.run_number}</span>
              )}
              {result.image.classification_status && (
                <span className="badge badge-status">
                  {result.image.classification_status}
                </span>
              )}
              {result.image.is_qc_flag && (
                <span className="badge badge-qc">QC</span>
              )}
              {result.image.benign_malignant && (
                <span
                  className={`badge ${
                    result.image.benign_malignant === "malignant"
                      ? "badge-malignant"
                      : "badge-benign"
                  }`}
                >
                  {result.image.benign_malignant}
                </span>
              )}
              <div className="feedback-buttons">
                <button
                  className={`feedback-btn${votes[result.image.id] === 1 ? " feedback-btn-active-up" : ""}`}
                  onClick={(e) => handleVote(e, result.image.id, 1)}
                  title="Relevant result"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={votes[result.image.id] === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                  </svg>
                </button>
                <button
                  className={`feedback-btn${votes[result.image.id] === -1 ? " feedback-btn-active-down" : ""}`}
                  onClick={(e) => handleVote(e, result.image.id, -1)}
                  title="Irrelevant result"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={votes[result.image.id] === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
