import React, { useState, useEffect, useCallback, useMemo } from "react";
import { searchSimilar, searchByText, checkHealth } from "./api/client";
import DropZone from "./components/DropZone";
import ResultsGrid from "./components/ResultsGrid";
import ImageDetail from "./components/ImageDetail";
import StatusBar from "./components/StatusBar";
import LibraryUpload from "./components/LibraryUpload";
import LibraryBrowser from "./components/LibraryBrowser";
import SimilarityFilter from "./components/SimilarityFilter";

function SkeletonCard({ delay }) {
  return (
    <div className="skeleton-card" style={{ animationDelay: `${delay}ms` }}>
      <div className="skeleton-image skeleton-pulse" />
      <div className="score-bar-track"><div className="score-bar-fill" style={{ width: "60%" }} /></div>
      <div className="skeleton-info">
        <div className="skeleton-line skeleton-line-short skeleton-pulse" />
        <div className="skeleton-line skeleton-line-medium skeleton-pulse" />
        <div className="skeleton-line skeleton-line-long skeleton-pulse" />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="results-grid" style={{ width: "100%", maxWidth: 920 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonCard key={i} delay={i * 60} />
      ))}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function App() {
  const [state, setState] = useState("idle"); // idle | searching | results | detail
  const [results, setResults] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [filters] = useState({});
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [queryFile, setQueryFile] = useState(null);
  const [textQuery, setTextQuery] = useState("");
  const [isDark, setIsDark] = useState(
    () => (localStorage.getItem("theme") ?? "dark") === "dark"
  );
  const [mode, setMode] = useState("search"); // "search" | "browse" | "add"
  const [minSimilarity, setMinSimilarity] = useState(0);
  const [maxSimilarity, setMaxSimilarity] = useState(100);

  useEffect(() => {
    const theme = isDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [isDark]);

  useEffect(() => {
    checkHealth()
      .then(setHealth)
      .catch(() => setHealth({ status: "unreachable" }));
  }, []);

  const allResults = results?.results || [];

  const filteredResults = useMemo(() => {
    const min = minSimilarity / 100;
    const max = maxSimilarity / 100;
    return allResults.filter((r) => {
      const score = r.similarity_score ?? 0;
      return score >= min && score <= max;
    });
  }, [allResults, minSimilarity, maxSimilarity]);

  const selectedIndex = useMemo(() => {
    if (!selectedResult) return -1;
    return filteredResults.findIndex(
      (r) => r.image.id === selectedResult.image.id
    );
  }, [filteredResults, selectedResult]);

  const handleSearch = useCallback(
    async (file) => {
      setQueryFile(file);
      setState("searching");
      setError(null);
      setResults(null);
      setMinSimilarity(0);
      setMaxSimilarity(100);

      try {
        const data = await searchSimilar(file, filters);
        setResults(data);
        setState("results");
      } catch (err) {
        setError(err.message);
        setState("idle");
      }
    },
    [filters]
  );

  const handleTextSearch = useCallback(
    async (e) => {
      e.preventDefault();
      if (!textQuery.trim()) return;
      setState("searching");
      setError(null);
      setResults(null);
      setQueryFile(null);
      setMinSimilarity(0);
      setMaxSimilarity(100);

      try {
        const data = await searchByText(textQuery.trim(), filters);
        setResults(data);
        setState("results");
      } catch (err) {
        setError(err.message);
        setState("idle");
      }
    },
    [textQuery, filters]
  );

  const handleResultClick = useCallback((result) => {
    setSelectedResult(result);
    setState("detail");
  }, []);

  const handleBack = useCallback(() => {
    setSelectedResult(null);
    setState("results");
  }, []);

  const handlePrevResult = useCallback(() => {
    setSelectedResult((current) => {
      if (!current) return current;
      const idx = filteredResults.findIndex((r) => r.image.id === current.image.id);
      if (idx <= 0) return current;
      return filteredResults[idx - 1];
    });
  }, [filteredResults]);

  const handleNextResult = useCallback(() => {
    setSelectedResult((current) => {
      if (!current) return current;
      const idx = filteredResults.findIndex((r) => r.image.id === current.image.id);
      if (idx < 0 || idx >= filteredResults.length - 1) return current;
      return filteredResults[idx + 1];
    });
  }, [filteredResults]);

  const handleSimilarityChange = useCallback((min, max) => {
    setMinSimilarity(min);
    setMaxSimilarity(max);
  }, []);

  // If the open detail falls outside the new filter range, return to the grid
  useEffect(() => {
    if (state !== "detail" || !selectedResult) return;
    const stillVisible = filteredResults.some(
      (r) => r.image.id === selectedResult.image.id
    );
    if (!stillVisible) {
      setSelectedResult(null);
      setState("results");
    }
  }, [filteredResults, selectedResult, state]);

  const handleNewSearch = useCallback(() => {
    setState("idle");
    setResults(null);
    setSelectedResult(null);
    setQueryFile(null);
    setTextQuery("");
    setMinSimilarity(0);
    setMaxSimilarity(100);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img
            className="brand-mark"
            src="/ili-brary-logo.png"
            alt="ILI-brary"
            width={44}
            height={44}
          />
          <div className="brand-wordmark">
            ILI<span>-BRARY</span>
          </div>
        </div>
        <nav className="header-nav">
          <button
            className={`nav-tab ${mode === "search" ? "nav-tab-active" : ""}`}
            onClick={() => { setMode("search"); handleNewSearch(); }}
          >
            Search
          </button>
          <button
            className={`nav-tab ${mode === "browse" ? "nav-tab-active" : ""}`}
            onClick={() => setMode("browse")}
          >
            Browse Library
          </button>
          <button
            className={`nav-tab ${mode === "add" ? "nav-tab-active" : ""}`}
            onClick={() => setMode("add")}
          >
            Add Entry
          </button>
        </nav>
        <div className="header-actions">
          {mode === "search" && state !== "idle" && (
            <button className="btn btn-secondary" onClick={handleNewSearch}>
              New Search
            </button>
          )}
          <button
            className="theme-toggle"
            onClick={() => setIsDark((d) => !d)}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {mode === "browse" && <LibraryBrowser />}

        {mode === "add" && <LibraryUpload />}

        {mode === "search" && state === "idle" && (
          <>
            <DropZone onFileDrop={handleSearch} />
            <div className="text-search">
              <div className="text-search-divider">or search by description</div>
              <form className="text-search-form" onSubmit={handleTextSearch}>
                <input
                  type="text"
                  className="text-search-input"
                  placeholder="e.g. metal loss near girth weld"
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!textQuery.trim()}
                >
                  Search
                </button>
              </form>
            </div>
          </>
        )}

        {mode === "search" && state === "searching" && (
          <div className="loading">
            <div className="loading-header">
              <div className="spinner" />
              <div className="loading-steps">
                <p className="loading-step">Extracting visual features...</p>
                <p className="loading-step">Searching vector index...</p>
                <p className="loading-step">Ranking by similarity</p>
              </div>
            </div>
            <SkeletonGrid />
          </div>
        )}

        {mode === "search" && (state === "results" || state === "detail") && results && (
          <>
            {state === "results" && (
              <>
                <SimilarityFilter
                  minPercent={minSimilarity}
                  maxPercent={maxSimilarity}
                  onChange={handleSimilarityChange}
                  totalCount={allResults.length}
                  visibleCount={filteredResults.length}
                />
                <ResultsGrid
                  results={filteredResults}
                  onResultClick={handleResultClick}
                  queryImageId={queryFile ? null : null}
                />
              </>
            )}

            {state === "detail" && selectedResult && (
              <ImageDetail
                key={selectedResult.image.id}
                result={selectedResult}
                onBack={handleBack}
                currentIndex={selectedIndex >= 0 ? selectedIndex : 0}
                totalCount={filteredResults.length}
                onPrev={handlePrevResult}
                onNext={handleNextResult}
              />
            )}
          </>
        )}
      </main>

      <StatusBar health={health} results={results} />
    </div>
  );
}
