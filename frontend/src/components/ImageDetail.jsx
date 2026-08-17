import React, { useEffect, useMemo, useState } from "react";
import { deleteLibraryEntry, resolveImageUrl } from "../api/client";
import { PANEL_TAG_OPTIONS, STATUS_COLORS } from "../lib/iliConstants";
import ZoomableImage from "./ZoomableImage";
import ImageLightbox from "./ImageLightbox";

const VIEW_FOCUS = "focus";
const VIEW_PANELS = "panels";
const VIEW_SPLIT = "split";

function shortPanelLabel(tag) {
  return (tag || "Panel").replace(/ Panel$/i, "").trim();
}

function panelGroupKey(tag) {
  return shortPanelLabel(tag).toLowerCase();
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
  const { image, similarity_score, image_url, media_urls, media_index, orientation_image_url } = result;
  const media = (media_urls && media_urls.length ? media_urls : [image_url]).filter(Boolean);
  const [mediaIdx, setMediaIdx] = useState(0);
  const [showOrientation, setShowOrientation] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [viewMode, setViewMode] = useState(VIEW_FOCUS);
  const [lightbox, setLightbox] = useState(null);
  const [showRevisions, setShowRevisions] = useState(true);

  const canNavigate = typeof currentIndex === "number" && totalCount > 0 && (onPrev || onNext);
  const hasPrev = canNavigate && currentIndex > 0 && typeof onPrev === "function";
  const hasNext = canNavigate && currentIndex < totalCount - 1 && typeof onNext === "function";
  const panelTags = Array.isArray(image.panel_tags) ? image.panel_tags : [];
  const tags = Array.isArray(image.tags) ? image.tags : [];
  // Panel-scoped search results carry a single image_url (possibly a
  // non-primary media file) plus media_index saying which panel_tags slot
  // it actually is — falls back to mediaIdx for the browse/detail flow,
  // where media_urls holds every image in panel_tags order already.
  const currentPanelTag = panelTags[mediaIdx];

  const panelGroups = useMemo(() => {
    const rank = (tag) => {
      const idx = PANEL_TAG_OPTIONS.indexOf(tag);
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

  const panelSlots = useMemo(
    () =>
      panelGroups.map((group) => ({
        tag: group.tag,
        index: group.indexes[0],
        url: group.urls[0],
        count: group.indexes.length,
        active: group.indexes.includes(mediaIdx),
      })),
    [panelGroups, mediaIdx]
  );

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

  const canUsePanels = media.length > 1;
  const canUseSplit = Boolean(orientation_image_url);

  // Reset per-image UI state when navigating to another similar result
  useEffect(() => {
    setMediaIdx(typeof media_index === "number" ? media_index : 0);
    setShowOrientation(false);
    setViewMode(VIEW_FOCUS);
    setLightbox(null);
    setShowRevisions(true);
    setConfirmDelete(false);
    setDeleteError(null);
    setUnlockInput("");
    setUnlocking(false);
    setUnlockError(null);
  }, [image.id]);

  useEffect(() => {
    if (viewMode === VIEW_PANELS && !canUsePanels) setViewMode(VIEW_FOCUS);
    if (viewMode === VIEW_SPLIT && !canUseSplit) setViewMode(VIEW_FOCUS);
  }, [viewMode, canUsePanels, canUseSplit]);

  useEffect(() => {
    if (viewMode !== VIEW_FOCUS) {
      setShowOrientation(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!canNavigate) return undefined;

    const onKeyDown = (e) => {
      if (lightbox) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft" && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && hasNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNavigate, hasPrev, hasNext, onPrev, onNext, lightbox]);

  const title =
    image.identification ||
    image.anomaly_description ||
    image.diagnosis ||
    "Image Details";

  const statusColor = STATUS_COLORS[image.classification_status];

  const handleToggleOrientation = () => {
    setShowOrientation((prev) => !prev);
  };

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

  const currentSrc =
    showOrientation && orientation_image_url
      ? resolveImageUrl(orientation_image_url)
      : resolveImageUrl(media[mediaIdx] || image_url);
  const currentAlt = showOrientation ? "Orientation reference" : title;

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
              title="Previous (←)"
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
              title="Next (→)"
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
                placeholder="Passkey to edit/delete"
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
              {unlockError && <span className="detail-error delete-error">{unlockError}</span>}
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
              {deleteError && <span className="detail-error delete-error">{deleteError}</span>}
            </form>
          )}
        </div>
      </div>

      <div className={`detail-content${viewMode !== VIEW_FOCUS ? " detail-content-wide" : ""}`}>
        <div className="detail-image-container">
          {(canUsePanels || canUseSplit) && (
            <div className="detail-view-toggle" role="group" aria-label="Image layout">
              <button
                type="button"
                className={`btn ${viewMode === VIEW_FOCUS ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setViewMode(VIEW_FOCUS)}
              >
                Focus
              </button>
              {canUsePanels && (
                <button
                  type="button"
                  className={`btn ${viewMode === VIEW_PANELS ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setViewMode(VIEW_PANELS)}
                >
                  Panels
                </button>
              )}
              {canUseSplit && (
                <button
                  type="button"
                  className={`btn ${viewMode === VIEW_SPLIT ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setViewMode(VIEW_SPLIT)}
                >
                  Side view
                </button>
              )}
            </div>
          )}

          {viewMode === VIEW_PANELS ? (
            <div className="panel-mosaic">
              {panelSlots.map((slot) => (
                <button
                  type="button"
                  key={slot.tag}
                  className={`panel-slot${slot.active ? " is-active" : ""}`}
                  onClick={() => {
                    selectPanel(slot.tag);
                    openLightbox(resolveImageUrl(slot.url), slot.tag);
                  }}
                  title={`Open ${slot.tag} full size`}
                >
                  <div className="panel-slot-label">
                    {shortPanelLabel(slot.tag)}
                    {slot.count > 1 ? ` · ${slot.count}` : ""}
                  </div>
                  <div className="panel-slot-frame">
                    <img src={resolveImageUrl(slot.url)} alt={slot.tag} />
                  </div>
                </button>
              ))}
            </div>
          ) : viewMode === VIEW_SPLIT ? (
            <div className="detail-split-view">
              <div className="detail-split-pane">
                <div className="detail-split-label">
                  {currentPanelTag ? shortPanelLabel(currentPanelTag) : "Primary"}
                </div>
                <ZoomableImage
                  src={resolveImageUrl(media[mediaIdx] || image_url)}
                  alt={title}
                  onOpen={() =>
                    openLightbox(resolveImageUrl(media[mediaIdx] || image_url), title)
                  }
                />
              </div>
              <div className="detail-split-pane">
                <div className="detail-split-label">Orientation</div>
                <ZoomableImage
                  src={resolveImageUrl(orientation_image_url)}
                  alt="Orientation reference"
                  onOpen={() =>
                    openLightbox(resolveImageUrl(orientation_image_url), "Orientation reference")
                  }
                />
              </div>
            </div>
          ) : (
            <>
              <ZoomableImage
                src={currentSrc}
                alt={currentAlt}
                onOpen={() => openLightbox(currentSrc, currentAlt)}
              />
              {showOrientation && (
                <div className="media-nav">
                  <span>Orientation Image (reference only)</span>
                </div>
              )}
              {canStepPanelImage && !showOrientation && (
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
              )}
              {media.length > 1 && !showOrientation && (
                <div className="media-thumbs">
                  {panelGroups.map((group) => (
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
                </div>
              )}
            </>
          )}

          <div className="detail-controls">
            {viewMode === VIEW_FOCUS && orientation_image_url && (
              <button
                className={`btn ${showOrientation ? "btn-primary" : "btn-secondary"}`}
                onClick={handleToggleOrientation}
              >
                {showOrientation ? "Show Original" : "View Orientation Image"}
              </button>
            )}
            {viewMode === VIEW_PANELS && (
              <span className="detail-view-hint">Click a panel to open it in Focus</span>
            )}
            {viewMode === VIEW_SPLIT && canStepPanelImage && (
              <div className="media-nav media-nav-inline">
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
            )}
            {viewMode === VIEW_SPLIT && media.length > 1 && (
              <div className="media-thumbs media-thumbs-inline">
                {panelGroups.map((group) => (
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
              </div>
            )}
          </div>
        </div>

        <div className="detail-metadata">
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

          {(image.anomaly_type || image.anomaly_id) && (
            <div className="detail-meta-chips">
              {image.anomaly_type && (
                <span className="ref-card-type">{image.anomaly_type}</span>
              )}
              {image.anomaly_id && (
                <span className="detail-id-chip">{image.anomaly_id}</span>
              )}
            </div>
          )}

          {similarity_score != null && (
            <div className="detail-score">
              <span className="detail-label">Similarity</span>
              <span className="detail-value">{(similarity_score * 100).toFixed(1)}%</span>
            </div>
          )}

          {(panelTags.length > 0 || tags.length > 0) && (
            <div className="detail-meta-block">
              {panelGroups.length > 0 && (
                <div className="panel-tag-row">
                  {panelGroups.map((group) => (
                    <span
                      key={group.tag}
                      className={`badge badge-panel${
                        group.indexes.includes(mediaIdx) && !showOrientation
                          ? " badge-panel-current"
                          : ""
                      }`}
                    >
                      {group.tag}
                      {group.indexes.length > 1 ? ` (${group.indexes.length})` : ""}
                    </span>
                  ))}
                </div>
              )}
              {tags.length > 0 && (
                <div className="panel-tag-row">
                  {tags.map((tag) => (
                    <span key={tag} className="badge">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {orientation_image_url && (
            <div className="orientation-detail">
              <span className="orientation-detail-label">Orientation</span>
              <button
                type="button"
                onClick={() => setViewMode(VIEW_SPLIT)}
                className="orientation-detail-thumb"
                title="Open side-by-side with orientation"
              >
                <img src={resolveImageUrl(orientation_image_url)} alt="Orientation reference" />
              </button>
            </div>
          )}

          <div className="detail-meta-block">
            <div className="detail-meta-heading">Identity</div>
            <dl className="detail-dl">
              <DetailItem label="Identification" value={image.identification} />
              <DetailItem label="Wall Location" value={image.wall_location} />
              <DetailItem label="Crack Angle" value={image.crack_image_angles} />
              <DetailItem
                label="Interacting features"
                value={
                  image.interacts_with_other_features === true
                    ? "Yes"
                    : image.interacts_with_other_features === false
                    ? "No"
                    : null
                }
              />
              <DetailItem label="Pipe Angle" value={image.pipe_angle != null ? `${image.pipe_angle}°` : null} />
            </dl>
            {image.interacts_with_other_features && (image.interaction_related_items || []).length > 0 && (
              <div className="panel-tag-row">
                {image.interaction_related_items.map((item) => (
                  <span key={item} className="badge">{item}</span>
                ))}
              </div>
            )}
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

          {(image.revision_history || []).length > 0 && (
            <div className="detail-meta-block">
              <button
                type="button"
                className="detail-meta-heading detail-revision-toggle"
                onClick={() => setShowRevisions((open) => !open)}
                aria-expanded={showRevisions}
              >
                <span>Revision history</span>
                <span className="detail-revision-toggle-meta">
                  {(image.revision_history || []).length}
                  <span className="detail-revision-arrow" aria-hidden="true">
                    {showRevisions ? "▴" : "▾"}
                  </span>
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
            <span className="detail-meta-footer-label">Image ID</span>
            <span className="detail-meta-footer-value">{image.id}</span>
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
