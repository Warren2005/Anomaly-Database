import React, { useCallback, useEffect, useState } from "react";
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

export default function LibraryBrowser() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [runOptions, setRunOptions] = useState([]);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

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
        <span className="library-count">{total} entr{total === 1 ? "y" : "ies"}</span>
      </div>

      <div className="browse-search-row">
        <input
          className="form-input browse-search"
          type="search"
          placeholder="Search comments, notes, anomaly name…"
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setFilters(EMPTY_FILTERS)}
        >
          Clear
        </button>
      </div>

      <div className="filter-chips-row">
        <span className="filter-label">Type</span>
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
      </div>

      <div className="filter-chips-row">
        <span className="filter-label">Panel</span>
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
      </div>

      <div className="browse-filters">
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
      </div>

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
