"""Tests for the custom dataset ingestion checkpoint."""

import tempfile
from pathlib import Path

from scripts.ingest_custom import IngestionCheckpoint


class TestIngestionCheckpoint:
    def test_is_processed_false(self):
        """New checkpoint reports image as not processed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cp = IngestionCheckpoint(Path(tmpdir) / "test.db")
            assert cp.is_processed("IMG_001") is False
            cp.close()

    def test_mark_and_check(self):
        """Marking an image as processed makes is_processed return True."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cp = IngestionCheckpoint(Path(tmpdir) / "test.db")
            cp.mark_processed("IMG_001")
            assert cp.is_processed("IMG_001") is True
            cp.close()

    def test_checkpoint_idempotent(self):
        """Marking the same image twice does not error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cp = IngestionCheckpoint(Path(tmpdir) / "test.db")
            cp.mark_processed("IMG_001")
            cp.mark_processed("IMG_001")  # Should not raise
            assert cp.is_processed("IMG_001") is True
            cp.close()

    def test_count_processed(self):
        """count_processed returns the correct count."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cp = IngestionCheckpoint(Path(tmpdir) / "test.db")
            assert cp.count_processed() == 0
            cp.mark_processed("IMG_001")
            cp.mark_processed("IMG_002")
            assert cp.count_processed() == 2
            cp.close()

    def test_persistence_across_instances(self):
        """Checkpoint persists across different instances (resumability)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            cp1 = IngestionCheckpoint(db_path)
            cp1.mark_processed("IMG_001")
            cp1.close()

            cp2 = IngestionCheckpoint(db_path)
            assert cp2.is_processed("IMG_001") is True
            cp2.close()
