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

Dataset format: a directory of images where the class label is the
filename prefix before the last "_<number>" (e.g. "crazing_12.jpg" ->
class "crazing"). This matches NEU-DET's layout out of the box.

Usage:
    python -m scripts.evaluate --dataset-dir ./data/eval/NEU-DET/images
    python -m scripts.evaluate --dataset-dir ./data/eval/NEU-DET/images --limit 300
"""

import argparse
import asyncio
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import open_clip
import torch
from PIL import Image as PILImage

LABEL_PATTERN = re.compile(r"^(.*)_\d+\.(jpg|jpeg|png)$", re.IGNORECASE)


def label_from_filename(filename: str) -> Optional[str]:
    match = LABEL_PATTERN.match(filename)
    return match.group(1).lower() if match else None


@dataclass
class ModelConfig:
    name: str
    pretrained: str
    label: str  # display name


async def embed_dataset(image_paths: list[Path], config: ModelConfig, device: str) -> np.ndarray:
    """Embed every image with one model. Returns an (N, D) array, row order
    matching image_paths."""
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

    embeddings = []
    start = time.time()
    for i, path in enumerate(image_paths):
        embeddings.append(await asyncio.to_thread(_embed_one, path))
        if (i + 1) % 200 == 0:
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
            continue  # no ground truth to check for this query (shouldn't happen with balanced classes)

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
    """Evaluate the two-stage cascade: primary model produces a shortlist,
    rerank model's embeddings determine the final order within it — same
    shape as app/services/reranking.py's rerank().

    Deliberately reported as two separate numbers rather than one mAP,
    because standard AP assumes the full corpus gets ranked — but the
    cascade only ever ranks `shortlist_size` candidates per query. Scoring
    it against the full corpus's relevant-item count mechanically caps AP
    at roughly shortlist_size / num_relevant regardless of ranking quality
    (e.g. ~50/294 ≈ 17% here), which looks like a bug in the *system*, not
    the metric — it isn't. So this reports the two stages' actual jobs
    separately, matching how L/14 (coverage) and H/14 (ordering) are
    described in production:
      - shortlist_recall: coverage — of all truly-relevant items in the
        whole corpus, what fraction did the primary-model cut even let
        through to the shortlist? (L/14's job)
      - map_within_shortlist: ranking quality of what did make it through,
        AP computed with the shortlist itself as the candidate pool, not
        the full corpus (H/14's job).
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
        print(f"    shortlist recall={metrics['shortlist_recall']:.1%}  (coverage: L/14's job)")
        print(f"    mAP-within-shortlist={metrics['map_within_shortlist']:.1%}  (ranking: H/14's job)")
        print(f"    (n={metrics['n_queries']} queries)\n")


async def main():
    parser = argparse.ArgumentParser(description="Evaluate retrieval quality against a real labeled dataset")
    parser.add_argument("--dataset-dir", required=True, help="Directory of labeled images (filename-prefix labels)")
    parser.add_argument("--limit", type=int, default=None, help="Cap number of images per class (for a quick run)")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--shortlist-size", type=int, default=50, help="Cascade shortlist size (matches production rerank_candidates)")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    all_paths = sorted(dataset_dir.glob("*.jpg")) + sorted(dataset_dir.glob("*.jpeg")) + sorted(dataset_dir.glob("*.png"))

    labeled_paths = []
    labels = []
    per_class_count: dict[str, int] = {}
    for path in all_paths:
        label = label_from_filename(path.name)
        if label is None:
            continue
        if args.limit and per_class_count.get(label, 0) >= args.limit:
            continue
        labeled_paths.append(path)
        labels.append(label)
        per_class_count[label] = per_class_count.get(label, 0) + 1

    print(f"Dataset: {len(labeled_paths)} labeled images across {len(per_class_count)} classes")
    for label, count in sorted(per_class_count.items()):
        print(f"  {label}: {count}")
    print(f"Device: {args.device}\n")

    k_values = [1, 3, 5]

    configs = {
        "b32": ModelConfig("ViT-B-32", "openai", "ViT-B/32 (old baseline)"),
        "l14": ModelConfig("ViT-L-14", "openai", "ViT-L/14 (new primary, alone)"),
        "h14": ModelConfig("ViT-H-14", "laion2b_s32b_b79k", "ViT-H/14 (rerank model, alone)"),
    }

    embeddings = {}
    for key, config in configs.items():
        print(f"Embedding with {config.label}...")
        embeddings[key] = await embed_dataset(labeled_paths, config, args.device)

    print("\n=== Individual models (no cascade) ===\n")
    for key, config in configs.items():
        metrics = leave_one_out_metrics(embeddings[key], labels, k_values)
        print_metrics(config.label, metrics, k_values)

    print("=== Cascade: ViT-L/14 shortlist -> ViT-H/14 rerank (production design) ===\n")
    cascade_metrics = cascade_rescore(
        embeddings["l14"], embeddings["h14"], labels, k_values, args.shortlist_size
    )
    print_metrics(f"L/14 -> H/14 cascade (shortlist={args.shortlist_size})", cascade_metrics, k_values)


if __name__ == "__main__":
    asyncio.run(main())
