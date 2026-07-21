"""
One-off held-out evaluation script (not part of the app) comparing:
  - CLIP ViT-B/32 (old baseline)
  - CLIP ViT-L/14 (new primary)
  - ViT-L/14 + ViT-H-14 rerank cascade (new primary + rerank)

Ground truth: DV_Data filenames form informal near-duplicate groups (e.g.
"girth weld bf.png" / "girth weld bf (1).png" are almost certainly the same
or a near-identical shot saved twice). For each image with at least one
other group member, do leave-one-out search and check whether a same-group
image appears in the top-3 results. This is a proxy for "does the model
recognize genuinely similar cases," not a rigorous benchmark.

Usage: python -m scripts.eval_rerank
"""

import asyncio
import hashlib
import re
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image as PILImage

DATA_DIR = Path("./data/DV_Data")


def file_hashes() -> dict:
    """MD5 of each image's bytes — used to flag byte-identical 'duplicate'
    pairs, which make a leave-one-out hit trivial rather than a genuine
    test of cross-photo similarity."""
    hashes = {}
    for path in list(DATA_DIR.glob("*.png")) + list(DATA_DIR.glob("*.jpg")):
        hashes[path.name] = hashlib.md5(path.read_bytes()).hexdigest()
    return hashes


# Generic OS-assigned filenames ("image (1).png", "image (2).png", ...)
# don't imply the photos are related — only descriptive names do.
GENERIC_NAMES = {"image", "imagepanel", "screenshot"}


def group_key(filename: str) -> str:
    """Normalize a filename to a near-duplicate group key, or None if the
    name is too generic to imply the images are actually related."""
    name = filename.lower()
    name = re.sub(r"\.(png|jpg|jpeg)$", "", name)
    name = re.sub(r"\s*\(\d+\)\s*", "", name)  # strip "(1)", "(2)" suffixes
    name = re.sub(r"[\s_.\-]+", "", name)  # strip spaces/punctuation
    name = name.replace("bf", "")  # "BF" / "bf" suffix variants
    if name in GENERIC_NAMES or name.startswith("screenshot"):
        return None
    return name


async def embed_all(model_name: str, pretrained: str, device="cpu"):
    model, _, preprocess = open_clip.create_model_and_transforms(
        model_name, pretrained=pretrained, device=device
    )
    model.eval()
    embeddings = {}
    for path in sorted(DATA_DIR.glob("*.png")) + sorted(DATA_DIR.glob("*.jpg")):
        img = PILImage.open(path).convert("RGB")
        tensor = preprocess(img).unsqueeze(0).to(device)
        with torch.no_grad():
            emb = model.encode_image(tensor)
            emb = emb / emb.norm(dim=-1, keepdim=True)
        embeddings[path.name] = emb.squeeze().cpu().numpy()
    return embeddings


def leave_one_out_hit_rates(embeddings: dict, groups: dict, hashes: dict) -> dict:
    """For each image with group-mates, check if a group-mate is in top-1/top-3.

    Splits results into 'trivial' cases (the query has a byte-identical
    duplicate elsewhere in the corpus, so finding it is not a real test of
    similarity understanding) vs 'genuine' cases (no identical duplicate —
    a real cross-photo similarity judgment).
    """
    names = list(embeddings.keys())
    matrix = np.stack([embeddings[n] for n in names])
    stats = {
        "trivial": {"hits1": 0, "hits3": 0, "n": 0},
        "genuine": {"hits1": 0, "hits3": 0, "n": 0, "misses": []},
    }

    for i, name in enumerate(names):
        if groups[name] is None:
            continue  # generic filename, no ground truth to check
        mates = {n for n in names if n != name and groups[n] == groups[name]}
        if not mates:
            continue  # singleton, no ground truth to check

        has_identical_dupe = any(hashes[m] == hashes[name] for m in mates)
        bucket = stats["trivial"] if has_identical_dupe else stats["genuine"]
        bucket["n"] += 1

        scores = matrix @ matrix[i]
        scores[i] = -1  # exclude self
        ranked = [names[j] for j in np.argsort(-scores)]
        if ranked[0] in mates:
            bucket["hits1"] += 1
        if set(ranked[:3]) & mates:
            bucket["hits3"] += 1
        elif bucket is stats["genuine"]:
            bucket["misses"].append(name)

    def rate(bucket, key):
        return bucket[key] / bucket["n"] if bucket["n"] else 0.0

    return {
        "trivial_top1": rate(stats["trivial"], "hits1"),
        "trivial_top3": rate(stats["trivial"], "hits3"),
        "trivial_n": stats["trivial"]["n"],
        "genuine_top1": rate(stats["genuine"], "hits1"),
        "genuine_top3": rate(stats["genuine"], "hits3"),
        "genuine_n": stats["genuine"]["n"],
        "genuine_misses": stats["genuine"]["misses"],
    }


async def main():
    groups = {p.name: group_key(p.name) for p in DATA_DIR.glob("*.*") if p.suffix.lower() in (".png", ".jpg")}
    hashes = file_hashes()
    from collections import Counter
    group_sizes = Counter(g for g in groups.values() if g is not None)
    multi_member_images = sum(1 for g in groups.values() if g is not None and group_sizes[g] > 1)
    print(f"Images with at least one near-duplicate group-mate: {multi_member_images}/{len(groups)}")
    for g, count in group_sizes.items():
        if count > 1:
            print(f"  group '{g}': {count} images")
    print()

    def show(label, embeddings):
        r = leave_one_out_hit_rates(embeddings, groups, hashes)
        print(
            f"  {label}: "
            f"trivial(has exact dupe) top-1={r['trivial_top1']:.1%} top-3={r['trivial_top3']:.1%} (n={r['trivial_n']})  |  "
            f"genuine(no exact dupe) top-1={r['genuine_top1']:.1%} top-3={r['genuine_top3']:.1%} (n={r['genuine_n']})\n"
        )
        return r

    print("Embedding with ViT-B/32 (baseline)...")
    b32 = await embed_all("ViT-B-32", "openai")
    r_b32 = show("ViT-B/32", b32)

    print("Embedding with ViT-L/14 (new primary)...")
    l14 = await embed_all("ViT-L-14", "openai")
    r_l14 = show("ViT-L/14", l14)

    print("Embedding with ViT-H-14 (rerank model, laion2b)...")
    h14 = await embed_all("ViT-H-14", "laion2b_s32b_b79k")
    r_h14 = show("ViT-H/14", h14)

    print(f"=== Summary — genuine (non-duplicate) cases only, n={r_b32['genuine_n']} ===")
    print(f"  {'Model':<20} {'Top-1':>8} {'Top-3':>8}")
    print(f"  {'ViT-B/32 (old)':<20} {r_b32['genuine_top1']:>7.1%} {r_b32['genuine_top3']:>7.1%}")
    print(f"  {'ViT-L/14 (new)':<20} {r_l14['genuine_top1']:>7.1%} {r_l14['genuine_top3']:>7.1%}")
    print(f"  {'ViT-H/14 (rerank)':<20} {r_h14['genuine_top1']:>7.1%} {r_h14['genuine_top3']:>7.1%}")
    print(f"\nGenuine-case misses at top-3, ViT-L/14: {r_l14['genuine_misses']}")
    print(f"Genuine-case misses at top-3, ViT-H/14: {r_h14['genuine_misses']}")
    print(f"Genuine-case misses at top-3, ViT-B/32: {r_b32['genuine_misses']}")


if __name__ == "__main__":
    asyncio.run(main())
