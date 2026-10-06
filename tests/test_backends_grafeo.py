"""Unit tests for GrafeoBackend result conversion, using fake databases."""

from __future__ import annotations

from dataclasses import dataclass, field

from anywidget_graph.backends.grafeo import GrafeoBackend


def _node(node_id: int, /, *labels: str, **props) -> dict:
    return {"_id": node_id, "_labels": list(labels), **props}


def _edge(edge_id: int, source: int, target: int, edge_type: str = "KNOWS", /, **props) -> dict:
    return {"_id": edge_id, "_source": source, "_target": target, "_type": edge_type, **props}


@dataclass
class FakeNode:
    id: int
    labels: list[str]
    props: dict = field(default_factory=dict)

    def properties(self) -> dict:
        return dict(self.props)


@dataclass
class FakeEdge:
    id: int
    edge_type: str
    source_id: int
    target_id: int
    props: dict = field(default_factory=dict)

    def properties(self) -> dict:
        return dict(self.props)


class FakeDB:
    """Returns canned rows from every execute method and serves direct lookups."""

    def __init__(self, rows, *, nodes=None, edges=None):
        self.rows = rows
        self.nodes = {n.id: n for n in nodes or []}
        self.edges = {e.id: e for e in edges or []}
        self.calls: list[tuple] = []
        self.lookups: list[tuple[str, int]] = []

    def execute(self, query):
        self.calls.append(("execute", query))
        return self.rows

    def execute_cypher(self, query):
        self.calls.append(("execute_cypher", query))
        return self.rows

    def execute_language(self, language, query):
        self.calls.append(("execute_language", language, query))
        return self.rows

    def get_node(self, node_id):
        self.lookups.append(("node", node_id))
        return self.nodes.get(node_id)

    def get_edge(self, edge_id):
        self.lookups.append(("edge", edge_id))
        return self.edges.get(edge_id)


class LookuplessDB:
    """A database without get_node / get_edge."""

    def __init__(self, rows):
        self.rows = rows

    def execute(self, query):
        return self.rows


ALIX = FakeNode(1, ["Person"], {"name": "Alix"})
GUS = FakeNode(2, ["Person"], {"name": "Gus"})
KNOWS = FakeEdge(10, "KNOWS", 1, 2, {"since": 2020})


# ------------------------------------------------------------------ #
#  Language dispatch                                                   #
# ------------------------------------------------------------------ #


def test_execute_gql_uses_execute():
    db = FakeDB([])
    GrafeoBackend(db).execute("MATCH (n) RETURN n", language="gql")
    assert db.calls == [("execute", "MATCH (n) RETURN n")]


def test_execute_unmapped_language_uses_execute_language():
    db = FakeDB([])
    GrafeoBackend(db).execute("FOR v IN x RETURN v", language="aql")
    assert db.calls == [("execute_language", "aql", "FOR v IN x RETURN v")]


def test_execute_unmapped_language_without_execute_language():
    db = LookuplessDB([])
    assert GrafeoBackend(db).execute("x", language="aql") == ([], [])


# ------------------------------------------------------------------ #
#  Result conversion                                                   #
# ------------------------------------------------------------------ #


def test_process_empty_result():
    assert GrafeoBackend(FakeDB([])).execute("q", language="gql") == ([], [])


def test_process_scalar_rows():
    rows = [{"name": "Alix", "age": 30}, {"name": "Gus", "age": None}]
    assert GrafeoBackend(FakeDB(rows)).execute("q", language="gql") == ([], [])


def test_process_deduplicates_nodes_and_edges():
    """An undirected match returns every edge twice; it must render once."""
    a, b, r = _node(1, "Person", name="Alix"), _node(2, "Person", name="Gus"), _edge(10, 1, 2)
    rows = [{"a": a, "r": r, "b": b}, {"a": b, "r": r, "b": a}]
    nodes, edges = GrafeoBackend(FakeDB(rows)).execute("q", language="gql")
    assert [n["id"] for n in nodes] == ["1", "2"]
    assert edges == [{"label": "KNOWS", "source": "1", "target": "2"}]


def test_process_keeps_parallel_edges():
    rows = [{"a": _node(1, "P"), "b": _node(2, "P"), "r": [_edge(10, 1, 2), _edge(11, 1, 2)]}]
    _, edges = GrafeoBackend(FakeDB(rows)).execute("q", language="gql")
    assert len(edges) == 2


def test_process_identity_wins_over_properties():
    """Regression: a property named `id` used to overwrite the node id, so edges pointed at missing nodes."""
    rows = [
        {
            "a": _node(1, "Movie", id="m1", name="The Matrix"),
            "r": _edge(10, 2, 1, "ACTED_IN", source="imdb", target="x"),
            "b": _node(2, "Person", id="p1", name="Keanu Reeves"),
        }
    ]
    nodes, edges = GrafeoBackend(FakeDB(rows)).execute("q", language="gql")
    assert {n["id"] for n in nodes} == {"1", "2"}
    (edge,) = edges
    assert (edge["source"], edge["target"], edge["label"]) == ("2", "1", "ACTED_IN")


def test_process_label_property_still_overrides_display_label():
    rows = [{"n": _node(1, "Person", label="Custom")}]
    (node,), _ = GrafeoBackend(FakeDB(rows)).execute("q", language="gql")
    assert node["label"] == "Custom"
    assert node["labels"] == ["Person"]


def test_process_lists_of_entities():
    rows = [{"people": [_node(1, "Person"), _node(2, "Person")], "rels": [_edge(10, 1, 2)]}]
    nodes, edges = GrafeoBackend(FakeDB(rows)).execute("q", language="gql")
    assert [n["id"] for n in nodes] == ["1", "2"]
    assert len(edges) == 1


def test_process_entities_nested_in_maps():
    rows = [{"m": {"who": _node(1, "Person"), "inner": {"rels": [_edge(10, 1, 2)], "other": _node(2, "P")}}}]
    nodes, edges = GrafeoBackend(FakeDB(rows)).execute("q", language="gql")
    assert sorted(n["id"] for n in nodes) == ["1", "2"]
    assert len(edges) == 1


def test_process_path_ids_are_resolved():
    db = FakeDB([{"p": {"nodes": [1, 2], "edges": [10]}}], nodes=[ALIX, GUS], edges=[KNOWS])
    nodes, edges = GrafeoBackend(db).execute("q", language="gql")
    assert [(n["id"], n["name"]) for n in nodes] == [("1", "Alix"), ("2", "Gus")]
    assert edges == [{"label": "KNOWS", "since": 2020, "source": "1", "target": "2"}]


def test_process_path_with_inline_entities():
    """Paths that already carry entities (a possible future encoding) need no lookups."""
    db = FakeDB([{"p": {"nodes": [_node(1, "P"), _node(2, "P")], "edges": [_edge(10, 1, 2)], "_type": "path"}}])
    nodes, edges = GrafeoBackend(db).execute("q", language="gql")
    assert len(nodes) == 2
    assert len(edges) == 1
    assert db.lookups == []


def test_process_path_skips_ids_already_returned():
    rows = [{"a": _node(1, "Person"), "p": {"nodes": [1, 2], "edges": [10]}}]
    db = FakeDB(rows, nodes=[ALIX, GUS], edges=[KNOWS])
    GrafeoBackend(db).execute("q", language="gql")
    assert ("node", 1) not in db.lookups
    assert ("node", 2) in db.lookups
    assert ("edge", 10) in db.lookups


def test_process_edge_endpoints_are_resolved():
    db = FakeDB([{"r": _edge(10, 1, 2)}], nodes=[ALIX, GUS])
    nodes, edges = GrafeoBackend(db).execute("q", language="gql")
    assert [n["name"] for n in nodes] == ["Alix", "Gus"]
    assert len(edges) == 1


def test_process_drops_edges_with_unresolvable_endpoints():
    """An edge whose endpoint cannot be found would crash the graph renderer."""
    db = FakeDB([{"r": _edge(10, 1, 99)}], nodes=[ALIX])
    nodes, edges = GrafeoBackend(db).execute("q", language="gql")
    assert [n["id"] for n in nodes] == ["1"]
    assert edges == []


def test_process_without_lookup_methods():
    rows = [{"r": _edge(10, 1, 2)}, {"p": {"nodes": [1, 2], "edges": [10]}}]
    assert GrafeoBackend(LookuplessDB(rows)).execute("q", language="gql") == ([], [])


def test_process_missing_path_entities_are_skipped():
    db = FakeDB([{"p": {"nodes": [1, 2], "edges": [10]}}], nodes=[ALIX])
    nodes, edges = GrafeoBackend(db).execute("q", language="gql")
    assert [n["id"] for n in nodes] == ["1"]
    assert edges == []


def test_process_ignores_bool_in_path():
    db = FakeDB([{"p": {"nodes": [True], "edges": []}}])
    assert GrafeoBackend(db).execute("q", language="gql") == ([], [])
    assert db.lookups == []


def test_process_generic_values_at_top_level():
    """Hand-built rows with plain `id` / `source` / `target` dicts still work."""
    rows = [{"n": {"id": "a", "name": "A"}, "m": {"id": "b"}, "r": {"source": "a", "target": "b", "type": "LINK"}}]
    nodes, edges = GrafeoBackend(LookuplessDB(rows)).execute("q", language="gql")
    assert [n["id"] for n in nodes] == ["a", "b"]
    assert edges == [{"source": "a", "target": "b", "label": "LINK"}]


def test_process_non_iterable_result():
    class Single:
        def items(self):
            return [("n", _node(5, "Thing"))]

    backend = GrafeoBackend(LookuplessDB(Single()))
    nodes, _ = backend._process_result(Single())
    assert [n["id"] for n in nodes] == ["5"]


def test_extract_items_variants():
    backend = GrafeoBackend(LookuplessDB([]))

    class WithData:
        def data(self):
            return {"x": 1}

    assert backend._extract_items({"a": 1}) == [("a", 1)]
    assert backend._extract_items(WithData()) == [("x", 1)]
    assert backend._extract_items(42) == []


# ------------------------------------------------------------------ #
#  Schema                                                              #
# ------------------------------------------------------------------ #


def test_fetch_schema_dict_entries():
    class SchemaDB:
        def schema(self):
            return {"labels": [{"name": "Person", "count": 3}], "edge_types": [{"name": "KNOWS", "count": 2}]}

    assert GrafeoBackend(SchemaDB()).fetch_schema() == (
        [{"label": "Person", "properties": [], "count": 3}],
        [{"type": "KNOWS", "properties": [], "count": 2}],
    )


def test_fetch_schema_string_entries():
    class SchemaDB:
        def schema(self):
            return {"labels": ["Person"], "edge_types": ["KNOWS"]}

    assert GrafeoBackend(SchemaDB()).fetch_schema() == (
        [{"label": "Person", "properties": []}],
        [{"type": "KNOWS", "properties": []}],
    )


def test_fetch_schema_unsupported_shapes():
    class NoSchema:
        pass

    class ListSchema:
        def schema(self):
            return ["Person"]

    class RdfSchema:
        def schema(self):
            return {"mode": "rdf"}

    assert GrafeoBackend(NoSchema()).fetch_schema() == ([], [])
    assert GrafeoBackend(ListSchema()).fetch_schema() == ([], [])
    assert GrafeoBackend(RdfSchema()).fetch_schema() == ([], [])
