import React, { useState } from "react";
import { submitFeedback } from "../api/client";
import ReferenceCard from "./ReferenceCard";

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
    if (votes[resultImageId] === vote) return;
    try {
      await submitFeedback(queryImageId || null, resultImageId, vote);
      setVotes((prev) => ({ ...prev, [resultImageId]: vote }));
    } catch (err) {
      console.error("Failed to submit feedback:", err);
    }
  };

  return (
    <div className="results-grid browse-grid ref-grid">
      {results.map((result, index) => (
        <ReferenceCard
          key={result.image.id}
          image={result.image}
          imageUrl={result.image_url}
          similarityScore={result.similarity_score}
          animationDelay={Math.min(index, 7) * 55}
          onClick={() => onResultClick(result)}
          footer={(
            <div className="ref-card-feedback" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`feedback-btn${votes[result.image.id] === 1 ? " feedback-btn-active-up" : ""}`}
                onClick={(e) => handleVote(e, result.image.id, 1)}
                title="Relevant result"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={votes[result.image.id] === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                </svg>
              </button>
              <button
                type="button"
                className={`feedback-btn${votes[result.image.id] === -1 ? " feedback-btn-active-down" : ""}`}
                onClick={(e) => handleVote(e, result.image.id, -1)}
                title="Irrelevant result"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={votes[result.image.id] === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                </svg>
              </button>
            </div>
          )}
        />
      ))}
    </div>
  );
}
