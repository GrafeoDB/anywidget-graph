"""Tests for anywidget-graph."""

from anywidget_graph import Graph


def test_from_dict():
    """Test creating a graph from a dictionary."""
    data = {
        "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
        "edges": [{"source": "a", "target": "b", "label": "connects"}],
    }
    graph = Graph.from_dict(data)

    assert len(graph.nodes) == 2
    assert len(graph.edges) == 1
    assert graph.nodes[0]["id"] == "a"
    assert graph.edges[0]["source"] == "a"


def test_direct_init():
    """Test creating a graph with direct initialization."""
    nodes = [{"id": "x"}, {"id": "y"}]
    edges = [{"source": "x", "target": "y"}]

    graph = Graph(nodes=nodes, edges=edges)

    assert len(graph.nodes) == 2
    assert len(graph.edges) == 1


def test_empty_graph():
    """Test creating an empty graph."""
    graph = Graph()

    assert graph.nodes == []
    assert graph.edges == []


def test_default_options():
    """Test default widget options."""
    graph = Graph()

    assert graph.width == 800
    assert graph.height == 600
    assert graph.show_labels is True
    assert graph.show_edge_labels is False


def test_custom_options():
    """Test custom widget options."""
    graph = Graph(width=1000, height=800, show_labels=False)

    assert graph.width == 1000
    assert graph.height == 800
    assert graph.show_labels is False
