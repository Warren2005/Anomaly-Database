"""
Seed a few demo library entries via the upload API.

Usage (backend must be running on :8000):
  python scripts/seed_demo.py
  python scripts/seed_demo.py --base-url http://localhost:8000
"""

from __future__ import annotations

import argparse
import io
import struct
import zlib
from pathlib import Path

import urllib.request

DEMO_ENTRIES = [
    {
        "anomaly_name": "Metal loss pit cluster",
        "anomaly_type": "Metal Loss",
        "run_number": "Run 42",
        "classification_status": "Confirmed",
        "analysis_comment": "Axially intermittent pitting near 3 o'clock",
        "signal_description": "Classic metal-loss signature with clear depth response",
        "analyst": "Demo Analyst",
        "depth": "2.1",
        "width": "12.0",
        "length": "18.5",
        "color": (220, 90, 60),
    },
    {
        "anomaly_name": "Dent with ovality",
        "anomaly_type": "Dent",
        "run_number": "Run 42",
        "classification_status": "Edge Case",
        "analysis_comment": "Ambiguous dent vs ripple — documented for calibration",
        "signal_description": "Localized deformation with mild ovality",
        "analyst": "Demo Analyst",
        "depth": "4.0",
        "color": (90, 140, 210),
    },
    {
        "anomaly_name": "Girth weld indication",
        "anomaly_type": "Girth Weld Anomaly",
        "run_number": "Run 51",
        "classification_status": "QC-Resolved",
        "analysis_comment": "Raised to QC; approved after senior review",
        "signal_description": "Weld-zone indication, not metal loss",
        "analyst": "Demo Analyst",
        "is_qc_flag": "true",
        "qc_raised_by": "Junior Analyst",
        "qc_reviewer": "Senior Reviewer",
        "qc_decision_rationale": "Weld geometry artifact — do not size as metal loss",
        "color": (70, 180, 120),
    },
    {
        "anomaly_name": "Crack-like linear feature",
        "anomaly_type": "Crack",
        "run_number": "Run 51",
        "classification_status": "Under Discussion",
        "analysis_comment": "Possible SCC cluster — pending second opinion",
        "signal_description": "Linear axial feature with sharp response",
        "analyst": "Demo Analyst",
        "depth": "1.2",
        "length": "25.0",
        "color": (200, 160, 40),
    },
]


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def make_png(color: tuple[int, int, int], size: int = 256) -> bytes:
    """Minimal solid-color PNG (no Pillow required)."""
    r, g, b = color
    raw = b"".join(b"\x00" + bytes([r, g, b]) * size for _ in range(size))
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)),
            _chunk(b"IDAT", zlib.compress(raw, 9)),
            _chunk(b"IEND", b""),
        ]
    )


def multipart_body(fields: dict, filename: str, file_bytes: bytes, content_type: str = "image/png") -> tuple[bytes, str]:
    boundary = "----DemoBoundary7MA4YWxkTrZu0gW"
    parts: list[bytes] = []
    for key, value in fields.items():
        if value is None or value == "":
            continue
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n"
            ).encode()
        )
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + file_bytes
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def upload(base_url: str, entry: dict) -> dict:
    color = entry.pop("color")
    png = make_png(color)
    body, content_type = multipart_body(entry, f"{entry['anomaly_name'].replace(' ', '_')}.png", png)
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/v1/library/upload",
        data=body,
        headers={"Content-Type": content_type},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return {"status": resp.status, "body": resp.read().decode()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    # Quick health check
    try:
        with urllib.request.urlopen(f"{args.base_url.rstrip('/')}/api/v1/health", timeout=5) as resp:
            print("Health:", resp.read().decode())
    except Exception as exc:
        raise SystemExit(
            f"Backend not reachable at {args.base_url}.\n"
            f"Start it first (Docker Desktop + docker compose up -d --build).\n"
            f"Error: {exc}"
        )

    out_dir = Path(__file__).resolve().parents[1] / "data" / "demo_seed"
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, entry in enumerate(DEMO_ENTRIES, start=1):
        payload = dict(entry)
        color = payload["color"]
        png = make_png(color)
        (out_dir / f"demo_{i}.png").write_bytes(png)
        print(f"[{i}/{len(DEMO_ENTRIES)}] Uploading {payload['anomaly_name']}...")
        result = upload(args.base_url, payload)
        print(" ", result["status"], result["body"][:180], "...")

    print("\nDone. Open Browse Library / Search in the UI.")


if __name__ == "__main__":
    main()
