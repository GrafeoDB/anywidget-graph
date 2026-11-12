"""UI components for anywidget-graph."""

from __future__ import annotations

from pathlib import Path

__all__ = ["get_css", "get_esm", "get_export3d_js", "get_export_js", "get_vendor_js", "get_vendor_js_3d"]

_UI_DIR = Path(__file__).parent


def _read_file(path: Path) -> str:
    """Read file contents."""
    return path.read_text(encoding="utf-8")


def get_vendor_js() -> str:
    """The bundled graph libraries (a script that sets the global ``anywidgetGraphVendor``)."""
    return _read_file(_UI_DIR / "vendor" / "graph-libs.min.js")


def get_vendor_js_3d() -> str:
    """The bundled Three.js and OrbitControls for the 3D view (a script that sets ``anywidgetGraph3dVendor``)."""
    return _read_file(_UI_DIR / "vendor" / "three.min.js")


def get_esm() -> str:
    """The widget's ES module: the graph libraries, then the front end esbuild bundles into ``dist/widget.js``.

    The bundle is built from the modules in this folder by ``scripts/vendor/build-esm.mjs`` (``npm run build:esm``);
    CI and tests/test_ui.py fail when it is stale. It reads the libraries through ``vendor-globals.js``, from the
    ``anywidgetGraphVendor`` the script in front of it defines. Three.js (for the 3D view, ``view="3d"`` /
    ``Graph3D``) is bundled the same way as ``anywidgetGraph3dVendor``, read through ``vendor-globals3d.js``.
    """
    return f"""\
// === Auto-generated ESM bundle for anywidget-graph ===
// graphology, sigma, graphology-layout, graphology-layout-forceatlas2 and d3-force are bundled
// (vendor/graph-libs.min.js, licenses in vendor/graph-libs.LICENSES.txt): the widget needs no CDN
{get_vendor_js()}
// Three.js and OrbitControls for the 3D view (vendor/three.min.js, licenses in vendor/three.LICENSES.txt)
{get_vendor_js_3d()}
{_read_file(_UI_DIR / "dist" / "widget.js")}"""


def get_export_js() -> str:
    """The standalone export page's renderer: ``dist/export.js``, bundled from ``export.ts`` by
    ``scripts/vendor/build-esm.mjs`` the same way as ``dist/widget.js``. ``widget.py``'s ``to_html`` inlines it into
    ``export.html`` after the page's ``DATA``/``OPTIONS`` constants."""
    return _read_file(_UI_DIR / "dist" / "export.js")


def get_export3d_js() -> str:
    """The 3D view's export page renderer: ``dist/export3d.js``, bundled from ``export3d.ts`` like ``export.js``.
    ``to_html`` inlines it into ``export3d.html`` when the graph's ``view`` is ``"3d"``."""
    return _read_file(_UI_DIR / "dist" / "export3d.js")


def get_css() -> str:
    """Get the combined CSS styles for the widget."""
    return _read_file(_UI_DIR / "styles.css")
