"""
The small trainable head sitting on top of a frozen backbone embedding
(see scripts/train_metric_head.py for how it's trained, and
scripts/evaluate.py + model_registry.json for the measured evaluation
that led to it being adopted as the primary embedding model).

Defined once here so both the training script and the production
embedding service (app/services/embedding.py) share the exact same
architecture — a head trained under one definition and loaded under a
different one would silently produce garbage.
"""

import torch.nn as nn
import torch.nn.functional as F


class ProjectionHead(nn.Module):
    """~230K parameters at the default sizes — deliberately tiny relative
    to the labeled anomaly library (tens to low hundreds of images)."""

    def __init__(self, in_dim: int, hidden_dim: int = 256, out_dim: int = 128, dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, out_dim),
        )

    def forward(self, x):
        return F.normalize(self.net(x), dim=-1)
