// Auto-detect API URL: in Electron (file: protocol) use localhost, in browser (nginx proxy) use relative path
const isElectron = typeof window !== "undefined" && window.location.protocol === "file:";
const BASE_URL = isElectron ? "http://localhost:8000/api/v1" : "/api/v1";

// Resolve image proxy paths returned by the backend (/api/v1/images/{id}/file).
// In Electron the path must be absolute since there's no server to resolve it against.
export function resolveImageUrl(url) {
  if (isElectron && url && url.startsWith("/")) {
    return `http://localhost:8000${url}`;
  }
  return url;
}

export async function searchSimilar(file, filters = {}) {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams();
  params.set("limit", "50");
  if (filters.diagnosis) params.set("diagnosis", filters.diagnosis);
  if (filters.tissue_type) params.set("tissue_type", filters.tissue_type);
  if (filters.benign_malignant)
    params.set("benign_malignant", filters.benign_malignant);
  if (filters.panel_tag) params.set("panel_tag", filters.panel_tag);

  const url = `${BASE_URL}/search/similar?${params.toString()}`;

  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Search failed: ${response.status}`
    );
  }
  return response.json();
}

export async function getImageDetail(imageId) {
  const response = await fetch(`${BASE_URL}/images/${imageId}`);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  return response.json();
}

export async function getFilters() {
  const response = await fetch(`${BASE_URL}/images/filters`);
  if (!response.ok) throw new Error(`Failed to fetch filters: ${response.status}`);
  return response.json();
}

export async function browseLibrary(filters = {}) {
  const params = new URLSearchParams();
  if (Array.isArray(filters.anomaly_types) && filters.anomaly_types.length) {
    params.set("anomaly_types", filters.anomaly_types.join(","));
  } else if (filters.anomaly_type) {
    params.set("anomaly_type", filters.anomaly_type);
  }
  if (filters.run_number) params.set("run_number", filters.run_number);
  if (filters.anomaly_status) params.set("anomaly_status", filters.anomaly_status);
  if (filters.classification_status) {
    params.set("classification_status", filters.classification_status);
  }
  if (Array.isArray(filters.panel_tags) && filters.panel_tags.length) {
    params.set("panel_tags", filters.panel_tags.join(","));
  }
  if (Array.isArray(filters.identifications) && filters.identifications.length) {
    params.set("identifications", filters.identifications.join(","));
  }
  if (Array.isArray(filters.wall_locations) && filters.wall_locations.length) {
    params.set("wall_locations", filters.wall_locations.join(","));
  }
  if (filters.interacts_with_other_features === true || filters.interacts_with_other_features === false) {
    params.set("interacts_with_other_features", String(filters.interacts_with_other_features));
  }
  if (filters.q) params.set("q", filters.q);
  for (const key of [
    "depth_min", "depth_max", "width_min", "width_max", "length_min", "length_max",
  ]) {
    if (filters[key] !== "" && filters[key] != null) params.set(key, filters[key]);
  }

  const qs = params.toString();
  const response = await fetch(`${BASE_URL}/library/browse${qs ? `?${qs}` : ""}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Browse failed: ${response.status}`
    );
  }
  return response.json();
}

export async function deleteLibraryEntry(imageId, passkey) {
  const response = await fetch(`${BASE_URL}/library/${imageId}`, {
    method: "DELETE",
    headers: { "X-Delete-Passkey": passkey ?? "" },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err?.error?.message || `Delete failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function verifyPasskey(passkey) {
  const response = await fetch(`${BASE_URL}/library/verify-passkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passkey }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || "Incorrect passkey.");
  }
  return true;
}

export async function getRuns() {
  const response = await fetch(`${BASE_URL}/library/runs`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Failed to load runs: ${response.status}`
    );
  }
  return response.json();
}

export async function addRun({ run, run_id }, passkey) {
  const response = await fetch(`${BASE_URL}/library/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Delete-Passkey": passkey ?? "",
    },
    body: JSON.stringify({ run, run_id }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Failed to add run: ${response.status}`
    );
  }
  return response.json();
}

export async function getTags() {
  const response = await fetch(`${BASE_URL}/library/tags`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Failed to load tags: ${response.status}`
    );
  }
  return response.json();
}

export async function addTag({ tag }, passkey) {
  const response = await fetch(`${BASE_URL}/library/tags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Delete-Passkey": passkey ?? "",
    },
    body: JSON.stringify({ tag }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Failed to add tag: ${response.status}`
    );
  }
  return response.json();
}

export async function searchByText(query, filters = {}) {
  const body = { query, top_k: 50 };
  if (filters.diagnosis) body.diagnosis = filters.diagnosis;
  if (filters.tissue_type) body.tissue_type = filters.tissue_type;
  if (filters.benign_malignant) body.benign_malignant = filters.benign_malignant;

  const response = await fetch(`${BASE_URL}/search/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error?.error?.message || `Text search failed: ${response.status}`
    );
  }
  return response.json();
}

export function createSearchWebSocket(onMessage, onError) {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsHost = isElectron ? "localhost:8000" : window.location.host;
  const ws = new WebSocket(`${wsProtocol}//${wsHost}/api/v1/ws/search`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onMessage(data);
  };
  ws.onerror = (err) => {
    if (onError) onError(err);
  };

  return ws;
}

export async function checkHealth() {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
  return response.json();
}

export async function uploadToLibrary(files, metadata, orientationImage, videos = []) {
  const form = new FormData();
  const list = Array.isArray(files) ? files : [files];
  list.forEach((f) => form.append("files", f));
  // Reference-only image — a completely separate field from `files`, so
  // it's structurally impossible for it to end up as searchable media.
  if (orientationImage) form.append("orientation_image", orientationImage);
  // Supporting video clips — same idea: a separate field, playback only,
  // never touched by the search/embedding pipeline.
  videos.forEach((v) => form.append("videos", v));
  Object.entries(metadata).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") form.append(k, v);
  });
  const response = await fetch(`${BASE_URL}/library/upload`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err?.error?.message || `Upload failed: ${response.status}`);
    error.details = err?.error?.details;
    throw error;
  }
  return response.json();
}

export async function updateLibraryEntry(
  imageId,
  {
    newFiles = [],
    panelTags = [],
    beamformingTypes = [],
    removeIndices = [],
    primaryIndex = 0,
    newOrientationImage = null,
    removeOrientationImage = false,
    newVideos = [],
    removeVideoIndices = [],
  } = {},
  metadata,
  passkey
) {
  const form = new FormData();
  newFiles.forEach((f) => form.append("new_files", f));
  if (panelTags.length) form.append("panel_tags", panelTags.join(","));
  form.append("beamforming_types", beamformingTypes.join(","));
  if (removeIndices.length) form.append("remove_media", removeIndices.join(","));
  form.append("primary_index", String(primaryIndex ?? 0));
  if (newOrientationImage) form.append("new_orientation_image", newOrientationImage);
  if (removeOrientationImage) form.append("remove_orientation_image", "true");
  newVideos.forEach((v) => form.append("new_videos", v));
  if (removeVideoIndices.length) form.append("remove_videos", removeVideoIndices.join(","));
  // Unlike upload, every field is sent even when blank — an edit form
  // always resends the current value, and a genuinely blank value means
  // "clear this field," not "wasn't provided" (see library.py's _resolved).
  Object.entries(metadata).forEach(([k, v]) => {
    if (v === undefined) return;
    form.append(k, v === null ? "" : String(v));
  });
  const response = await fetch(`${BASE_URL}/library/${imageId}`, {
    method: "PUT",
    headers: { "X-Delete-Passkey": passkey ?? "" },
    body: form,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const error = new Error(err?.error?.message || `Update failed: ${response.status}`);
    error.details = err?.error?.details;
    error.status = response.status;
    throw error;
  }
  return response.json();
}
