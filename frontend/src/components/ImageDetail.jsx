import React, { useEffect, useMemo, useRef, useState } from "react";
import { deleteLibraryEntry, resolveImageUrl } from "../api/client";
import { PANEL_TAG_OPTIONS, STATUS_COLORS, canonicalBeamformingType, canonicalPanelTag, formatCrackAngle, isBeamformingPanel, shortcutModeLabel } from "../lib/iliConstants";
import ZoomableImage from "./ZoomableImage";
import ImageLightbox from "./ImageLightbox";

const VIEW_FOCUS = "focus";
const VIEW_GRID = "grid";
const GRID_TILE_SIZE_KEY = "ili-grid-tile-size";
const GRID_TILE_MIN = 160;
const GRID_TILE_MAX = 420;
const GRID_TILE_DEFAULT = 280;

function loadGridTileSize() {
  try {
    const raw = Number(localStorage.getItem(GRID_TILE_SIZE_KEY));
    if (Number.isFinite(raw) && raw >= GRID_TILE_MIN && raw <= GRID_TILE_MAX) return raw;
  } catch {
    /* ignore */
  }
  return GRID_TILE_DEFAULT;
}

function shortPanelLabel(tag) {
  const canonical = canonicalPanelTag(tag);
  return (canonical || "Panel").replace(/ Panel$/i, "").trim();
}

function panelGroupKey(tag) {
  return shortPanelLabel(tag).toLowerCase();
}

/** Unique filter id for Grid visibility — Beamforming splits by mode. */
function gridFilterKey(tag, mode = "") {
  const panel = panelGroupKey(tag);
  if (isBeamformingPanel(tag)) {
    const m = canonicalBeamformingType(mode) || "unspecified";
    return `${panel}::${m}`;
  }
  return panel;
}

function gridFilterLabel(tag, mode = "") {
  const short = shortPanelLabel(tag);
  if (isBeamformingPanel(tag)) {
    const m = shortcutModeLabel(mode) || "Unspecified mode";
    return `${short} · ${m}`;
  }
  return short;
}

export default function ImageDetail({
  result,
  onBack,
  onDeleted,
  backLabel = "Back to Results",
  allowDelete = false,
  allowEdit = false,
  onEdit = null,
  adminPasskey = null,
  onUnlock = null,
  onAuthError = null,
  currentIndex = null,
  totalCount = null,
  onPrev = null,
  onNext = null,
}) {
  const { image, similarity_score, image_url, media_urls, media_storage_paths, media_index, orientation_image_url, video_urls } = result;
  const media = (media_urls && media_urls.length ? media_urls : [image_url]).filter(Boolean);
  const [mediaIdx, setMediaIdx] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [viewMode, setViewMode] = useState(VIEW_FOCUS);
  const [gridTileSize, setGridTileSize] = useState(loadGridTileSize);
  // Full revision list is opt-in; latest updater is always shown.
  const [showRevisions, setShowRevisions] = useState(false);
  /** Filter keys hidden in Grid mode. Empty = show all. */
  const [gridHiddenPanels, setGridHiddenPanels] = useState(() => new Set());
  const [gridFilterOpen, setGridFilterOpen] = useState(false);
  const gridFilterRef = useRef(null);

  const [copiedAnomalyId, setCopiedAnomalyId] = useState(false);
  const copyResetTimerRef = useRef(null);
  const metaPaneRef = useRef(null);
  const imagePaneRef = useRef(null);

  const canNavigate = typeof currentIndex === "number" && totalCount > 0 && (onPrev || onNext);
  const hasPrev = canNavigate && currentIndex > 0 && typeof onPrev === "function";
  const hasNext = canNavigate && currentIndex < totalCount - 1 && typeof onNext === "function";
  const panelTags = Array.isArray(image.panel_tags) ? image.panel_tags : [];
  const beamformingTypes = Array.isArray(image.beamforming_types) ? image.beamforming_types : [];
  const tags = Array.isArray(image.tags) ? image.tags : [];
  // Panel-scoped search results carry a single image_url (possibly a
  // non-primary media file) plus media_index saying which panel_tags slot
  // it actually is — falls back to mediaIdx for the browse/detail flow,
  // where media_urls holds every image in panel_tags order already.
  const currentBeamformingType = canonicalBeamformingType(beamformingTypes[mediaIdx] || "");

  const panelGroups = useMemo(() => {
    const rank = (tag) => {
      const idx = PANEL_TAG_OPTIONS.indexOf(canonicalPanelTag(tag));
      return idx >= 0 ? idx : PANEL_TAG_OPTIONS.length + 1;
    };
    const map = new Map();
    media.forEach((url, i) => {
      const raw = (panelTags[i] || `Image ${i + 1}`).trim();
      const key = panelGroupKey(raw);
      if (!map.has(key)) map.set(key, { tag: raw, indexes: [], urls: [] });
      const group = map.get(key);
      group.indexes.push(i);
      group.urls.push(url);
    });
    return [...map.values()].sort((a, b) => rank(a.tag) - rank(b.tag));
  }, [media, panelTags]);

  const currentGroup = useMemo(
    () => panelGroups.find((g) => g.indexes.includes(mediaIdx)) || panelGroups[0] || null,
    [panelGroups, mediaIdx]
  );
  const withinPos = currentGroup ? currentGroup.indexes.indexOf(mediaIdx) : 0;
  const withinCount = currentGroup?.indexes.length || 1;
  const canStepPanelImage = withinCount > 1;

  const selectPanel = (tag) => {
    const group = panelGroups.find((g) => panelGroupKey(g.tag) === panelGroupKey(tag));
    if (!group) return;
    setMediaIdx(group.indexes.includes(mediaIdx) ? mediaIdx : group.indexes[0]);
  };

  const stepPanelImage = (dir) => {
    if (!currentGroup || currentGroup.indexes.length < 2) return;
    const next = withinPos + dir;
    if (next < 0 || next >= currentGroup.indexes.length) return;
    setMediaIdx(currentGroup.indexes[next]);
  };

  // Left/Right cycles through ALL of this anomaly's images (Raw,
  // Beamforming, Image, etc.), not just within one panel group like
  // stepPanelImage above. Kept as a separate function since "see every
  // image" and "step within one panel's sub-images" are different asks
  // with different key bindings (Left/Right vs the ‹ › buttons under the
  // image). Steps through panelGroups' flattened order (the same
  // left-to-right order the panel tabs are displayed in), not raw `media`
  // storage order, and wraps around at both ends.
  const orderedMediaIndexes = useMemo(
    () => panelGroups.flatMap((g) => g.indexes),
    [panelGroups]
  );

  const stepMedia = (dir) => {
    if (orderedMediaIndexes.length < 2) return;
    const pos = orderedMediaIndexes.indexOf(mediaIdx);
    const currentPos = pos === -1 ? 0 : pos;
    const total = orderedMediaIndexes.length;
    const nextPos = (currentPos + dir + total) % total;
    setMediaIdx(orderedMediaIndexes[nextPos]);
  };

  const canUsePanels = media.length > 1;

  const gridFilterOptions = useMemo(() => {
    const map = new Map();
    media.forEach((_, i) => {
      const tag = (panelTags[i] || `Image ${i + 1}`).trim();
      const mode = canonicalBeamformingType(beamformingTypes[i] || "");
      const key = gridFilterKey(tag, mode);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: gridFilterLabel(tag, mode),
          tag,
          mode,
          count: 0,
        });
      }
      map.get(key).count += 1;
    });
    return [...map.values()].sort((a, b) => {
      const ra = PANEL_TAG_OPTIONS.indexOf(canonicalPanelTag(a.tag));
      const rb = PANEL_TAG_OPTIONS.indexOf(canonicalPanelTag(b.tag));
      const ia = ra >= 0 ? ra : PANEL_TAG_OPTIONS.length;
      const ib = rb >= 0 ? rb : PANEL_TAG_OPTIONS.length;
      if (ia !== ib) return ia - ib;
      return a.label.localeCompare(b.label);
    });
  }, [media, panelTags, beamformingTypes]);

  const toggleGridPanel = (key) => {
    setGridHiddenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const gridSlots = useMemo(() => {
    return media
      .map((url, i) => {
        const tag = (panelTags[i] || `Image ${i + 1}`).trim();
        const mode = canonicalBeamformingType(beamformingTypes[i] || "");
        return {
          url,
          index: i,
          tag,
          mode,
          key: gridFilterKey(tag, mode),
        };
      })
      .filter((slot) => !gridHiddenPanels.has(slot.key));
  }, [media, panelTags, beamformingTypes, gridHiddenPanels]);

  const visibleFilterCount = gridFilterOptions.length - gridHiddenPanels.size;
  const gridFilterSummary =
    gridHiddenPanels.size === 0
      ? "All panels"
      : visibleFilterCount <= 0
        ? "None selected"
        : `${visibleFilterCount} of ${gridFilterOptions.length} panels`;

  const latestRevision = useMemo(() => {
    const history = image.revision_history || [];
    if (!history.length) return null;
    return [...history].sort((a, b) => {
      const ver = (b.version ?? 0) - (a.version ?? 0);
      if (ver !== 0) return ver;
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    })[0];
  }, [image.revision_history]);

  const createdRevision = useMemo(() => {
    const history = image.revision_history || [];
    if (!history.length) return null;
    return [...history].sort((a, b) => {
      const ver = (a.version ?? 0) - (b.version ?? 0);
      if (ver !== 0) return ver;
      return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    })[0];
  }, [image.revision_history]);

  // Reset per-image UI state when navigating to another similar result
  useEffect(() => {
    setMediaIdx(typeof media_index === "number" ? media_index : 0);
    setViewMode(VIEW_FOCUS);
    setLightbox(null);
    setShowRevisions(false);
    setGridHiddenPanels(new Set());
    setGridFilterOpen(false);
    setConfirmDelete(false);
    setDeleteError(null);
    setUnlockInput("");
    setUnlocking(false);
    setUnlockError(null);
    setCopiedAnomalyId(false);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    metaPaneRef.current?.scrollTo({ top: 0 });
  }, [image.id]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (viewMode === VIEW_GRID && !canUsePanels) setViewMode(VIEW_FOCUS);
  }, [viewMode, canUsePanels]);

  useEffect(() => {
    if (viewMode !== VIEW_GRID) setGridFilterOpen(false);
  }, [viewMode]);

  useEffect(() => {
    if (!gridFilterOpen) return undefined;
    const onPointerDown = (e) => {
      if (gridFilterRef.current && !gridFilterRef.current.contains(e.target)) {
        setGridFilterOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setGridFilterOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [gridFilterOpen]);

  useEffect(() => {
    try {
      const clamped = Math.min(GRID_TILE_MAX, Math.max(GRID_TILE_MIN, gridTileSize));
      localStorage.setItem(GRID_TILE_SIZE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, [gridTileSize]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (lightbox) return;
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        e.preventDefault();
        // Layered: close whatever's on top first, only fall through to
        // "leave this anomaly entirely" once nothing else is active.
        if (unlockError || deleteError) {
          setUnlockError(null);
          setDeleteError(null);
        } else if (confirmDelete) {
          setConfirmDelete(false);
          setDeleteError(null);
        } else {
          onBack();
        }
        return;
      }

      // Left/Right: step through this anomaly's own images (Raw,
      // Beamforming, Image, etc). Up/Down: move to the previous/next
      // anomaly in the list (what Left/Right used to do) — kept on
      // separate keys so neither action steals the other's shortcut.
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepMedia(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        stepMedia(1);
        return;
      }
      if (canNavigate && e.key === "ArrowUp" && hasPrev) {
        e.preventDefault();
        onPrev();
        return;
      }
      if (canNavigate && e.key === "ArrowDown" && hasNext) {
        e.preventDefault();
        onNext();
        return;
      }

      const pane = metaPaneRef.current;
      if (!pane) return;
      const page = Math.max(120, pane.clientHeight * 0.85);
      if (e.key === "PageDown") {
        e.preventDefault();
        pane.scrollBy({ top: page, behavior: "smooth" });
      } else if (e.key === "PageUp") {
        e.preventDefault();
        pane.scrollBy({ top: -page, behavior: "smooth" });
      } else if (e.key === "Home" && e.ctrlKey) {
        e.preventDefault();
        pane.scrollTo({ top: 0, behavior: "smooth" });
      } else if (e.key === "End" && e.ctrlKey) {
        e.preventDefault();
        pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    canNavigate, hasPrev, hasNext, onPrev, onNext, lightbox,
    unlockError, deleteError, confirmDelete, onBack, stepMedia,
  ]);

  useEffect(() => {
    const imagePane = imagePaneRef.current;
    const metaPane = metaPaneRef.current;
    if (!imagePane || !metaPane) return undefined;

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) return;
      if (e.target.closest(".zoomable-image-wrap")) return;
      // Grid tiles / panel filter own their own overflow — don't steal the wheel
      // for the metadata pane or the masonry can't scroll.
      if (e.target.closest(".panel-masonry, .grid-panel-filter-menu")) return;
      e.preventDefault();
      metaPane.scrollTop += e.deltaY;
    };

    imagePane.addEventListener("wheel", onWheel, { passive: false });
    return () => imagePane.removeEventListener("wheel", onWheel);
  }, [viewMode, image.id]);

  const title =
    image.identification ||
    image.anomaly_description ||
    image.diagnosis ||
    "Image Details";

  const statusColor = STATUS_COLORS[image.classification_status];

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteLibraryEntry(image.id, adminPasskey);
      if (onDeleted) onDeleted();
      else onBack();
    } catch (err) {
      setDeleteError(err.message);
      if (err.status === 403) onAuthError?.();
    } finally {
      setDeleting(false);
    }
  };

  const handleUnlockSubmit = async (e) => {
    e.preventDefault();
    if (!unlockInput || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await onUnlock?.(unlockInput);
      setUnlockInput("");
    } catch (err) {
      setUnlockError(err.message);
    } finally {
      setUnlocking(false);
    }
  };

  const openLightbox = (src, alt) => {
    if (!src) return;
    setLightbox({ src, alt: alt || title });
  };

  const copyAnomalyId = async () => {
    const value = (image.anomaly_id || "").trim();
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedAnomalyId(true);
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = setTimeout(() => {
        setCopiedAnomalyId(false);
        copyResetTimerRef.current = null;
      }, 1600);
    } catch {
      setCopiedAnomalyId(false);
    }
  };

  const currentSrc = resolveImageUrl(media[mediaIdx] || image_url);
  const currentAlt = title;
  const currentStoragePath = media_storage_paths?.[mediaIdx] || null;

  return (
    <div className="image-detail">
      <div className="detail-toolbar">
        <div className="detail-toolbar-left">
          <button className="btn btn-secondary" onClick={onBack}>
            {backLabel}
          </button>
        </div>

        {canNavigate ? (
          <div className="result-nav" role="navigation" aria-label="Library entries">
            <button
              type="button"
              className="btn btn-secondary result-nav-btn"
              onClick={onPrev}
              disabled={!hasPrev}
              aria-label="Previous entry"
              title="Previous (↑)"
            >
              ‹
            </button>
            <span className="result-nav-label" aria-live="polite">
              {currentIndex + 1} of {totalCount}
            </span>
            <button
              type="button"
              className="btn btn-secondary result-nav-btn"
              onClick={onNext}
              disabled={!hasNext}
              aria-label="Next entry"
              title="Next (↓)"
            >
              ›
            </button>
          </div>
        ) : (
          <div className="result-nav result-nav-spacer" aria-hidden="true" />
        )}

        <div className="detail-toolbar-right">
          {(allowEdit || allowDelete) && !adminPasskey && !confirmDelete && (
            <form className="delete-confirm detail-unlock-form" onSubmit={handleUnlockSubmit}>
              <input
                type="password"
                className="form-input delete-passkey-input detail-unlock-input"
                placeholder="Admin key to edit/delete"
                value={unlockInput}
                onChange={(e) => setUnlockInput(e.target.value)}
                autoComplete="off"
              />
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={unlocking || !unlockInput}
              >
                {unlocking ? "Checking…" : "Unlock"}
              </button>
            </form>
          )}
          {allowEdit && adminPasskey && !confirmDelete && (
            <button className="btn btn-secondary" onClick={() => onEdit?.(result)}>
              Edit Entry
            </button>
          )}
          {allowDelete && adminPasskey && !confirmDelete && (
            <button
              className="btn btn-danger"
              onClick={() => { setConfirmDelete(true); setDeleteError(null); }}
            >
              Delete Entry
            </button>
          )}
          {allowDelete && adminPasskey && confirmDelete && (
            <form
              className="delete-confirm"
              onSubmit={(e) => {
                e.preventDefault();
                if (!deleting) handleDelete();
              }}
            >
              <span>Delete this entry permanently?</span>
              <strong className="delete-warning">DELETION CANNOT BE UNDONE</strong>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="detail-content">
        <div
          ref={imagePaneRef}
          className={`detail-image-container${viewMode === VIEW_GRID ? " is-grid" : ""}`}
        >
          {(canUsePanels || currentBeamformingType) && (
            <div className="detail-image-toolbar">
              <div className="detail-view-toggle" role="group" aria-label="Image layout">
                {canUsePanels && (
                  <>
                    <button
                      type="button"
                      className={`btn ${viewMode === VIEW_FOCUS ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setViewMode(VIEW_FOCUS)}
                    >
                      Focus
                    </button>
                    <button
                      type="button"
                      className={`btn ${viewMode === VIEW_GRID ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setViewMode(VIEW_GRID)}
                    >
                      Grid
                    </button>
                  </>
                )}
              </div>
              {viewMode === VIEW_GRID && (
                <label className="grid-tile-size" title="Resize panel tiles">
                  <span className="grid-tile-size-label">Tile size</span>
                  <input
                    type="range"
                    min={GRID_TILE_MIN}
                    max={GRID_TILE_MAX}
                    step={10}
                    value={gridTileSize}
                    onChange={(e) => setGridTileSize(Number(e.target.value))}
                    aria-label="Panel tile size"
                  />
                </label>
              )}
              {viewMode === VIEW_FOCUS && (
                <div className="detail-beam-mode">
                  {currentBeamformingType ? (
                    <span className="badge badge-beam-type">{currentBeamformingType}</span>
                  ) : null}
                </div>
              )}
              <div className="media-thumbs detail-panel-tabs">
                {canUsePanels && viewMode === VIEW_FOCUS && panelGroups.map((group) => (
                  <button
                    key={panelGroupKey(group.tag)}
                    type="button"
                    className={`media-thumb${group.indexes.includes(mediaIdx) ? " active" : ""}`}
                    onClick={() => selectPanel(group.tag)}
                    title={
                      group.indexes.length > 1
                        ? `${group.tag} · ${group.indexes.length} images`
                        : group.tag
                    }
                  >
                    {shortPanelLabel(group.tag)}
                  </button>
                ))}
                {canUsePanels && viewMode === VIEW_GRID && (
                  <div className="grid-panel-filter-dropdown" ref={gridFilterRef}>
                    <button
                      type="button"
                      className={`btn btn-secondary grid-panel-filter-trigger${gridFilterOpen ? " is-open" : ""}`}
                      aria-expanded={gridFilterOpen}
                      aria-haspopup="listbox"
                      onClick={() => setGridFilterOpen((open) => !open)}
                    >
                      <span className="grid-panel-filter-trigger-label">Show panels</span>
                      <span className="grid-panel-filter-trigger-value">{gridFilterSummary}</span>
                      <span className="detail-revision-arrow" aria-hidden="true">
                        {gridFilterOpen ? "▴" : "▾"}
                      </span>
                    </button>
                    {gridFilterOpen && (
                      <div className="grid-panel-filter-menu" role="listbox" aria-label="Panels to show in grid">
                        <div className="grid-panel-filter-menu-head">
                          <span>Choose panels to display</span>
                          <button
                            type="button"
                            className="grid-panel-filter-reset"
                            onClick={() => {
                              if (gridHiddenPanels.size === 0) {
                                setGridHiddenPanels(new Set(gridFilterOptions.map((opt) => opt.key)));
                              } else {
                                setGridHiddenPanels(new Set());
                              }
                            }}
                          >
                            {gridHiddenPanels.size === 0 ? "Unselect all" : "Select all"}
                          </button>
                        </div>
                        {gridFilterOptions.map((opt) => {
                          const visible = !gridHiddenPanels.has(opt.key);
                          return (
                            <label key={opt.key} className="grid-panel-filter-option">
                              <input
                                type="checkbox"
                                checked={visible}
                                onChange={() => toggleGridPanel(opt.key)}
                              />
                              <span className="grid-panel-filter-option-text">
                                <span className="grid-panel-filter-option-label">{opt.label}</span>
                                {opt.count > 1 && (
                                  <span className="grid-panel-filter-option-count">{opt.count}</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {viewMode === VIEW_GRID ? (
            <div className="panel-layout">
              {gridSlots.length === 0 ? (
                <p className="grid-panel-empty">
                  No panels selected. Open Show panels and choose which views to display.
                </p>
              ) : (
              <div
                className="panel-masonry"
                aria-label="Panel grid"
                style={{ "--panel-tile-min": `${gridTileSize}px` }}
              >
                {gridSlots.map((slot) => {
                  const active = slot.index === mediaIdx;
                  return (
                    <button
                      type="button"
                      key={`${slot.url}-${slot.index}`}
                      className={`panel-slot${active ? " is-active" : ""}`}
                      onClick={() => {
                        setMediaIdx(slot.index);
                        openLightbox(resolveImageUrl(slot.url), slot.tag);
                      }}
                      title={slot.mode ? `Open ${slot.tag} · ${slot.mode}` : `Open ${slot.tag}`}
                    >
                      <div className="panel-slot-label">{shortPanelLabel(slot.tag)}</div>
                      {slot.mode ? (
                        <div className="panel-slot-mode">{shortcutModeLabel(slot.mode)}</div>
                      ) : null}
                      <img src={resolveImageUrl(slot.url)} alt={slot.tag} />
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          ) : (
            <>
              <div
                className="detail-image-viewport"
                title={media.length > 1 ? "Use ← → to browse this anomaly's images" : undefined}
              >
                <ZoomableImage
                  src={currentSrc}
                  alt={currentAlt}
                  onOpen={() => openLightbox(currentSrc, currentAlt)}
                />
              </div>
              {currentStoragePath && (
                <div className="detail-storage-note">
                  <span className="detail-storage-path" title={currentStoragePath}>
                    Stored in Dropbox at: {currentStoragePath}
                  </span>
                  <a href={currentSrc} download className="btn btn-secondary detail-storage-download">
                    Download
                  </a>
                </div>
              )}
              {canStepPanelImage && (
                <div className="detail-image-footer">
                  <div className="media-nav">
                    <button
                      className="btn btn-secondary"
                      disabled={withinPos === 0}
                      onClick={() => stepPanelImage(-1)}
                      aria-label="Previous image in this panel"
                    >
                      ‹
                    </button>
                    <span>
                      {withinPos + 1} / {withinCount}
                      {currentGroup?.tag ? ` · ${shortPanelLabel(currentGroup.tag)}` : ""}
                    </span>
                    <button
                      className="btn btn-secondary"
                      disabled={withinPos === withinCount - 1}
                      onClick={() => stepPanelImage(1)}
                      aria-label="Next image in this panel"
                    >
                      ›
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="detail-metadata"
          ref={metaPaneRef}
          tabIndex={0}
          aria-label="Anomaly details"
        >
          <div className="detail-meta-header">
            <h2>{title}</h2>
            {image.classification_status && (
              <span
                className="badge detail-status-badge"
                style={{
                  color: statusColor,
                  borderColor: statusColor,
                }}
              >
                {image.classification_status}
              </span>
            )}
          </div>

          {(image.anomaly_type || image.anomaly_id || panelGroups.length > 0) && (
            <div className="detail-meta-chips">
              {image.anomaly_type && (
                <span className="ref-card-type">{image.anomaly_type}</span>
              )}
              {image.anomaly_id && (
                <span className="detail-id-chip-wrap">
                  <span className="detail-id-chip">{image.anomaly_id}</span>
                  <button
                    type="button"
                    className="detail-id-copy-btn"
                    onClick={copyAnomalyId}
                    aria-label="Copy anomaly ID"
                    title={copiedAnomalyId ? "Copied" : "Copy anomaly ID"}
                  >
                    {copiedAnomalyId ? "Copied" : "Copy"}
                  </button>
                </span>
              )}
              {panelGroups.length > 0 && (
                <div className="detail-panel-tags">
                  <div className="panel-tag-row">
                    {panelGroups.map((group) => (
                      <button
                        type="button"
                        key={group.tag}
                        className={`badge badge-panel${
                          group.indexes.includes(mediaIdx) ? " badge-panel-current" : ""
                        }`}
                        onClick={() => selectPanel(group.tag)}
                      >
                        {group.tag}
                        {group.indexes.length > 1 ? ` (${group.indexes.length})` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {similarity_score != null && (
            <div className="detail-score">
              <span className="detail-label">Similarity</span>
              <span className="detail-value">{(similarity_score * 100).toFixed(1)}%</span>
            </div>
          )}

          {orientation_image_url && (
            <div className="detail-meta-block detail-orientation-block">
              <div className="detail-meta-heading">Orientation</div>
              <button
                type="button"
                onClick={() =>
                  openLightbox(
                    resolveImageUrl(orientation_image_url),
                    "Orientation reference"
                  )
                }
                className="orientation-detail-thumb"
                title="Click to view orientation image"
                aria-label="View orientation image"
              >
                <img src={resolveImageUrl(orientation_image_url)} alt="Orientation reference" />
              </button>
            </div>
          )}

          {video_urls?.length > 0 && (
            <div className="detail-meta-block detail-video-block">
              <div className="detail-meta-heading">
                Videos
                {video_urls.length > 1 ? ` (${video_urls.length})` : ""}
              </div>
              <ul className="video-list">
                {video_urls.map((url, i) => (
                  <li key={url} className="video-list-item">
                    <a
                      href={resolveImageUrl(url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="video-list-link"
                    >
                      Video {i + 1}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="detail-meta-block">
            <div className="detail-meta-heading">Identity</div>
            <dl className="detail-dl">
              <DetailItem label="Identification" value={image.identification} />
              <DetailItem label="Client ID" value={image.client_id} />
              <DetailItem
                label="Mode"
                value={
                  isBeamformingPanel(currentGroup?.tag)
                    ? currentBeamformingType || "N/A"
                    : "N/A"
                }
              />
              <DetailItem label="Wall Location" value={image.wall_location} />
              <DetailItem label="Pipe Angle" value={image.pipe_angle != null ? `${image.pipe_angle}°` : null} />
              <DetailItem label="Crack Angle" value={formatCrackAngle(image.crack_image_angles)} />
              {(image.interacts_with_other_features === true
                || image.interacts_with_other_features === false) && (
                <div className="detail-item detail-item-interacting">
                  <dt>Interacting features</dt>
                  <dd>
                    <div className="detail-interacting-value">
                      <span>{image.interacts_with_other_features ? "Yes" : "No"}</span>
                      {image.interacts_with_other_features
                        && (image.interaction_related_items || []).length > 0 && (
                        <div className="detail-interaction-tags">
                          {image.interaction_related_items.map((item) => (
                            <span key={item} className="badge badge-interaction">{item}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="detail-meta-block">
            <div className="detail-meta-heading">Run</div>
            <dl className="detail-dl">
              <DetailItem label="Run" value={image.run_number} />
              <DetailItem label="Run ID" value={image.anomaly_description} />
              <DetailItem label="ZeroAngle Frame" value={image.zero_angle_frame_index} />
            </dl>
          </div>

          {(image.signal_description || image.differential_diagnosis || image.limitations_uncertainty || image.analysis_comment || image.notes) && (
            <div className="detail-meta-block">
              <div className="detail-meta-heading">Analysis</div>
              <dl className="detail-dl detail-dl-stack">
                <DetailItem label="Detection signature" value={image.signal_description} />
                <DetailItem label="Differential diagnosis" value={image.differential_diagnosis} />
                <DetailItem label="Limitations / uncertainty" value={image.limitations_uncertainty} />
                <DetailItem label="Comments" value={image.analysis_comment} />
                <DetailItem label="Notes" value={image.notes} />
              </dl>
            </div>
          )}

          {(image.depth != null && image.depth !== "") || (image.width != null && image.width !== "") || (image.length != null && image.length !== "") ? (
            <div className="detail-meta-block">
              <div className="detail-meta-heading">Dimensions</div>
              <div className="detail-dim-row">
                {image.depth != null && image.depth !== "" && (
                  <div className="detail-dim">
                    <span className="detail-dim-label">Depth</span>
                    <span className="detail-dim-value">{image.depth}<span>mm</span></span>
                  </div>
                )}
                {image.width != null && image.width !== "" && (
                  <div className="detail-dim">
                    <span className="detail-dim-label">Width</span>
                    <span className="detail-dim-value">{image.width}<span>mm</span></span>
                  </div>
                )}
                {image.length != null && image.length !== "" && (
                  <div className="detail-dim">
                    <span className="detail-dim-label">Length</span>
                    <span className="detail-dim-value">{image.length}<span>mm</span></span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {(image.revision_history || []).length > 0 && (createdRevision || latestRevision) && (
            <div className="detail-meta-block">
              <div className="detail-revision-columns">
                {latestRevision && (
                  <div className="detail-revision-col">
                    <div className="detail-meta-heading">Last updated</div>
                    <div className="detail-revision-latest">
                      <span className="detail-revision-latest-name">{latestRevision.name || "Unknown"}</span>
                      {latestRevision.timestamp && (
                        <span className="detail-revision-latest-when">
                          {new Date(latestRevision.timestamp).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                      {latestRevision.comment && (
                        <div className="revision-comment">{latestRevision.comment}</div>
                      )}
                    </div>
                  </div>
                )}
                {createdRevision && (
                  <div className="detail-revision-col">
                    <div className="detail-meta-heading">Created by</div>
                    <div className="detail-revision-latest">
                      <span className="detail-revision-latest-name">{createdRevision.name || "Unknown"}</span>
                      {createdRevision.timestamp && (
                        <span className="detail-revision-latest-when">
                          {new Date(createdRevision.timestamp).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                      {createdRevision.comment && (
                        <div className="revision-comment">{createdRevision.comment}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {(image.revision_history || []).length > 1 && (
                <>
                  <button
                    type="button"
                    className="detail-revision-show-all"
                    onClick={() => setShowRevisions((open) => !open)}
                    aria-expanded={showRevisions}
                  >
                    {showRevisions ? "Hide full revision history" : "Show full revision history"}
                    <span className="detail-revision-arrow" aria-hidden="true">
                      {showRevisions ? "▴" : "▾"}
                    </span>
                  </button>
                  {showRevisions && (
                    <ul className="detail-revision-list">
                      {[...image.revision_history]
                        .sort((a, b) => {
                          const ver = (b.version ?? 0) - (a.version ?? 0);
                          if (ver !== 0) return ver;
                          return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
                        })
                        .map((rev) => (
                          <li key={rev.version}>
                            <span className="detail-revision-ver">V{rev.version}</span>
                            <span className="detail-revision-body">
                              {rev.name} — {new Date(rev.timestamp).toLocaleDateString()}
                              {rev.comment && <div className="revision-comment">{rev.comment}</div>}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {image.is_qc_flag && (
            <div className="detail-meta-block">
              <div className="detail-meta-heading">QC feedback</div>
              <dl className="detail-dl">
                <DetailItem label="Raised by" value={image.qc_raised_by} />
                <DetailItem label="Reviewer" value={image.qc_reviewer} />
                <DetailItem label="Decision" value={image.qc_decision_rationale} />
              </dl>
            </div>
          )}

          <div className="detail-meta-footer">
            {tags.length > 0 && (
              <div className="detail-meta-footer-row">
                <div className="detail-meta-footer-item">
                  <span className="detail-meta-footer-label">Tags</span>
                  <div className="panel-tag-row detail-meta-footer-tags">
                    {tags.map((tag) => (
                      <span key={tag} className="badge badge-tag">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="detail-meta-footer-item">
              <span className="detail-meta-footer-label">Image ID</span>
              <span className="detail-meta-footer-value">{image.id}</span>
            </div>
          </div>
        </div>
      </div>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
      {(unlockError || deleteError) && (
        <div
          className="leave-confirm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="passkey-error-title"
          onClick={() => {
            setUnlockError(null);
            setDeleteError(null);
          }}
        >
          <div className="leave-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="passkey-error-title">{unlockError || deleteError}</h3>
            <p>Check the passkey and try again.</p>
            <div className="leave-confirm-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setUnlockError(null);
                  setDeleteError(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="detail-item">
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}
