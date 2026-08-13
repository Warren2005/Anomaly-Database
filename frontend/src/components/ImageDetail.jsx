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
          <div className="result-nav" role="navigation" aria-label="Similar results">
            <button
              type="button"
              className="btn btn-secondary result-nav-btn"
              onClick={onPrev}
              disabled={!hasPrev}
              aria-label="Previous similar result"
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
              aria-label="Next similar result"
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
          <h2>{title}</h2>
          {image.classification_status && (
            <span
              className="badge"
              style={{
                color: statusColor,
                borderColor: statusColor,
                marginBottom: 12,
                display: "inline-block",
              }}
            >
              {image.classification_status}
            </span>
          )}

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

          {orientation_image_url && (
            <div className="orientation-detail">
              <span className="orientation-detail-label">Orientation Image (reference only)</span>
              <button
                type="button"
                onClick={handleToggleOrientation}
                className="orientation-detail-thumb"
              >
                <img src={resolveImageUrl(orientation_image_url)} alt="Orientation reference" />
              </button>
            </div>
          )}

          {similarity_score != null && (
            <div className="detail-score">
              <span className="detail-label">Similarity</span>
              <span className="detail-value">{(similarity_score * 100).toFixed(1)}%</span>
            </div>
          )}

          <table className="detail-table">
            <tbody>
              <DetailRow label="Anomaly ID" value={image.anomaly_id} />
              <DetailRow label="Identification" value={image.identification} />
              <DetailRow label="Pipe Angle" value={image.pipe_angle != null ? `${image.pipe_angle}°` : null} />
              <DetailRow label="Anomaly Type" value={image.anomaly_type} />
              <DetailRow
                label="Interacting with Other Features"
                value={
                  image.interacts_with_other_features === true
                    ? "Yes"
                    : image.interacts_with_other_features === false
                    ? "No"
                    : null
                }
              />
              {image.interacts_with_other_features && (image.interaction_related_items || []).length > 0 && (
                <tr>
                  <td colSpan={2}>
                    <div className="panel-tag-row">
                      {image.interaction_related_items.map((item) => (
                        <span key={item} className="badge">{item}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              <DetailRow label="Run" value={image.run_number} />
              <DetailRow label="ZeroAngle Frame Index" value={image.zero_angle_frame_index} />
              <DetailRow label="Run ID" value={image.anomaly_description} />
              <DetailRow label="Detection signature" value={image.signal_description} />
              <DetailRow
                label="Similar anomalies / differential diagnosis"
                value={image.differential_diagnosis}
              />
              <DetailRow
                label="Limitations / uncertainty"
                value={image.limitations_uncertainty}
              />
              {image.analysis_comment && (
                <DetailRow label="Comments" value={image.analysis_comment} />
              )}
              {image.notes && (
                <DetailRow label="Notes" value={image.notes} />
              )}
              <DetailRow label="Depth (mm)" value={image.depth} />
              <DetailRow label="Width (mm)" value={image.width} />
              <DetailRow label="Length (mm)" value={image.length} />
              {(image.revision_history || []).length > 0 && (
                <>
                  <tr>
                    <td colSpan={2} className="detail-section-divider">Revision History</td>
                  </tr>
                  {[...image.revision_history]
                    .sort((a, b) => a.version - b.version)
                    .map((rev) => (
                      <tr key={rev.version}>
                        <td className="detail-label">V{rev.version}</td>
                        <td className="detail-value">
                          {rev.name} — {new Date(rev.timestamp).toLocaleDateString()}
                          {rev.comment && <div className="revision-comment">{rev.comment}</div>}
                        </td>
                      </tr>
                    ))}
                </>
              )}
              {image.is_qc_flag && (
                <>
                  <tr>
                    <td colSpan={2} className="detail-section-divider">QC Feedback</td>
                  </tr>
                  <DetailRow label="QC Raised By" value={image.qc_raised_by} />
                  <DetailRow label="QC Reviewer" value={image.qc_reviewer} />
                  <DetailRow label="Decision & Rationale" value={image.qc_decision_rationale} />
                </>
              )}
              <DetailRow label="Image ID" value={image.id} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <tr>
      <td className="detail-label">{label}</td>
      <td className="detail-value">{String(value)}</td>
    </tr>
  );
}
