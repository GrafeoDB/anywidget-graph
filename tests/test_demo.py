"""Tests for the demo widget: grafeo's Silicon Valley demo dataset, drawn from Python, queried on Grafeo WASM."""

from __future__ import annotations

import json
from collections import Counter

import grafeo
from grafeo_datasets import silicon_valley

from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.demo import DEMO_QUERY, demo_edges, demo_graph, demo_nodes


def test_demo_graph_configures_wasm_mode():
    graph = demo_graph()
    assert graph.database_backend == "grafeo"
    assert graph.grafeo_connection_mode == "wasm"
    assert graph.query_language == "gql"
    assert graph.query == DEMO_QUERY
    assert graph._demo_mode is True
    # The browser loads the dataset itself; demo_graph() adds no statements
    assert json.loads(graph._demo_data) == []


def test_demo_graph_draws_the_whole_dataset():
    graph = demo_graph()
    assert len(graph.nodes) == 64
    assert len(graph.edges) == 149
    # Eight node labels: each takes one of the eight palette colours
    assert len(Counter(node["labels"][0] for node in graph.nodes)) == 8
    ids = {node["id"] for node in graph.nodes}
    assert all(edge["source"] in ids and edge["target"] in ids for edge in graph.edges)


def test_demo_nodes_are_shaped_as_a_grafeo_result():
    piper = next(node for node in demo_nodes() if node["id"] == "pied-piper")
    assert piper["label"] == "Pied Piper"
    assert piper["labels"] == ["Company"]
    assert piper["name"] == "Pied Piper"
    assert piper["description"].startswith("Richard Hendricks")
    # The node's own properties come along
    assert piper["founded"] == "2014-03"
    edge = demo_edges()[0]
    assert set(edge) >= {"source", "target", "label"}


def test_demo_graph_kwargs_override_defaults():
    graph = demo_graph(width=400, dark_mode=False, show_toolbar=False)
    assert graph.width == 400
    assert graph.dark_mode is False
    assert graph.show_toolbar is False


def test_demo_query_on_the_dataset_returns_the_drawn_graph():
    """The browser runs the dataset's GQL on the same engine: the demo query there finds what Python draws, the node
    without a relationship (Fiona) included."""
    db = grafeo.GrafeoDB()
    silicon_valley.load(db)
    nodes, edges = GrafeoBackend(db).execute(DEMO_QUERY, language="gql")
    assert len(edges) == len(demo_edges())
    assert sorted(node["name"] for node in nodes) == sorted(node["name"] for node in demo_nodes())
