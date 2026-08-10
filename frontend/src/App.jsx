import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { searchSimilar, checkHealth } from "./api/client";
import ResultsGrid from "./components/ResultsGrid";
import ImageDetail from "./components/ImageDetail";
import StatusBar from "./components/StatusBar";
import LibraryUpload from "./components/LibraryUpload";
import LibraryBrowser from "./components/LibraryBrowser";
import SimilarityFilter from "./components/SimilarityFilter";
import logoMark from "./assets/ili-brary-logo.png";

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

function ImageSearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
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
  const [isDark, setIsDark] = useState(
    () => (localStorage.getItem("theme") ?? "dark") === "dark"
  );
  const [mode, setMode] = useState("browse"); // "browse" | "add" | "search"
  const [minSimilarity, setMinSimilarity] = useState(0);
  const [maxSimilarity, setMaxSimilarity] = useState(100);
  const [addEntryDirty, setAddEntryDirty] = useState(false);
  const [leaveAddConfirm, setLeaveAddConfirm] = useState(null);
  const imageSearchRef = useRef(null);

  const handleAddDirtyChange = useCallback((dirty) => {
    setAddEntryDirty(Boolean(dirty));
  }, []);

  const requestModeChange = useCallback((nextMode, after) => {
    if (mode === "add" && addEntryDirty && nextMode !== "add") {
      setLeaveAddConfirm({ nextMode, after });
      return;
    }
    setMode(nextMode);
    after?.();
  }, [mode, addEntryDirty]);

  const confirmLeaveAdd = useCallback(() => {
    if (!leaveAddConfirm) return;
    const { nextMode, after } = leaveAddConfirm;
    setLeaveAddConfirm(null);
    setAddEntryDirty(false);
    setMode(nextMode);
    after?.();
  }, [leaveAddConfirm]);

  const runWithLeaveGuard = useCallback((nextMode, action) => {
    if (mode === "add" && addEntryDirty) {
      setLeaveAddConfirm({ nextMode, after: action });
      return;
    }
    action?.();
  }, [mode, addEntryDirty]);

  useEffect(() => {
    if (!addEntryDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [addEntryDirty]);

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
      setMode("search");
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
        setMode("browse");
      }
    },
    [filters]
  );

  const handleImageSearchPick = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    runWithLeaveGuard("search", () => {
      void handleSearch(file);
    });
  }, [runWithLeaveGuard, handleSearch]);

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
    setMinSimilarity(0);
    setMaxSimilarity(100);
    setMode("browse");
  }, []);

  const goHome = useCallback(() => {
    requestModeChange("browse", () => {
      setState("idle");
      setSelectedResult(null);
    });
  }, [requestModeChange]);

  return (
    <div className="app">
      <header className="app-header">
        <button type="button" className="brand brand-button" onClick={goHome}>
          <img
            className="brand-mark"
            src={logoMark}
            alt="ILI-brary"
            width={40}
            height={40}
          />
          <div className="brand-wordmark">
            ILI<span>-BRARY</span>
          </div>
        </button>
        <nav className="header-nav">
          <button
            className={`nav-tab ${mode === "browse" ? "nav-tab-active" : ""}`}
            onClick={() => requestModeChange("browse")}
          >
            Library
          </button>
          <button
            className={`nav-tab ${mode === "add" ? "nav-tab-active" : ""}`}
            onClick={() => requestModeChange("add")}
          >
            Add Entry
          </button>
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-primary header-image-search"
            onClick={() => imageSearchRef.current?.click()}
            aria-label="Search by image"
            title="Upload an image to find similar library entries"
          >
            <ImageSearchIcon />
            <span>Search by image</span>
          </button>
          <input
            ref={imageSearchRef}
            type="file"
            accept=".jpg,.jpeg,.png,.tiff,.tif,image/jpeg,image/png,image/tiff"
            className="header-file-input"
            onChange={handleImageSearchPick}
          />
          {mode === "search" && state !== "idle" && (
            <button className="btn btn-secondary" onClick={handleNewSearch}>
              Clear
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

        {mode === "add" && (
          <LibraryUpload onDirtyChange={handleAddDirtyChange} />
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
                <div className="search-results-header">
                  <h2 className="library-browser-title">Search results</h2>
                  <button type="button" className="btn btn-secondary" onClick={goHome}>
                    Back to Library
                  </button>
                </div>
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

      <StatusBar health={health} results={mode === "search" ? results : null} />

      {leaveAddConfirm && (
        <div
          className="leave-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-confirm-title"
        >
          <div className="leave-confirm-modal">
            <h3 id="leave-confirm-title">Discard unsaved entry?</h3>
            <p>
              You have started an Add Entry form. Leaving this page will discard
              your images and field values.
            </p>
            <div className="leave-confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setLeaveAddConfirm(null)}
              >
                Stay on Add Entry
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmLeaveAdd}
              >
                Discard and leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
