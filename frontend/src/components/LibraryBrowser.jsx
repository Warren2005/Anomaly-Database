import React, { useCallback, useEffect, useMemo, useState } from "react";
import { browseLibrary, getFilters, verifyPasskey } from "../api/client";
import ImageDetail from "./ImageDetail";
import LibraryUpload from "./LibraryUpload";
import ReferenceCard from "./ReferenceCard";
import {
  ANOMALY_TYPES,
  CLASSIFICATION_STATUS_OPTIONS,
  IDENTIFICATION_BY_TYPE,
  PANEL_TAG_OPTIONS,
  WALL_LOCATION_OPTIONS,
} from "../lib/iliConstants";

const EMPTY_FILTERS = {
  q: "",
  anomaly_types: [],
  identifications: [],
  panel_tags: [],
  wall_locations: [],
  run_number: "",
  classification_status: "",
  interacts_with_other_features: null,
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
  // Edit/Delete unlock — scoped to whichever anomaly is currently open, not
  // the whole session: cleared whenever the user leaves it (Back, a
  // completed delete, or a completed edit), but survives cancelling an
  // edit back into the same anomaly's detail view.
  const [adminPasskey, setAdminPasskey] = useState(null);

  const handleUnlock = useCallback(async (passkey) => {
    await verifyPasskey(passkey);
    setAdminPasskey(passkey);
  }, []);

  const lockAdmin = useCallback(() => setAdminPasskey(null), []);
  const [openSections, setOpenSections] = useState({
    type: true,
    identification: true,
    panel: true,
    wall: true,
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

  const identificationClusters = useMemo(() => {
    const types = filters.anomaly_types.length
      ? ANOMALY_TYPES.filter((type) => filters.anomaly_types.includes(type))
      : ANOMALY_TYPES;
    return types
      .map((type) => ({ type, options: IDENTIFICATION_BY_TYPE[type] || [] }))
      .filter((cluster) => cluster.options.length > 0);
  }, [filters.anomaly_types]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q.trim()) n += 1;
    n += filters.anomaly_types.length;
    n += filters.identifications.length;
    n += filters.panel_tags.length;
    n += filters.wall_locations.length;
    if (filters.run_number) n += 1;
    if (filters.classification_status) n += 1;
    if (filters.interacts_with_other_features === true || filters.interacts_with_other_features === false) {
      n += 1;
    }
    return n;
  }, [filters]);

  const selectedIndex = useMemo(() => {
    if (!selected?.image?.id) return -1;
    return items.findIndex((item) => item.image.id === selected.image.id);
  }, [items, selected]);

  const goToBrowseItem = useCallback((index) => {
    if (index < 0 || index >= items.length) return;
    lockAdmin();
    setSelected(items[index]);
  }, [items, lockAdmin]);

  if (editingItem) {
    return (
      <LibraryUpload
        editingImage={editingItem}
        adminPasskey={adminPasskey}
        onAuthError={lockAdmin}
        onCancel={() => {
          setSelected(editingItem);
          setEditingItem(null);
        }}
        onSuccess={(result) => {
          setEditingItem(null);
          lockAdmin();
          if (result) {
            setSelected({
              image: result.image,
              image_url: result.image_url,
              media_urls: result.media_urls,
              media_storage_paths: result.media_storage_paths,
              orientation_image_url: result.orientation_image_url,
              video_urls: result.video_urls,
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
        key={selected.image.id}
        result={{
          image: selected.image,
          image_url: selected.image_url,
          media_urls: selected.media_urls,
          media_storage_paths: selected.media_storage_paths,
          orientation_image_url: selected.orientation_image_url,
          video_urls: selected.video_urls,
          similarity_score: null,
        }}
        onBack={() => {
          setSelected(null);
          lockAdmin();
        }}
        onDeleted={() => {
          setSelected(null);
          lockAdmin();
          load();
        }}
        onEdit={(result) => {
          setEditingItem(result);
          setSelected(null);
        }}
        backLabel="Back to Library"
        allowDelete
        allowEdit
        adminPasskey={adminPasskey}
        onUnlock={handleUnlock}
        onAuthError={lockAdmin}
        currentIndex={selectedIndex >= 0 ? selectedIndex : 0}
        totalCount={items.length}
        onPrev={() => goToBrowseItem(selectedIndex - 1)}
        onNext={() => goToBrowseItem(selectedIndex + 1)}
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
            placeholder="Comments, detection signature, Anomaly ID…"
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
                aria-pressed={filters.anomaly_types.includes(type)}
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
          <div className="id-clusters">
            {identificationClusters.map((cluster) => (
              <div key={cluster.type} className="id-cluster">
                <div className="id-cluster-label">{cluster.type}</div>
                <div className="chips-wrap">
                  {cluster.options.map((idOpt) => (
                    <button
                      key={idOpt}
                      type="button"
                      className={`chip ${filters.identifications.includes(idOpt) ? "chip-active" : ""}`}
                      aria-pressed={filters.identifications.includes(idOpt)}
                      onClick={() =>
                        setFilter("identifications", toggleType(filters.identifications, idOpt))
                      }
                    >
                      {idOpt}
                    </button>
                  ))}
                </div>
              </div>
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
                aria-pressed={filters.panel_tags.includes(tag)}
                onClick={() => setFilter("panel_tags", toggleType(filters.panel_tags, tag))}
              >
                {tag}
              </button>
            ))}
          </div>
        </FilterSection>

        <FilterSection
          id="wall"
          label="Wall Location"
          open={!!openSections.wall}
          onToggle={toggleSection}
          count={filters.wall_locations.length}
        >
          <div className="chips-wrap">
            {WALL_LOCATION_OPTIONS.map((loc) => (
              <button
                key={loc}
                type="button"
                className={`chip ${filters.wall_locations.includes(loc) ? "chip-active" : ""}`}
                aria-pressed={filters.wall_locations.includes(loc)}
                onClick={() => setFilter("wall_locations", toggleType(filters.wall_locations, loc))}
              >
                {loc}
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

        <FilterSection
          id="other"
          label="Other"
          open={!!openSections.other}
          onToggle={toggleSection}
          count={
            filters.interacts_with_other_features === true
            || filters.interacts_with_other_features === false
              ? 1
              : 0
          }
        >
          <label className="checkbox-label browse-filter-check">
            <input
              type="checkbox"
              checked={filters.interacts_with_other_features === true}
              onChange={(e) =>
                setFilter(
                  "interacts_with_other_features",
                  e.target.checked ? true : null
                )
              }
            />
            Interacting with other features
          </label>
        </FilterSection>
      </aside>

      <div className="library-browser-main">
        <div className="library-browser-header">
          <div>
            <h2 className="library-browser-title">Reference Library</h2>
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
          <div className="results-grid browse-grid ref-grid">
            {items.map((item, index) => {
              const img = item.image;
              return (
                <ReferenceCard
                  key={img.id}
                  image={img}
                  imageUrl={item.image_url}
                  animationDelay={Math.min(index, 7) * 55}
                  onClick={() => setSelected(item)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
