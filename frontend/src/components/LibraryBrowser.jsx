import React, { useCallback, useEffect, useMemo, useState } from "react";
import { browseLibrary, getFilters, resolveImageUrl } from "../api/client";
import ImageDetail from "./ImageDetail";
import LibraryUpload from "./LibraryUpload";
import {
  ALL_IDENTIFICATIONS,
  ANOMALY_TYPES,
  CLASSIFICATION_STATUS_OPTIONS,
  IDENTIFICATION_BY_TYPE,
  PANEL_TAG_OPTIONS,
} from "../lib/iliConstants";

const EMPTY_FILTERS = {
  q: "",
  anomaly_types: [],
  identifications: [],
  panel_tags: [],
  run_number: "",
  classification_status: "",
};

function toggleType(arr, type) {
  return arr.includes(type) ? arr.filter((t) => t !== type) : [...arr, type];
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
  const [editingItem, setEditingItem] = useState(null);
  const [openSections, setOpenSections] = useState({
    type: true,
    identification: true,
    panel: true,
  });

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

  const identificationOptions = useMemo(() => {
    if (!filters.anomaly_types.length) return ALL_IDENTIFICATIONS;
    const scoped = filters.anomaly_types.flatMap(
      (type) => IDENTIFICATION_BY_TYPE[type] || []
    );
    return [...new Set(scoped)];
  }, [filters.anomaly_types]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q.trim()) n += 1;
    n += filters.anomaly_types.length;
    n += filters.identifications.length;
    n += filters.panel_tags.length;
    if (filters.run_number) n += 1;
    if (filters.classification_status) n += 1;
    return n;
  }, [filters]);

  if (editingItem) {
    return (
      <LibraryUpload
        editingImage={editingItem}
        onCancel={() => {
          setSelected(editingItem);
          setEditingItem(null);
        }}
        onSuccess={(result) => {
          setEditingItem(null);
          if (result) {
            setSelected({
              image: result.image,
              image_url: result.image_url,
              media_urls: result.media_urls,
              orientation_image_url: result.orientation_image_url,
            });
          }
          load();
        }}
      />
    );
  }

  if (selected) {
    return (
      <ImageDetail
        result={{
          image: selected.image,
          image_url: selected.image_url,
          media_urls: selected.media_urls,
          orientation_image_url: selected.orientation_image_url,
          similarity_score: null,
        }}
        onBack={() => setSelected(null)}
        onDeleted={() => {
          setSelected(null);
          load();
        }}
        onEdit={(result) => {
          setEditingItem(result);
          setSelected(null);
        }}
        backLabel="Back to Library"
        allowDelete
        allowEdit
      />
    );
  }

  return (
    <div className="library-browser">
      <aside className="browse-filter-sidebar is-open" aria-label="Library filters">
        <div className="browse-filter-panel-head">
          <h3>Filters</h3>
          <button
            type="button"
            className="btn btn-secondary browse-filter-clear"
            onClick={() => setFilters(EMPTY_FILTERS)}
            disabled={activeFilterCount === 0}
          >
            Clear all
          </button>
        </div>

        <div className="browse-filter-search">
          <label className="form-label" htmlFor="browse-filter-q">Search</label>
          <input
            id="browse-filter-q"
            className="form-input"
            type="search"
            placeholder="Detection signature, Anomaly ID, identification…"
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
          id="identification"
          label="Identification"
          open={!!openSections.identification}
          onToggle={toggleSection}
          count={filters.identifications.length}
        >
          <div className="chips-wrap">
            {identificationOptions.map((idOpt) => (
              <button
                key={idOpt}
                type="button"
                className={`chip ${filters.identifications.includes(idOpt) ? "chip-active" : ""}`}
                onClick={() =>
                  setFilter("identifications", toggleType(filters.identifications, idOpt))
                }
              >
                {idOpt}
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
      </aside>

      <div className="library-browser-main">
        <div className="library-browser-header">
          <div>
            <h2 className="library-browser-title">Reference Library</h2>
            <p className="library-browser-subtitle">
              Browse curated ILI examples by type, panel, run, and status
            </p>
          </div>
          <div className="library-browser-tools">
            <span className="library-count">{total} entr{total === 1 ? "y" : "ies"}</span>
          </div>
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
              return (
                <div
                  key={img.id}
                  className="result-card"
                  style={{ animationDelay: `${Math.min(index, 7) * 55}ms` }}
                  onClick={() => setSelected(item)}
                >
                  <img
                    src={resolveImageUrl(item.image_url)}
                    alt={img.anomaly_id || img.identification || "Library entry"}
                    className="result-image"
                    loading="lazy"
                  />
                  <div className="result-info">
                    <div className="result-diagnosis">
                      {img.anomaly_id || "No Anomaly ID"}
                    </div>
                    <div className="result-info-row">
                      {img.anomaly_type && (
                        <span className="badge badge-anomaly">{img.anomaly_type}</span>
                      )}
                      {img.identification && (
                        <span className="browse-card-identification">{img.identification}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
