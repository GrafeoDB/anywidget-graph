"""UI components for anywidget-graph."""

from __future__ import annotations

import re
from pathlib import Path

__all__ = ["get_css", "get_esm", "get_vendor_js"]

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


def get_vendor_js() -> str:
    """The bundled graph libraries (a script that sets the global ``anywidgetGraphVendor``)."""
    return _read_file(_UI_DIR / "vendor" / "graph-libs.min.js")


def get_esm() -> str:
    """Get aggregated ESM JavaScript."""
    defaults_js = _read_file(_UI_DIR / "defaults.js")
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

    vendor_js = get_vendor_js()

    return f"""\
// === Auto-generated ESM bundle for anywidget-graph ===
// graphology, sigma, graphology-layout, graphology-layout-forceatlas2 and d3-force are bundled
// (vendor/graph-libs.min.js, licenses in vendor/graph-libs.LICENSES.txt): the widget needs no CDN
{vendor_js}
const {{ Graph, Sigma, circular, random, forceAtlas2, d3Force }} = anywidgetGraphVendor;

// === Defaults (for a host without Python) ===
{_strip_imports_exports(defaults_js)}

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
