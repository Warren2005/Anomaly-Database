import React from "react";
import ReferenceCard from "./ReferenceCard";

export default function ResultsGrid({ results, onResultClick }) {
  if (!results || results.length === 0) {
    return (
      <div className="no-results">
        <p>No similar images in this confidence range. Try widening the similarity filter.</p>
      </div>
    );
  }

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
        />
      ))}
    </div>
  );
}
