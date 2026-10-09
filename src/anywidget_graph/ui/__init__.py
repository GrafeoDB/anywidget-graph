"""UI components for anywidget-graph."""

from __future__ import annotations

import re
from pathlib import Path

__all__ = ["get_css", "get_esm"]

_UI_DIR = Path(__file__).parent

# Backend modules: namespace used by `import * as <ns> from ...` -> prefix for their functions
_BACKEND_PREFIXES = {
    "neo4jBackend": "neo4j",
    "grafeoBackend": "grafeo",
    "grafeoEmbedBackend": "grafeoEmbed",
}

_FUNCTION_DECL = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.MULTILINE)


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


def _declared_functions(code: str) -> list[str]:
    """Names of the top-level function declarations in a module."""
    return _FUNCTION_DECL.findall(code)


def _prefixed_name(prefix: str, name: str) -> str:
    return f"{prefix}{name[0].upper()}{name[1:]}"


def _prefix_functions(code: str, prefix: str, names: list[str]) -> str:
    """Rename function names with a prefix (declarations and call sites).

    Matches whole identifiers only, so 'connect(' inside 'disconnect(' and
    method calls such as 'driver.connect(' are left alone.
    """
    for name in names:
        code = re.sub(rf"(?<![\w$.]){re.escape(name)}\(", f"{_prefixed_name(prefix, name)}(", code)
    return code


def _prepare_backend(code: str, prefix: str) -> str:
    """Strip imports/exports and prefix every function the backend module declares."""
    names = _declared_functions(code)
    return _prefix_functions(_strip_imports_exports(code), prefix, names)


def _resolve_namespaces(code: str) -> str:
    """Replace backend namespace calls (``grafeoBackend.connect(``) with the prefixed functions."""
    code = _strip_imports_exports(code)
    for namespace, prefix in _BACKEND_PREFIXES.items():
        code = re.sub(
            rf"\b{namespace}\.([A-Za-z_$][\w$]*)\(",
            lambda m, prefix=prefix: f"{_prefixed_name(prefix, m.group(1))}(",
            code,
        )
    return code


def _resolve_schema_imports(code: str) -> str:
    """Resolve schema.js named imports from backend modules.

    schema.js imports ``fetchSchema as neo4jFetchSchema`` (and the grafeo
    equivalents), which already match the prefixed names, so stripping the
    import lines is enough.
    """
    return _strip_imports_exports(code)


def get_esm() -> str:
    """Get aggregated ESM JavaScript."""
    icons_js = _read_file(_UI_DIR / "icons.js")
    neo4j_js = _read_file(_UI_DIR / "neo4j.js")
    grafeo_result_js = _read_file(_UI_DIR / "grafeo-result.js")
    grafeo_js = _read_file(_UI_DIR / "grafeo.js")
    grafeo_embed_js = _read_file(_UI_DIR / "grafeo-embed.js")
    schema_js = _read_file(_UI_DIR / "schema.js")
    settings_js = _read_file(_UI_DIR / "settings.js")
    properties_js = _read_file(_UI_DIR / "properties.js")
    results_js = _read_file(_UI_DIR / "results.js")
    lanes_js = _read_file(_UI_DIR / "lanes.js")
    toolbar_js = _read_file(_UI_DIR / "toolbar.js")
    index_js = _read_file(_UI_DIR / "index.js")

    return f"""\
// === Auto-generated ESM bundle for anywidget-graph ===
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";
import circular from "https://esm.sh/graphology-layout@0.6.1/circular.js";
import random from "https://esm.sh/graphology-layout@0.6.1/random.js";
import forceAtlas2 from "https://esm.sh/graphology-layout-forceatlas2@0.10.1";
import * as d3Force from "https://esm.sh/d3-force@3.0.0";
import neo4j from "https://cdn.jsdelivr.net/npm/neo4j-driver@5.28.0/lib/browser/neo4j-web.esm.min.js";

// === Icons ===
{_strip_imports_exports(icons_js)}

// === Neo4j Backend ===
{_prepare_backend(neo4j_js, "neo4j")}

// === Grafeo Result Conversion (shared by server and WASM) ===
{_strip_imports_exports(grafeo_result_js)}

// === Grafeo Server Backend ===
{_prepare_backend(grafeo_js, "grafeo")}

// === Grafeo WASM Backend ===
{_prepare_backend(grafeo_embed_js, "grafeoEmbed")}

// === Schema Panel ===
{_resolve_schema_imports(schema_js)}

// === Settings Panel ===
{_resolve_namespaces(settings_js)}

// === Properties Panel ===
{_strip_imports_exports(properties_js)}

// === Results Drawer ===
{_strip_imports_exports(results_js)}

// === Linked Lanes (pure helpers) ===
{_strip_imports_exports(lanes_js)}

// === Toolbar ===
{_resolve_namespaces(toolbar_js)}

// === Main Entry ===
{_resolve_namespaces(index_js)}

export default {{ render }};
"""


def get_css() -> str:
    """Get the combined CSS styles for the widget."""
    return _read_file(_UI_DIR / "styles.css")
