"""Tests for the ESM bundle produced by ``anywidget_graph.ui``.

The bundler concatenates the UI modules after stripping imports/exports and
renaming backend functions, so a mistake there only shows up in the browser.
These tests check the produced string (and parse it with Node.js), the single
pinned WASM engine version, and run the browser-side Grafeo modules under
Node against real engine output.
"""

from __future__ import annotations

import json
import re
import subprocess
import tomllib
from pathlib import Path

import pytest
from packaging.specifiers import SpecifierSet
from packaging.version import Version

from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.ui import get_esm

ROOT = Path(__file__).resolve().parent.parent
UI_DIR = ROOT / "src" / "anywidget_graph" / "ui"
WASM_URL_RE = re.compile(r"@grafeo-db/wasm@")
VERSION_RE = re.compile(r'export const GRAFEO_WASM_VERSION = "([^"]+)";')


def _wasm_version() -> str:
    match = VERSION_RE.search((UI_DIR / "grafeo-embed.js").read_text(encoding="utf-8"))
    assert match, "GRAFEO_WASM_VERSION not found in grafeo-embed.js"
    return match.group(1)


def _run_node(node_bin: str, *args: str, stdin: str | None = None) -> str:
    proc = subprocess.run(
        [node_bin, *args], input=stdin, capture_output=True, text=True, encoding="utf-8", cwd=ROOT, check=False
    )
    assert proc.returncode == 0, f"node {' '.join(args)} failed:\n{proc.stdout}\n{proc.stderr}"
    return proc.stdout


# ------------------------------------------------------------------ #
#  Produced bundle                                                     #
# ------------------------------------------------------------------ #


@pytest.fixture(scope="module")
def esm() -> str:
    return get_esm()


def test_bundle_has_no_imports_and_one_default_export(esm):
    """The libraries are bundled: a page that cannot reach a CDN still renders the widget."""
    assert [line for line in esm.splitlines() if line.lstrip().startswith("import ")] == []
    assert not re.search(r"""\bfrom\s*["']https?://""", esm)
    assert re.search(r"export \{\s*(\w+) as default\s*\};\s*$", esm)
    assert esm.count("export ") == 1


def test_bundle_is_built_from_the_current_sources(node_bin):
    """ui/dist/widget.js is what esbuild makes of the modules now (CI installs esbuild in scripts/vendor)."""
    if not (ROOT / "scripts" / "vendor" / "node_modules" / "esbuild").exists():
        pytest.skip("esbuild is not installed: npm ci in scripts/vendor")
    _run_node(node_bin, "scripts/vendor/build-esm.mjs", "--check")


def test_only_the_optional_backends_load_code_from_the_network(esm):
    """neo4j-driver and the WASM engine load when their backend connects, never with the widget."""
    # Dynamic imports only: graphology's own graph.import(...) method is no module load
    dynamic = set(re.findall(r"""(?<![\w$.])import\(\s*([^)]+?)\s*\)""", esm))
    assert dynamic == {"NEO4J_DRIVER_URL", "`${GRAFEO_WASM_CDN}/grafeo_wasm_bg.js`"}
    driver = '"https://cdn.jsdelivr.net/npm/neo4j-driver@5.28.3/lib/browser/neo4j-web.esm.min.js";'
    assert esm.count(f"NEO4J_DRIVER_URL = {driver}") == 1


def test_bundle_loads_without_a_network(esm, node_bin, tmp_path):
    """Node imports no https: URL, so the module loading at all shows that nothing comes from a CDN.

    sigma reads WebGL constants when it loads; Node has no WebGL, so a stub stands in for them.
    """
    bundle = tmp_path / "widget.mjs"
    bundle.write_text(esm, encoding="utf-8")
    script = (
        "globalThis.WebGL2RenderingContext = globalThis.WebGLRenderingContext = new Proxy({}, { get: () => 0 });"
        f"const m = await import({json.dumps(bundle.as_uri())}); console.log(typeof m.default.render)"
    )
    out = _run_node(node_bin, "--input-type=module", "-e", script)
    assert out.strip() == "function"


def test_the_bundled_libraries_carry_their_licenses():
    licenses = (UI_DIR / "vendor" / "graph-libs.LICENSES.txt").read_text(encoding="utf-8")
    for package in ("graphology", "sigma", "graphology-layout", "graphology-layout-forceatlas2", "d3-force"):
        assert f"\n== {package}@" in f"\n{licenses}", package


def test_wasm_version_is_pinned_exactly_once():
    """The browser engine URL is built from one constant: an engine bump is a one-line change."""
    hits = {
        path.name: len(WASM_URL_RE.findall(path.read_text(encoding="utf-8"))) for path in sorted(UI_DIR.glob("*.js"))
    }
    assert {name: count for name, count in hits.items() if count} == {"grafeo-embed.js": 1}
    # An exact npm version (0.6.0, or a pre-release such as 0.6.0-beta.1), never a range
    assert re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?", _wasm_version()), "pin an exact version"


def test_bundle_contains_pinned_wasm_url_once(esm):
    version = _wasm_version()
    assert esm.count(f'GRAFEO_WASM_VERSION = "{version}";') == 1
    assert esm.count("https://cdn.jsdelivr.net/npm/@grafeo-db/wasm@${GRAFEO_WASM_VERSION}") == 1
    assert len(WASM_URL_RE.findall(esm)) == 1
    # esm.sh cannot serve the wasm-pack bundler build (no init, wasm never instantiated)
    assert "esm.sh/@grafeo-db" not in esm


def test_wasm_version_in_lockstep_with_python_extra():
    """The browser engine and the Python `grafeo` extra must target the same release line."""
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    (requirement,) = pyproject["project"]["optional-dependencies"]["grafeo"]
    spec = SpecifierSet(requirement.removeprefix("grafeo"))
    version = _wasm_version()
    assert spec.contains(Version(version), prereleases=True), f"@grafeo-db/wasm {version} outside grafeo{spec}"


def test_bundle_parses_with_node(esm, node_bin, tmp_path):
    bundle = tmp_path / "widget.mjs"
    bundle.write_text(esm, encoding="utf-8")
    _run_node(node_bin, "--check", str(bundle))


def test_js_unit_tests(node_bin):
    # Every Node test file, so a new one cannot be left out (`node --test "tests/js/*.test.mjs"` by hand)
    tests = sorted(path.relative_to(ROOT).as_posix() for path in (ROOT / "tests" / "js").glob("*.test.mjs"))
    assert len(tests) >= 4
    _run_node(node_bin, "--test", *tests)


# ------------------------------------------------------------------ #
#  JS converter against real engine rows                               #
# ------------------------------------------------------------------ #

_JS_CONVERT = """
import { grafeoRowsToGraph } from "./src/anywidget_graph/ui/grafeo-result.js";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { rows, nodes, edges } = JSON.parse(chunks.join(""));
const lookup = (query) => {
  const ids = query.match(/IN \\[(.*)\\]/)[1].split(", ");
  return query.includes("id(r)")
    ? ids.filter((i) => edges[i]).map((i) => ({ r: edges[i] }))
    : ids.filter((i) => nodes[i]).map((i) => ({ n: nodes[i] }));
};
process.stdout.write(JSON.stringify(await grafeoRowsToGraph(rows, lookup)));
"""

_JS_LOOKUP_QUERIES = """
import { grafeoNodeLookupQuery, grafeoEdgeLookupQuery } from "./src/anywidget_graph/ui/grafeo-result.js";
const [nodeIds, edgeIds] = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify([grafeoNodeLookupQuery(nodeIds), grafeoEdgeLookupQuery(edgeIds)]));
"""


def _canonical(nodes: list[dict], edges: list[dict]) -> tuple[list, list]:
    return (
        sorted((n["id"], tuple(n.get("labels", [])), n.get("name")) for n in nodes),
        sorted((e["source"], e["target"], e["label"]) for e in edges),
    )


@pytest.mark.parametrize(
    ("language", "query"),
    [
        ("gql", "MATCH (a)-[r]->(b) RETURN a, r, b"),
        ("cypher", "MATCH (a)-[r]-(b) RETURN a, r, b"),
        ("gql", "MATCH p = (a:Person {name: 'Alix'})-[:KNOWS]->{2}(b) RETURN p"),
        ("cypher", "MATCH (a {name: 'Alix'})-[r:KNOWS*2]->(b) RETURN r"),
        ("cypher", "MATCH (n:Person) RETURN n.name, collect(n) AS ns"),
        ("gremlin", "g.E()"),
        ("gql", "MATCH (n:Nope) RETURN n"),
    ],
    ids=["gql", "undirected", "path", "var-length", "collect", "gremlin-edges", "empty"],
)
def test_js_converter_matches_python_backend(grafeo_db, node_bin, language, query):
    """Browser and Python backends turn the same engine rows into the same graph."""
    backend = GrafeoBackend(grafeo_db)
    rows = list(backend._run(query, language))
    all_nodes = {str(r["n"]["_id"]): r["n"] for r in grafeo_db.execute("MATCH (n) RETURN n")}
    all_edges = {str(r["r"]["_id"]): r["r"] for r in grafeo_db.execute("MATCH ()-[r]->() RETURN r")}
    payload = json.dumps({"rows": rows, "nodes": all_nodes, "edges": all_edges})

    js_graph = json.loads(_run_node(node_bin, "--input-type=module", "-e", _JS_CONVERT, stdin=payload))
    py_nodes, py_edges = backend.execute(query, language=language)

    assert _canonical(js_graph["nodes"], js_graph["edges"]) == _canonical(py_nodes, py_edges)


def test_js_lookup_queries_run_on_the_engine(grafeo_db, ids, node_bin):
    """The GQL the browser sends to resolve path ids is valid and returns the entities."""
    (row,) = grafeo_db.execute("MATCH (a {name: 'Alix'})-[r]->() RETURN r")
    edge_id = str(row["r"]["_id"])
    wanted = json.dumps([[ids["Alix"], ids["Gus"]], [edge_id]])
    node_query, edge_query = json.loads(_run_node(node_bin, "--input-type=module", "-e", _JS_LOOKUP_QUERIES, wanted))
    assert sorted(r["n"]["name"] for r in grafeo_db.execute(node_query)) == ["Alix", "Gus"]
    assert [str(r["r"]["_id"]) for r in grafeo_db.execute(edge_query)] == [edge_id]


def _trait_defaults_js() -> dict:
    source = (UI_DIR / "defaults.js").read_text(encoding="utf-8")
    match = re.search(r"export const TRAIT_DEFAULTS = (\{.*?\});\s*$", source, re.DOTALL | re.MULTILINE)
    assert match, "defaults.js holds export const TRAIT_DEFAULTS = {...};"
    return json.loads(match.group(1))


def test_front_end_defaults_match_the_python_traits():
    # A host without Python (an app's own model) gets these for the settings it leaves out
    from anywidget_graph import Graph

    graph = Graph()
    expected = {
        name: getattr(graph, name) for name in Graph.class_own_traits(sync=True) if name not in ("_esm", "_css")
    }
    assert _trait_defaults_js() == expected


def test_bundle_carries_the_defaults(esm):
    assert re.search(r"\b(var|const|let) TRAIT_DEFAULTS = \{", esm)
    assert "export const TRAIT_DEFAULTS" not in esm
