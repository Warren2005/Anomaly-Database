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

/** Display labels for the anomaly page — keep + / − on Add Entry. */
export function formatCrackAngle(value) {
  const v = (value || "").trim();
  if (v === "+" ) return "Pos";
  if (v === "-" || v === "−") return "Neg";
  if (v.toLowerCase() === "both") return "Both";
  return v;
}

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

/** Default shortcuts under the Add Entry drop zone (user-customizable) */
export const DEFAULT_PANEL_SHORTCUTS = [
  { panel: "Beamforming Panel", mode: "" },
  { panel: "Image Panel", mode: "" },
  { panel: "Raw Panel", mode: "" },
];

export const COMMON_PANEL_TAGS = DEFAULT_PANEL_SHORTCUTS.map((s) => s.panel);

const PANEL_SHORTCUTS_KEY = "ili-panel-shortcuts-v2";
const LEGACY_SHORTCUTS_KEY = "ili-panel-shortcuts";

export const BEAMFORMING_PANEL = "Beamforming Panel";

/** Surface-detect beamforming modes (Direct L-L / Fluid Flood).
 *  Not limited to Metal Loss anomalies — any type can use these. */
export const METAL_LOSS_BEAMFORMING_MODES = [
  "Inner Surface Detect (Fluid Flood)",
  "Outer Surface Detect (Direct L-L)",
  "Outer Surface (Direct L-L Complex Surface)",
];

/** Crack-like beamforming modes — metadata only; these imply Crack-like. */
export const CRACK_BEAMFORMING_MODES = [
  "Inner Surface Detect (Fluid Flood Angled)",
  "Outer Surface Verify (Direct T-T)",
  "Crack Detect Outer (Halfskip TT-T)",
  "Crack Detect Inner (Halfskip T-TT)",
  "Crack Verify Outer (1.5 skip TTT-TT)",
  "Crack Verify Inner (1.5 skip TT-TTT)",
  "Outer Surface Verify Complex (Direct T-T Complex Surface)",
  "Crack Detect Outer Complex (Halfskip TT-T Complex Surface)",
  "Crack Detect Inner Complex (Halfskip T-TT Complex Surface)",
];

export const BEAMFORMING_TYPE_OPTIONS = [
  ...METAL_LOSS_BEAMFORMING_MODES,
  ...CRACK_BEAMFORMING_MODES,
];

/** Older truncated labels → full official names (including parentheticals) */
const BEAMFORMING_TYPE_ALIASES = {
  "Outer Surface Verify Complex (Direct T-T Complex)":
    "Outer Surface Verify Complex (Direct T-T Complex Surface)",
  "Crack Detect Outer Complex (Halfskip TT-T Complex)":
    "Crack Detect Outer Complex (Halfskip TT-T Complex Surface)",
  "Crack Detect Inner Complex (Halfskip T-TT Complex)":
    "Crack Detect Inner Complex (Halfskip T-TT Complex Surface)",
};

export function isBeamformingPanel(tag) {
  return (tag || "").trim() === BEAMFORMING_PANEL;
}

export function beamformingModesForAnomalyType(anomalyType) {
  if (anomalyType === "Crack-like") return CRACK_BEAMFORMING_MODES;
  return METAL_LOSS_BEAMFORMING_MODES;
}

/** Full mode name, including bracketed method. Never truncated for display. */
export function canonicalBeamformingType(type) {
  const t = (type || "").trim();
  return BEAMFORMING_TYPE_ALIASES[t] || t;
}

export function shortBeamformingType(type) {
  return canonicalBeamformingType(type);
}

/** Only crack modes imply an anomaly type. Surface-detect modes do not. */
export function anomalyTypeForBeamformingMode(type) {
  const t = canonicalBeamformingType(type);
  if (CRACK_BEAMFORMING_MODES.includes(t)) return "Crack-like";
  return "";
}

export function shortcutComboKey(panel, mode = "") {
  const p = (panel || "").trim();
  const m = isBeamformingPanel(p) ? canonicalBeamformingType(mode) : "";
  return `${p}::${m}`;
}

export function normalizePanelShortcut(raw) {
  if (typeof raw === "string") {
    if (!PANEL_TAG_OPTIONS.includes(raw)) return null;
    return { panel: raw, mode: "" };
  }
  if (!raw || !PANEL_TAG_OPTIONS.includes(raw.panel)) return null;
  return {
    panel: raw.panel,
    mode: isBeamformingPanel(raw.panel) ? canonicalBeamformingType(raw.mode) : "",
  };
}

function parseStoredShortcuts(rawJson) {
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed) || !parsed.length) return null;
  // Old string[] layouts (Cross-Section, etc.) should not override the new defaults.
  if (parsed.every((item) => typeof item === "string")) return null;
  const unique = [];
  const seen = new Set();
  for (const raw of parsed) {
    const shortcut = normalizePanelShortcut(raw);
    if (!shortcut) continue;
    const key = shortcutComboKey(shortcut.panel, shortcut.mode);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(shortcut);
  }
  return unique.length ? unique : null;
}

export function loadPanelShortcuts() {
  try {
    const current = localStorage.getItem(PANEL_SHORTCUTS_KEY);
    if (current) {
      const parsed = parseStoredShortcuts(current);
      if (parsed) return parsed;
    }
    // Ignore legacy string layouts; v2 starts from Beamforming (no mode), Image, Raw.
    localStorage.removeItem(LEGACY_SHORTCUTS_KEY);
    return DEFAULT_PANEL_SHORTCUTS.map((s) => ({ ...s }));
  } catch {
    return DEFAULT_PANEL_SHORTCUTS.map((s) => ({ ...s }));
  }
}

export function savePanelShortcuts(shortcuts) {
  try {
    localStorage.setItem(PANEL_SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch {
    /* ignore quota / private mode */
  }
}

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
