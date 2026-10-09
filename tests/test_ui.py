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
from anywidget_graph.ui import (
    _declared_functions,
    _prefix_functions,
    _resolve_namespaces,
    _strip_imports_exports,
    get_esm,
)

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
#  Bundler helpers                                                     #
# ------------------------------------------------------------------ #


def test_strip_imports_exports():
    code = 'import { a } from "./a.js";\nexport function f() {}\nexport async function g() {}\nexport const X = 1;\n'
    code += "export default { f };\n"
    assert _strip_imports_exports(code) == "function f() {}\nasync function g() {}\nconst X = 1;\n"


def test_declared_functions():
    code = "\n".join(
        [
            "export async function connect(a) {}",
            "function helper() {}",
            "  function nested() {}",
            "const x = function () {};",
        ]
    )
    assert _declared_functions(code) == ["connect", "helper"]


def test_prefix_functions_renames_whole_identifiers_only():
    code = "function connect(m) { disconnect(m); driver.connect(m); reconnect(m); connect(m); }"
    assert _prefix_functions(code, "grafeo", ["connect"]) == (
        "function grafeoConnect(m) { disconnect(m); driver.connect(m); reconnect(m); grafeoConnect(m); }"
    )


def test_resolve_namespaces():
    code = "await grafeoEmbedBackend.connect(model);\nneo4jBackend.fetchSchema(m);\ngrafeoBackend.executeQuery(q);"
    assert _resolve_namespaces(code) == (
        "await grafeoEmbedConnect(model);\nneo4jFetchSchema(m);\ngrafeoExecuteQuery(q);"
    )


# ------------------------------------------------------------------ #
#  Produced bundle                                                     #
# ------------------------------------------------------------------ #


@pytest.fixture(scope="module")
def esm() -> str:
    return get_esm()


def test_bundle_has_only_header_imports_and_one_default_export(esm):
    import_lines = [line for line in esm.splitlines() if line.lstrip().startswith("import ")]
    assert all(line.startswith("import ") and "https://" in line for line in import_lines), import_lines
    assert len(import_lines) == 7
    assert [line for line in esm.splitlines() if line.lstrip().startswith("export ")] == ["export default { render };"]


def test_bundle_resolves_all_backend_namespaces(esm):
    assert not re.search(r"\b(neo4j|grafeo|grafeoEmbed)Backend\.", esm)


def test_bundle_calls_only_declared_backend_functions(esm):
    """Every renamed backend call must point at a function the bundle declares."""
    declared = set(_declared_functions(esm))
    called = set(re.findall(r"(?<![\w$.])((?:neo4j|grafeoEmbed|grafeo)[A-Z][\w$]*)\(", esm))
    assert called, "no backend calls found"
    assert called - declared == set()


def test_bundle_declares_no_duplicate_functions(esm):
    names = _declared_functions(esm)
    assert len(names) == len(set(names)), sorted({n for n in names if names.count(n) > 1})


def test_wasm_version_is_pinned_exactly_once():
    """The browser engine URL is built from one constant: the 0.6.0 bump is a one-line change."""
    hits = {
        path.name: len(WASM_URL_RE.findall(path.read_text(encoding="utf-8"))) for path in sorted(UI_DIR.glob("*.js"))
    }
    assert {name: count for name, count in hits.items() if count} == {"grafeo-embed.js": 1}
    assert re.fullmatch(r"\d+\.\d+\.\d+", _wasm_version()), "pin an exact version"


def test_bundle_contains_pinned_wasm_url_once(esm):
    version = _wasm_version()
    assert esm.count(f'const GRAFEO_WASM_VERSION = "{version}";') == 1
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
    _run_node(node_bin, "--test", "tests/js/grafeo-result.test.mjs", "tests/js/lanes.test.mjs")


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
