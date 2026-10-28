"""UI components for anywidget-graph."""

from __future__ import annotations

from pathlib import Path

__all__ = ["get_css", "get_esm", "get_vendor_js"]

_UI_DIR = Path(__file__).parent


def _read_file(path: Path) -> str:
    """Read file contents."""
    return path.read_text(encoding="utf-8")


def get_vendor_js() -> str:
    """The bundled graph libraries (a script that sets the global ``anywidgetGraphVendor``)."""
    return _read_file(_UI_DIR / "vendor" / "graph-libs.min.js")


def get_esm() -> str:
    """The widget's ES module: the graph libraries, then the front end esbuild bundles into ``dist/widget.js``.

    The bundle is built from the modules in this folder by ``scripts/vendor/build-esm.mjs`` (``npm run build:esm``);
    CI and tests/test_ui.py fail when it is stale. It reads the libraries through ``vendor-globals.js``, from the
    ``anywidgetGraphVendor`` the script in front of it defines.
    """
    return f"""\
// === Auto-generated ESM bundle for anywidget-graph ===
// graphology, sigma, graphology-layout, graphology-layout-forceatlas2 and d3-force are bundled
// (vendor/graph-libs.min.js, licenses in vendor/graph-libs.LICENSES.txt): the widget needs no CDN
{get_vendor_js()}
{_read_file(_UI_DIR / "dist" / "widget.js")}"""


def get_css() -> str:
    """Get the combined CSS styles for the widget."""
    return _read_file(_UI_DIR / "styles.css")
