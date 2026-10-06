"""Contract tests against the real Grafeo engine (the `grafeo` extra).

These pin the exact Python API calls and result shapes that
`anywidget_graph.backends.grafeo` turns into nodes and edges, so an engine
change fails here with a clear message instead of silently rendering an
empty graph. Error assertions use the exception type, never the error code.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import grafeo
import pytest
from packaging.specifiers import SpecifierSet
from packaging.version import Version

from anywidget_graph import Graph
from anywidget_graph.backends.grafeo import GrafeoBackend

ROOT = Path(__file__).resolve().parent.parent


def _rows(result) -> list[dict]:
    return list(result)


# ------------------------------------------------------------------ #
#  Engine version and capabilities                                     #
# ------------------------------------------------------------------ #


def test_engine_version_satisfies_extra():
    """The installed engine is inside the range the `grafeo` extra allows."""
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    (requirement,) = pyproject["project"]["optional-dependencies"]["grafeo"]
    spec = SpecifierSet(requirement.removeprefix("grafeo"))
    assert spec.contains(Version(grafeo.__version__), prereleases=True), f"grafeo {grafeo.__version__} not in {spec}"


def test_build_info_and_features():
    """build_info() and features() describe the engine and its query languages."""
    info = grafeo.build_info()
    assert info["version"] == grafeo.__version__
    features = set(grafeo.features())
    assert features == set(info["features"])
    # Every language the backend dispatches to must be compiled in
    assert {"gql", "cypher", "gremlin", "graphql", "sparql", "sql-pgq"} <= features


def test_language_methods_exist(grafeo_db):
    """GrafeoBackend dispatches to these methods; a rename must fail loudly."""
    for method in [*GrafeoBackend._LANGUAGE_METHODS.values(), "execute", "execute_language"]:
        assert callable(getattr(grafeo_db, method, None)), method
    assert callable(grafeo_db.get_node)
    assert callable(grafeo_db.get_edge)
    assert callable(grafeo_db.schema)


def test_execute_language_takes_language_first(grafeo_db):
    """execute_language(language, query): used for languages without a dedicated method."""
    rows = _rows(grafeo_db.execute_language("cypher", "MATCH (n:Person) RETURN n.name AS name ORDER BY name"))
    assert [row["name"] for row in rows] == ["Alix", "Gus", "Vincent"]


# ------------------------------------------------------------------ #
#  Row and entity encoding                                             #
# ------------------------------------------------------------------ #


def test_rows_are_dicts_keyed_by_column(grafeo_db):
    result = grafeo_db.execute("MATCH (a {name: 'Alix'})-[r]->(b) RETURN a, r, b")
    assert result.columns == ["a", "r", "b"]
    (row,) = _rows(result)
    assert isinstance(row, dict)
    assert list(row) == ["a", "r", "b"]


def test_node_encoding(grafeo_db):
    """Nodes: {_id: int, _labels: [str], **properties}."""
    (row,) = _rows(grafeo_db.execute("MATCH (n {name: 'Alix'}) RETURN n"))
    node = row["n"]
    assert isinstance(node["_id"], int)
    assert node["_labels"] == ["Person"]
    assert {k: v for k, v in node.items() if not k.startswith("_")} == {"name": "Alix", "age": 30, "id": "p1"}


def test_edge_encoding(grafeo_db):
    """Edges: {_id: int, _type: str, _source: int, _target: int, **properties}."""
    (row,) = _rows(grafeo_db.execute("MATCH (a {name: 'Alix'})-[r]->(b) RETURN a, r, b"))
    edge = row["r"]
    assert isinstance(edge["_id"], int)
    assert edge["_type"] == "KNOWS"
    assert edge["_source"] == row["a"]["_id"]
    assert edge["_target"] == row["b"]["_id"]
    assert {k: v for k, v in edge.items() if not k.startswith("_")} == {"since": 2020, "source": "school"}


def test_path_encoding_carries_ids(grafeo_db, ids):
    """Paths: {nodes: [int], edges: [int]}; the backend resolves the ids itself."""
    rows = _rows(grafeo_db.execute("MATCH p = (a:Person {name: 'Alix'})-[:KNOWS]->{2}(b) RETURN p"))
    (row,) = rows
    path = row["p"]
    assert set(path) >= {"nodes", "edges"}
    assert [str(n) for n in path["nodes"]] == [ids["Alix"], ids["Gus"], ids["Vincent"]]
    assert len(path["edges"]) == 2
    assert all(isinstance(e, int) for e in path["edges"])


def test_variable_length_edge_variable_is_list_of_edges(grafeo_db):
    rows = _rows(grafeo_db.execute_cypher("MATCH (a {name: 'Alix'})-[r:KNOWS*2]->(b) RETURN r"))
    (row,) = rows
    assert [e["_type"] for e in row["r"]] == ["KNOWS", "KNOWS"]


def test_path_functions_return_entities(grafeo_db):
    rows = _rows(
        grafeo_db.execute_cypher(
            "MATCH p = (a {name: 'Alix'})-[:KNOWS*2]->(b) RETURN nodes(p) AS ns, relationships(p) AS rs"
        )
    )
    (row,) = rows
    assert [n["name"] for n in row["ns"]] == ["Alix", "Gus", "Vincent"]
    assert all("_source" in r for r in row["rs"])


@pytest.mark.parametrize(
    "query",
    [
        "MATCH (n:Person) RETURN n ORDER BY n.name",
        "MATCH (n:Person) RETURN DISTINCT n",
        "MATCH (n:Person {name: 'Alix'}) RETURN n UNION MATCH (n:Person {name: 'Gus'}) RETURN n",
    ],
)
def test_nodes_keep_their_kind(grafeo_db, query):
    """ORDER BY, DISTINCT and UNION return node dicts, not raw ids or plain maps."""
    rows = _rows(grafeo_db.execute_cypher(query))
    assert rows
    assert all("_labels" in row["n"] for row in rows)


def test_collect_returns_entities(grafeo_db):
    (row,) = _rows(grafeo_db.execute_cypher("MATCH (n:Person) RETURN collect(n) AS people"))
    assert sorted(n["name"] for n in row["people"]) == ["Alix", "Gus", "Vincent"]


def test_unaliased_columns_are_named_after_expression(grafeo_db):
    result = grafeo_db.execute_cypher("MATCH (n:Person {name: 'Alix'}) RETURN n.name, n")
    assert result.columns == ["n.name", "n"]


def test_get_node_and_get_edge(grafeo_db, ids):
    """Direct lookups used to resolve path members and edge endpoints."""
    node = grafeo_db.get_node(int(ids["Alix"]))
    assert node.id == int(ids["Alix"])
    assert list(node.labels) == ["Person"]
    assert node.properties() == {"name": "Alix", "age": 30, "id": "p1"}

    (row,) = _rows(grafeo_db.execute("MATCH (a {name: 'Alix'})-[r]->() RETURN r"))
    edge = grafeo_db.get_edge(row["r"]["_id"])
    assert edge.edge_type == "KNOWS"
    assert (str(edge.source_id), str(edge.target_id)) == (ids["Alix"], ids["Gus"])
    assert edge.properties() == {"since": 2020, "source": "school"}

    assert grafeo_db.get_node(10_000) is None
    assert grafeo_db.get_edge(10_000) is None


def test_schema_shape(grafeo_db):
    schema = grafeo_db.schema()
    assert schema["labels"] == [{"name": "Person", "count": 3}]
    assert schema["edge_types"] == [{"name": "KNOWS", "count": 2}]


# ------------------------------------------------------------------ #
#  Errors raise GrafeoError (never match on the error code)            #
# ------------------------------------------------------------------ #


@pytest.mark.parametrize(
    ("method", "query"),
    [
        ("execute", "MATCH (n RETURN n"),
        ("execute", "MATCH (n) RETURN n; MATCH (m) RETURN m"),
        ("execute", "MATCH (n) WHERE n.name = $name RETURN n"),
        ("execute_cypher", "MATCH (n) WITH n.name RETURN 1"),
    ],
    ids=["syntax", "multiple-statements", "unsupplied-parameter", "unaliased-with"],
)
def test_invalid_queries_raise(grafeo_db, method, query):
    with pytest.raises(grafeo.GrafeoError):
        getattr(grafeo_db, method)(query)


def test_unknown_language_raises(grafeo_db):
    with pytest.raises(grafeo.GrafeoError):
        grafeo_db.execute_language("aql", "FOR v IN x RETURN v")


# ------------------------------------------------------------------ #
#  Backend end to end                                                  #
# ------------------------------------------------------------------ #


def _edge_set(edges: list[dict]) -> set[tuple[str, str, str]]:
    return {(e["source"], e["target"], e["label"]) for e in edges}


@pytest.mark.parametrize(
    ("language", "query"),
    [
        ("gql", "MATCH (a)-[r]->(b) RETURN a, r, b"),
        ("cypher", "MATCH (a)-[r]-(b) RETURN a, r, b"),
        ("gql", "MATCH p = (a:Person {name: 'Alix'})-[:KNOWS]->{2}(b) RETURN p"),
        ("cypher", "MATCH (a {name: 'Alix'})-[r:KNOWS*2]->(b) RETURN r"),
        ("cypher", "MATCH p = (a {name: 'Alix'})-[:KNOWS*2]->(b) RETURN nodes(p), relationships(p)"),
        ("cypher", "MATCH ()-[r]->() RETURN r"),
        ("gremlin", "g.E()"),
    ],
    ids=["gql", "undirected", "path", "var-length", "path-functions", "edges-only", "gremlin-edges"],
)
def test_backend_builds_full_graph(grafeo_db, ids, language, query):
    """Every shape that describes the whole chain renders three nodes and two edges once each."""
    nodes, edges = GrafeoBackend(grafeo_db).execute(query, language=language)

    assert sorted(n["id"] for n in nodes) == sorted(ids.values())
    assert len(edges) == 2
    assert _edge_set(edges) == {(ids["Alix"], ids["Gus"], "KNOWS"), (ids["Gus"], ids["Vincent"], "KNOWS")}


def test_backend_identity_beats_properties(grafeo_db, ids):
    """Properties named `id` / `source` do not replace engine identities."""
    nodes, edges = GrafeoBackend(grafeo_db).execute("MATCH (a {name: 'Alix'})-[r]->(b) RETURN a, r, b")
    alix = next(n for n in nodes if n["name"] == "Alix")
    assert alix["id"] == ids["Alix"]
    assert alix["labels"] == ["Person"]
    (edge,) = edges
    assert edge["source"] == ids["Alix"]
    assert edge["since"] == 2020


def test_backend_mixed_rows(grafeo_db, ids):
    """Scalar columns next to entities are ignored, entities are kept."""
    nodes, edges = GrafeoBackend(grafeo_db).execute(
        "MATCH (n:Person) RETURN n.name, n, count(*) AS c", language="cypher"
    )
    assert sorted(n["id"] for n in nodes) == sorted(ids.values())
    assert edges == []


@pytest.mark.parametrize(
    ("language", "query"),
    [
        ("gql", "MATCH (n:Nope) RETURN n"),
        ("gql", "MATCH (n:Person) RETURN n.name AS name"),
        ("graphql", "{ Person { name } }"),
        ("sparql", "SELECT ?s WHERE { ?s ?p ?o }"),
        ("sql", "SELECT * FROM GRAPH_TABLE (MATCH (a:Person) COLUMNS (a.name AS name))"),
    ],
    ids=["empty", "scalars", "graphql", "sparql", "sql"],
)
def test_backend_results_without_entities(grafeo_db, language, query):
    assert GrafeoBackend(grafeo_db).execute(query, language=language) == ([], [])


def test_backend_unknown_language_reaches_engine(grafeo_db):
    with pytest.raises(grafeo.GrafeoError):
        GrafeoBackend(grafeo_db).execute("FOR v IN x RETURN v", language="aql")


def test_backend_fetch_schema(grafeo_db):
    node_types, edge_types = GrafeoBackend(grafeo_db).fetch_schema()
    assert node_types == [{"label": "Person", "properties": [], "count": 3}]
    assert edge_types == [{"type": "KNOWS", "properties": [], "count": 2}]


# ------------------------------------------------------------------ #
#  Widget with the embedded backend                                    #
# ------------------------------------------------------------------ #


def test_widget_executes_query(grafeo_db, ids):
    graph = Graph(grafeo_db=grafeo_db, query="MATCH (a)-[r]->(b) RETURN a, r, b", query_language="gql")
    graph._execute_query += 1
    assert graph.query_error == ""
    assert sorted(n["id"] for n in graph.nodes) == sorted(ids.values())
    assert len(graph.edges) == 2
    assert graph.query_running is False
    assert graph.query_time > 0


def test_widget_reports_engine_errors(grafeo_db):
    graph = Graph(grafeo_db=grafeo_db, query="MATCH (n) RETURN n; MATCH (m) RETURN m", query_language="gql")
    graph._execute_query += 1
    assert "statement" in graph.query_error.lower()
    assert graph.nodes == []
    assert graph.query_running is False


@pytest.mark.parametrize("language", ["gql", "cypher", "gremlin", "sparql"])
def test_widget_expand_node(grafeo_db, ids, language):
    """Expanding Gus pulls in both neighbours; integer ids must be matched as integers."""
    graph = Graph(grafeo_db=grafeo_db, query_language=language)
    graph.expand_node(ids["Gus"])
    assert graph.query_error == ""
    assert sorted(n["id"] for n in graph.nodes) == sorted(ids.values())
    assert _edge_set(graph.edges) == {(ids["Alix"], ids["Gus"], "KNOWS"), (ids["Gus"], ids["Vincent"], "KNOWS")}


def test_widget_expand_node_merges(grafeo_db, ids):
    graph = Graph(grafeo_db=grafeo_db, query_language="gql")
    graph.expand_node(ids["Alix"])
    assert sorted(n["id"] for n in graph.nodes) == sorted([ids["Alix"], ids["Gus"]])
    graph.expand_node(ids["Gus"])
    assert sorted(n["id"] for n in graph.nodes) == sorted(ids.values())
    assert len(graph.edges) == 2
