"""
Step 2: a lightweight metric-learning head on top of a frozen backbone.

Trains a small trainable projection — NOT the backbone itself, which stays
frozen throughout — using a triplet loss over the labeled anomaly library,
and evaluates it with stratified K-fold cross-validation using the exact
same Precision@K/Recall@K/mAP definitions as scripts/evaluate.py, so the
numbers here are directly comparable to Step 0/1's.

Why a head instead of fine-tuning the backbone: with ~60-200 labeled
images, fine-tuning a multi-hundred-million-parameter transformer would
mostly memorize the training set rather than learn anything that
generalizes. A small trainable head (a couple hundred thousand
parameters) sitting on top of frozen, precomputed backbone embeddings is
a much better fit for this much data — this is the same reasoning that
ruled out full fine-tuning in the plan.

Why K-fold, not a single train/test split: several classes have as few
as 8-10 examples (fewer still on the identification grouping); a single
split would make both the training set and the evaluation numbers highly
sensitive to which handful of images happened to land where. K-fold means
every image is evaluated exactly once, by a head version that never saw
it during training, and the final numbers are averaged across folds — a
trustworthy estimate given how little data there is, not a lucky/unlucky
split.

Two numbers are reported side by side for a fair comparison:
  - "DINOv2 raw, k-fold protocol"   — the same frozen embeddings from
    Step 1, scored under the k-fold-aggregated protocol (not plain
    leave-one-out) so any difference from the trained-head number below
    is attributable to the head, not to a different evaluation protocol.
  - "DINOv2 + trained head"         — the actual Step 2 result.

Uses every stored image per anomaly (primary + additional panel images),
not just the primary — see load_library_corpus()'s docstring. Two rules
follow from that, both load-bearing, not cosmetic:
  - K-fold splits by ANOMALY, not by individual image — every image
    belonging to one anomaly always lands in the same fold, so a held-out
    query's own sibling images are never in the training set that
    produced the head scoring it.
  - Triplet positives are never drawn from the anchor's own anomaly, even
    within a training split. Two images of the same anomaly can look
    substantially different from each other (different panel type, or
    the same panel type but a different beamforming sub-mode — confirmed
    against the real corpus: 12 of the 13 anomalies with a repeated panel
    tag turned out to have different beamforming_types) — forcing them
    together as a "positive pair" would fight the model's real
    visual-similarity signal rather than reinforce it. A positive must
    come from a genuinely different anomaly that happens to share the
    same label.

Usage:
    python -m scripts.train_metric_head
    python -m scripts.train_metric_head --label-field identification --folds 5
    python -m scripts.train_metric_head --epochs 300 --embed-dim 128
"""

import argparse
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from app.ml.projection_head import ProjectionHead
from scripts.evaluate import (
    MODEL_REGISTRY,
    append_to_registry,
    embed_dataset,
    load_library_corpus,
)


def stratified_kfold_anomaly_indices(
    labels: list[str], anomaly_ids: list[str], k: int, seed: int
) -> list[list[int]]:
    """Hand-rolled stratified K-fold (no sklearn dependency), at the
    ANOMALY level: every image belonging to one anomaly is dealt to the
    same fold together, so a held-out query's own sibling panel images
    can never have been part of the training set that produced the head
    scoring it. Stratification (proportional share of every class per
    fold) happens over anomalies, not raw images, so an anomaly with 4
    images doesn't get 4x the say in balancing a fold that an anomaly
    with 2 images gets."""
    rng = random.Random(seed)

    anomaly_label: dict[str, str] = {}
    anomaly_image_idxs: dict[str, list[int]] = {}
    for i, (label, anomaly_id) in enumerate(zip(labels, anomaly_ids)):
        anomaly_label.setdefault(anomaly_id, label)
        anomaly_image_idxs.setdefault(anomaly_id, []).append(i)

    by_class_anomalies: dict[str, list[str]] = {}
    for anomaly_id, label in anomaly_label.items():
        by_class_anomalies.setdefault(label, []).append(anomaly_id)

    folds: list[list[int]] = [[] for _ in range(k)]
    for anomaly_ids_in_class in by_class_anomalies.values():
        shuffled = anomaly_ids_in_class[:]
        rng.shuffle(shuffled)
        for pos, anomaly_id in enumerate(shuffled):
            folds[pos % k].extend(anomaly_image_idxs[anomaly_id])
    return folds


def cosine_distance(x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    return 1.0 - F.cosine_similarity(x, y)


def sample_triplets(
    train_idx: list[int], labels: list[str], anomaly_ids: list[str], rng: random.Random
) -> tuple[list[int], list[int], list[int]]:
    """One anchor per training image per call; a random same-class positive
    and a random different-class negative. Called fresh each epoch, so
    different pairs get sampled over training — the small-dataset
    equivalent of exhausting the triplet space.

    The positive is drawn from the same class but a DIFFERENT anomaly —
    never a sibling image of the anchor's own anomaly, even though a
    sibling technically shares the label. Two images of the same anomaly
    can look substantially different (different panel type, or the same
    panel type but a different beamforming sub-mode), so treating them as
    a positive pair would train the head to pull apart-looking images
    together purely because of shared bookkeeping, not shared appearance
    — fighting the model's real visual signal instead of reinforcing it.
    """
    by_class: dict[str, list[int]] = {}
    for i in train_idx:
        by_class.setdefault(labels[i], []).append(i)

    anchors, positives, negatives = [], [], []
    classes = list(by_class.keys())
    for a in train_idx:
        same_class_other_anomaly = [
            i for i in by_class[labels[a]] if anomaly_ids[i] != anomaly_ids[a]
        ]
        if not same_class_other_anomaly:
            continue  # this fold has no other anomaly of this class — skip as an anchor
        other_classes = [c for c in classes if c != labels[a]]
        if not other_classes:
            continue
        pos = rng.choice(same_class_other_anomaly)
        neg_class = rng.choice(other_classes)
        neg = rng.choice(by_class[neg_class])
        anchors.append(a)
        positives.append(pos)
        negatives.append(neg)
    return anchors, positives, negatives


def train_head_for_fold(
    frozen_embeddings: torch.Tensor,
    labels: list[str],
    anomaly_ids: list[str],
    train_idx: list[int],
    in_dim: int,
    hidden_dim: int,
    out_dim: int,
    epochs: int,
    lr: float,
    margin: float,
    seed: int,
) -> ProjectionHead:
    torch.manual_seed(seed)
    head = ProjectionHead(in_dim, hidden_dim, out_dim)
    optimizer = torch.optim.Adam(head.parameters(), lr=lr, weight_decay=1e-4)
    loss_fn = nn.TripletMarginWithDistanceLoss(distance_function=cosine_distance, margin=margin)
    rng = random.Random(seed)

    head.train()
    for _epoch in range(epochs):
        anchors, positives, negatives = sample_triplets(train_idx, labels, anomaly_ids, rng)
        if not anchors:
            continue
        a_emb = head(frozen_embeddings[anchors])
        p_emb = head(frozen_embeddings[positives])
        n_emb = head(frozen_embeddings[negatives])
        loss = loss_fn(a_emb, p_emb, n_emb)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

    head.eval()
    return head


def metrics_for_queries(
    embeddings: np.ndarray, labels: list[str], query_indices: list[int], k_values: list[int]
) -> dict:
    """Same Precision@K/Recall@K/AP formulas as evaluate.py's
    leave_one_out_metrics, but scored only for the given query indices
    (a fold's held-out images) against the full corpus — lets metrics be
    accumulated across folds and combined at the end into one aggregate
    number covering all N images, each queried by a head that never
    trained on it."""
    labels_arr = np.array(labels)
    sims = embeddings @ embeddings.T

    precision_at_k = {k: [] for k in k_values}
    recall_at_k = {k: [] for k in k_values}
    average_precisions = []

    for i in query_indices:
        scores = sims[i].copy()
        scores[i] = -np.inf
        ranked_idx = np.argsort(-scores)
        relevant = labels_arr[ranked_idx] == labels_arr[i]
        num_relevant = int(relevant.sum())
        if num_relevant == 0:
            continue

        for k in k_values:
            top_k_relevant = int(relevant[:k].sum())
            precision_at_k[k].append(top_k_relevant / k)
            recall_at_k[k].append(top_k_relevant / num_relevant)

        hits = 0
        precisions_at_hits = []
        for rank, is_rel in enumerate(relevant, start=1):
            if is_rel:
                hits += 1
                precisions_at_hits.append(hits / rank)
        average_precisions.append(sum(precisions_at_hits) / num_relevant)

    return {
        "precision_at_k": {k: v for k, v in precision_at_k.items()},
        "recall_at_k": {k: v for k, v in recall_at_k.items()},
        "average_precisions": average_precisions,
    }


def aggregate_fold_metrics(fold_results: list[dict], k_values: list[int]) -> dict:
    precision_at_k = {k: [] for k in k_values}
    recall_at_k = {k: [] for k in k_values}
    average_precisions = []
    n_queries = 0
    for res in fold_results:
        for k in k_values:
            precision_at_k[k].extend(res["precision_at_k"][k])
            recall_at_k[k].extend(res["recall_at_k"][k])
        average_precisions.extend(res["average_precisions"])
        n_queries += len(res["average_precisions"])
    return {
        "precision_at_k": {k: float(np.mean(v)) for k, v in precision_at_k.items()},
        "recall_at_k": {k: float(np.mean(v)) for k, v in recall_at_k.items()},
        "map": float(np.mean(average_precisions)),
        "n_queries": n_queries,
    }


def print_metrics(label: str, metrics: dict, k_values: list[int]):
    p_str = "  ".join(f"P@{k}={metrics['precision_at_k'][k]:.1%}" for k in k_values)
    r_str = "  ".join(f"R@{k}={metrics['recall_at_k'][k]:.1%}" for k in k_values)
    print(f"  {label}")
    print(f"    {p_str}")
    print(f"    {r_str}")
    print(f"    mAP={metrics['map']:.1%}  (n={metrics['n_queries']} queries)\n")


async def main_async(args):
    if args.library_data_dir:
        data_dir = Path(args.library_data_dir)
    else:
        from app.core.config import settings
        data_dir = Path(settings.library_data_dir)

    print(f"Library data dir: {data_dir}")
    labeled_paths, labels, anomaly_ids = load_library_corpus(data_dir, args.label_field, None)

    per_class_count: dict[str, int] = {}
    per_class_anomalies: dict[str, set] = {}
    for label, anomaly_id in zip(labels, anomaly_ids):
        per_class_count[label] = per_class_count.get(label, 0) + 1
        per_class_anomalies.setdefault(label, set()).add(anomaly_id)
    n_anomalies = len(set(anomaly_ids))
    print(f"Dataset: {len(labeled_paths)} labeled images ({n_anomalies} distinct anomalies) across {len(per_class_count)} classes")
    for label, count in sorted(per_class_count.items()):
        n_a = len(per_class_anomalies[label])
        flag = f"  <- fewer than {args.folds} anomalies: won't appear in every fold" if n_a < args.folds else ""
        print(f"  {label}: {count} images ({n_a} anomalies){flag}")

    backbone_config = MODEL_REGISTRY[args.backbone]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\nEmbedding all images with frozen {backbone_config.label} ({device})...")
    raw_embeddings = await embed_dataset(labeled_paths, backbone_config, device)
    frozen = torch.from_numpy(raw_embeddings).float()
    in_dim = frozen.shape[1]

    k_values = [1, 3, 5]
    folds = stratified_kfold_anomaly_indices(labels, anomaly_ids, args.folds, args.seed)
    print(f"\n{args.folds}-fold split sizes (images): {[len(f) for f in folds]}\n")

    raw_fold_results = []
    head_fold_results = []
    for fold_i, held_out in enumerate(folds):
        train_idx = [i for i in range(len(labels)) if i not in held_out]
        print(f"Fold {fold_i + 1}/{args.folds}: {len(held_out)} images held out, {len(train_idx)} training")

        # Baseline: raw frozen embeddings, scored under the same k-fold
        # query accounting (isolates the head's effect from the eval protocol).
        raw_fold_results.append(
            metrics_for_queries(raw_embeddings, labels, held_out, k_values)
        )

        # Train a fresh head using only this fold's training images.
        head = train_head_for_fold(
            frozen, labels, anomaly_ids, train_idx,
            in_dim=in_dim, hidden_dim=args.hidden_dim, out_dim=args.embed_dim,
            epochs=args.epochs, lr=args.lr, margin=args.margin, seed=args.seed + fold_i,
        )
        with torch.no_grad():
            projected = head(frozen).cpu().numpy()
        head_fold_results.append(
            metrics_for_queries(projected, labels, held_out, k_values)
        )

    print("\n=== Aggregated across all folds (every image queried exactly once, never by its own trained head) ===\n")
    raw_metrics = aggregate_fold_metrics(raw_fold_results, k_values)
    head_metrics = aggregate_fold_metrics(head_fold_results, k_values)
    print_metrics(f"{backbone_config.label} raw, k-fold protocol", raw_metrics, k_values)
    print_metrics(f"{backbone_config.label} + trained head (dim={args.embed_dim})", head_metrics, k_values)

    delta_map = head_metrics["map"] - raw_metrics["map"]
    delta_p1 = head_metrics["precision_at_k"][1] - raw_metrics["precision_at_k"][1]
    print(f"  change in mAP = {delta_map:+.1%}")
    print(f"  change in P@1 = {delta_p1:+.1%}\n")

    append_to_registry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "library",
        "label_field": args.label_field,
        "dataset": str(data_dir),
        "n_images": len(labeled_paths),
        "n_anomalies": n_anomalies,
        "n_classes": len(per_class_count),
        "device": device,
        "step": "step2_metric_head",
        "backbone": args.backbone,
        "folds": args.folds,
        "fold_level": "anomaly",
        "positive_sampling": "same_class_different_anomaly_only",
        "head_config": {"hidden_dim": args.hidden_dim, "embed_dim": args.embed_dim, "epochs": args.epochs, "lr": args.lr, "margin": args.margin},
        "raw_metrics": raw_metrics,
        "head_metrics": head_metrics,
    })

    if args.final_output:
        # The k-fold heads above exist only to measure generalization —
        # none of them ever saw 100% of the data, so none of them is the
        # model to actually ship. This trains one more head, identical in
        # every other way, using every labeled image as training data, and
        # saves it for the embedding service to load at startup.
        print(f"\nTraining final production head on all {len(labels)} images ({n_anomalies} anomalies)...")
        all_idx = list(range(len(labels)))
        final_head = train_head_for_fold(
            frozen, labels, anomaly_ids, all_idx,
            in_dim=in_dim, hidden_dim=args.hidden_dim, out_dim=args.embed_dim,
            epochs=args.epochs, lr=args.lr, margin=args.margin, seed=args.seed,
        )
        output_path = Path(args.final_output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save({
            "state_dict": final_head.state_dict(),
            "backbone": args.backbone,
            "in_dim": in_dim,
            "hidden_dim": args.hidden_dim,
            "embed_dim": args.embed_dim,
            "trained_on": {
                "n_images": len(labels),
                "n_anomalies": n_anomalies,
                "label_field": args.label_field,
                "positive_sampling": "same_class_different_anomaly_only",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            # This head was cross-validated (above) using anomaly_type/
            # identification labels, but never on 100% of the data — the
            # k-fold numbers in this same registry entry are the honest
            # estimate of how *this* final head should perform.
            "cross_validated_metrics": head_metrics,
        }, output_path)
        print(f"Saved final head to {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Train and evaluate a lightweight metric-learning head over a frozen backbone")
    parser.add_argument("--backbone", default="dinov2-base", choices=list(MODEL_REGISTRY), help="Frozen backbone from scripts/evaluate.py's MODEL_REGISTRY")
    parser.add_argument("--library-data-dir", default=None)
    parser.add_argument("--label-field", default="anomaly_type", choices=["anomaly_type", "identification"])
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--hidden-dim", type=int, default=256)
    parser.add_argument("--embed-dim", type=int, default=128)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--margin", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--final-output", default=None,
        help="If given, after the k-fold evaluation also train one more head on "
             "100%% of the labeled data and save it to this path (the head the "
             "embedding service actually loads at startup).",
    )
    args = parser.parse_args()

    import asyncio
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
