"""Tests for anywidget-graph."""

import json

from anywidget_graph import Graph

# ------------------------------------------------------------------ #
#  Initialization                                                      #
# ------------------------------------------------------------------ #


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
    assert graph.dark_mode is True
    assert graph.layout == "force"
    assert graph.selection_mode == "click"
    assert graph.database_backend == "grafeo"
    assert graph.max_nodes == 300


def test_custom_options():
    """Test custom widget options."""
    graph = Graph(width=1000, height=800, show_labels=False)

    assert graph.width == 1000
    assert graph.height == 800
    assert graph.show_labels is False


# ------------------------------------------------------------------ #
#  Factory methods                                                     #
# ------------------------------------------------------------------ #


def test_from_dict_empty():
    """from_dict with empty data."""
    graph = Graph.from_dict({"nodes": [], "edges": []})
    assert graph.nodes == []
    assert graph.edges == []


def test_from_dict_missing_edges():
    """from_dict with no edges key defaults to empty list."""
    graph = Graph.from_dict({"nodes": [{"id": "a"}]})
    assert len(graph.nodes) == 1
    assert graph.edges == []


def test_from_dict_forwards_kwargs():
    """from_dict passes extra kwargs to constructor."""
    graph = Graph.from_dict(
        {"nodes": [{"id": "a"}], "edges": []},
        width=1200,
        dark_mode=False,
    )
    assert graph.width == 1200
    assert graph.dark_mode is False


def test_from_networkx():
    """from_networkx converts a simple graph."""

    # Minimal mock that behaves like networkx.Graph
    class MockGraph:
        def nodes(self, data=False):
            return [("a", {"name": "Alice"}), ("b", {"name": "Bob"})]

        def edges(self, data=False):
            return [("a", "b", {"weight": 1.0})]

    graph = Graph.from_networkx(MockGraph())
    assert len(graph.nodes) == 2
    assert len(graph.edges) == 1
    assert graph.nodes[0]["id"] == "a"
    assert graph.nodes[0]["label"] == "Alice"
    assert graph.edges[0]["source"] == "a"
    assert graph.edges[0]["target"] == "b"
    assert graph.edges[0]["weight"] == 1.0


def test_from_networkx_label_attr():
    """from_networkx uses custom label_attr."""

    class MockGraph:
        def nodes(self, data=False):
            return [("1", {"title": "Node One"})]

        def edges(self, data=False):
            return []

    graph = Graph.from_networkx(MockGraph(), label_attr="title")
    assert graph.nodes[0]["label"] == "Node One"


def test_from_dataframe():
    """from_dataframe converts node and edge DataFrames."""

    class FakeRow:
        """Minimal pandas Series mock."""

        def __init__(self, data):
            self._data = data

        def to_dict(self):
            return dict(self._data)

    class FakeDF:
        def __init__(self, rows):
            self._rows = [FakeRow(r) for r in rows]

        def iterrows(self):
            yield from enumerate(self._rows)

    nodes_df = FakeDF([{"id": "a", "group": "person"}, {"id": "b", "group": "person"}])
    edges_df = FakeDF([{"source": "a", "target": "b", "weight": 1.0}])

    graph = Graph.from_dataframe(nodes_df, edges_df)
    assert len(graph.nodes) == 2
    assert len(graph.edges) == 1
    assert graph.nodes[0]["id"] == "a"
    assert graph.edges[0]["weight"] == 1.0


# ------------------------------------------------------------------ #
#  Clear and pin/unpin operations                                      #
# ------------------------------------------------------------------ #


def test_clear():
    """clear() resets nodes, edges, selection, and pins."""
    graph = Graph(
        nodes=[{"id": "a"}],
        edges=[{"source": "a", "target": "a"}],
    )
    graph.selected_node = {"id": "a"}
    graph.pinned_nodes = {"a": True}

    graph.clear()

    assert graph.nodes == []
    assert graph.edges == []
    assert graph.selected_node is None
    assert graph.selected_edge is None
    assert graph.pinned_nodes == {}
    assert graph.query_error == ""


def test_pin_nodes():
    """pin_nodes adds node IDs to pinned_nodes."""
    graph = Graph()
    graph.pin_nodes(["a", "b"])
    assert graph.pinned_nodes == {"a": True, "b": True}


def test_pin_nodes_idempotent():
    """pin_nodes does not overwrite existing pins."""
    graph = Graph()
    graph.pinned_nodes = {"a": True}
    graph.pin_nodes(["a", "b"])
    assert graph.pinned_nodes == {"a": True, "b": True}


def test_unpin_nodes():
    """unpin_nodes removes specific node IDs."""
    graph = Graph()
    graph.pinned_nodes = {"a": True, "b": True, "c": True}
    graph.unpin_nodes(["a", "c"])
    assert graph.pinned_nodes == {"b": True}


def test_toggle_pin():
    """toggle_pin switches pin state."""
    graph = Graph()
    graph.toggle_pin("a")
    assert graph.pinned_nodes == {"a": True}
    graph.toggle_pin("a")
    assert graph.pinned_nodes == {}


def test_unpin_all():
    """unpin_all clears all pins."""
    graph = Graph()
    graph.pinned_nodes = {"a": True, "b": True}
    graph.unpin_all()
    assert graph.pinned_nodes == {}


# ------------------------------------------------------------------ #
#  Event handlers                                                      #
# ------------------------------------------------------------------ #


def test_on_node_click_returns_callback():
    """on_node_click returns the callback for decorator use."""
    graph = Graph()

    def handler(node_id, node_data):
        pass

    result = graph.on_node_click(handler)
    assert result is handler


def test_on_node_click_fires():
    """on_node_click fires when selected_node changes."""
    graph = Graph()
    clicks = []

    @graph.on_node_click
    def handle(node_id, node_data):
        clicks.append((node_id, node_data))

    graph.selected_node = {"id": "a", "label": "Alice"}
    assert len(clicks) == 1
    assert clicks[0][0] == "a"
    assert clicks[0][1]["label"] == "Alice"


def test_on_node_click_ignores_none():
    """on_node_click does not fire when selected_node is set to None."""
    graph = Graph()
    clicks = []

    @graph.on_node_click
    def handle(node_id, node_data):
        clicks.append(node_id)

    graph.selected_node = None
    assert len(clicks) == 0


def test_on_edge_click_fires():
    """on_edge_click fires when selected_edge changes."""
    graph = Graph()
    clicks = []

    @graph.on_edge_click
    def handle(edge_data):
        clicks.append(edge_data)

    graph.selected_edge = {"source": "a", "target": "b", "label": "KNOWS"}
    assert len(clicks) == 1
    assert clicks[0]["label"] == "KNOWS"


def test_on_selection_fires():
    """on_selection fires when selected_nodes changes."""
    graph = Graph()
    selections = []

    @graph.on_selection
    def handle(node_ids):
        selections.append(node_ids)

    graph.selected_nodes = ["a", "b", "c"]
    assert len(selections) == 1
    assert selections[0] == ["a", "b", "c"]


def test_on_selection_ignores_empty():
    """on_selection does not fire for empty selection."""
    graph = Graph()
    selections = []

    @graph.on_selection
    def handle(node_ids):
        selections.append(node_ids)

    graph.selected_nodes = []
    assert len(selections) == 0


# ------------------------------------------------------------------ #
#  Node expansion                                                      #
# ------------------------------------------------------------------ #


def test_expand_node_without_backend():
    """expand_node sets query_error when no backend is configured."""
    graph = Graph()
    graph.expand_node("a")
    assert "backend" in graph.query_error.lower()


def test_merge_graph_deduplicates():
    """_merge_graph deduplicates nodes and edges."""
    graph = Graph(
        nodes=[{"id": "a"}, {"id": "b"}],
        edges=[{"source": "a", "target": "b", "label": "KNOWS"}],
    )
    graph._merge_graph(
        [{"id": "b"}, {"id": "c"}],
        [
            {"source": "a", "target": "b", "label": "KNOWS"},
            {"source": "b", "target": "c", "label": "LIKES"},
        ],
    )
    assert len(graph.nodes) == 3
    assert len(graph.edges) == 2


def test_merge_graph_truncates():
    """_merge_graph truncates to max_nodes."""
    graph = Graph(nodes=[{"id": str(i)} for i in range(10)])
    graph.max_nodes = 12

    graph._merge_graph(
        [{"id": str(i)} for i in range(10, 20)],
        [],
    )
    assert len(graph.nodes) == 12
    assert "truncated" in graph.query_error.lower()


# ------------------------------------------------------------------ #
#  Export: to_json                                                     #
# ------------------------------------------------------------------ #


def test_to_json():
    """to_json returns valid JSON with nodes and edges."""
    graph = Graph(
        nodes=[{"id": "a", "label": "Alice"}],
        edges=[{"source": "a", "target": "a"}],
    )
    result = json.loads(graph.to_json())
    assert "nodes" in result
    assert "edges" in result
    assert len(result["nodes"]) == 1
    assert result["nodes"][0]["id"] == "a"


def test_to_json_empty():
    """to_json works on empty graph."""
    graph = Graph()
    result = json.loads(graph.to_json())
    assert result == {"nodes": [], "edges": []}


# ------------------------------------------------------------------ #
#  Export: to_html / save_html                                         #
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


# ------------------------------------------------------------------ #
#  Styling traitlets                                                   #
# ------------------------------------------------------------------ #


def test_color_field():
    """color_field traitlet can be set."""
    graph = Graph(color_field="group")
    assert graph.color_field == "group"


def test_size_range():
    """size_range traitlet can be set."""
    graph = Graph(size_range=[2, 50])
    assert graph.size_range == [2, 50]


def test_edge_styling():
    """Edge styling traitlets work."""
    graph = Graph(
        edge_color_field="type",
        edge_color_scale="plasma",
        edge_size_field="weight",
        edge_size_range=[1, 10],
    )
    assert graph.edge_color_field == "type"
    assert graph.edge_color_scale == "plasma"
    assert graph.edge_size_field == "weight"
    assert graph.edge_size_range == [1, 10]


# ------------------------------------------------------------------ #
#  Backend property                                                    #
# ------------------------------------------------------------------ #


def test_backend_property():
    """backend property getter/setter works."""
    graph = Graph()
    assert graph.backend is None

    class MockBackend:
        def execute(self, query, language="cypher"):
            return [], []

    mb = MockBackend()
    graph.backend = mb
    assert graph.backend is mb


def test_grafeo_db_legacy():
    """grafeo_db legacy property creates a GrafeoBackend."""
    graph = Graph()

    class FakeGrafeoDB:
        pass

    graph.grafeo_db = FakeGrafeoDB()
    assert graph.backend is not None
    assert graph.grafeo_db is not None


# ------------------------------------------------------------------ #
#  Build neighbor query                                                #
# ------------------------------------------------------------------ #


def test_build_neighbor_query_cypher():
    """Cypher neighbor query is generated correctly."""
    q = Graph._build_neighbor_query("node42", "cypher")
    assert "node42" in q
    assert "MATCH" in q


def test_build_neighbor_query_gremlin():
    """Gremlin neighbor query is generated correctly."""
    q = Graph._build_neighbor_query("v123", "gremlin")
    assert "v123" in q
    assert "g.V(" in q


def test_build_neighbor_query_aql():
    """AQL neighbor query is generated correctly."""
    q = Graph._build_neighbor_query("doc/1", "aql")
    assert "doc/1" in q
    assert "FOR" in q
