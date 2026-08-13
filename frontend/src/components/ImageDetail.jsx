import React, { useEffect, useState } from "react";
import { deleteLibraryEntry, getExplainability, resolveImageUrl } from "../api/client";
import { STATUS_COLORS } from "../lib/iliConstants";
import ZoomableImage from "./ZoomableImage";

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
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showOrientation, setShowOrientation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);

  const canNavigate = typeof currentIndex === "number" && totalCount > 0 && (onPrev || onNext);
  const hasPrev = canNavigate && currentIndex > 0 && typeof onPrev === "function";
  const hasNext = canNavigate && currentIndex < totalCount - 1 && typeof onNext === "function";
  const panelTags = Array.isArray(image.panel_tags) ? image.panel_tags : [];
  const tags = Array.isArray(image.tags) ? image.tags : [];
  // Panel-scoped search results carry a single image_url (possibly a
  // non-primary media file) plus media_index saying which panel_tags slot
  // it actually is — falls back to mediaIdx for the browse/detail flow,
  // where media_urls holds every image in panel_tags order already.
  const currentPanelTag =
    panelTags[typeof media_index === "number" ? media_index : mediaIdx];

  // Reset per-image UI state when navigating to another similar result
  useEffect(() => {
    setMediaIdx(0);
    setHeatmapUrl(null);
    setShowHeatmap(false);
    setShowOrientation(false);
    setError(null);
    setConfirmDelete(false);
    setDeleteError(null);
    setUnlockInput("");
    setUnlocking(false);
    setUnlockError(null);
  }, [image.id]);

  useEffect(() => {
    if (!canNavigate) return undefined;

    const onKeyDown = (e) => {
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
  }, [canNavigate, hasPrev, hasNext, onPrev, onNext]);

  const title =
    image.identification ||
    image.anomaly_description ||
    image.diagnosis ||
    "Image Details";

  const statusColor = STATUS_COLORS[image.classification_status];

  const handleToggleHeatmap = async () => {
    if (showHeatmap) {
      setShowHeatmap(false);
      return;
    }
    setShowOrientation(false);
    if (heatmapUrl) {
      setShowHeatmap(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = await getExplainability(image.id);
      setHeatmapUrl(url);
      setShowHeatmap(true);
    } catch (err) {
      setError("Failed to generate attention map");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleOrientation = () => {
    setShowOrientation((prev) => !prev);
    setShowHeatmap(false);
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

  const currentSrc =
    showOrientation && orientation_image_url
      ? resolveImageUrl(orientation_image_url)
      : showHeatmap && heatmapUrl
      ? heatmapUrl
      : resolveImageUrl(media[mediaIdx] || image_url);
  const currentAlt = showOrientation ? "Orientation reference" : title;

  return (
    <div className="image-detail">
      <div className="detail-toolbar">
        <button className="btn btn-secondary" onClick={onBack}>
          {backLabel}
        </button>

        {canNavigate && (
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
        )}

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
            {unlockError && <span className="heatmap-error delete-error">{unlockError}</span>}
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
            {deleteError && <span className="heatmap-error delete-error">{deleteError}</span>}
          </form>
        )}
      </div>

      <div className="detail-content">
        <div className="detail-image-container">
          <ZoomableImage src={currentSrc} alt={currentAlt} />
          {showOrientation && (
            <div className="media-nav">
              <span>Orientation Image (reference only)</span>
            </div>
          )}
          {media.length > 1 && !showHeatmap && !showOrientation && (
            <div className="media-nav">
              <button
                className="btn btn-secondary"
                disabled={mediaIdx === 0}
                onClick={() => setMediaIdx((i) => i - 1)}
              >
                ‹
              </button>
              <span>
                {mediaIdx + 1} / {media.length}
                {currentPanelTag ? ` · ${currentPanelTag}` : ""}
              </span>
              <button
                className="btn btn-secondary"
                disabled={mediaIdx === media.length - 1}
                onClick={() => setMediaIdx((i) => i + 1)}
              >
                ›
              </button>
            </div>
          )}
          {currentPanelTag && !showOrientation && (
            <div className="panel-tag-row current-panel-tag">
              <span className="badge badge-panel">{currentPanelTag}</span>
            </div>
          )}
          {media.length > 1 && !showHeatmap && !showOrientation && (
            <div className="media-thumbs">
              {media.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  className={`media-thumb${i === mediaIdx ? " active" : ""}`}
                  onClick={() => setMediaIdx(i)}
                  title={panelTags[i] || `Image ${i + 1}`}
                >
                  <img src={resolveImageUrl(url)} alt="" />
                  {panelTags[i] && (
                    <span className="media-thumb-tag">{panelTags[i].replace(/ Panel$/, "")}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="heatmap-controls">
            <button
              className={`btn ${showHeatmap ? "btn-primary" : "btn-secondary"}`}
              onClick={handleToggleHeatmap}
              disabled={loading}
            >
              {loading ? "Generating..." : showHeatmap ? "Show Original" : "Show Attention Map"}
            </button>
            {orientation_image_url && (
              <button
                className={`btn ${showOrientation ? "btn-primary" : "btn-secondary"}`}
                onClick={handleToggleOrientation}
              >
                {showOrientation ? "Show Original" : "View Orientation Image"}
              </button>
            )}
            {error && <span className="heatmap-error">{error}</span>}
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

          {(panelTags.length > 1 || tags.length > 0) && (
            <div className="detail-meta-block">
              {panelTags.length > 1 && (
                <div className="panel-tag-row">
                  {panelTags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="badge badge-panel">
                      {i + 1}. {tag}
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
                onClick={handleToggleOrientation}
                className="orientation-detail-thumb"
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
              <DetailItem label="Image Angles" value={image.crack_image_angles} />
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
              <div className="detail-meta-heading">Revision history</div>
              <ul className="detail-revision-list">
                {[...image.revision_history]
                  .sort((a, b) => a.version - b.version)
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
