"""
Reusable retrieval evaluation harness.

Unlike the earlier eval_rerank.py (which used filename-based near-duplicate
groups as an informal, unverified proxy for ground truth), this evaluates
against a *real* labeled dataset — each image's class comes from an actual
label, not a guess. Computes the standard retrieval metrics: Precision@K,
Recall@K, and mAP (mean Average Precision), via leave-one-out search
exactly like production search.py does (excluded self, ranked by cosine
similarity over L2-normalized embeddings).

Supports evaluating a single model, or a two-stage cascade (primary model
narrows to a shortlist, a second/heavier model re-scores it) — the same
shape as the production rerank cascade in app/services/reranking.py — so
the cascade itself gets evaluated, not just each model in isolation.

Two dataset sources:
  --source library (default) — the real, in-production anomaly library.
    Reads directly from LIBRARY_DATA_DIR/metadata.json + its images/
    directory, labeled by an actual metadata field (--label-field
    anomaly_type or identification). This is what should drive real
    model-selection decisions — the NEU-DET numbers below are a sanity
    check against a public benchmark, not a stand-in for this.
  --source neu-det — a directory of images where the class label is the
    filename prefix before the last "_<number>" (e.g. "crazing_12.jpg" ->
    class "crazing"). Matches NEU-DET's layout out of the box. Useful as
    a second opinion / sanity check, but NEU-DET is steel-surface-defect
    photography, not ILI beamforming/UT imagery — a model that wins here
    is not guaranteed to win on the real library, which is why --source
    library is the default and the one that should gate any real decision.

Two model backends:
  open_clip — the CLIP checkpoints already used in production (and any
    other open_clip checkpoint).
  timm      — everything else, e.g. DINOv2 (facebookresearch, self-
    supervised, no text/caption alignment) via `timm.create_model(...)`.
    Both backends are L2-normalized and cosine-compared identically, so
    numbers are directly comparable across backends.

Usage:
    # Real library corpus (default), current production models + DINOv2
    python -m scripts.evaluate

    # Same, but group by the finer (and much thinner) identification field
    python -m scripts.evaluate --label-field identification

    # Only specific models
    python -m scripts.evaluate --models l14,dinov2-large

    # Original NEU-DET sanity check
    python -m scripts.evaluate --source neu-det --dataset-dir ./data/eval/NEU-DET/images
"""

import argparse
import asyncio
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import open_clip
import timm
import torch
from PIL import Image as PILImage

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "model_registry.json"


def append_to_registry(entry: dict, registry_path: Path = REGISTRY_PATH) -> None:
    """Append one evaluation run to the model registry log. This is what
    makes a model swap a *measured, recorded* event instead of a silent
    config change — anyone can check model_registry.json to see what
    accuracy was actually verified for the model currently in production,
    and when."""
    try:
        history = json.loads(registry_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        history = []
    history.append(entry)
    registry_path.write_text(json.dumps(history, indent=2))
    print(f"Recorded evaluation run in {registry_path}")


LABEL_PATTERN = re.compile(r"^(.*)_\d+\.(jpg|jpeg|png)$", re.IGNORECASE)


def label_from_filename(filename: str) -> Optional[str]:
    match = LABEL_PATTERN.match(filename)
    return match.group(1).lower() if match else None


def load_neu_det_corpus(dataset_dir: Path, limit: Optional[int]) -> tuple[list[Path], list[str]]:
    all_paths = (
        sorted(dataset_dir.glob("*.jpg"))
        + sorted(dataset_dir.glob("*.jpeg"))
        + sorted(dataset_dir.glob("*.png"))
    )
    paths: list[Path] = []
    labels: list[str] = []
    per_class_count: dict[str, int] = {}
    for path in all_paths:
        label = label_from_filename(path.name)
        if label is None:
            continue
        if limit and per_class_count.get(label, 0) >= limit:
            continue
        paths.append(path)
        labels.append(label)
        per_class_count[label] = per_class_count.get(label, 0) + 1
    return paths, labels


def load_library_corpus(
    data_dir: Path, label_field: str, limit: Optional[int]
) -> tuple[list[Path], list[str]]:
    """Load the real, in-production anomaly library — one image (its
    primary/searchable image) per anomaly, labeled by an actual metadata
    field. This is app/services/file_store.py's metadata.json read
    directly off disk, not through the running API, so this can be run
    standalone without the backend up."""
    records = json.loads((data_dir / "metadata.json").read_text(encoding="utf-8"))
    images_dir = data_dir / "images"

    paths: list[Path] = []
    labels: list[str] = []
    per_class_count: dict[str, int] = {}
    skipped_no_label = 0
    skipped_missing_file = 0
    for record in records:
        if record.get("dataset_source") != "library":
            continue
        label = record.get(label_field)
        if not label:
            skipped_no_label += 1
            continue
        image_path = images_dir / record["image_path"]
        if not image_path.exists():
            skipped_missing_file += 1
            continue
        if limit and per_class_count.get(label, 0) >= limit:
            continue
        paths.append(image_path)
        labels.append(label)
        per_class_count[label] = per_class_count.get(label, 0) + 1

    if skipped_no_label:
        print(f"  (skipped {skipped_no_label} entries with no '{label_field}' set)")
    if skipped_missing_file:
        print(f"  (skipped {skipped_missing_file} entries whose image file is missing on disk)")

    return paths, labels


@dataclass
class ModelConfig:
    key: str
    backend: str  # "open_clip" | "timm"
    name: str
    pretrained: str  # open_clip only; ignored for timm
    label: str  # display name


# Every model this script knows how to evaluate. --models selects a subset.
# DINOv2 (timm) has no text/caption training at all — pure self-supervised
# visual structure — which is why it's the first non-CLIP candidate worth
# testing: it may pick up on ILI imagery's texture/pattern better than a
# model trained on web photo+caption pairs that never included anything
# like a beamforming panel or a UT plot.
MODEL_REGISTRY: dict[str, ModelConfig] = {
    "b32": ModelConfig("b32", "open_clip", "ViT-B-32", "openai", "ViT-B/32 (old baseline)"),
    "l14": ModelConfig("l14", "open_clip", "ViT-L-14", "openai", "ViT-L/14 (production primary)"),
    "h14": ModelConfig("h14", "open_clip", "ViT-H-14", "laion2b_s32b_b79k", "ViT-H/14 (production rerank)"),
    "dinov2-base": ModelConfig(
        "dinov2-base", "timm", "vit_base_patch14_dinov2.lvd142m", "", "DINOv2 ViT-B/14 (86M, self-supervised)"
    ),
    "dinov2-large": ModelConfig(
        "dinov2-large", "timm", "vit_large_patch14_dinov2.lvd142m", "", "DINOv2 ViT-L/14 (300M, self-supervised)"
    ),
}
DEFAULT_LIBRARY_MODELS = ["l14", "h14", "dinov2-base", "dinov2-large"]
DEFAULT_NEU_DET_MODELS = ["b32", "l14", "h14"]


async def embed_dataset(image_paths: list[Path], config: ModelConfig, device: str) -> np.ndarray:
    """Embed every image with one model. Returns an (N, D) array, row order
    matching image_paths. Every backend is L2-normalized identically so
    cosine similarity is directly comparable across models."""
    if config.backend == "open_clip":
        model, _, preprocess = open_clip.create_model_and_transforms(
            config.name, pretrained=config.pretrained, device=device
        )
        model.eval()

        def _embed_one(path: Path) -> list[float]:
            image = PILImage.open(path).convert("RGB")
            tensor = preprocess(image).unsqueeze(0).to(device)
            with torch.no_grad():
                emb = model.encode_image(tensor)
                emb = emb / emb.norm(dim=-1, keepdim=True)
            return emb.squeeze().cpu().tolist()

    elif config.backend == "timm":
        model = timm.create_model(config.name, pretrained=True, num_classes=0).to(device)
        model.eval()
        data_cfg = timm.data.resolve_data_config({}, model=model)
        transform = timm.data.create_transform(**data_cfg)

        def _embed_one(path: Path) -> list[float]:
            image = PILImage.open(path).convert("RGB")
            tensor = transform(image).unsqueeze(0).to(device)
            with torch.no_grad():
                emb = model(tensor)
                emb = emb / emb.norm(dim=-1, keepdim=True)
            return emb.squeeze().cpu().tolist()

    else:
        raise ValueError(f"Unknown backend: {config.backend}")

    embeddings = []
    start = time.time()
    for i, path in enumerate(image_paths):
        embeddings.append(await asyncio.to_thread(_embed_one, path))
        if (i + 1) % 50 == 0:
            elapsed = time.time() - start
            print(f"    embedded {i + 1}/{len(image_paths)} ({elapsed:.0f}s elapsed)")
    del model
    if device == "cuda":
        torch.cuda.empty_cache()
    return np.array(embeddings, dtype=np.float32)


def leave_one_out_metrics(
    embeddings: np.ndarray, labels: list[str], k_values: list[int]
) -> dict:
    """Precision@K, Recall@K (averaged over all queries), and mAP.

    Standard formulas:
      Precision@K = |top-K ∩ relevant| / K
      Recall@K    = |top-K ∩ relevant| / |relevant|
      AP (per query) = mean of Precision@k over each rank k where the
                       item at that rank is relevant
      mAP = mean of AP over all queries
    """
    n = len(labels)
    labels_arr = np.array(labels)
    sims = embeddings @ embeddings.T  # (N, N) cosine similarity (already L2-normalized)

    precision_at_k = {k: [] for k in k_values}
    recall_at_k = {k: [] for k in k_values}
    average_precisions = []

    for i in range(n):
        scores = sims[i].copy()
        scores[i] = -np.inf  # exclude self
        ranked_idx = np.argsort(-scores)
        relevant = labels_arr[ranked_idx] == labels_arr[i]
        num_relevant = int(relevant.sum())  # all same-class images besides self

        if num_relevant == 0:
            continue  # no ground truth to check for this query (e.g. a singleton class)

        for k in k_values:
            top_k_relevant = int(relevant[:k].sum())
            precision_at_k[k].append(top_k_relevant / k)
            recall_at_k[k].append(top_k_relevant / num_relevant)

        # Average precision: precision@k at each rank where a relevant item appears
        hits = 0
        precisions_at_hits = []
        for rank, is_rel in enumerate(relevant, start=1):
            if is_rel:
                hits += 1
                precisions_at_hits.append(hits / rank)
        average_precisions.append(sum(precisions_at_hits) / num_relevant)

    return {
        "precision_at_k": {k: float(np.mean(v)) for k, v in precision_at_k.items()},
        "recall_at_k": {k: float(np.mean(v)) for k, v in recall_at_k.items()},
        "map": float(np.mean(average_precisions)),
        "n_queries": n,
    }


def cascade_rescore(
    primary_embeddings: np.ndarray,
    rerank_embeddings: np.ndarray,
    labels: list[str],
    k_values: list[int],
    shortlist_size: int,
) -> dict:
    """Evaluate a two-stage cascade: primary model produces a shortlist,
    rerank model's embeddings determine the final order within it — same
    shape as app/services/reranking.py's rerank().

    Deliberately reported as two separate numbers rather than one mAP,
    because standard AP assumes the full corpus gets ranked — but the
    cascade only ever ranks `shortlist_size` candidates per query. Scoring
    it against the full corpus's relevant-item count mechanically caps AP
    at roughly shortlist_size / num_relevant regardless of ranking quality,
    which looks like a bug in the *system*, not the metric — it isn't. So
    this reports the two stages' actual jobs separately:
      - shortlist_recall: coverage — of all truly-relevant items in the
        whole corpus, what fraction did the primary-model cut even let
        through to the shortlist? (the primary model's job)
      - map_within_shortlist: ranking quality of what did make it through,
        AP computed with the shortlist itself as the candidate pool, not
        the full corpus (the rerank model's job)
    """
    n = len(labels)
    labels_arr = np.array(labels)
    primary_sims = primary_embeddings @ primary_embeddings.T
    rerank_sims = rerank_embeddings @ rerank_embeddings.T

    precision_at_k = {k: [] for k in k_values}
    recall_at_k = {k: [] for k in k_values}  # recall against the full corpus (fixed K, no denominator issue)
    shortlist_recalls = []
    average_precisions_within_shortlist = []

    for i in range(n):
        p_scores = primary_sims[i].copy()
        p_scores[i] = -np.inf
        shortlist_idx = np.argsort(-p_scores)[:shortlist_size]

        r_scores = rerank_sims[i][shortlist_idx]
        final_order = shortlist_idx[np.argsort(-r_scores)]

        relevant = labels_arr[final_order] == labels_arr[i]
        num_relevant_total = int((labels_arr == labels_arr[i]).sum()) - 1
        num_relevant_in_shortlist = int(relevant.sum())
        if num_relevant_total == 0:
            continue

        for k in k_values:
            top_k_relevant = int(relevant[:k].sum())
            precision_at_k[k].append(top_k_relevant / k)
            recall_at_k[k].append(top_k_relevant / num_relevant_total)

        shortlist_recalls.append(num_relevant_in_shortlist / num_relevant_total)

        if num_relevant_in_shortlist > 0:
            hits = 0
            precisions_at_hits = []
            for rank, is_rel in enumerate(relevant, start=1):
                if is_rel:
                    hits += 1
                    precisions_at_hits.append(hits / rank)
            average_precisions_within_shortlist.append(
                sum(precisions_at_hits) / num_relevant_in_shortlist
            )
        else:
            average_precisions_within_shortlist.append(0.0)

    return {
        "precision_at_k": {k: float(np.mean(v)) for k, v in precision_at_k.items()},
        "recall_at_k": {k: float(np.mean(v)) for k, v in recall_at_k.items()},
        "shortlist_recall": float(np.mean(shortlist_recalls)),
        "map_within_shortlist": float(np.mean(average_precisions_within_shortlist)),
        "n_queries": n,
    }


def print_metrics(label: str, metrics: dict, k_values: list[int]):
    p_str = "  ".join(f"P@{k}={metrics['precision_at_k'][k]:.1%}" for k in k_values)
    r_str = "  ".join(f"R@{k}={metrics['recall_at_k'][k]:.1%}" for k in k_values)
    print(f"  {label}")
    print(f"    {p_str}")
    print(f"    {r_str}")
    if "map" in metrics:
        print(f"    mAP={metrics['map']:.1%}  (n={metrics['n_queries']} queries)\n")
    else:
        print(f"    shortlist recall={metrics['shortlist_recall']:.1%}  (coverage: primary model's job)")
        print(f"    mAP-within-shortlist={metrics['map_within_shortlist']:.1%}  (ranking: rerank model's job)")
        print(f"    (n={metrics['n_queries']} queries)\n")


async def main():
    parser = argparse.ArgumentParser(description="Evaluate retrieval quality against a labeled dataset")
    parser.add_argument(
        "--source", choices=["library", "neu-det"], default="library",
        help="library = the real, in-production anomaly corpus (default); "
             "neu-det = the public steel-surface-defect sanity-check dataset",
    )
    parser.add_argument(
        "--library-data-dir", default=None,
        help="Override LIBRARY_DATA_DIR (defaults to Settings.library_data_dir from .env)",
    )
    parser.add_argument(
        "--label-field", default="anomaly_type", choices=["anomaly_type", "identification"],
        help="library source only: which metadata field to group by. anomaly_type has "
             "fewer, larger, more balanced classes; identification is finer-grained but "
             "some classes currently have only 1-2 examples.",
    )
    parser.add_argument("--dataset-dir", default=None, help="neu-det source only: directory of labeled images")
    parser.add_argument("--limit", type=int, default=None, help="Cap number of images per class (for a quick run)")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--shortlist-size", type=int, default=50, help="Cascade shortlist size (matches production rerank_candidates)")
    parser.add_argument(
        "--models", default=None,
        help=f"Comma-separated model keys from {list(MODEL_REGISTRY)} "
             f"(default: {DEFAULT_LIBRARY_MODELS} for library, {DEFAULT_NEU_DET_MODELS} for neu-det)",
    )
    parser.add_argument(
        "--cascade", default="l14:h14",
        help="primary_key:rerank_key to evaluate as a two-stage cascade (matches production's "
             "design by default). Pass 'none' to skip cascade evaluation.",
    )
    args = parser.parse_args()

    if args.source == "library":
        if args.library_data_dir:
            data_dir = Path(args.library_data_dir)
        else:
            from app.core.config import settings
            data_dir = Path(settings.library_data_dir)
        print(f"Library data dir: {data_dir}")
        labeled_paths, labels = load_library_corpus(data_dir, args.label_field, args.limit)
        model_keys = (args.models or ",".join(DEFAULT_LIBRARY_MODELS)).split(",")
    else:
        if not args.dataset_dir:
            parser.error("--dataset-dir is required for --source neu-det")
        labeled_paths, labels = load_neu_det_corpus(Path(args.dataset_dir), args.limit)
        model_keys = (args.models or ",".join(DEFAULT_NEU_DET_MODELS)).split(",")

    per_class_count: dict[str, int] = {}
    for label in labels:
        per_class_count[label] = per_class_count.get(label, 0) + 1

    print(f"Dataset: {len(labeled_paths)} labeled images across {len(per_class_count)} classes")
    for label, count in sorted(per_class_count.items()):
        flag = "  <- too few for a meaningful leave-one-out score" if count <= 2 else ""
        print(f"  {label}: {count}{flag}")
    print(f"Device: {args.device}\n")

    k_values = [1, 3, 5]

    configs = {key: MODEL_REGISTRY[key] for key in model_keys}

    embeddings = {}
    for key, config in configs.items():
        print(f"Embedding with {config.label}...")
        embeddings[key] = await embed_dataset(labeled_paths, config, args.device)

    print("\n=== Individual models (no cascade) ===\n")
    per_model_metrics = {}
    for key, config in configs.items():
        metrics = leave_one_out_metrics(embeddings[key], labels, k_values)
        print_metrics(config.label, metrics, k_values)
        per_model_metrics[key] = {
            "name": config.name,
            "backend": config.backend,
            "pretrained": config.pretrained,
            "label": config.label,
            "metrics": metrics,
        }

    cascade_metrics = None
    if args.cascade.lower() != "none":
        primary_key, _, rerank_key = args.cascade.partition(":")
        if primary_key in embeddings and rerank_key in embeddings:
            print(f"=== Cascade: {configs[primary_key].label} shortlist -> {configs[rerank_key].label} rerank ===\n")
            cascade_metrics = cascade_rescore(
                embeddings[primary_key], embeddings[rerank_key], labels, k_values, args.shortlist_size
            )
            print_metrics(
                f"{primary_key} -> {rerank_key} cascade (shortlist={args.shortlist_size})",
                cascade_metrics, k_values,
            )
        else:
            print(f"Skipping cascade: '{primary_key}' or '{rerank_key}' not in --models {model_keys}\n")

    append_to_registry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": args.source,
        "label_field": args.label_field if args.source == "library" else None,
        "dataset": str(data_dir if args.source == "library" else args.dataset_dir),
        "n_images": len(labeled_paths),
        "n_classes": len(per_class_count),
        "device": args.device,
        "shortlist_size": args.shortlist_size,
        "models": per_model_metrics,
        "cascade": cascade_metrics,
    })


if __name__ == "__main__":
    asyncio.run(main())
