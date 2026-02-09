"""UI components for anywidget-graph."""

from __future__ import annotations

from pathlib import Path

__all__ = ["get_esm", "get_css"]

_UI_DIR = Path(__file__).parent


def _read_file(path: Path) -> str:
    """Read file contents."""
    return path.read_text(encoding="utf-8")


def _strip_imports_exports(code: str) -> str:
    """Remove import and export statements from JS code."""
    lines = []
    for line in code.split("\n"):
        stripped = line.strip()
        if stripped.startswith("import "):
            continue
        if stripped.startswith("export function "):
            line = line.replace("export function ", "function ")
        elif stripped.startswith("export async function "):
            line = line.replace("export async function ", "async function ")
        elif stripped.startswith("export const "):
            line = line.replace("export const ", "const ")
        elif stripped.startswith("export default"):
            continue
        lines.append(line)
    return "\n".join(lines)


def _prepare_neo4j(code: str) -> str:
    """Strip imports/exports and rename executeQuery to avoid clash with index.js."""
    code = _strip_imports_exports(code)
    code = code.replace("async function executeQuery(", "async function neo4jExecuteQuery(")
    return code


def _resolve_neo4j_namespace(code: str) -> str:
    """Replace neo4jBackend.xxx() calls with direct function calls."""
    code = _strip_imports_exports(code)
    code = code.replace("neo4jBackend.executeQuery(", "neo4jExecuteQuery(")
    code = code.replace("neo4jBackend.connect(", "connect(")
    code = code.replace("neo4jBackend.disconnect(", "disconnect(")
    code = code.replace("neo4jBackend.isConnected(", "isConnected(")
    code = code.replace("neo4jBackend.fetchSchema(", "fetchSchema(")
    return code


def get_esm() -> str:
    """Get aggregated ESM JavaScript.

    Combines all UI components into a single module so that
    no relative imports remain. This is required for anywidget
    environments that load ESM via Blob URLs (Pyodide, marimo islands).
    """
    icons_js = _read_file(_UI_DIR / "icons.js")
    neo4j_js = _read_file(_UI_DIR / "neo4j.js")
    schema_js = _read_file(_UI_DIR / "schema.js")
    settings_js = _read_file(_UI_DIR / "settings.js")
    properties_js = _read_file(_UI_DIR / "properties.js")
    toolbar_js = _read_file(_UI_DIR / "toolbar.js")
    index_js = _read_file(_UI_DIR / "index.js")

    return f"""\
// === Auto-generated ESM bundle for anywidget-graph ===
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";
import neo4j from "https://cdn.jsdelivr.net/npm/neo4j-driver@5.28.0/lib/browser/neo4j-web.esm.min.js";

// === Icons ===
{_strip_imports_exports(icons_js)}

// === Neo4j Backend ===
{_prepare_neo4j(neo4j_js)}

// === Schema Panel ===
{_strip_imports_exports(schema_js)}

// === Settings Panel ===
{_resolve_neo4j_namespace(settings_js)}

// === Properties Panel ===
{_strip_imports_exports(properties_js)}

// === Toolbar ===
{_strip_imports_exports(toolbar_js)}

// === Main Entry ===
{_resolve_neo4j_namespace(index_js)}

export default {{ render }};
"""


def get_css() -> str:
    """Get the combined CSS styles for the widget."""
    return _read_file(_UI_DIR / "styles.css")
