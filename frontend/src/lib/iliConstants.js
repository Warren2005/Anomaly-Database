/** Shared ILI constants — Zach reference-library taxonomy + statuses */

export const ANOMALY_TYPES = [
  "Metal Loss",
  "Weld",
  "Crack-like",
  "Deformation",
  "Lamination",
  "Other",
];

/** Pipeline component types, for the "interacting with other features" multi-select */
export const COMPONENT_OPTIONS = [
  "Valve",
  "Tee",
  "Flange",
  "Girth Weld",
  "Sleeve",
  "Casing",
  "Tap",
  "Bend/Elbow",
  "Other",
];

/** Combined options for the interacting-features multi-select (deduped, e.g. both lists have "Other") */
export const INTERACTION_OPTIONS = [...new Set([...ANOMALY_TYPES, ...COMPONENT_OPTIONS])];

export const CLASSIFICATION_STATUS_OPTIONS = [
  "Confirmed",
  "Edge Case",
  "QC-Resolved",
  "Under Discussion",
];

export const WALL_LOCATION_OPTIONS = [
  "External",
  "Internal",
  "Mid Wall",
  "N/A",
];

/** Crack-like only: which image angle(s) are present */
export const CRACK_IMAGE_ANGLE_OPTIONS = ["+", "-", "Both"];

export const DIMENSION_REQUIREMENTS = {
  "Metal Loss": ["depth", "width", "length"],
  Weld: ["depth", "width", "length"],
  "Crack-like": ["depth", "length"],
  Deformation: ["depth", "width"],
  Lamination: ["depth"],
};

/**
 * Identification options keyed by Anomaly Type (ILI viewer taxonomy).
 */
export const IDENTIFICATION_BY_TYPE = {
  "Metal Loss": [
    "Corrosion",
    "Corrosion Cluster",
    "Grinding",
    "Gouge",
    "Scratches",
    "Manufactured",
  ],
  Weld: [
    "Girth Weld Anomaly",
    "Longitudinal Weld Anomaly",
    "Spiral Weld Anomaly",
    "Arc Strike",
    "Slag Inclusion",
  ],
  "Crack-like": [
    "Crack",
    "Stress Corrosion Cracking",
    "Hook Crack",
    "EDM Notch",
    "Crack Cluster",
    "Lack of Fusion",
    "Weld Trim",
  ],
  Deformation: [
    "Ovality",
    "Dent Complex",
    "Dent Kinked",
    "Dent Plain",
    "Dent Re-Rounded",
    "Ripple/Wrinkle",
    "Buckle",
    "Roof Topping",
  ],
  Lamination: [
    "Planar Lamination",
    "Sloped Lamination",
    "Bulging Lamination",
    "Inclusion",
  ],
  Other: [
    "Debris",
    "Artificial Anomaly",
    "Coating Disbondment",
    "Wall Thickness Increase",
    "Bubble",
    "Nominal Pipe",
  ],
};

/** Flat list of all Identification values across types (for Library filters) */
export const ALL_IDENTIFICATIONS = [
  ...new Set(Object.values(IDENTIFICATION_BY_TYPE).flat()),
];

/** Default Identification when an Anomaly Type is selected */
export const IDENTIFICATION_DEFAULTS = {
  "Metal Loss": "Corrosion",
  Weld: "Girth Weld Anomaly",
  "Crack-like": "Crack",
  Deformation: "Ovality",
  Lamination: "Planar Lamination",
  Other: "Debris",
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

/** Shortcuts under the Add Entry drop zone */
export const COMMON_PANEL_TAGS = [
  "Beamforming Panel",
  "Image Panel",
  "Raw Panel",
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
