import React, { useCallback, useEffect, useMemo, useState } from "react";
import { browseLibrary, getFilters, resolveImageUrl } from "../api/client";
import ImageDetail from "./ImageDetail";
import {
  ANOMALY_TYPES,
  CLASSIFICATION_STATUS_OPTIONS,
  PANEL_TAG_OPTIONS,
  STATUS_COLORS,
} from "../lib/iliConstants";

const EMPTY_FILTERS = {
  q: "",
  anomaly_types: [],
  panel_tags: [],
  run_number: "",
  classification_status: "",
};

function toggleType(arr, type) {
  return arr.includes(type) ? arr.filter((t) => t !== type) : [...arr, type];
}

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function FilterSection({ id, label, open, onToggle, count, children }) {
  return (
    <div className={`browse-filter-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="browse-filter-section-toggle"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span className="browse-filter-section-label">
          {label}
          {count > 0 && <span className="browse-filter-section-count">{count}</span>}
        </span>
        <span className="browse-filter-plus" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="browse-filter-section-body">{children}</div>}
    </div>
  );
}

export default function LibraryBrowser() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [runOptions, setRunOptions] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openSections, setOpenSections] = useState({});

  useEffect(() => {
    getFilters()
      .then((data) => setRunOptions(data.run_numbers || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await browseLibrary(filters);
      setItems(data.images || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSection = (id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q.trim()) n += 1;
    n += filters.anomaly_types.length;
    n += filters.panel_tags.length;
    if (filters.run_number) n += 1;
    if (filters.classification_status) n += 1;
    return n;
  }, [filters]);

  if (selected) {
    return (
      <ImageDetail
        result={{
          image: selected.image,
          image_url: selected.image_url,
          media_urls: selected.media_urls,
          similarity_score: null,
        }}
        onBack={() => setSelected(null)}
        onDeleted={() => {
          setSelected(null);
          load();
        }}
        backLabel="Back to Library"
        allowDelete
      />
    );
  }

  return (
    <div className="library-browser">
      <div className="library-browser-header">
        <div>
          <h2 className="library-browser-title">Reference Library</h2>
          <p className="library-browser-subtitle">
            Browse curated ILI examples by type, panel, run, and status
          </p>
        </div>
        <div className="library-browser-tools">
          <span className="library-count">{total} entr{total === 1 ? "y" : "ies"}</span>
          <button
            type="button"
            className={`btn browse-filter-trigger${filtersOpen || activeFilterCount ? " is-active" : ""}`}
            onClick={() => setFiltersOpen(true)}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
          >
            <FilterIcon />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="browse-filter-badge">{activeFilterCount}</span>
            )}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div
          className="browse-filter-overlay"
          role="presentation"
          onClick={() => setFiltersOpen(false)}
        >
          <div
            className="browse-filter-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Library filters"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="browse-filter-panel-head">
              <h3>Filters</h3>
              <div className="browse-filter-panel-actions">
                <button
                  type="button"
                  className="btn btn-secondary browse-filter-clear"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  disabled={activeFilterCount === 0}
                >
                  Clear all
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setFiltersOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>

            <div className="browse-filter-search">
              <label className="form-label" htmlFor="browse-filter-q">Search</label>
              <input
                id="browse-filter-q"
                className="form-input"
                type="search"
                placeholder="Comments, notes, anomaly name…"
                value={filters.q}
                onChange={(e) => setFilter("q", e.target.value)}
              />
            </div>

            <FilterSection
              id="type"
              label="Type"
              open={!!openSections.type}
              onToggle={toggleSection}
              count={filters.anomaly_types.length}
            >
              <div className="chips-wrap">
                {ANOMALY_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`chip ${filters.anomaly_types.includes(type) ? "chip-active" : ""}`}
                    onClick={() => setFilter("anomaly_types", toggleType(filters.anomaly_types, type))}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection
              id="panel"
              label="Panel"
              open={!!openSections.panel}
              onToggle={toggleSection}
              count={filters.panel_tags.length}
            >
              <div className="chips-wrap">
                {PANEL_TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`chip ${filters.panel_tags.includes(tag) ? "chip-active" : ""}`}
                    onClick={() => setFilter("panel_tags", toggleType(filters.panel_tags, tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </FilterSection>

            <FilterSection
              id="run"
              label="Run"
              open={!!openSections.run}
              onToggle={toggleSection}
              count={filters.run_number ? 1 : 0}
            >
              <select
                className="form-select"
                value={filters.run_number}
                onChange={(e) => setFilter("run_number", e.target.value)}
              >
                <option value="">All runs</option>
                {runOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </FilterSection>

            <FilterSection
              id="status"
              label="Classification"
              open={!!openSections.status}
              onToggle={toggleSection}
              count={filters.classification_status ? 1 : 0}
            >
              <select
                className="form-select"
                value={filters.classification_status}
                onChange={(e) => setFilter("classification_status", e.target.value)}
              >
                <option value="">All classification statuses</option>
                {CLASSIFICATION_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FilterSection>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={load}>Retry</button>
        </div>
      )}

      {loading && (
        <div className="loading" style={{ marginTop: 24 }}>
          <div className="spinner" />
          <p className="loading-step">Loading library…</p>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="no-results">
          <p>No entries yet. Use Add Entry to contribute the first reference example.</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="results-grid browse-grid">
          {items.map((item, index) => {
            const img = item.image;
            const statusColor = STATUS_COLORS[img.classification_status] || "var(--text-muted)";
            const mediaCount = (item.media_urls || [item.image_url]).length;
            return (
              <div
                key={img.id}
                className="result-card"
                style={{ animationDelay: `${Math.min(index, 7) * 55}ms` }}
                onClick={() => setSelected(item)}
              >
                <img
                  src={resolveImageUrl(item.image_url)}
                  alt={img.anomaly_name || "Library entry"}
                  className="result-image"
                  loading="lazy"
                />
                <div className="result-info">
                  <div className="result-diagnosis">
                    {img.anomaly_name || img.anomaly_description || "Untitled"}
                  </div>
                  <div className="result-info-row">
                    {img.anomaly_type && (
                      <span className="badge badge-anomaly">{img.anomaly_type}</span>
                    )}
                    {(img.panel_tags || []).map((tag) => (
                      <span key={tag} className="badge badge-panel">{tag}</span>
                    ))}
                    {img.run_number && <span className="badge">{img.run_number}</span>}
                    {img.classification_status && (
                      <span className="badge" style={{ color: statusColor, borderColor: statusColor }}>
                        {img.classification_status}
                      </span>
                    )}
                    {img.is_qc_flag && <span className="badge badge-qc">QC</span>}
                    {mediaCount > 1 && <span className="badge">{mediaCount} media</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
