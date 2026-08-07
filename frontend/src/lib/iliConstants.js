/** Shared ILI constants — Zach reference-library taxonomy + statuses */

export const ANOMALY_TYPES = [
  "Metal Loss",
  "Deformation",
  "Crack",
  "Inclusion",
  "Lamination",
  "Girth Weld Anomaly",
  "Seam Weld Anomaly",
  "Dent",
  "Corrosion",
  "Other",
];

export const CLASSIFICATION_STATUS_OPTIONS = [
  "Confirmed",
  "Edge Case",
  "QC-Resolved",
  "Under Discussion",
];

export const DIMENSION_REQUIREMENTS = {
  "Metal Loss": ["depth", "width", "length"],
  Corrosion: ["depth", "width"],
  Crack: ["depth", "length"],
  Deformation: ["depth", "width"],
  Dent: ["depth"],
  Lamination: ["depth"],
  Inclusion: ["depth"],
};

export const STATUS_COLORS = {
  Confirmed: "#34d399",
  "Edge Case": "#fbbf24",
  "QC-Resolved": "#60a5fa",
  "Under Discussion": "#f87171",
};

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/gif",
  "image/webp",
];

/** Panel / view tags — multi-select on Add Entry */
export const PANEL_TAG_OPTIONS = [
  "Image Panel",
  "Beamforming Panel",
];
