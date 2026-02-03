"""UI components for anywidget-graph."""

from __future__ import annotations

from pathlib import Path

__all__ = ["get_esm", "get_css"]

_UI_DIR = Path(__file__).parent


def get_esm() -> str:
    """Get the combined ESM JavaScript for the widget."""
    return (_UI_DIR / "index.js").read_text(encoding="utf-8")


def get_css() -> str:
    """Get the combined CSS styles for the widget."""
    return (_UI_DIR / "styles.css").read_text(encoding="utf-8")
