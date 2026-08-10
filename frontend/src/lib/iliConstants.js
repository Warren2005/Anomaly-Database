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

/** Panel / view tags — multi-select on Add Entry (matches ILI Open Panel types) */
export const PANEL_TAG_OPTIONS = [
  "Beamforming Panel",
  "Raw Panel",
  "Plot Panel",
  "Image Panel",
  "Heatmap Panel",
  "Multi Section Panel",
  "Cross-Section Panel",
  "Dent Sizing Panel",
  "Tool Pose Panel",
];

/** Past ILI runs available in Add Entry (newest first, including sub-runs) */
export const RUN_OPTIONS = [
  "ILIT0016",
  "ILIT0015",
  "ILIT0014",
  "ILIT0013-02",
  "ILIT0013",
  "ILIT0012-01",
  "ILIT0011-02",
  "ILIT0011",
  "ILIT0010",
  "ILIT0009",
  "ILIT0008",
];

/**
 * Unique Run ID for each run selection.
 * Empty string = pending.
 */
export const RUN_DESCRIPTIONS = {
  ILIT0008: "0A49KLT3B7Y",
  ILIT0009: "0AA6Y6FBA1X",
  ILIT0010: "0A49KLT3B7Y",
  ILIT0011: "0AEKH5L7BXZ",
  "ILIT0011-02": "0AGBXB4WEGN",
  "ILIT0012-01": "0AK338BFJPQ",
  ILIT0013: "0AP3OOMEPID",
  "ILIT0013-02": "0AQQZFV2ALD",
  ILIT0014: "0AS0KUQOE45",
  ILIT0015: "0B76825MIN3",
  ILIT0016: "0AXVHCA77S1",
};
