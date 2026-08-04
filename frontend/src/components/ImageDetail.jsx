import React, { useState } from "react";
import { deleteLibraryEntry, getExplainability, resolveImageUrl } from "../api/client";
import { STATUS_COLORS } from "../lib/iliConstants";

export default function ImageDetail({
  result,
  onBack,
  onDeleted,
  backLabel = "Back to Results",
  allowDelete = false,
}) {
  const { image, similarity_score, image_url, media_urls } = result;
  const media = (media_urls && media_urls.length ? media_urls : [image_url]).filter(Boolean);
  const [mediaIdx, setMediaIdx] = useState(0);
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const title =
    image.anomaly_name ||
    image.anomaly_description ||
    image.diagnosis ||
    "Image Details";

  const statusColor = STATUS_COLORS[image.classification_status];

  const handleToggleHeatmap = async () => {
    if (showHeatmap) {
      setShowHeatmap(false);
      return;
    }
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

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteLibraryEntry(image.id);
      if (onDeleted) onDeleted();
      else onBack();
    } catch (err) {
      setError(err.message);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const currentSrc =
    showHeatmap && heatmapUrl
      ? heatmapUrl
      : resolveImageUrl(media[mediaIdx] || image_url);

  return (
    <div className="image-detail">
      <div className="detail-toolbar">
        <button className="btn btn-secondary" onClick={onBack}>
          {backLabel}
        </button>
        {allowDelete && !confirmDelete && (
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete Entry
          </button>
        )}
        {allowDelete && confirmDelete && (
          <div className="delete-confirm">
            <span>Delete this entry permanently?</span>
            <button className="btn btn-danger" disabled={deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Confirm"}
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="detail-content">
        <div className="detail-image-container">
          <img src={currentSrc} alt={title} className="detail-image" />
          {media.length > 1 && !showHeatmap && (
            <div className="media-nav">
              <button
                className="btn btn-secondary"
                disabled={mediaIdx === 0}
                onClick={() => setMediaIdx((i) => i - 1)}
              >
                ‹
              </button>
              <span>{mediaIdx + 1} / {media.length}</span>
              <button
                className="btn btn-secondary"
                disabled={mediaIdx === media.length - 1}
                onClick={() => setMediaIdx((i) => i + 1)}
              >
                ›
              </button>
            </div>
          )}
          {media.length > 1 && !showHeatmap && (
            <div className="media-thumbs">
              {media.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  className={`media-thumb${i === mediaIdx ? " active" : ""}`}
                  onClick={() => setMediaIdx(i)}
                >
                  <img src={resolveImageUrl(url)} alt="" />
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

          {similarity_score != null && (
            <div className="detail-score">
              <span className="detail-label">Similarity</span>
              <span className="detail-value">{(similarity_score * 100).toFixed(1)}%</span>
            </div>
          )}

          <table className="detail-table">
            <tbody>
              <DetailRow label="Anomaly Type" value={image.anomaly_type} />
              <DetailRow label="Run ID" value={image.run_number} />
              <DetailRow label="Description" value={image.anomaly_description} />
              <DetailRow label="Signal Description" value={image.signal_description} />
              <DetailRow label="Comments" value={image.analysis_comment} />
              <DetailRow label="Notes" value={image.notes} />
              <DetailRow label="Depth (mm)" value={image.depth} />
              <DetailRow label="Width (mm)" value={image.width} />
              <DetailRow label="Length (mm)" value={image.length} />
              <DetailRow label="Contributed By" value={image.analyst} />
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
