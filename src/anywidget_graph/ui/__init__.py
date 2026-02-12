"""UI components for anywidget-graph."""

from __future__ import annotations

import re
from pathlib import Path

__all__ = ["get_css", "get_esm"]

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


def _prefix_functions(code: str, prefix: str, names: list[str]) -> str:
    """Rename function names with a prefix using word-boundary regex.

    Replaces both declarations and call sites while avoiding
    substring matches (e.g. 'connect(' inside 'disconnect(').
    """
    for name in names:
        code = re.sub(rf"\b{name}\(", f"{prefix}{name[0].upper()}{name[1:]}(", code)
    return code


def _prepare_neo4j(code: str) -> str:
    """Strip imports/exports and prefix all neo4j functions (declarations + call sites)."""
    code = _strip_imports_exports(code)
    return _prefix_functions(
        code,
        "neo4j",
        [
            "fetchSchema",
            "executeQuery",
            "processRecords",
            "processValue",
        ],
    )


def _prepare_grafeo(code: str) -> str:
    """Strip imports/exports and prefix all grafeo server functions."""
    code = _strip_imports_exports(code)
    return _prefix_functions(
        code,
        "grafeo",
        [
            "connect",
            "disconnect",
            "isConnected",
            "fetchSchema",
            "executeQuery",
            "processResult",
            "processValue",
        ],
    )


def _prepare_grafeo_embed(code: str) -> str:
    """Strip imports/exports and prefix all grafeo WASM functions."""
    code = _strip_imports_exports(code)
    return _prefix_functions(
        code,
        "grafeoEmbed",
        [
            "connect",
            "disconnect",
            "isConnected",
            "fetchSchema",
            "executeQuery",
            "processResult",
            "processValue",
        ],
    )


def _resolve_namespaces(code: str) -> str:
    """Replace all backend namespace references with direct function calls."""
    code = _strip_imports_exports(code)
    # neo4jBackend.*
    code = code.replace("neo4jBackend.executeQuery(", "neo4jExecuteQuery(")
    code = code.replace("neo4jBackend.connect(", "connect(")
    code = code.replace("neo4jBackend.disconnect(", "disconnect(")
    code = code.replace("neo4jBackend.isConnected(", "isConnected(")
    code = code.replace("neo4jBackend.fetchSchema(", "neo4jFetchSchema(")
    # grafeoBackend.*
    code = code.replace("grafeoBackend.executeQuery(", "grafeoExecuteQuery(")
    code = code.replace("grafeoBackend.connect(", "grafeoConnect(")
    code = code.replace("grafeoBackend.disconnect(", "grafeoDisconnect(")
    code = code.replace("grafeoBackend.isConnected(", "grafeoIsConnected(")
    code = code.replace("grafeoBackend.fetchSchema(", "grafeoFetchSchema(")
    # grafeoEmbedBackend.*
    code = code.replace("grafeoEmbedBackend.executeQuery(", "grafeoEmbedExecuteQuery(")
    code = code.replace("grafeoEmbedBackend.connect(", "grafeoEmbedConnect(")
    code = code.replace("grafeoEmbedBackend.disconnect(", "grafeoEmbedDisconnect(")
    code = code.replace("grafeoEmbedBackend.isConnected(", "grafeoEmbedIsConnected(")
    code = code.replace("grafeoEmbedBackend.fetchSchema(", "grafeoEmbedFetchSchema(")
    return code


def _resolve_schema_imports(code: str) -> str:
    """Resolve schema.js named imports from backend modules."""
    code = _strip_imports_exports(code)
    # The schema.js file imports fetchSchema as named imports from backends
    # After stripping, these become direct calls with the right names
    code = code.replace("neo4jFetchSchema(", "neo4jFetchSchema(")
    code = code.replace("grafeoFetchSchema(", "grafeoFetchSchema(")
    code = code.replace("grafeoEmbedFetchSchema(", "grafeoEmbedFetchSchema(")
    return code


def get_esm() -> str:
    """Get aggregated ESM JavaScript."""
    icons_js = _read_file(_UI_DIR / "icons.js")
    neo4j_js = _read_file(_UI_DIR / "neo4j.js")
    grafeo_js = _read_file(_UI_DIR / "grafeo.js")
    grafeo_embed_js = _read_file(_UI_DIR / "grafeo-embed.js")
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

// === Grafeo Server Backend ===
{_prepare_grafeo(grafeo_js)}

// === Grafeo WASM Backend ===
{_prepare_grafeo_embed(grafeo_embed_js)}

// === Schema Panel ===
{_resolve_schema_imports(schema_js)}

// === Settings Panel ===
{_resolve_namespaces(settings_js)}

// === Properties Panel ===
{_strip_imports_exports(properties_js)}

// === Toolbar ===
{_resolve_namespaces(toolbar_js)}

// === Main Entry ===
{_resolve_namespaces(index_js)}

export default {{ render }};
"""


def get_css() -> str:
    """Get the combined CSS styles for the widget."""
    return _read_file(_UI_DIR / "styles.css")
