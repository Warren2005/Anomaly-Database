import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { uploadToLibrary, updateLibraryEntry, getRuns, addRun, getTags, addTag, resolveImageUrl } from "../api/client";
import {
  ANOMALY_TYPES,
  CLASSIFICATION_STATUS_OPTIONS,
  DIMENSION_REQUIREMENTS,
  IDENTIFICATION_BY_TYPE,
  IDENTIFICATION_DEFAULTS,
  ACCEPTED_IMAGE_TYPES,
  PANEL_TAG_OPTIONS,
  loadPanelShortcuts,
  savePanelShortcuts,
  shortcutComboKey,
  isBeamformingPanel,
  canonicalPanelTag,
  canonicalBeamformingType,
  shortcutModeLabel,
  anomalyTypeForBeamformingMode,
  BEAMFORMING_TYPE_OPTIONS,
  METAL_LOSS_BEAMFORMING_MODES,
  CRACK_BEAMFORMING_MODES,
  RUN_OPTIONS,
  RUN_DESCRIPTIONS,
  INTERACTION_OPTIONS,
  WALL_LOCATION_OPTIONS,
  CRACK_IMAGE_ANGLE_OPTIONS,
  IMAGE_QUALITY_GUIDANCE,
} from "../lib/iliConstants";

const ADD_NEW_RUN = "__add_new__";
const ADD_NEW_TAG = "__add_new_tag__";
const CRACK_TYPE = "Crack-like";
const SHORTCUT_REORDER_TYPE = "application/x-ili-shortcut-index";

function shortShortcutLabel(tag) {
  const canonical = canonicalPanelTag(tag);
  return (canonical || "Panel").replace(/ Panel$/i, "").trim();
}

const FIELD_LABELS = {
  anomaly_type: "Anomaly Type",
  run_number: "Run",
  identification: "Identification",
  anomaly_id: "Anomaly ID",
  classification_status: "Classification Status",
  wall_location: "Wall Location",
  crack_image_angles: "Crack Angle",
  contributor_name: "Your Name",
  signal_description: "Detection signature",
  differential_diagnosis: "Similar anomalies / differential diagnosis",
  limitations_uncertainty: "Limitations / uncertainty",
  interacts_with_other_features: "Interacting?",
  interaction_related_items: "Related features",
  file: "Panel image",
  depth: "Depth",
  width: "Width",
  length: "Length",
  zero_angle_frame_index: "ZeroAngle Frame Index",
  pipe_angle: "Pipe Angle",
};

function validationMessages(errs) {
  const messages = [];
  const seen = new Set();
  const add = (text) => {
    if (!seen.has(text)) {
      seen.add(text);
      messages.push(text);
    }
  };
  for (const [key, msg] of Object.entries(errs)) {
    if (key.startsWith("panel_") || key.startsWith("existing_")) {
      add(typeof msg === "string" && !msg.includes("Required") ? msg : "Each image needs a panel tag");
      continue;
    }
    if (key === "file") {
      add(msg);
      continue;
    }
    const label = FIELD_LABELS[key] || key;
    if (msg === "Required" || (typeof msg === "string" && msg.startsWith("Required"))) {
      add(`${label} is required`);
    } else {
      add(`${label}: ${msg}`);
    }
  }
  return messages;
}

const FALLBACK_RUNS = RUN_OPTIONS.map((run) => ({
  run,
  run_id: RUN_DESCRIPTIONS[run] || "",
}));

function shortcutMatchesMedia(shortcut, panelTag, beamType) {
  if ((panelTag || "") !== shortcut.panel) return false;
  if (!isBeamformingPanel(shortcut.panel)) return true;
  return canonicalBeamformingType(beamType) === canonicalBeamformingType(shortcut.mode);
}

function formWithInferredAnomalyType(prev, mode) {
  const inferred = anomalyTypeForBeamformingMode(mode);
  if (!inferred || prev.anomaly_type === inferred) return prev;
  const opts = IDENTIFICATION_BY_TYPE[inferred];
  return {
    ...prev,
    anomaly_type: inferred,
    identification: opts?.includes(prev.identification)
      ? prev.identification
      : (IDENTIFICATION_DEFAULTS[inferred] || opts?.[0] || ""),
    crack_image_angles: inferred === CRACK_TYPE ? prev.crack_image_angles : "",
  };
}

function BeamformingModeSelect({ value, onChange }) {
  const selected = value || "";
  const extra = selected && !BEAMFORMING_TYPE_OPTIONS.includes(selected) ? [selected] : [];
  return (
    <>
      <label className="form-label preview-panel-label">
        Mode <span className="opt">optional</span>
      </label>
      <select
        className="form-select"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">— Select mode —</option>
        {extra.map((type) => (
          <option key={type} value={type}>{type}</option>
        ))}
        <optgroup label="Surface detect">
          {METAL_LOSS_BEAMFORMING_MODES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </optgroup>
        <optgroup label="Crack-like">
          {CRACK_BEAMFORMING_MODES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </optgroup>
      </select>
    </>
  );
}

function ShortcutPickerMenu({ anchorEl, menuRef, minWidth = 200, className = "", children }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!anchorEl) return undefined;
    const gap = 6;
    const margin = 8;
    const needed = Math.min(340, Math.round(window.innerHeight * 0.45));
    const first = anchorEl.getBoundingClientRect();
    const shortfall = first.bottom + gap + needed - (window.innerHeight - margin);
    if (shortfall > 0) {
      const col = anchorEl.closest(".upload-media-col");
      if (col) col.scrollTop += shortfall;
      else window.scrollBy(0, shortfall);
    }

    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - 16);
      let left = r.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      const spaceBelow = Math.max(160, window.innerHeight - r.bottom - gap - margin);
      setPos({
        top: r.bottom + gap,
        left,
        width,
        maxHeight: spaceBelow,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl, minWidth]);

  if (!anchorEl || !pos) return null;
  return createPortal(
    <div
      ref={menuRef}
      className={`panel-shortcut-picker is-portal${className ? ` ${className}` : ""}`}
      role="listbox"
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
    >
      {children}
    </div>,
    document.body
  );
}

const EMPTY_FORM = {
  identification: "",
  anomaly_id: "",
  client_id: "",
  anomaly_description: "",
  signal_description: "",
  differential_diagnosis: "",
  limitations_uncertainty: "",
  classification_status: "",
  anomaly_type: "",
  run_number: "",
  wall_location: "",
  crack_image_angles: "",
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
  interacts_with_other_features: "no",
};

function formFromImage(image) {
  if (!image) return { ...EMPTY_FORM };
  return {
    identification: image.identification || "",
    anomaly_id: image.anomaly_id || "",
    client_id: image.client_id || "",
    anomaly_description: image.anomaly_description || "",
    signal_description: image.signal_description || "",
    differential_diagnosis: image.differential_diagnosis || "",
    limitations_uncertainty: image.limitations_uncertainty || "",
    classification_status: image.classification_status || "",
    anomaly_type: image.anomaly_type || "",
    run_number: image.run_number || "",
    wall_location: image.wall_location || "",
    crack_image_angles: image.crack_image_angles || "",
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
        : "no",
  };
}

function existingMediaFromDetail(detail) {
  if (!detail) return [];
  const urls = detail.media_urls?.length ? detail.media_urls : [detail.image_url];
  const tags = detail.image.panel_tags || [];
  const beamTypes = detail.image.beamforming_types || [];
  return urls.map((url, i) => ({
    originalIndex: i,
    url,
    panelTag: canonicalPanelTag(tags[i] || ""),
    beamformingType: canonicalBeamformingType(beamTypes[i] || ""),
    removed: false,
  }));
}

function existingVideosFromDetail(detail) {
  if (!detail) return [];
  const urls = detail.video_urls || [];
  return urls.map((url, i) => ({
    originalIndex: i,
    url,
    name: `Video ${i + 1}`,
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
  const [fileBeamformingTypes, setFileBeamformingTypes] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [primaryIndex, setPrimaryIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [imageQualityGuideOpen, setImageQualityGuideOpen] = useState(false);
  const [dropTargetIndex, setDropTargetIndex] = useState(null);
  const [reorderFrom, setReorderFrom] = useState(null);
  const reorderFromRef = useRef(null);
  const didReorderRef = useRef(false);
  const [form, setForm] = useState(initialForm);
  const [existingMedia, setExistingMedia] = useState(() => existingMediaFromDetail(editingImage));
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [runs, setRuns] = useState(FALLBACK_RUNS);
  const [tagOptions, setTagOptions] = useState([]);
  const [selectedTags, setSelectedTags] = useState(() => editingImage?.image?.tags || []);
  const [tagSelectValue, setTagSelectValue] = useState("");
  const [selectedInteractionItems, setSelectedInteractionItems] = useState(
    () => editingImage?.image?.interaction_related_items || []
  );
  const [orientationFile, setOrientationFile] = useState(null);
  const [orientationPreview, setOrientationPreview] = useState(null);
  const [orientationRemoved, setOrientationRemoved] = useState(false);
  const orientationInputRef = useRef(null);
  const [videoFiles, setVideoFiles] = useState([]);
  const [existingVideos, setExistingVideos] = useState(() => existingVideosFromDetail(editingImage));
  const videoInputRef = useRef(null);
  const [showAddRun, setShowAddRun] = useState(false);
  const [newRunName, setNewRunName] = useState("");
  const [newRunId, setNewRunId] = useState("");
  const [addRunPasskey, setAddRunPasskey] = useState("");
  const [addingRun, setAddingRun] = useState(false);
  const [addRunError, setAddRunError] = useState(null);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addTagPasskey, setAddTagPasskey] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [addTagError, setAddTagError] = useState(null);
  const [previewLightbox, setPreviewLightbox] = useState(null);
  const [missingFields, setMissingFields] = useState(null);
  const fileInputRef = useRef(null);
  const shortcutInputRef = useRef(null);
  const pendingPanelRef = useRef("");
  const pendingBeamformingRef = useRef("");
  const shortcutPickerRef = useRef(null);
  const pickerAnchorRef = useRef(null);
  const shortcutMenuRef = useRef(null);
  const [panelShortcuts, setPanelShortcuts] = useState(() => loadPanelShortcuts());
  const [shortcutPicker, setShortcutPicker] = useState(null);
  const [shortcutDupError, setShortcutDupError] = useState(null);

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
    || showAddTag
    || existingMedia.some((m) => m.removed)
    || selectedTags.length !== initialTags.length
    || selectedTags.some((t) => !initialTags.includes(t))
    || Boolean(orientationFile)
    || orientationRemoved
    || videoFiles.length > 0
    || existingVideos.some((v) => v.removed)
    || Object.keys(EMPTY_FORM).some((key) => form[key] !== initialForm[key])
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  useEffect(
    () => () => previewsRef.current.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); }),
    []
  );

  useEffect(() => {
    if (!previewLightbox && !missingFields) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (missingFields) setMissingFields(null);
      else setPreviewLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewLightbox, missingFields]);

  const openPreviewLightbox = useCallback((src, label = "") => {
    if (!src) return;
    setPreviewLightbox({ src, label });
  }, []);

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

  const refreshTags = useCallback(async () => {
    try {
      const data = await getTags();
      if (Array.isArray(data.tags)) {
        setTagOptions(data.tags);
      }
    } catch {
      // Keep empty catalog if API is unavailable
    }
  }, []);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  useEffect(() => {
    refreshTags();
  }, [refreshTags]);

  const commitTag = useCallback((raw) => {
    const tag = raw.trim();
    if (!tag) return;
    setSelectedTags((prev) =>
      prev.some((t) => t.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag]
    );
  }, []);

  const removeTag = useCallback((tag) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleTagSelect = (value) => {
    if (value === ADD_NEW_TAG) {
      setTagSelectValue("");
      setShowAddTag(true);
      setAddTagError(null);
      return;
    }
    setTagSelectValue("");
    if (value) commitTag(value);
  };

  const resetAddTagForm = () => {
    setShowAddTag(false);
    setNewTagName("");
    setAddTagPasskey("");
    setAddTagError(null);
  };

  const handleAddTag = async (e) => {
    e.preventDefault();
    const tag = newTagName.trim();
    if (!tag) {
      setAddTagError("Tag is required.");
      return;
    }
    if (!addTagPasskey) {
      setAddTagError("Admin passkey required.");
      return;
    }
    setAddingTag(true);
    setAddTagError(null);
    try {
      const entry = await addTag({ tag }, addTagPasskey);
      await refreshTags();
      commitTag(entry.tag);
      resetAddTagForm();
    } catch (err) {
      setAddTagError(err.message || "Failed to add tag.");
    } finally {
      setAddingTag(false);
    }
  };

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

  const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"];

  const addVideos = (incoming) => {
    const list = Array.from(incoming || []).filter(
      (f) => ACCEPTED_VIDEO_TYPES.includes(f.type) || f.type.startsWith("video/")
    );
    if (!list.length) {
      setError("Please use MP4, MOV, WebM, or AVI for videos.");
      return;
    }
    setError(null);
    setVideoFiles((prev) => [...prev, ...list]);
  };

  const removeVideoFile = (idx) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeExistingVideo = (originalIndex) => {
    setExistingVideos((prev) =>
      prev.map((v) => (v.originalIndex === originalIndex ? { ...v, removed: true } : v))
    );
  };

  const survivingExistingVideos = existingVideos.filter((v) => !v.removed);

  const runIdFor = useCallback(
    (run) => {
      if (!run) return "";
      const hit = runs.find((r) => r.run === run);
      return hit?.run_id || RUN_DESCRIPTIONS[run] || "";
    },
    [runs]
  );

  const addFiles = useCallback((incoming, panelTag = "", beamformingType = "") => {
    const list = Array.from(incoming || []).filter((f) =>
      ACCEPTED_IMAGE_TYPES.includes(f.type) || f.type.startsWith("image/")
    );
    if (!list.length) {
      setError("Please use JPEG, PNG, TIFF, GIF, or WebP images.");
      return;
    }
    setError(null);
    setSuccess(null);
    const tag = canonicalPanelTag(panelTag);
    const mode = isBeamformingPanel(tag) ? canonicalBeamformingType(beamformingType) : "";
    setFiles((prev) => [...prev, ...list]);
    setFilePanelTags((prev) => [...prev, ...list.map(() => tag)]);
    setFileBeamformingTypes((prev) => [...prev, ...list.map(() => mode)]);
    setPreviews((prev) => [
      ...prev,
      ...list.map((f) => ({ url: URL.createObjectURL(f), name: f.name })),
    ]);
    if (mode) {
      setForm((prev) => formWithInferredAnomalyType(prev, mode));
    }
  }, []);

  const removeFile = (idx) => {
    const existingCount = existingMedia.filter((m) => !m.removed).length;
    const combinedIdx = existingCount + idx;
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setFilePanelTags((prev) => prev.filter((_, i) => i !== idx));
    setFileBeamformingTypes((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => {
      if (prev[idx]?.url) URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
    setPrimaryIndex((prev) => {
      if (prev === combinedIdx) return 0;
      if (prev > combinedIdx) return prev - 1;
      return prev;
    });
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[`panel_${idx}`];
      return next;
    });
  };

  const setFilePanelTag = (idx, tag) => {
    setFilePanelTags((prev) => prev.map((t, i) => (i === idx ? tag : t)));
    if (!isBeamformingPanel(tag)) {
      setFileBeamformingTypes((prev) => prev.map((t, i) => (i === idx ? "" : t)));
    }
    setFieldErrors((prev) => ({ ...prev, [`panel_${idx}`]: undefined, file: undefined }));
  };

  const setFileBeamformingType = (idx, type) => {
    setFileBeamformingTypes((prev) => prev.map((t, i) => (i === idx ? type : t)));
    setForm((prev) => formWithInferredAnomalyType(prev, type));
  };

  const removeExistingMedia = (originalIndex) => {
    const before = existingMedia.filter((m) => !m.removed);
    const removedPos = before.findIndex((m) => m.originalIndex === originalIndex);
    setExistingMedia((prev) =>
      prev.map((m) => (m.originalIndex === originalIndex ? { ...m, removed: true } : m))
    );
    if (removedPos >= 0) {
      setPrimaryIndex((prev) => {
        if (prev === removedPos) return 0;
        if (prev > removedPos) return prev - 1;
        return prev;
      });
    }
    setFieldErrors((prev) => ({ ...prev, file: undefined }));
  };

  const setExistingPanelTag = (originalIndex, tag) => {
    setExistingMedia((prev) =>
      prev.map((m) =>
        m.originalIndex === originalIndex
          ? {
              ...m,
              panelTag: tag,
              beamformingType: isBeamformingPanel(tag) ? m.beamformingType : "",
            }
          : m
      )
    );
    setFieldErrors((prev) => ({ ...prev, [`existing_${originalIndex}`]: undefined, file: undefined }));
  };

  const setExistingBeamformingType = (originalIndex, type) => {
    setExistingMedia((prev) =>
      prev.map((m) => (m.originalIndex === originalIndex ? { ...m, beamformingType: type } : m))
    );
    setForm((prev) => formWithInferredAnomalyType(prev, type));
  };

  const survivingExisting = existingMedia.filter((m) => !m.removed);
  const mediaCount = survivingExisting.length + files.length;

  useEffect(() => {
    if (mediaCount === 0) {
      setPrimaryIndex(0);
      return;
    }
    if (primaryIndex >= mediaCount) {
      setPrimaryIndex(0);
    }
  }, [mediaCount, primaryIndex]);

  const isPrimaryAt = (combinedIndex) =>
    mediaCount > 0 && combinedIndex === primaryIndex;

  const setPrimaryAt = (combinedIndex) => {
    if (combinedIndex < 0 || combinedIndex >= mediaCount) return;
    setPrimaryIndex(combinedIndex);
  };

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  const openPanelShortcut = (shortcut) => {
    if (didReorderRef.current) {
      didReorderRef.current = false;
      return;
    }
    pendingPanelRef.current = shortcut.panel;
    pendingBeamformingRef.current = isBeamformingPanel(shortcut.panel) ? shortcut.mode : "";
    shortcutInputRef.current?.click();
  };

  const handleShortcutReorderStart = (e, index) => {
    if (e.target.closest(".panel-shortcut-icon")) {
      e.preventDefault();
      return;
    }
    didReorderRef.current = false;
    reorderFromRef.current = index;
    setReorderFrom(index);
    e.dataTransfer.setData(SHORTCUT_REORDER_TYPE, String(index));
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleShortcutReorderEnd = () => {
    reorderFromRef.current = null;
    setReorderFrom(null);
    setDropTargetIndex(null);
  };

  const handleShortcutDragOver = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isFileDrag(e) ? "copy" : "move";
    setDropTargetIndex(index);
  };

  const handleShortcutDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    e.preventDefault();
    setDropTargetIndex(null);
  };

  const persistShortcuts = (next) => {
    setPanelShortcuts(next);
    savePanelShortcuts(next);
    pickerAnchorRef.current = null;
    setShortcutPicker(null);
  };

  const reorderShortcuts = (from, to) => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
    if (from < 0 || to < 0 || from >= panelShortcuts.length || to >= panelShortcuts.length) return;
    const next = [...panelShortcuts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persistShortcuts(next);
  };

  const handleShortcutDrop = (e, shortcut, index) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetIndex(null);
    if (isFileDrag(e) && e.dataTransfer.files?.length) {
      reorderFromRef.current = null;
      setReorderFrom(null);
      addFiles(
        e.dataTransfer.files,
        shortcut.panel,
        isBeamformingPanel(shortcut.panel) ? shortcut.mode : ""
      );
      return;
    }
    const fromRaw = e.dataTransfer.getData(SHORTCUT_REORDER_TYPE) || e.dataTransfer.getData("text/plain");
    const from = reorderFromRef.current ?? (fromRaw === "" ? NaN : Number(fromRaw));
    reorderFromRef.current = null;
    setReorderFrom(null);
    if (Number.isInteger(from) && from >= 0) {
      didReorderRef.current = from !== index;
      reorderShortcuts(from, index);
    }
  };

  const shortcutAlreadyExists = (panel, mode, exceptIndex = -1) => {
    const key = shortcutComboKey(panel, mode);
    return panelShortcuts.some(
      (s, i) => i !== exceptIndex && shortcutComboKey(s.panel, s.mode) === key
    );
  };

  const warnDuplicateShortcut = () => {
    pickerAnchorRef.current = null;
    setShortcutPicker(null);
    setShortcutDupError("That shortcut already exists.");
  };

  const addPanelShortcut = (panel, mode = "") => {
    if (!panel) {
      setShortcutPicker(null);
      return;
    }
    if (isBeamformingPanel(panel) && shortcutPicker?.mode === "add") {
      pickerAnchorRef.current = pickerAnchorRef.current;
      setShortcutPicker({ mode: "add-beam-mode" });
      return;
    }
    if (shortcutAlreadyExists(panel, mode)) {
      warnDuplicateShortcut();
      return;
    }
    persistShortcuts([...panelShortcuts, { panel, mode: isBeamformingPanel(panel) ? canonicalBeamformingType(mode) : "" }]);
  };

  const addBeamformingShortcut = (mode) => {
    const canonical = canonicalBeamformingType(mode);
    if (shortcutAlreadyExists("Beamforming Panel", canonical)) {
      warnDuplicateShortcut();
      return;
    }
    persistShortcuts([...panelShortcuts, { panel: "Beamforming Panel", mode: canonical }]);
  };

  const replacePanelShortcut = (index, panel) => {
    if (!panel) {
      setShortcutPicker(null);
      return;
    }
    if (isBeamformingPanel(panel)) {
      setShortcutPicker({ mode: "edit-beam-mode", index });
      return;
    }
    if (shortcutAlreadyExists(panel, "", index)) {
      warnDuplicateShortcut();
      return;
    }
    persistShortcuts(
      panelShortcuts.map((s, i) => (i === index ? { panel, mode: "" } : s))
    );
  };

  const replaceBeamformingMode = (index, mode) => {
    const canonical = canonicalBeamformingType(mode);
    if (shortcutAlreadyExists("Beamforming Panel", canonical, index)) {
      warnDuplicateShortcut();
      return;
    }
    persistShortcuts(
      panelShortcuts.map((s, i) =>
        i === index ? { panel: "Beamforming Panel", mode: canonical } : s
      )
    );
  };

  const removePanelShortcut = (index) => {
    persistShortcuts(panelShortcuts.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (!shortcutPicker) return undefined;
    const onPointerDown = (e) => {
      const inBlock = shortcutPickerRef.current?.contains(e.target);
      const inMenu = shortcutMenuRef.current?.contains(e.target);
      if (!inBlock && !inMenu) {
        pickerAnchorRef.current = null;
        setShortcutPicker(null);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        pickerAnchorRef.current = null;
        setShortcutPicker(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shortcutPicker]);

  const toggleShortcutPicker = (next, anchorEl) => {
    const same =
      shortcutPicker &&
      next &&
      shortcutPicker.mode === next.mode &&
      shortcutPicker.index === next.index;
    if (same) {
      pickerAnchorRef.current = null;
      setShortcutPicker(null);
      return;
    }
    pickerAnchorRef.current = anchorEl;
    setShortcutPicker(next);
  };

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
        if (value !== CRACK_TYPE) {
          next.crack_image_angles = "";
        }
      }
      return next;
    });
    setFieldErrors((prev) => {
      const cleared = { ...prev, [field]: undefined };
      if (field === "anomaly_type") {
        cleared.identification = undefined;
        cleared.crack_image_angles = undefined;
      }
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
    if (!form.wall_location) errs.wall_location = "Required";
    if (form.anomaly_type === CRACK_TYPE && !form.crack_image_angles) {
      errs.crack_image_angles = "Required for Crack-like";
    }
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
      setMissingFields(validationMessages(errs));
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
        crack_image_angles:
          form.anomaly_type === CRACK_TYPE ? form.crack_image_angles : "",
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
        const removeVideoIndices = existingVideos.filter((v) => v.removed).map((v) => v.originalIndex);
        const removeIndices = existingMedia.filter((m) => m.removed).map((m) => m.originalIndex);
        // Final image order matches the backend: surviving existing first, then new uploads.
        const panelTags = [
          ...survivingExisting.map((m) => canonicalPanelTag(m.panelTag)),
          ...filePanelTags.map(canonicalPanelTag),
        ];
        const beamformingTypes = [
          ...survivingExisting.map((m) =>
            isBeamformingPanel(m.panelTag) ? canonicalBeamformingType(m.beamformingType) : ""
          ),
          ...filePanelTags.map((tag, i) =>
            isBeamformingPanel(tag) ? canonicalBeamformingType(fileBeamformingTypes[i]) : ""
          ),
        ];
        // Lets the backend detect "someone else changed/deleted this since
        // you opened it" instead of silently overwriting their edit.
        payload.expected_updated_at = editingImage.image.updated_at;
        const result = await updateLibraryEntry(
          editingImage.image.id,
          {
            newFiles: files,
            panelTags,
            beamformingTypes,
            removeIndices,
            primaryIndex,
            newOrientationImage: orientationFile,
            removeOrientationImage: orientationRemoved,
            newVideos: videoFiles,
            removeVideoIndices,
          },
          payload,
          adminPasskey
        );
        // No local "success" screen here — the parent (LibraryBrowser)
        // navigates straight back to the updated detail view, which is
        // itself the confirmation that the save worked.
        if (onSuccess) onSuccess(result);
      } else {
        // Ordered 1:1 with uploaded files; primary_index nominates CLIP primary.
        payload.panel_tags = filePanelTags.map(canonicalPanelTag).join(",");
        payload.beamforming_types = filePanelTags
          .map((tag, i) =>
            isBeamformingPanel(tag) ? canonicalBeamformingType(fileBeamformingTypes[i]) : ""
          )
          .join(",");
        payload.primary_index = String(primaryIndex);
        const result = await uploadToLibrary(files, payload, orientationFile, videoFiles);
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
    previews.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
    setFiles([]);
    setFilePanelTags([]);
    setFileBeamformingTypes([]);
    setPreviews([]);
    setPrimaryIndex(0);
    setForm(EMPTY_FORM);
    setSelectedTags([]);
    setOrientationFile(null);
    setOrientationPreview(null);
    setOrientationRemoved(false);
    setVideoFiles([]);
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
      <div className="upload-landscape">
        <div className="upload-media-col">
          <div className="library-browser-header">
            <div>
              <div className="library-browser-title-row">
                <h2 className="library-browser-title">{isEditMode ? "Edit Entry" : "Add Entry"}</h2>
                <button
                  type="button"
                  className={`info-tip-btn${imageQualityGuideOpen ? " is-open" : ""}`}
                  aria-expanded={imageQualityGuideOpen}
                  aria-controls="image-quality-guidance"
                  title="Image quality standards"
                  onClick={() => setImageQualityGuideOpen((open) => !open)}
                >
                  <span aria-hidden="true">i</span>
                  <span className="sr-only">Image quality standards</span>
                </button>
              </div>
              <p className="library-browser-subtitle">
                {isEditMode
                  ? "Update fields or manage this anomaly's images — at least one image must remain"
                  : "Upload panel screenshots and tag each one."}
              </p>
              {imageQualityGuideOpen && (
                <div id="image-quality-guidance" className="info-tip-panel" role="note">
                  <p className="info-tip-title">Image quality standards</p>
                  <ul className="info-tip-list">
                    {IMAGE_QUALITY_GUIDANCE.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {isEditMode && (
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
          <p className="upload-guidance-note">
            Ensure each panel image contains only that panel's signal field. Don't include content from Nautilus
            that doesn't visibly show the anomaly. This is necessary to avoid noise in the data, which will be
            used for search.
          </p>
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

          <div className="panel-shortcut-block" ref={shortcutPickerRef}>
            <p className="form-hint media-preview-hint">Shortcuts · click or drop to add, drag to rearrange</p>
            <input
              ref={shortcutInputRef}
              type="file"
              accept="image/jpeg,image/png,image/tiff,image/gif,image/webp"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                addFiles(e.target.files, pendingPanelRef.current, pendingBeamformingRef.current);
                pendingPanelRef.current = "";
                pendingBeamformingRef.current = "";
                e.target.value = "";
              }}
            />
            <div className="panel-shortcut-grid">
              {panelShortcuts.map((shortcut, index) => {
                const tag = shortcut.panel;
                const count =
                  files.filter((_, i) => shortcutMatchesMedia(shortcut, filePanelTags[i], fileBeamformingTypes[i])).length +
                  survivingExisting.filter((m) =>
                    shortcutMatchesMedia(shortcut, m.panelTag, m.beamformingType)
                  ).length;
                const short = shortShortcutLabel(tag);
                const isBeam = isBeamformingPanel(tag);
                return (
                  <div
                    key={`${shortcutComboKey(tag, shortcut.mode)}-${index}`}
                    draggable
                    className={`panel-shortcut${reorderFrom === index ? " is-dragging" : ""}${
                      dropTargetIndex === index ? " is-drop-target" : ""
                    }${count > 0 ? " has-images" : ""}${isBeam && shortcut.mode ? " has-mode" : ""}`}
                    onDragStart={(e) => handleShortcutReorderStart(e, index)}
                    onDragEnd={handleShortcutReorderEnd}
                    onDragOver={(e) => handleShortcutDragOver(e, index)}
                    onDragLeave={handleShortcutDragLeave}
                    onDrop={(e) => handleShortcutDrop(e, shortcut, index)}
                  >
                    <div className="panel-shortcut-actions">
                      <button
                        type="button"
                        className="panel-shortcut-icon"
                        title="Change this shortcut"
                        aria-label={`Change ${short} shortcut`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleShortcutPicker({ mode: "edit", index }, e.currentTarget.closest(".panel-shortcut"));
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="panel-shortcut-icon"
                        title="Remove this shortcut"
                        aria-label={`Remove ${short} shortcut`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removePanelShortcut(index);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      className="panel-shortcut-main"
                      onClick={() => openPanelShortcut(shortcut)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openPanelShortcut(shortcut);
                        }
                      }}
                      title={
                        shortcut.mode
                          ? `Add ${tag} · ${shortcut.mode}`
                          : `Add ${tag} image`
                      }
                    >
                      <span className="panel-shortcut-label">{short}</span>
                      <span className="panel-shortcut-hint">
                        {count > 0 ? `${count} added` : "Drop, click, or drag"}
                      </span>
                      {isBeam && shortcut.mode ? (
                        <span className="panel-shortcut-mode">
                          <span className="panel-shortcut-mode-kicker">Mode</span>
                          <span className="panel-shortcut-mode-value">{shortcutModeLabel(shortcut.mode)}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div
                className={`panel-shortcut panel-shortcut-add${
                  shortcutPicker?.mode === "add" || shortcutPicker?.mode === "add-beam-mode" ? " is-open" : ""
                }`}
              >
                <button
                  type="button"
                  className="panel-shortcut-main"
                  onClick={(e) =>
                    toggleShortcutPicker({ mode: "add" }, e.currentTarget.closest(".panel-shortcut"))
                  }
                  title="Add a panel shortcut"
                >
                  <span className="panel-shortcut-label">+ Add shortcut</span>
                  <span className="panel-shortcut-hint">Choose a panel</span>
                </button>
              </div>
            </div>
          </div>

          {isEditMode && survivingExisting.length > 0 && (
            <div className="media-preview-section">
              <p className="form-hint media-preview-hint">
                Existing images — remove any, change a panel tag, or set which is Primary (CLIP search).
              </p>
              <div className="media-preview-grid">
                {survivingExisting.map((m, survivingIdx) => (
                  <div
                    key={m.originalIndex}
                    className={`preview-card${fieldErrors[`existing_${m.originalIndex}`] ? " preview-card-error" : ""}${
                      isPrimaryAt(survivingIdx) ? " preview-card-primary" : ""
                    }`}
                  >
                    <div className="preview-thumb">
                      <button
                        type="button"
                        className="preview-thumb-open"
                        onClick={() =>
                          openPreviewLightbox(
                            resolveImageUrl(m.url),
                            m.panelTag || `Existing image ${m.originalIndex + 1}`
                          )
                        }
                        aria-label="View image larger"
                      >
                        <img src={resolveImageUrl(m.url)} alt="" />
                      </button>
                      {isPrimaryAt(survivingIdx) ? (
                        <span className="preview-primary">Primary</span>
                      ) : (
                        <button
                          type="button"
                          className="preview-make-primary"
                          onClick={() => setPrimaryAt(survivingIdx)}
                        >
                          Make primary
                        </button>
                      )}
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
                    {isBeamformingPanel(m.panelTag) && (
                      <BeamformingModeSelect
                        value={m.beamformingType}
                        onChange={(type) => setExistingBeamformingType(m.originalIndex, type)}
                      />
                    )}
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
                {mediaCount > 1
                  ? ". Click Make primary to choose the CLIP search image."
                  : survivingExisting.length === 0
                  ? ". This image is used for CLIP search (Primary)."
                  : ""}
              </p>
              <div className="media-preview-grid">
                {previews.map((p, i) => {
                  const combinedIdx = survivingExisting.length + i;
                  return (
                  <div
                    key={`${p.name}-${i}`}
                    className={`preview-card${fieldErrors[`panel_${i}`] ? " preview-card-error" : ""}${
                      isPrimaryAt(combinedIdx) ? " preview-card-primary" : ""
                    }`}
                  >
                    <div className="preview-thumb">
                      <button
                        type="button"
                        className="preview-thumb-open"
                        onClick={() =>
                          openPreviewLightbox(p.url, filePanelTags[i] || p.name || `New image ${i + 1}`)
                        }
                        aria-label={`View ${p.name || "image"} larger`}
                      >
                        <img src={p.url} alt={p.name} />
                      </button>
                      {isPrimaryAt(combinedIdx) ? (
                        <span className="preview-primary">Primary</span>
                      ) : (
                        <button
                          type="button"
                          className="preview-make-primary"
                          onClick={() => setPrimaryAt(combinedIdx)}
                        >
                          Make primary
                        </button>
                      )}
                      <button
                        type="button"
                        className="remove-img"
                        onClick={() => removeFile(i)}
                        aria-label="Remove this image"
                      >
                        ✕
                      </button>
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
                    {isBeamformingPanel(filePanelTags[i]) && (
                      <BeamformingModeSelect
                        value={fileBeamformingTypes[i]}
                        onChange={(type) => setFileBeamformingType(i, type)}
                      />
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {fieldErrors.file && (
            <p className="add-run-error">{fieldErrors.file}</p>
          )}

          {error && (
            <div className="error-banner">
              <span>{error}</span>
              <button onClick={() => setError(null)}>Dismiss</button>
            </div>
          )}
        </div>

      <div className="upload-form-col">
      <form className="upload-form" onSubmit={handleSubmit}>
        <div className="form-row form-row-3">
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

        <div className="form-row form-row-3">
          <div className="form-field">
            <label className="form-label">
              Client ID <span className="opt">optional</span>
            </label>
            <input
              className="form-input"
              type="text"
              value={form.client_id}
              onChange={(e) => handleFormChange("client_id", e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="form-field">
            <label className="form-label">Identification <span className="req">*</span></label>
            {identificationSelectOptions ? (
              <select
                className={`form-select${fieldErrors.identification ? " has-error-input" : ""}`}
                value={form.identification}
                onChange={(e) => handleFormChange("identification", e.target.value)}
              >
                {identificationSelectOptions.map((opt) => {
                  const isDefault = IDENTIFICATION_DEFAULTS[form.anomaly_type] === opt;
                  return (
                    <option key={opt} value={opt}>
                      {isDefault ? `${opt} — most common` : opt}
                    </option>
                  );
                })}
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
              value={form.anomaly_id}
              onChange={(e) => handleFormChange("anomaly_id", e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="form-row form-row-3">
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
            <label className="form-label">
              ZeroAngle Frame Index <span className="opt">optional</span>
            </label>
            <input
              className={`form-input${fieldErrors.zero_angle_frame_index ? " has-error-input" : ""}`}
              type="text"
              inputMode="numeric"
              value={form.zero_angle_frame_index}
              onChange={(e) => handleFormChange("zero_angle_frame_index", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="form-label">
              Pipe Angle <span className="opt">optional</span>
            </label>
            <input
              className={`form-input${fieldErrors.pipe_angle ? " has-error-input" : ""}`}
              type="text"
              inputMode="decimal"
              value={form.pipe_angle}
              onChange={(e) => handleFormChange("pipe_angle", e.target.value)}
            />
            {fieldErrors.pipe_angle && (
              <p className="add-run-error">{fieldErrors.pipe_angle}</p>
            )}
          </div>
        </div>

        <div className="segment-controls-row">
          <div className="form-field form-field-grow">
            <label className="form-label">Wall Location <span className="req">*</span></label>
            <div
              className={`segment-box${fieldErrors.wall_location ? " has-error-input" : ""}`}
              role="listbox"
              aria-label="Wall location"
            >
              {WALL_LOCATION_OPTIONS.map((opt, idx) => (
                <React.Fragment key={opt}>
                  {idx > 0 && <span className="segment-divider" aria-hidden="true" />}
                  <button
                    type="button"
                    role="option"
                    aria-selected={form.wall_location === opt}
                    className={`segment-option${
                      form.wall_location === opt ? " is-selected" : ""
                    }`}
                    onClick={() => handleFormChange("wall_location", opt)}
                  >
                    {opt}
                  </button>
                </React.Fragment>
              ))}
            </div>
            {fieldErrors.wall_location && (
              <p className="add-run-error">{fieldErrors.wall_location}</p>
            )}
          </div>

          <div className={`form-field form-field-angles${form.anomaly_type === CRACK_TYPE ? "" : " is-disabled"}`}>
            <label className="form-label">
              Crack Angle
              {form.anomaly_type === CRACK_TYPE
                ? <span className="req"> *</span>
                : <span className="opt"> Crack-like only</span>}
            </label>
            <div
              className={`segment-box segment-box-angles${
                fieldErrors.crack_image_angles ? " has-error-input" : ""
              }`}
              role="listbox"
              aria-label="Crack angle"
              aria-disabled={form.anomaly_type !== CRACK_TYPE}
            >
              {CRACK_IMAGE_ANGLE_OPTIONS.map((opt, idx) => (
                <React.Fragment key={opt}>
                  {idx > 0 && <span className="segment-divider" aria-hidden="true" />}
                  <button
                    type="button"
                    role="option"
                    disabled={form.anomaly_type !== CRACK_TYPE}
                    aria-selected={form.crack_image_angles === opt}
                    className={`segment-option${
                      opt === "+" || opt === "-" ? " segment-option-symbol" : ""
                    }${form.crack_image_angles === opt ? " is-selected" : ""}`}
                    onClick={() => handleFormChange("crack_image_angles", opt)}
                  >
                    {opt}
                  </button>
                </React.Fragment>
              ))}
            </div>
            {fieldErrors.crack_image_angles && (
              <p className="add-run-error">{fieldErrors.crack_image_angles}</p>
            )}
          </div>

          <div className="form-field form-field-interact">
            <label className="form-label">
              Interacting? <span className="req">*</span>
            </label>
            <div
              className={`segment-box segment-box-yesno${
                fieldErrors.interacts_with_other_features ? " has-error-input" : ""
              }`}
              role="listbox"
              aria-label="Interacting with other features"
            >
              <button
                type="button"
                role="option"
                aria-selected={form.interacts_with_other_features === "yes"}
                className={`segment-option${
                  form.interacts_with_other_features === "yes" ? " is-selected" : ""
                }`}
                onClick={() => handleFormChange("interacts_with_other_features", "yes")}
              >
                Yes
              </button>
              <span className="segment-divider" aria-hidden="true" />
              <button
                type="button"
                role="option"
                aria-selected={form.interacts_with_other_features === "no"}
                className={`segment-option${
                  form.interacts_with_other_features === "no" ? " is-selected" : ""
                }`}
                onClick={() => {
                  handleFormChange("interacts_with_other_features", "no");
                  setSelectedInteractionItems([]);
                }}
              >
                No
              </button>
            </div>
            {fieldErrors.interacts_with_other_features && (
              <p className="add-run-error">{fieldErrors.interacts_with_other_features}</p>
            )}
          </div>
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
                value={form[dim]}
                onChange={(e) => handleFormChange(dim, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="comment-categories">
          <div className="form-field">
            <label className="form-label">
              Detection signature <span className="req">*</span>
            </label>
            <textarea
              className={`form-textarea${fieldErrors.signal_description ? " has-error-input" : ""}`}
              value={form.signal_description}
              onChange={(e) => handleFormChange("signal_description", e.target.value)}
              placeholder={"Describe the anomaly appearance in each relevant panel. Example:\nImage Panel: …\nFluid Flood: …\nComplex L-L: …"}
              rows={4}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Similar anomalies / differential diagnosis <span className="req">*</span>
            </label>
            <textarea
              className={`form-textarea${fieldErrors.differential_diagnosis ? " has-error-input" : ""}`}
              value={form.differential_diagnosis}
              onChange={(e) => handleFormChange("differential_diagnosis", e.target.value)}
              placeholder="Identify features this finding could be confused with and the criteria used to differentiate them (for example, SSWC)."
              rows={4}
            />
          </div>

          <div className="form-field">
            <label className="form-label">
              Limitations / uncertainty <span className="req">*</span>
            </label>
            <textarea
              className={`form-textarea${fieldErrors.limitations_uncertainty ? " has-error-input" : ""}`}
              value={form.limitations_uncertainty}
              onChange={(e) => handleFormChange("limitations_uncertainty", e.target.value)}
              placeholder="State classification confidence as High, Medium, or Low, and briefly justify the factors that support that rating."
              rows={4}
            />
          </div>
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

        {isEditMode && editingImage?.image?.revision_history?.length > 0 && (
          <div className="form-field revision-history-field">
            <label className="form-label">Revision History</label>
            <ul className="revision-history-list">
              {[...editingImage.image.revision_history]
                .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))
                .map((rev) => (
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
            Comment <span className="opt">optional</span>
          </label>
          <textarea
            className="form-textarea"
            value={form.contributor_comment}
            onChange={(e) => handleFormChange("contributor_comment", e.target.value)}
          />
        </div>

        <div className="form-field orientation-field">
          <label className="form-label">
            Orientation Image <span className="opt">optional</span>
          </label>
          {(orientationPreview || existingOrientationUrl) ? (
            <div className="orientation-preview">
              <button
                type="button"
                className="orientation-preview-open"
                onClick={() =>
                  openPreviewLightbox(
                    orientationPreview || resolveImageUrl(existingOrientationUrl),
                    "Orientation reference"
                  )
                }
                aria-label="View orientation image larger"
              >
                <img
                  src={orientationPreview || resolveImageUrl(existingOrientationUrl)}
                  alt="Orientation reference"
                />
              </button>
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
        </div>

        <div className="form-field videos-field">
          <label className="form-label">
            Videos <span className="opt">optional — multiple allowed</span>
          </label>
          {(survivingExistingVideos.length > 0 || videoFiles.length > 0) && (
            <ul className="video-list">
              {survivingExistingVideos.map((v) => (
                <li key={`existing-${v.originalIndex}`} className="video-list-item">
                  <a
                    href={resolveImageUrl(v.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="video-list-link"
                  >
                    {v.name}
                  </a>
                  <button
                    type="button"
                    className="remove-img video-list-remove"
                    onClick={() => removeExistingVideo(v.originalIndex)}
                    aria-label={`Remove ${v.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {videoFiles.map((f, i) => (
                <li key={`new-${i}`} className="video-list-item">
                  <span className="video-list-link video-list-pending">{f.name}</span>
                  <button
                    type="button"
                    className="remove-img video-list-remove"
                    onClick={() => removeVideoFile(i)}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => videoInputRef.current?.click()}
          >
            Add video…
          </button>
          <p className="form-hint">
            Not played inline — open the link above to play/download it wherever it's saved.
          </p>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addVideos(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="form-footer-signature">
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Tags <span className="opt">optional</span></label>
              <select
                className="form-select"
                value={tagSelectValue}
                onChange={(e) => handleTagSelect(e.target.value)}
              >
                <option value="">— Choose tag —</option>
                {tagOptions
                  .filter((opt) => !selectedTags.some((t) => t.toLowerCase() === opt.toLowerCase()))
                  .map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                <option value={ADD_NEW_TAG}>+ Add new tag…</option>
              </select>
              {showAddTag && (
                <div className="add-run-panel">
                  <p className="add-run-title">Add a new tag (admin passkey required)</p>
                  <div className="form-row add-run-actions">
                    <div className="form-field">
                      <label className="form-label">Tag</label>
                      <input
                        className="form-input"
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="form-field">
                      <label className="form-label">Passkey</label>
                      <input
                        className="form-input"
                        type="password"
                        value={addTagPasskey}
                        onChange={(e) => setAddTagPasskey(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <div className="add-run-buttons">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={addingTag}
                        onClick={handleAddTag}
                      >
                        {addingTag ? "Saving…" : "Save tag"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={resetAddTagForm}
                        disabled={addingTag}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  {addTagError && <p className="add-run-error">{addTagError}</p>}
                </div>
              )}
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
                {isEditMode ? "Sign this revision" : "Your Name"} <span className="req">*</span>
              </label>
              <input
                className={`form-input${fieldErrors.contributor_name ? " has-error-input" : ""}`}
                type="text"
                value={form.contributor_name}
                onChange={(e) => handleFormChange("contributor_name", e.target.value)}
              />
            </div>
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
      </div>

      {missingFields && (
        <div
          className="leave-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="missing-fields-title"
          onClick={() => setMissingFields(null)}
        >
          <div className="leave-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="missing-fields-title">Can’t save yet</h3>
            <p>Fix these issues before saving:</p>
            <ul className="missing-fields-list">
              {missingFields.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <div className="leave-confirm-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMissingFields(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {shortcutPicker && (
        <ShortcutPickerMenu
          anchorEl={pickerAnchorRef.current}
          menuRef={shortcutMenuRef}
          minWidth={
            shortcutPicker.mode === "add-beam-mode" || shortcutPicker.mode === "edit-beam-mode" || shortcutPicker.mode === "edit"
              ? 420
              : 200
          }
          className={
            shortcutPicker.mode === "add-beam-mode" || shortcutPicker.mode === "edit-beam-mode"
              ? "panel-shortcut-mode-picker"
              : ""
          }
        >
          {shortcutPicker.mode === "add" &&
            PANEL_TAG_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                onClick={() => addPanelShortcut(option)}
              >
                {shortShortcutLabel(option)}
              </button>
            ))}
          {shortcutPicker.mode === "edit" && (
            <>
              <p className="panel-shortcut-picker-group">Panel</p>
              {PANEL_TAG_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  className={panelShortcuts[shortcutPicker.index]?.panel === option ? "is-selected" : ""}
                  onClick={() => replacePanelShortcut(shortcutPicker.index, option)}
                >
                  {shortShortcutLabel(option)}
                </button>
              ))}
              {isBeamformingPanel(panelShortcuts[shortcutPicker.index]?.panel) && (
                <>
                  <p className="panel-shortcut-picker-group">Mode</p>
                  {["", ...BEAMFORMING_TYPE_OPTIONS].map((type) => (
                    <button
                      key={type || "no-mode"}
                      type="button"
                      role="option"
                      className={
                        canonicalBeamformingType(panelShortcuts[shortcutPicker.index]?.mode) === type
                          ? "is-selected"
                          : ""
                      }
                      onClick={() => replaceBeamformingMode(shortcutPicker.index, type)}
                    >
                      {type || "No mode"}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
          {(shortcutPicker.mode === "add-beam-mode" || shortcutPicker.mode === "edit-beam-mode") && (
            <>
              <p className="panel-shortcut-picker-group">Surface detect</p>
              {METAL_LOSS_BEAMFORMING_MODES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="option"
                  onClick={() =>
                    shortcutPicker.mode === "edit-beam-mode"
                      ? replaceBeamformingMode(shortcutPicker.index, type)
                      : addBeamformingShortcut(type)
                  }
                >
                  {type}
                </button>
              ))}
              <p className="panel-shortcut-picker-group">Crack-like</p>
              {CRACK_BEAMFORMING_MODES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="option"
                  onClick={() =>
                    shortcutPicker.mode === "edit-beam-mode"
                      ? replaceBeamformingMode(shortcutPicker.index, type)
                      : addBeamformingShortcut(type)
                  }
                >
                  {type}
                </button>
              ))}
              <button
                type="button"
                role="option"
                onClick={() =>
                  shortcutPicker.mode === "edit-beam-mode"
                    ? replaceBeamformingMode(shortcutPicker.index, "")
                    : addBeamformingShortcut("")
                }
              >
                No mode
              </button>
            </>
          )}
        </ShortcutPickerMenu>
      )}

      {shortcutDupError && (
        <div
          className="leave-confirm-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="shortcut-dup-title"
          onClick={() => setShortcutDupError(null)}
        >
          <div className="leave-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="shortcut-dup-title">Shortcut already exists</h3>
            <p>{shortcutDupError} Pick a different panel or mode.</p>
            <div className="leave-confirm-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShortcutDupError(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {previewLightbox && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={previewLightbox.label || "Image preview"}
          onClick={() => setPreviewLightbox(null)}
        >
          <button
            type="button"
            className="image-lightbox-close"
            onClick={() => setPreviewLightbox(null)}
            aria-label="Close image preview"
          >
            ✕
          </button>
          <div className="image-lightbox-stage">
            <img
              src={previewLightbox.src}
              alt={previewLightbox.label || "Uploaded image"}
              className="image-lightbox-image"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {previewLightbox.label && (
            <span className="image-lightbox-hint">{previewLightbox.label}</span>
          )}
        </div>
      )}
    </div>
  );
}
