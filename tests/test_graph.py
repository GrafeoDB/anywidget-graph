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


# ------------------------------------------------------------------ #
#  to_html / save_html tests                                          #
# ------------------------------------------------------------------ #


def test_to_html_returns_string():
    """to_html() returns a non-empty HTML string."""
    graph = Graph(
        nodes=[{"id": "a", "label": "Alice"}, {"id": "b", "label": "Bob"}],
        edges=[{"source": "a", "target": "b", "label": "KNOWS"}],
    )
    html = graph.to_html()
    assert isinstance(html, str)
    assert len(html) > 0


def test_to_html_contains_expected_structure():
    """The HTML output contains essential structural elements."""
    graph = Graph(
        nodes=[{"id": "n1", "label": "Node1"}],
        edges=[],
    )
    html = graph.to_html()
    assert "<!DOCTYPE html>" in html
    assert "<title>Graph Visualization</title>" in html
    assert 'id="container"' in html
    assert 'id="tooltip"' in html
    assert "graphology@0.25.4" in html
    assert "sigma@3.0.0" in html
    assert "graphology-layout@0.6.1" in html
    assert "graphology-layout-forceatlas2@0.10.1" in html


def test_to_html_embeds_node_data():
    """Node data is serialized into the HTML."""
    graph = Graph(
        nodes=[{"id": "x", "label": "X-node", "score": 42}],
        edges=[],
    )
    html = graph.to_html()
    assert '"id": "x"' in html or '"id":"x"' in html
    assert "X-node" in html
    assert "42" in html


def test_to_html_embeds_edge_data():
    """Edge data is serialized into the HTML."""
    graph = Graph(
        nodes=[{"id": "a"}, {"id": "b"}],
        edges=[{"source": "a", "target": "b", "label": "REL"}],
    )
    html = graph.to_html()
    assert "REL" in html
    assert '"source"' in html
    assert '"target"' in html


def test_to_html_embeds_visual_options():
    """Visual settings are embedded in the OPTIONS JSON."""
    graph = Graph(
        nodes=[],
        edges=[],
        dark_mode=False,
        background="#ffffff",
        show_labels=False,
    )
    html = graph.to_html()
    assert '"dark_mode": false' in html or '"dark_mode":false' in html
    assert "#ffffff" in html
    assert '"show_labels": false' in html or '"show_labels":false' in html


def test_to_html_custom_title_and_dimensions():
    """Custom title, width, and height appear in the output."""
    graph = Graph(nodes=[], edges=[])
    html = graph.to_html(title="My Graph", width="800px", height="400px")
    assert "<title>My Graph</title>" in html
    assert "800px" in html
    assert "400px" in html


def test_to_html_color_scales_present():
    """All six color scales are embedded in the HTML."""
    graph = Graph(nodes=[], edges=[])
    html = graph.to_html()
    for scale_name in ("viridis", "plasma", "inferno", "magma", "cividis", "turbo"):
        assert scale_name in html


def test_to_html_empty_graph():
    """to_html() works on an empty graph without errors."""
    graph = Graph()
    html = graph.to_html()
    assert "<!DOCTYPE html>" in html
    assert '"nodes": []' in html or '"nodes":[]' in html


def test_to_html_with_styling_fields():
    """Styling fields (color_field, size_field, etc.) appear in OPTIONS."""
    graph = Graph(nodes=[], edges=[])
    graph.color_field = "category"
    graph.size_field = "weight"
    graph.edge_color_field = "type"
    graph.edge_size_field = "strength"
    html = graph.to_html()
    assert '"color_field": "category"' in html or '"color_field":"category"' in html
    assert '"size_field": "weight"' in html or '"size_field":"weight"' in html
    assert '"edge_color_field": "type"' in html or '"edge_color_field":"type"' in html
    assert '"edge_size_field": "strength"' in html or '"edge_size_field":"strength"' in html


def test_save_html(tmp_path):
    """save_html() writes a valid HTML file to disk."""
    graph = Graph(
        nodes=[{"id": "a"}, {"id": "b"}],
        edges=[{"source": "a", "target": "b"}],
    )
    out = tmp_path / "graph.html"
    graph.save_html(str(out), title="Saved Graph")
    assert out.exists()
    content = out.read_text(encoding="utf-8")
    assert "<title>Saved Graph</title>" in content
    assert "graphology@0.25.4" in content
