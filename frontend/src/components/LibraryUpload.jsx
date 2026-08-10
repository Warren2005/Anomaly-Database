import React, { useState, useCallback, useRef, useEffect } from "react";
import { uploadToLibrary, getRuns, addRun } from "../api/client";
import {
  ANOMALY_TYPES,
  CLASSIFICATION_STATUS_OPTIONS,
  DIMENSION_REQUIREMENTS,
  ACCEPTED_IMAGE_TYPES,
  PANEL_TAG_OPTIONS,
  RUN_OPTIONS,
  RUN_DESCRIPTIONS,
} from "../lib/iliConstants";

const ADD_NEW_RUN = "__add_new__";

const FALLBACK_RUNS = RUN_OPTIONS.map((run) => ({
  run,
  run_id: RUN_DESCRIPTIONS[run] || "",
}));

const EMPTY_FORM = {
  anomaly_name: "",
  anomaly_description: "",
  signal_description: "",
  classification_status: "",
  anomaly_type: "",
  run_number: "",
  depth: "",
  width: "",
  length: "",
  analysis_comment: "",
  notes: "",
  analyst: "",
  panel_tags: [],
  zero_angle_frame_index: "",
  is_qc_flag: false,
  qc_raised_by: "",
  qc_reviewer: "",
  qc_decision_rationale: "",
};

export default function LibraryUpload({ onSuccess }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [runs, setRuns] = useState(FALLBACK_RUNS);
  const [showAddRun, setShowAddRun] = useState(false);
  const [newRunName, setNewRunName] = useState("");
  const [newRunId, setNewRunId] = useState("");
  const [addRunPasskey, setAddRunPasskey] = useState("");
  const [addingRun, setAddingRun] = useState(false);
  const [addRunError, setAddRunError] = useState(null);
  const fileInputRef = useRef(null);

  const requiredDims = DIMENSION_REQUIREMENTS[form.anomaly_type] || [];

  const refreshRuns = useCallback(async () => {
    try {
      const data = await getRuns();
      if (Array.isArray(data.runs) && data.runs.length) {
        setRuns(data.runs);
      }
    } catch {
      // Keep fallback catalog if API is unavailable
    }
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  const runIdFor = useCallback(
    (run) => {
      if (!run) return "";
      const hit = runs.find((r) => r.run === run);
      return hit?.run_id || RUN_DESCRIPTIONS[run] || "";
    },
    [runs]
  );

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming || []).filter((f) =>
      ACCEPTED_IMAGE_TYPES.includes(f.type) || f.type.startsWith("image/")
    );
    if (!list.length) {
      setError("Please use JPEG, PNG, TIFF, GIF, or WebP images.");
      return;
    }
    setError(null);
    setSuccess(null);
    setFiles((prev) => [...prev, ...list]);
    list.forEach((f) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviews((prev) => [...prev, { url: e.target.result, name: f.name }]);
      };
      reader.readAsDataURL(f);
    });
  }, []);

  const removeFile = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleFormChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "is_qc_flag" && !value) {
        next.qc_raised_by = "";
        next.qc_reviewer = "";
        next.qc_decision_rationale = "";
      }
      if (field === "run_number") {
        next.anomaly_description = value ? runIdFor(value) : "";
      }
      return next;
    });
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleRunSelect = (value) => {
    if (value === ADD_NEW_RUN) {
      setShowAddRun(true);
      setAddRunError(null);
      return;
    }
    setShowAddRun(false);
    handleFormChange("run_number", value);
  };

  const resetAddRunForm = () => {
    setShowAddRun(false);
    setNewRunName("");
    setNewRunId("");
    setAddRunPasskey("");
    setAddRunError(null);
  };

  const handleAddRun = async (e) => {
    e.preventDefault();
    const run = newRunName.trim();
    const run_id = newRunId.trim();
    if (!run || !run_id) {
      setAddRunError("Run and Run ID are required.");
      return;
    }
    if (!addRunPasskey) {
      setAddRunError("Admin passkey required.");
      return;
    }
    setAddingRun(true);
    setAddRunError(null);
    try {
      const entry = await addRun({ run, run_id }, addRunPasskey);
      await refreshRuns();
      setForm((prev) => ({
        ...prev,
        run_number: entry.run,
        anomaly_description: entry.run_id,
      }));
      resetAddRunForm();
    } catch (err) {
      setAddRunError(err.message || "Failed to add run.");
    } finally {
      setAddingRun(false);
    }
  };

  const togglePanelTag = (tag) => {
    setForm((prev) => {
      const current = prev.panel_tags || [];
      const next = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag];
      return { ...prev, panel_tags: next };
    });
  };

  const validate = () => {
    const errs = {};
    if (!form.anomaly_type) errs.anomaly_type = "Required";
    if (!form.run_number.trim()) errs.run_number = "Required";
    if (!form.anomaly_name.trim()) errs.anomaly_name = "Required";
    if (!form.classification_status) errs.classification_status = "Required";
    if (!form.analyst.trim()) errs.analyst = "Required";
    if (!files.length) errs.file = "At least one image is required";
    for (const dim of ["depth", "width", "length"]) {
      const raw = String(form[dim] ?? "").trim();
      if (raw === "") {
        if (requiredDims.includes(dim)) errs[dim] = "Required for this anomaly type";
        continue;
      }
      // Numbers only — any decimal precision (e.g. 1.234567)
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        errs[dim] = "Numbers only (any decimals)";
      }
    }
    const frameRaw = String(form.zero_angle_frame_index ?? "").trim();
    if (frameRaw !== "" && !/^\d+$/.test(frameRaw)) {
      errs.zero_angle_frame_index = "Whole number only";
    }
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const payload = {
        ...form,
        depth: form.depth !== "" ? String(form.depth).trim() : undefined,
        width: form.width !== "" ? String(form.width).trim() : undefined,
        length: form.length !== "" ? String(form.length).trim() : undefined,
        zero_angle_frame_index:
          form.zero_angle_frame_index !== ""
            ? String(form.zero_angle_frame_index).trim()
            : undefined,
        is_qc_flag: form.is_qc_flag ? "true" : "false",
        panel_tags: (form.panel_tags || []).join(","),
      };
      delete payload.track;
      if (!form.panel_tags?.length) {
        delete payload.panel_tags;
      }
      if (!form.is_qc_flag) {
        delete payload.qc_raised_by;
        delete payload.qc_reviewer;
        delete payload.qc_decision_rationale;
      }
      const result = await uploadToLibrary(files, payload);
      setSuccess(result);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setPreviews([]);
    setForm(EMPTY_FORM);
    setSuccess(null);
    setError(null);
    setFieldErrors({});
  };

  if (success) {
    return (
      <div className="library-upload">
        <div className="upload-success">
          <p style={{ fontSize: "15px", fontWeight: 600 }}>Saved to Library</p>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            Indexed for search and visible in Browse Library.
          </p>
          <button className="btn btn-secondary" onClick={handleReset} style={{ marginTop: "8px" }}>
            Upload Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="library-upload">
      <div className="library-browser-header">
        <div>
          <h2 className="library-browser-title">Add Entry</h2>
          <p className="library-browser-subtitle">
            Contribute a reference example with ILI metadata (under ~5 minutes)
          </p>
        </div>
      </div>

      <div
        className={`dropzone${isDragging ? " dropzone-active" : ""}${fieldErrors.file ? " has-error" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <p className="dropzone-text">Drop images or click to browse</p>
        <p className="dropzone-formats">JPEG, PNG, TIFF, GIF, WebP · multiple files supported</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/tiff,image/gif,image/webp"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {previews.length > 0 && (
        <div className="media-preview-grid">
          {previews.map((p, i) => (
            <div key={`${p.name}-${i}`} className="preview-thumb">
              <img src={p.url} alt={p.name} />
              {i === 0 && <span className="preview-primary">Primary</span>}
              <button type="button" className="remove-img" onClick={() => removeFile(i)}>✕</button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <form className="upload-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Anomaly Type <span className="req">*</span></label>
            <select
              className={`form-select${fieldErrors.anomaly_type ? " has-error-input" : ""}`}
              value={form.anomaly_type}
              onChange={(e) => handleFormChange("anomaly_type", e.target.value)}
            >
              <option value="">— Select Type —</option>
              {ANOMALY_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Run <span className="req">*</span></label>
            <select
              className={`form-select${fieldErrors.run_number ? " has-error-input" : ""}`}
              value={form.run_number}
              onChange={(e) => handleRunSelect(e.target.value)}
            >
              <option value="">— Select Run —</option>
              {runs.map((r) => (
                <option key={r.run} value={r.run}>{r.run}</option>
              ))}
              <option value={ADD_NEW_RUN}>+ Add new run…</option>
            </select>
          </div>
        </div>

        {showAddRun && (
          <div className="add-run-panel">
            <p className="add-run-title">Add a new run (admin passkey required)</p>
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Run</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. ILIT0017"
                  value={newRunName}
                  onChange={(e) => setNewRunName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-field">
                <label className="form-label">Run ID</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. 0AXXXXXXX"
                  value={newRunId}
                  onChange={(e) => setNewRunId(e.target.value)}
                />
              </div>
            </div>
            <div className="form-row add-run-actions">
              <div className="form-field">
                <label className="form-label">Passkey</label>
                <input
                  className="form-input"
                  type="password"
                  placeholder="Admin passkey"
                  value={addRunPasskey}
                  onChange={(e) => setAddRunPasskey(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="add-run-buttons">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={addingRun}
                  onClick={handleAddRun}
                >
                  {addingRun ? "Saving…" : "Save run"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetAddRunForm}
                  disabled={addingRun}
                >
                  Cancel
                </button>
              </div>
            </div>
            {addRunError && <p className="add-run-error">{addRunError}</p>}
          </div>
        )}

        <div className="form-field">
          <label className="form-label">Run ID</label>
          <input
            className="form-input"
            type="text"
            readOnly
            placeholder={form.run_number ? "Unique ID pending for this run" : "Select a Run first"}
            value={form.anomaly_description}
          />
        </div>

        <div className="form-row">
          <div className="form-field">
            <label className="form-label">Anomaly Name <span className="req">*</span></label>
            <input
              className={`form-input${fieldErrors.anomaly_name ? " has-error-input" : ""}`}
              type="text"
              placeholder="Short descriptive name"
              value={form.anomaly_name}
              onChange={(e) => handleFormChange("anomaly_name", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Classification Status <span className="req">*</span></label>
            <select
              className={`form-select${fieldErrors.classification_status ? " has-error-input" : ""}`}
              value={form.classification_status}
              onChange={(e) => handleFormChange("classification_status", e.target.value)}
            >
              <option value="">— Select —</option>
              {CLASSIFICATION_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">
            Panel Tags <span className="opt">multi-select</span>
          </label>
          <div className="tag-multi" role="group" aria-label="Panel tags">
            {PANEL_TAG_OPTIONS.map((tag) => {
              const selected = (form.panel_tags || []).includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`tag-chip${selected ? " tag-chip-active" : ""}`}
                  aria-pressed={selected}
                  onClick={() => togglePanelTag(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
          <p className="form-hint">Select one or more panel types from the ILI viewer (Image, Beamforming, Heatmap, etc.)</p>
        </div>

        <div className="form-field">
          <label className="form-label">
            ZeroAngle Frame Index <span className="opt">optional</span>
          </label>
          <input
            className={`form-input${fieldErrors.zero_angle_frame_index ? " has-error-input" : ""}`}
            type="text"
            inputMode="numeric"
            placeholder="e.g. 1240"
            value={form.zero_angle_frame_index}
            onChange={(e) => handleFormChange("zero_angle_frame_index", e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="form-label">Comments <span className="opt">full-text searchable</span></label>
          <textarea
            className="form-textarea"
            placeholder='Engineering observations — e.g. "axially intermittent", threshold notes'
            value={form.analysis_comment}
            onChange={(e) => handleFormChange("analysis_comment", e.target.value)}
          />
        </div>

        {requiredDims.length > 0 && (
          <div className="dim-callout">
            Mandatory dimensions for {form.anomaly_type}: {requiredDims.join(", ")}
          </div>
        )}

        <div className="form-row form-row-3">
          {["depth", "width", "length"].map((dim) => (
            <div className="form-field" key={dim}>
              <label className="form-label">
                {dim.charAt(0).toUpperCase() + dim.slice(1)} (mm)
                {requiredDims.includes(dim) && <span className="req"> *</span>}
              </label>
              <input
                className={`form-input${fieldErrors[dim] ? " has-error-input" : ""}`}
                type="text"
                inputMode="decimal"
                placeholder="e.g. 12.345"
                value={form[dim]}
                onChange={(e) => handleFormChange(dim, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="qc-section">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.is_qc_flag}
              onChange={(e) => handleFormChange("is_qc_flag", e.target.checked)}
            />
            This entry originated as a QC flag
          </label>
          {form.is_qc_flag && (
            <div className="qc-fields">
              <div className="form-row">
                <div className="form-field">
                  <label className="form-label">QC Raised By</label>
                  <input
                    className="form-input"
                    type="text"
                    value={form.qc_raised_by}
                    onChange={(e) => handleFormChange("qc_raised_by", e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">QC Reviewer</label>
                  <input
                    className="form-input"
                    type="text"
                    value={form.qc_reviewer}
                    onChange={(e) => handleFormChange("qc_reviewer", e.target.value)}
                  />
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">QC Decision &amp; Rationale</label>
                <textarea
                  className="form-textarea"
                  value={form.qc_decision_rationale}
                  onChange={(e) => handleFormChange("qc_decision_rationale", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="form-field">
          <label className="form-label">Contributed By <span className="req">*</span></label>
          <input
            className={`form-input${fieldErrors.analyst ? " has-error-input" : ""}`}
            type="text"
            placeholder="Your name"
            value={form.analyst}
            onChange={(e) => handleFormChange("analyst", e.target.value)}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={uploading}
          style={{ alignSelf: "flex-end", minWidth: 140 }}
        >
          {uploading ? "Saving..." : "Save Entry"}
        </button>
      </form>
    </div>
  );
}
