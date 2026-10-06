"""Tests for the demo widget (WASM mode with pre-populated data)."""

from __future__ import annotations

import json

import grafeo

from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.demo import DEMO_EDGES, DEMO_INSERT_STATEMENTS, DEMO_NODES, DEMO_QUERY, demo_graph


def test_demo_graph_configures_wasm_mode():
    graph = demo_graph()
    assert graph.database_backend == "grafeo"
    assert graph.grafeo_connection_mode == "wasm"
    assert graph.query_language == "gql"
    assert graph.query == DEMO_QUERY
    assert graph._demo_mode is True
    assert len(graph.nodes) == len(DEMO_NODES)
    assert len(graph.edges) == len(DEMO_EDGES)


def test_demo_graph_kwargs_override_defaults():
    graph = demo_graph(width=400, dark_mode=False, show_toolbar=False)
    assert graph.width == 400
    assert graph.dark_mode is False
    assert graph.show_toolbar is False


def test_demo_data_is_one_statement_per_entry():
    """The engine rejects several `;`-separated statements in one call, so the browser runs them one by one."""
    statements = json.loads(demo_graph()._demo_data)
    assert statements == DEMO_INSERT_STATEMENTS.split("\n")
    for statement in statements:
        assert statement.count(";") == 1
        assert statement.endswith(";")


def test_demo_statements_run_on_the_engine():
    """The WASM build runs the same engine: every demo statement must be valid there too."""
    db = grafeo.GrafeoDB()
    for statement in json.loads(demo_graph()._demo_data):
        db.execute(statement.rstrip(";"))
    assert db.node_count == len(DEMO_NODES)
    assert db.edge_count == len(DEMO_EDGES)

    nodes, edges = GrafeoBackend(db).execute(DEMO_QUERY, language="gql")
    assert len(nodes) == len(DEMO_NODES)
    assert len(edges) == len(DEMO_EDGES)
    # Demo nodes carry an `id` property ("m1", "p1", ...); the widget id must stay the engine id
    node_ids = {n["id"] for n in nodes}
    assert all(e["source"] in node_ids and e["target"] in node_ids for e in edges)
    assert sorted(n["name"] for n in nodes) == sorted(n["label"] for n in DEMO_NODES)
