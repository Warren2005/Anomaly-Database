import React, { useState, useCallback, useRef, useEffect } from "react";
import { uploadToLibrary, updateLibraryEntry, getRuns, addRun, getFilters, resolveImageUrl } from "../api/client";
import {
  ANOMALY_TYPES,
  CLASSIFICATION_STATUS_OPTIONS,
  DIMENSION_REQUIREMENTS,
  IDENTIFICATION_BY_TYPE,
  IDENTIFICATION_DEFAULTS,
  ACCEPTED_IMAGE_TYPES,
  PANEL_TAG_OPTIONS,
  RUN_OPTIONS,
  RUN_DESCRIPTIONS,
  INTERACTION_OPTIONS,
} from "../lib/iliConstants";

const ADD_NEW_RUN = "__add_new__";

const FALLBACK_RUNS = RUN_OPTIONS.map((run) => ({
  run,
  run_id: RUN_DESCRIPTIONS[run] || "",
}));

const EMPTY_FORM = {
  identification: "",
  anomaly_id: "",
  anomaly_description: "",
  signal_description: "",
  differential_diagnosis: "",
  limitations_uncertainty: "",
  classification_status: "",
  anomaly_type: "",
  run_number: "",
  depth: "",
  width: "",
  length: "",
  notes: "",
  contributor_name: "",
  contributor_comment: "",
  zero_angle_frame_index: "",
  pipe_angle: "",
  is_qc_flag: false,
  qc_raised_by: "",
  qc_reviewer: "",
  qc_decision_rationale: "",
  interacts_with_other_features: "",
};

function formFromImage(image) {
  if (!image) return EMPTY_FORM;
  return {
    identification: image.identification || "",
    anomaly_id: image.anomaly_id || "",
    anomaly_description: image.anomaly_description || "",
    signal_description: image.signal_description || "",
    differential_diagnosis: image.differential_diagnosis || "",
    limitations_uncertainty: image.limitations_uncertainty || "",
    classification_status: image.classification_status || "",
    anomaly_type: image.anomaly_type || "",
    run_number: image.run_number || "",
    depth: image.depth ?? "",
    width: image.width ?? "",
    length: image.length ?? "",
    notes: image.notes || "",
    contributor_name: "",
    contributor_comment: "",
    zero_angle_frame_index: image.zero_angle_frame_index ?? "",
    pipe_angle: image.pipe_angle ?? "",
    is_qc_flag: Boolean(image.is_qc_flag),
    qc_raised_by: image.qc_raised_by || "",
    qc_reviewer: image.qc_reviewer || "",
    qc_decision_rationale: image.qc_decision_rationale || "",
    interacts_with_other_features:
      image.interacts_with_other_features === true
        ? "yes"
        : image.interacts_with_other_features === false
        ? "no"
        : "",
  };
}

function existingMediaFromDetail(detail) {
  if (!detail) return [];
  const urls = detail.media_urls?.length ? detail.media_urls : [detail.image_url];
  const tags = detail.image.panel_tags || [];
  return urls.map((url, i) => ({
    originalIndex: i,
    url,
    panelTag: tags[i] || "",
    removed: false,
  }));
}

export default function LibraryUpload({
  onSuccess,
  onDirtyChange,
  editingImage = null,
  onCancel,
  adminPasskey = null,
  onAuthError = null,
}) {
  const isEditMode = Boolean(editingImage);
  const [initialForm] = useState(() => formFromImage(editingImage?.image));
  const [files, setFiles] = useState([]);
  const [filePanelTags, setFilePanelTags] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [existingMedia, setExistingMedia] = useState(() => existingMediaFromDetail(editingImage));
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [runs, setRuns] = useState(FALLBACK_RUNS);
  const [tagOptions, setTagOptions] = useState([]);
  const [selectedTags, setSelectedTags] = useState(() => editingImage?.image?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [selectedInteractionItems, setSelectedInteractionItems] = useState(
    () => editingImage?.image?.interaction_related_items || []
  );
  const [orientationFile, setOrientationFile] = useState(null);
  const [orientationPreview, setOrientationPreview] = useState(null);
  const [orientationRemoved, setOrientationRemoved] = useState(false);
  const orientationInputRef = useRef(null);
  const [showAddRun, setShowAddRun] = useState(false);
  const [newRunName, setNewRunName] = useState("");
  const [newRunId, setNewRunId] = useState("");
  const [addRunPasskey, setAddRunPasskey] = useState("");
  const [addingRun, setAddingRun] = useState(false);
  const [addRunError, setAddRunError] = useState(null);
  const fileInputRef = useRef(null);

  const requiredDims = DIMENSION_REQUIREMENTS[form.anomaly_type] || [];
  const typeIdentifications = IDENTIFICATION_BY_TYPE[form.anomaly_type] || null;
  const identificationSelectOptions = typeIdentifications
    ? (
      form.identification && !typeIdentifications.includes(form.identification)
        ? [form.identification, ...typeIdentifications]
        : typeIdentifications
    )
    : null;

  const [initialTags] = useState(() => editingImage?.image?.tags || []);

  const isDirty = !success && (
    files.length > 0
    || filePanelTags.some(Boolean)
    || showAddRun
    || existingMedia.some((m) => m.removed)
    || selectedTags.length !== initialTags.length
    || selectedTags.some((t) => !initialTags.includes(t))
    || Boolean(orientationFile)
    || orientationRemoved
    || Object.keys(EMPTY_FORM).some((key) => form[key] !== initialForm[key])
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

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

  useEffect(() => {
    // Growing catalog for Tags — typing a new one here adds it for next time.
    getFilters()
      .then((data) => {
        setTagOptions(data.tags || []);
      })
      .catch(() => {});
  }, []);

  const commitTag = useCallback((raw) => {
    const tag = raw.trim();
    if (!tag) return;
    setSelectedTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]
    );
    setTagOptions((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase())
        ? prev
        : [...prev, tag].sort((a, b) => a.localeCompare(b))
    );
    setTagInput("");
  }, []);

  const removeTag = useCallback((tag) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const toggleInteractionItem = useCallback((item) => {
    setSelectedInteractionItems((prev) =>
      prev.includes(item) ? prev.filter((t) => t !== item) : [...prev, item]
    );
  }, []);

  const existingOrientationUrl =
    !orientationFile && !orientationRemoved ? editingImage?.orientation_image_url : null;

  const handleOrientationPick = (file) => {
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) && !file.type.startsWith("image/")) {
      setError("Please use JPEG, PNG, TIFF, GIF, or WebP for the orientation image.");
      return;
    }
    setOrientationFile(file);
    setOrientationRemoved(false);
    const reader = new FileReader();
    reader.onload = (e) => setOrientationPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const clearOrientation = () => {
    setOrientationFile(null);
    setOrientationPreview(null);
    if (isEditMode && editingImage?.orientation_image_url) {
      setOrientationRemoved(true);
    }
    if (orientationInputRef.current) orientationInputRef.current.value = "";
  };

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
    setFilePanelTags((prev) => [...prev, ...list.map(() => "")]);
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
    setFilePanelTags((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`panel_${idx}`];
      return next;
    });
  };

  const setFilePanelTag = (idx, tag) => {
    setFilePanelTags((prev) => prev.map((t, i) => (i === idx ? tag : t)));
    setFieldErrors((prev) => ({ ...prev, [`panel_${idx}`]: undefined, file: undefined }));
  };

  const removeExistingMedia = (originalIndex) => {
    setExistingMedia((prev) =>
      prev.map((m) => (m.originalIndex === originalIndex ? { ...m, removed: true } : m))
    );
    setFieldErrors((prev) => ({ ...prev, file: undefined }));
  };

  const setExistingPanelTag = (originalIndex, tag) => {
    setExistingMedia((prev) =>
      prev.map((m) => (m.originalIndex === originalIndex ? { ...m, panelTag: tag } : m))
    );
    setFieldErrors((prev) => ({ ...prev, [`existing_${originalIndex}`]: undefined, file: undefined }));
  };

  const survivingExisting = existingMedia.filter((m) => !m.removed);
  const isExistingPrimary = (m) =>
    survivingExisting.length > 0 && survivingExisting[0].originalIndex === m.originalIndex;
  const isNewFilePrimary = (i) => survivingExisting.length === 0 && i === 0;

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
      if (field === "anomaly_type") {
        const opts = IDENTIFICATION_BY_TYPE[value];
        if (opts?.length) {
          if (!opts.includes(prev.identification)) {
            next.identification = IDENTIFICATION_DEFAULTS[value] || opts[0];
          }
        } else if (IDENTIFICATION_BY_TYPE[prev.anomaly_type]) {
          // Leaving a typed dropdown — clear so free-text types start blank
          next.identification = "";
        }
      }
      return next;
    });
    setFieldErrors((prev) => {
      const cleared = { ...prev, [field]: undefined };
      if (field === "anomaly_type") cleared.identification = undefined;
      return cleared;
    });
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

  const validate = () => {
    const errs = {};
    if (!form.anomaly_type) errs.anomaly_type = "Required";
    if (!form.run_number.trim()) errs.run_number = "Required";
    if (!form.identification.trim()) errs.identification = "Required";
    if (!form.anomaly_id.trim()) errs.anomaly_id = "Required";
    if (!form.classification_status) errs.classification_status = "Required";
    if (!form.contributor_name.trim()) errs.contributor_name = "Required";
    if (!form.signal_description.trim()) errs.signal_description = "Required";
    if (!form.differential_diagnosis.trim()) errs.differential_diagnosis = "Required";
    if (!form.limitations_uncertainty.trim()) errs.limitations_uncertainty = "Required";
    if (!form.interacts_with_other_features) errs.interacts_with_other_features = "Required";
    if (form.interacts_with_other_features === "yes" && selectedInteractionItems.length === 0) {
      errs.interaction_related_items = "Select at least one related type/component";
    }
    if (survivingExisting.length + files.length === 0) {
      errs.file = "An anomaly must have at least one image, each tagged with its panel type";
    } else {
      filePanelTags.forEach((tag, i) => {
        if (!tag) errs[`panel_${i}`] = "Select a panel for this image";
      });
      survivingExisting.forEach((m) => {
        if (!m.panelTag) errs[`existing_${m.originalIndex}`] = "Select a panel for this image";
      });
      if (filePanelTags.some((tag) => !tag) || survivingExisting.some((m) => !m.panelTag)) {
        errs.file = "Each image needs a panel tag";
      }
    }
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
    const pipeAngleRaw = String(form.pipe_angle ?? "").trim();
    if (pipeAngleRaw !== "" && !/^\d+(\.\d+)?$/.test(pipeAngleRaw)) {
      errs.pipe_angle = "Numbers only (any decimals)";
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
        signal_description: form.signal_description.trim(),
        differential_diagnosis: form.differential_diagnosis.trim(),
        limitations_uncertainty: form.limitations_uncertainty.trim(),
        depth: form.depth !== "" ? String(form.depth).trim() : undefined,
        width: form.width !== "" ? String(form.width).trim() : undefined,
        length: form.length !== "" ? String(form.length).trim() : undefined,
        zero_angle_frame_index:
          form.zero_angle_frame_index !== ""
            ? String(form.zero_angle_frame_index).trim()
            : undefined,
        pipe_angle: form.pipe_angle !== "" ? String(form.pipe_angle).trim() : undefined,
        is_qc_flag: form.is_qc_flag ? "true" : "false",
        tags: selectedTags.join(","),
        contributor_name: form.contributor_name.trim(),
        interacts_with_other_features: form.interacts_with_other_features === "yes" ? "true" : "false",
        interaction_related_items:
          form.interacts_with_other_features === "yes" ? selectedInteractionItems.join(",") : "",
      };
      delete payload.track;
      delete payload.analysis_comment;
      delete payload.notes;
      if (!form.is_qc_flag) {
        delete payload.qc_raised_by;
        delete payload.qc_reviewer;
        delete payload.qc_decision_rationale;
      }

      if (isEditMode) {
        const removeIndices = existingMedia.filter((m) => m.removed).map((m) => m.originalIndex);
        // Final image order matches the backend: surviving existing first, then new uploads.
        const panelTags = [...survivingExisting.map((m) => m.panelTag), ...filePanelTags];
        const result = await updateLibraryEntry(
          editingImage.image.id,
          {
            newFiles: files,
            panelTags,
            removeIndices,
            newOrientationImage: orientationFile,
            removeOrientationImage: orientationRemoved,
          },
          payload,
          adminPasskey
        );
        // No local "success" screen here — the parent (LibraryBrowser)
        // navigates straight back to the updated detail view, which is
        // itself the confirmation that the save worked.
        if (onSuccess) onSuccess(result);
      } else {
        // Ordered 1:1 with uploaded files (primary first, then extras)
        payload.panel_tags = filePanelTags.join(",");
        const result = await uploadToLibrary(files, payload, orientationFile);
        setSuccess(result);
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      setError(err.message);
      if (err.details?.field) {
        setFieldErrors((prev) => ({ ...prev, [err.details.field]: err.message }));
      }
      if (isEditMode && err.status === 403) onAuthError?.();
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setFilePanelTags([]);
    setPreviews([]);
    setForm(EMPTY_FORM);
    setSelectedTags([]);
    setTagInput("");
    setOrientationFile(null);
    setOrientationPreview(null);
    setOrientationRemoved(false);
    setSuccess(null);
    setError(null);
    setFieldErrors({});
    resetAddRunForm();
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
          <h2 className="library-browser-title">{isEditMode ? "Edit Entry" : "Add Entry"}</h2>
          <p className="library-browser-subtitle">
            {isEditMode
              ? "Update fields or manage this anomaly's images — at least one image must remain"
              : "Add one or more panel screenshots for the same anomaly — each image needs its own panel tag"}
          </p>
        </div>
        {isEditMode && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      <div
        className={`dropzone${isDragging ? " dropzone-active" : ""}${fieldErrors.file ? " has-error" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <p className="dropzone-text">
          {isEditMode ? "Drop more panel images or click to browse" : "Drop multiple panel images or click to browse"}
        </p>
        <p className="dropzone-formats">
          JPEG, PNG, TIFF, GIF, WebP · tag each image with its panel type below
        </p>
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

      {isEditMode && survivingExisting.length > 0 && (
        <div className="media-preview-section">
          <p className="form-hint media-preview-hint">
            Existing images — remove any, or change a panel tag. At least one image must remain.
          </p>
          <div className="media-preview-grid">
            {survivingExisting.map((m) => (
              <div
                key={m.originalIndex}
                className={`preview-card${fieldErrors[`existing_${m.originalIndex}`] ? " preview-card-error" : ""}`}
              >
                <div className="preview-thumb">
                  <img src={resolveImageUrl(m.url)} alt="" />
                  {isExistingPrimary(m) && <span className="preview-primary">Primary</span>}
                  <button
                    type="button"
                    className="remove-img"
                    onClick={() => removeExistingMedia(m.originalIndex)}
                    aria-label="Remove this image"
                  >
                    ✕
                  </button>
                </div>
                <label className="form-label preview-panel-label">
                  Panel <span className="req">*</span>
                </label>
                <select
                  className={`form-select${fieldErrors[`existing_${m.originalIndex}`] ? " has-error-input" : ""}`}
                  value={m.panelTag || ""}
                  onChange={(e) => setExistingPanelTag(m.originalIndex, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">— Select panel —</option>
                  {PANEL_TAG_OPTIONS.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {previews.length > 0 && (
        <div className="media-preview-section">
          <p className="form-hint media-preview-hint">
            {previews.length === 1
              ? "1 new image — choose which panel it is"
              : `${previews.length} new images — choose a panel tag for each`}
            {survivingExisting.length === 0 && ". First image is used for CLIP search (Primary)."}
          </p>
          <div className="media-preview-grid">
            {previews.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className={`preview-card${fieldErrors[`panel_${i}`] ? " preview-card-error" : ""}`}
              >
                <div className="preview-thumb">
                  <img src={p.url} alt={p.name} />
                  {isNewFilePrimary(i) && <span className="preview-primary">Primary</span>}
                  <button type="button" className="remove-img" onClick={() => removeFile(i)}>✕</button>
                </div>
                <label className="form-label preview-panel-label">
                  Panel <span className="req">*</span>
                </label>
                <select
                  className={`form-select${fieldErrors[`panel_${i}`] ? " has-error-input" : ""}`}
                  value={filePanelTags[i] || ""}
                  onChange={(e) => setFilePanelTag(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="">— Select panel —</option>
                  {PANEL_TAG_OPTIONS.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {fieldErrors.file && (
        <p className="add-run-error" style={{ marginTop: "-8px" }}>{fieldErrors.file}</p>
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
            <label className="form-label">Identification <span className="req">*</span></label>
            {identificationSelectOptions ? (
              <select
                className={`form-select${fieldErrors.identification ? " has-error-input" : ""}`}
                value={form.identification}
                onChange={(e) => handleFormChange("identification", e.target.value)}
              >
                {identificationSelectOptions.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <select
                className={`form-select${fieldErrors.identification ? " has-error-input" : ""}`}
                value=""
                disabled
              >
                <option value="">
                  {form.anomaly_type
                    ? "— Options for this type coming soon —"
                    : "— Select Anomaly Type first —"}
                </option>
              </select>
            )}
          </div>
          <div className="form-field">
            <label className="form-label">Anomaly ID <span className="req">*</span></label>
            <input
              className={`form-input${fieldErrors.anomaly_id ? " has-error-input" : ""}`}
              type="text"
              placeholder="Unique ID for this anomaly"
              value={form.anomaly_id}
              onChange={(e) => handleFormChange("anomaly_id", e.target.value)}
              autoComplete="off"
            />
          </div>
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

        <div className="form-field">
          <label className="form-label">Tags <span className="opt">optional</span></label>
          <select
            className="form-select"
            value=""
            onChange={(e) => {
              if (e.target.value) commitTag(e.target.value);
            }}
          >
            <option value="">— Select existing tag —</option>
            {tagOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
          <input
            className="form-input"
            type="text"
            placeholder="Or type a new tag and press Enter"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTag(tagInput);
              }
            }}
            autoComplete="off"
          />
          <p className="form-hint">
            Pick an existing tag above, or type a new one and press Enter — new tags are added for everyone to reuse
          </p>
          {selectedTags.length > 0 && (
            <div className="tag-chip-row">
              {selectedTags.map((t) => (
                <span key={t} className="badge badge-panel tag-chip">
                  {t}
                  <button
                    type="button"
                    className="tag-chip-remove"
                    onClick={() => removeTag(t)}
                    aria-label={`Remove tag ${t}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
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

        <div className="comment-categories">
          <div className="form-field">
            <label className="form-label">
              Detection signature <span className="req">*</span>
            </label>
            <p className="form-hint">
              What the analyst sees in the data; main panels used for identification / sizing
            </p>
            <textarea
              className={`form-textarea${fieldErrors.signal_description ? " has-error-input" : ""}`}
              placeholder='e.g. Clear metal-loss signature on beamforming + image panels'
              value={form.signal_description}
              onChange={(e) => handleFormChange("signal_description", e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Similar anomalies / differential diagnosis <span className="req">*</span>
            </label>
            <p className="form-hint">
              How to distinguish it from other features; main differences
            </p>
            <textarea
              className={`form-textarea${fieldErrors.differential_diagnosis ? " has-error-input" : ""}`}
              placeholder="e.g. Differs from weld anomaly by axial intermittency and depth response"
              value={form.differential_diagnosis}
              onChange={(e) => handleFormChange("differential_diagnosis", e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Limitations / uncertainty <span className="req">*</span>
            </label>
            <p className="form-hint">
              Similarities with other anomalies; uncertainties
            </p>
            <textarea
              className={`form-textarea${fieldErrors.limitations_uncertainty ? " has-error-input" : ""}`}
              placeholder="e.g. May resemble shallow corrosion near threshold; sizing uncertain without…"
              value={form.limitations_uncertainty}
              onChange={(e) => handleFormChange("limitations_uncertainty", e.target.value)}
            />
          </div>
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
          <label className="form-label">
            Interacting with other features? <span className="req">*</span>
          </label>
          <select
            className={`form-select${fieldErrors.interacts_with_other_features ? " has-error-input" : ""}`}
            value={form.interacts_with_other_features}
            onChange={(e) => handleFormChange("interacts_with_other_features", e.target.value)}
          >
            <option value="">— Select —</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        {form.interacts_with_other_features === "yes" && (
          <div className="form-field">
            <label className="form-label">
              Related Anomaly Types / Components <span className="req">*</span>
            </label>
            <div className="tag-chip-row interaction-chip-row">
              {INTERACTION_OPTIONS.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`tag-chip${
                    selectedInteractionItems.includes(item) ? " tag-chip-active" : ""
                  }`}
                  onClick={() => toggleInteractionItem(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            {fieldErrors.interaction_related_items && (
              <p className="add-run-error">{fieldErrors.interaction_related_items}</p>
            )}
          </div>
        )}

        {isEditMode && editingImage?.image?.revision_history?.length > 0 && (
          <div className="form-field revision-history-field">
            <label className="form-label">Revision History</label>
            <ul className="revision-history-list">
              {editingImage.image.revision_history.map((rev) => (
                <li key={rev.version}>
                  <strong>V{rev.version}</strong> — {rev.name} —{" "}
                  {new Date(rev.timestamp).toLocaleDateString()}
                  {rev.comment && <div className="revision-comment">{rev.comment}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-field">
          <label className="form-label">
            {isEditMode ? "Sign this revision" : "Your Name"} <span className="req">*</span>
          </label>
          <input
            className={`form-input${fieldErrors.contributor_name ? " has-error-input" : ""}`}
            type="text"
            placeholder="Your name"
            value={form.contributor_name}
            onChange={(e) => handleFormChange("contributor_name", e.target.value)}
          />
        </div>

        <div className="form-field">
          <label className="form-label">
            Comment <span className="opt">optional</span>
          </label>
          <textarea
            className="form-textarea"
            placeholder={isEditMode ? "What changed and why…" : "e.g. Initial entry"}
            value={form.contributor_comment}
            onChange={(e) => handleFormChange("contributor_comment", e.target.value)}
          />
        </div>

        <div className="form-field orientation-field">
          <label className="form-label">
            Orientation Image <span className="opt">optional — reference only, never used in search</span>
          </label>
          {(orientationPreview || existingOrientationUrl) ? (
            <div className="orientation-preview">
              <img src={orientationPreview || resolveImageUrl(existingOrientationUrl)} alt="Orientation reference" />
              <button
                type="button"
                className="remove-img"
                onClick={clearOrientation}
                aria-label="Remove orientation image"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => orientationInputRef.current?.click()}
            >
              Choose orientation image…
            </button>
          )}
          <input
            ref={orientationInputRef}
            type="file"
            accept="image/jpeg,image/png,image/tiff,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              handleOrientationPick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="form-field pipe-angle-field">
            <label className="form-label">
              Pipe Angle <span className="opt">optional — degrees</span>
            </label>
            <input
              className={`form-input${fieldErrors.pipe_angle ? " has-error-input" : ""}`}
              type="text"
              inputMode="decimal"
              placeholder="e.g. 47.5"
              value={form.pipe_angle}
              onChange={(e) => handleFormChange("pipe_angle", e.target.value)}
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={uploading}
          style={{ alignSelf: "flex-end", minWidth: 140 }}
        >
          {uploading ? "Saving..." : isEditMode ? "Save Changes" : "Save Entry"}
        </button>
      </form>
    </div>
  );
}
