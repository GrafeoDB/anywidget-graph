"""Main Graph widget using anywidget and Sigma.js."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import anywidget
import traitlets
from traitlets import observe

from anywidget_graph.backends import DatabaseBackend
from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.ui import get_css, get_esm

if TYPE_CHECKING:
    from collections.abc import Callable


class Graph(anywidget.AnyWidget):
    """Interactive graph visualization widget using Sigma.js.

    Supports Neo4j (browser-side) and Grafeo (Python-side) backends.

    Examples
    --------
    Basic usage with static data:

        >>> graph = Graph(
        ...     nodes=[{"id": "a", "label": "Alice"}, {"id": "b", "label": "Bob"}],
        ...     edges=[{"source": "a", "target": "b", "label": "KNOWS"}],
        ... )

    With Neo4j connection:

        >>> graph = Graph(
        ...     database_backend="neo4j",
        ...     connection_uri="neo4j+s://demo.neo4jlabs.com",
        ...     connection_username="neo4j",
        ...     connection_password="password",
        ... )

    With Grafeo backend:

        >>> import grafeo
        >>> db = grafeo.GrafeoDB()
        >>> graph = Graph(database_backend="grafeo", grafeo_db=db)
    """

    _esm = get_esm()
    _css = get_css()

    # === Graph Data ===
    nodes = traitlets.List(trait=traitlets.Dict()).tag(sync=True)
    edges = traitlets.List(trait=traitlets.Dict()).tag(sync=True)

    # === Display Settings ===
    width = traitlets.Int(default_value=800).tag(sync=True)
    height = traitlets.Int(default_value=600).tag(sync=True)
    background = traitlets.Unicode(default_value="#fafafa").tag(sync=True)
    show_labels = traitlets.Bool(default_value=True).tag(sync=True)
    show_edge_labels = traitlets.Bool(default_value=False).tag(sync=True)

    # === Property-Based Styling (node) ===
    color_field = traitlets.Unicode(allow_none=True, default_value=None).tag(sync=True)
    color_scale = traitlets.Unicode(default_value="viridis").tag(sync=True)
    color_domain = traitlets.List(allow_none=True, default_value=None).tag(sync=True)
    size_field = traitlets.Unicode(allow_none=True, default_value=None).tag(sync=True)
    size_range = traitlets.List(default_value=[5, 30]).tag(sync=True)

    # === Property-Based Styling (edge) ===
    edge_color_field = traitlets.Unicode(allow_none=True, default_value=None).tag(sync=True)
    edge_color_scale = traitlets.Unicode(default_value="viridis").tag(sync=True)
    edge_size_field = traitlets.Unicode(allow_none=True, default_value=None).tag(sync=True)
    edge_size_range = traitlets.List(default_value=[1, 8]).tag(sync=True)

    # === Layout ===
    layout = traitlets.Unicode(default_value="force").tag(sync=True)

    # === Hover / Tooltip ===
    show_tooltip = traitlets.Bool(default_value=True).tag(sync=True)
    tooltip_fields = traitlets.List(default_value=["label", "id"]).tag(sync=True)
    hovered_node = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)
    hovered_edge = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)

    # === Selection State ===
    selected_node = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)
    selected_edge = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)
    selected_nodes = traitlets.List(default_value=[]).tag(sync=True)
    selected_edges = traitlets.List(default_value=[]).tag(sync=True)
    selection_mode = traitlets.Unicode(default_value="click").tag(sync=True)

    # === Toolbar Visibility ===
    show_toolbar = traitlets.Bool(default_value=True).tag(sync=True)
    show_settings = traitlets.Bool(default_value=True).tag(sync=True)
    show_query_input = traitlets.Bool(default_value=True).tag(sync=True)

    # === Theme ===
    dark_mode = traitlets.Bool(default_value=True).tag(sync=True)

    # === Database Backend ===
    database_backend = traitlets.Unicode(default_value="grafeo").tag(sync=True)

    # === Grafeo Connection Mode ===
    grafeo_connection_mode = traitlets.Unicode(default_value="embedded").tag(sync=True)
    grafeo_server_url = traitlets.Unicode(default_value="http://localhost:7474").tag(sync=True)

    # === Neo4j Connection (browser-side) ===
    connection_uri = traitlets.Unicode(default_value="").tag(sync=True)
    connection_username = traitlets.Unicode(default_value="").tag(sync=True)
    connection_password = traitlets.Unicode(default_value="").tag(sync=True)
    connection_database = traitlets.Unicode(default_value="default").tag(sync=True)

    # === Query State ===
    query = traitlets.Unicode(default_value="").tag(sync=True)
    query_language = traitlets.Unicode(default_value="cypher").tag(sync=True)
    query_running = traitlets.Bool(default_value=False).tag(sync=True)
    query_error = traitlets.Unicode(default_value="").tag(sync=True)

    # === Connection State ===
    connection_status = traitlets.Unicode(default_value="disconnected").tag(sync=True)

    # === Schema Data ===
    schema_node_types = traitlets.List(trait=traitlets.Dict()).tag(sync=True)
    schema_edge_types = traitlets.List(trait=traitlets.Dict()).tag(sync=True)

    # === Node Dragging / Pinning ===
    pinned_nodes = traitlets.Dict(default_value={}).tag(sync=True)

    # === Node Expansion ===
    max_nodes = traitlets.Int(default_value=300).tag(sync=True)
    _expand_request = traitlets.Dict(default_value={}).tag(sync=True)

    # === Query Execution Trigger (for Python backends) ===
    _execute_query = traitlets.Int(default_value=0).tag(sync=True)

    # === Demo Mode (auto-populate WASM and run query) ===
    _demo_mode = traitlets.Bool(default_value=False).tag(sync=True)
    _demo_data = traitlets.Unicode(default_value="").tag(sync=True)

    def __init__(
        self,
        nodes: list[dict[str, Any]] | None = None,
        edges: list[dict[str, Any]] | None = None,
        *,
        width: int = 800,
        height: int = 600,
        background: str = "#fafafa",
        show_labels: bool = True,
        show_edge_labels: bool = False,
        show_toolbar: bool = True,
        show_settings: bool = True,
        show_query_input: bool = True,
        dark_mode: bool = True,
        database_backend: str = "grafeo",
        connection_uri: str = "",
        connection_username: str = "",
        connection_password: str = "",
        connection_database: str = "default",
        grafeo_db: Any = None,
        backend: DatabaseBackend | None = None,
        **kwargs: Any,
    ) -> None:
        """Initialize the Graph widget.

        Parameters
        ----------
        nodes : list[dict], optional
            List of node dictionaries with 'id' and optional 'label', 'color', etc.
        edges : list[dict], optional
            List of edge dictionaries with 'source', 'target', and optional 'label'.
        width : int
            Widget width in pixels.
        height : int
            Widget height in pixels.
        background : str
            Background color for the graph area.
        show_labels : bool
            Whether to show node labels.
        show_edge_labels : bool
            Whether to show edge labels.
        show_toolbar : bool
            Whether to show the toolbar.
        show_settings : bool
            Whether to show the settings button.
        show_query_input : bool
            Whether to show the query input.
        dark_mode : bool
            Whether to use dark theme.
        database_backend : str
            Database backend: "neo4j" or "grafeo".
        connection_uri : str
            Neo4j connection URI.
        connection_username : str
            Neo4j username.
        connection_password : str
            Neo4j password.
        connection_database : str
            Neo4j database name.
        grafeo_db : Any
            Grafeo database instance for Python-side execution (legacy).
        backend : DatabaseBackend | None
            Generic database backend implementing the DatabaseBackend protocol.
        """
        super().__init__(
            nodes=nodes or [],
            edges=edges or [],
            width=width,
            height=height,
            background=background,
            show_labels=show_labels,
            show_edge_labels=show_edge_labels,
            show_toolbar=show_toolbar,
            show_settings=show_settings,
            show_query_input=show_query_input,
            dark_mode=dark_mode,
            database_backend=database_backend,
            connection_uri=connection_uri,
            connection_username=connection_username,
            connection_password=connection_password,
            connection_database=connection_database,
            **kwargs,
        )
        self._node_click_callbacks: list[Callable] = []
        self._edge_click_callbacks: list[Callable] = []

        # Support both legacy grafeo_db and new generic backend
        if backend is not None:
            self._backend = backend
        elif grafeo_db is not None:
            self._backend = GrafeoBackend(grafeo_db)
        else:
            self._backend = None

    @property
    def backend(self) -> DatabaseBackend | None:
        """Get the current database backend."""
        return self._backend

    @backend.setter
    def backend(self, value: DatabaseBackend | None) -> None:
        """Set the database backend."""
        self._backend = value

    @property
    def grafeo_db(self) -> Any:
        """Get the Grafeo database instance (legacy property)."""
        if isinstance(self._backend, GrafeoBackend):
            return self._backend.db
        return None

    @grafeo_db.setter
    def grafeo_db(self, value: Any) -> None:
        """Set the Grafeo database instance (legacy property)."""
        self._backend = GrafeoBackend(value) if value else None

    @observe("_execute_query")
    def _on_execute_query(self, change: dict) -> None:
        """Handle query execution trigger from JavaScript."""
        if change["new"] == 0:
            return  # Skip initial value
        if self._backend is not None:
            self._execute_backend_query()

    def _execute_backend_query(self) -> None:
        """Execute query against the configured backend."""
        if not self._backend:
            self.query_error = "No database backend configured"
            return

        try:
            self.query_running = True
            self.query_error = ""
            nodes, edges = self._backend.execute(self.query, language=self.query_language)
            self.nodes = nodes
            self.edges = edges
        except Exception as e:
            self.query_error = str(e)
        finally:
            self.query_running = False

    @observe("_expand_request")
    def _on_expand_request(self, change: dict) -> None:
        """Handle node expansion trigger from JavaScript."""
        data = change["new"]
        if not data or "node_id" not in data:
            return
        self._expand_node(data["node_id"])

    def _expand_node(self, node_id: str) -> None:
        """Fetch neighbors of a node and merge into the graph."""
        if not self._backend:
            self.query_error = "No backend configured for expansion"
            return

        try:
            self.query_running = True
            self.query_error = ""
            lang = self.query_language or "cypher"
            query = self._build_neighbor_query(node_id, lang)
            new_nodes, new_edges = self._backend.execute(query, language=lang)
            self._merge_graph(new_nodes, new_edges)
        except Exception as e:
            self.query_error = str(e)
        finally:
            self.query_running = False

    @staticmethod
    def _build_neighbor_query(node_id: str, language: str) -> str:
        """Build a neighbor query for the given language."""
        if language in ("cypher", "gql"):
            return f'MATCH (n)-[r]-(m) WHERE id(n) = "{node_id}" RETURN n, r, m'
        if language == "gremlin":
            return f"g.V('{node_id}').bothE().as('e').otherV().as('v').select('e','v')"
        if language == "aql":
            return f'FOR v, e IN 1..1 ANY "{node_id}" GRAPH "default" RETURN {{v: v, e: e}}'
        # Fallback to Cypher-style
        return f'MATCH (n)-[r]-(m) WHERE id(n) = "{node_id}" RETURN n, r, m'

    def _merge_graph(self, new_nodes: list[dict], new_edges: list[dict]) -> None:
        """Merge new nodes and edges into the existing graph, deduplicating."""
        existing_node_ids = {n["id"] for n in self.nodes}
        existing_edge_keys = {(e["source"], e["target"], e.get("label", "")) for e in self.edges}

        merged_nodes = list(self.nodes) + [n for n in new_nodes if n["id"] not in existing_node_ids]
        merged_edges = list(self.edges) + [
            e for e in new_edges if (e["source"], e["target"], e.get("label", "")) not in existing_edge_keys
        ]

        if len(merged_nodes) > self.max_nodes:
            merged_nodes = merged_nodes[: self.max_nodes]
            kept_ids = {n["id"] for n in merged_nodes}
            merged_edges = [e for e in merged_edges if e["source"] in kept_ids and e["target"] in kept_ids]
            self.query_error = f"Graph truncated to {self.max_nodes} nodes. Call clear() or increase max_nodes."

        self.nodes = merged_nodes
        self.edges = merged_edges

    def expand_node(self, node_id: str) -> None:
        """Programmatically expand a node to show its neighbors."""
        self._expand_node(node_id)

    def clear(self) -> None:
        """Clear the graph and reset selection."""
        self.nodes = []
        self.edges = []
        self.selected_node = None
        self.selected_edge = None
        self.pinned_nodes = {}
        self.query_error = ""

    def pin_nodes(self, node_ids: list[str]) -> None:
        """Pin nodes at their current positions (they resist layout forces)."""
        updated = dict(self.pinned_nodes)
        for nid in node_ids:
            if nid not in updated:
                updated[nid] = True
        self.pinned_nodes = updated

    def unpin_nodes(self, node_ids: list[str]) -> None:
        """Unpin nodes so they participate in layout again."""
        updated = {k: v for k, v in self.pinned_nodes.items() if k not in node_ids}
        self.pinned_nodes = updated

    def toggle_pin(self, node_id: str) -> None:
        """Toggle the pin state of a single node."""
        updated = dict(self.pinned_nodes)
        if node_id in updated:
            del updated[node_id]
        else:
            updated[node_id] = True
        self.pinned_nodes = updated

    def unpin_all(self) -> None:
        """Unpin all nodes."""
        self.pinned_nodes = {}

    @classmethod
    def from_dict(cls, data: dict[str, Any], **kwargs: Any) -> Graph:
        """Create a Graph from a dictionary with 'nodes' and 'edges' keys.

        Parameters
        ----------
        data : dict
            Dictionary with 'nodes' and 'edges' lists.
        **kwargs
            Additional arguments passed to Graph constructor.

        Returns
        -------
        Graph
            New Graph instance.
        """
        return cls(nodes=data.get("nodes", []), edges=data.get("edges", []), **kwargs)

    @classmethod
    def from_cypher(cls, result: Any, **kwargs: Any) -> Graph:
        """Create a Graph from Cypher query results.

        Parameters
        ----------
        result : Any
            Query result from Neo4j driver or similar.
        **kwargs
            Additional arguments passed to Graph constructor.

        Returns
        -------
        Graph
            New Graph instance with extracted nodes and edges.

        Example
        -------
        >>> from neo4j import GraphDatabase
        >>> driver = GraphDatabase.driver(uri, auth=auth)
        >>> with driver.session() as session:
        ...     result = session.run("MATCH (n)-[r]->(m) RETURN n, r, m")
        ...     graph = Graph.from_cypher(result)
        """
        from anywidget_graph.converters import CypherConverter

        data = CypherConverter().convert(result)
        return cls(nodes=data["nodes"], edges=data["edges"], **kwargs)

    @classmethod
    def from_gql(cls, result: Any, **kwargs: Any) -> Graph:
        """Create a Graph from GQL query results.

        GQL (ISO Graph Query Language) uses a similar format to Cypher.

        Parameters
        ----------
        result : Any
            Query result from GQL-compatible database.
        **kwargs
            Additional arguments passed to Graph constructor.

        Returns
        -------
        Graph
            New Graph instance with extracted nodes and edges.
        """
        from anywidget_graph.converters import GQLConverter

        data = GQLConverter().convert(result)
        return cls(nodes=data["nodes"], edges=data["edges"], **kwargs)

    @classmethod
    def from_sparql(
        cls,
        result: Any,
        subject_var: str = "s",
        predicate_var: str = "p",
        object_var: str = "o",
        **kwargs: Any,
    ) -> Graph:
        """Create a Graph from SPARQL query results.

        Parameters
        ----------
        result : Any
            SPARQL query result (e.g., from RDFLib or SPARQLWrapper).
        subject_var : str
            Variable name for subjects (default: "s").
        predicate_var : str
            Variable name for predicates (default: "p").
        object_var : str
            Variable name for objects (default: "o").
        **kwargs
            Additional arguments passed to Graph constructor.

        Returns
        -------
        Graph
            New Graph instance with extracted nodes and edges.

        Example
        -------
        >>> from rdflib import Graph as RDFGraph
        >>> g = RDFGraph()
        >>> g.parse("data.ttl")
        >>> result = g.query("SELECT ?s ?p ?o WHERE { ?s ?p ?o }")
        >>> graph = Graph.from_sparql(result)
        """
        from anywidget_graph.converters import SPARQLConverter

        converter = SPARQLConverter(
            subject_var=subject_var,
            predicate_var=predicate_var,
            object_var=object_var,
        )
        data = converter.convert(result)
        return cls(nodes=data["nodes"], edges=data["edges"], **kwargs)

    @classmethod
    def from_gremlin(cls, result: Any, **kwargs: Any) -> Graph:
        """Create a Graph from Gremlin/TinkerPop query results.

        Parameters
        ----------
        result : Any
            Gremlin traversal result.
        **kwargs
            Additional arguments passed to Graph constructor.

        Returns
        -------
        Graph
            New Graph instance with extracted nodes and edges.

        Example
        -------
        >>> from gremlin_python.driver import client
        >>> gremlin_client = client.Client('ws://localhost:8182/gremlin', 'g')
        >>> result = gremlin_client.submit("g.V().limit(10)").all().result()
        >>> graph = Graph.from_gremlin(result)
        """
        from anywidget_graph.converters import GremlinConverter

        data = GremlinConverter().convert(result)
        return cls(nodes=data["nodes"], edges=data["edges"], **kwargs)

    @classmethod
    def from_graphql(
        cls,
        result: Any,
        nodes_path: str | None = None,
        edges_path: str | None = None,
        id_field: str = "id",
        label_field: str = "name",
        **kwargs: Any,
    ) -> Graph:
        """Create a Graph from GraphQL JSON response.

        Parameters
        ----------
        result : Any
            GraphQL JSON response.
        nodes_path : str | None
            Dot-separated path to nodes list (e.g., "data.users").
        edges_path : str | None
            Dot-separated path to edges list.
        id_field : str
            Field name for node IDs (default: "id").
        label_field : str
            Field name for node labels (default: "name").
        **kwargs
            Additional arguments passed to Graph constructor.

        Returns
        -------
        Graph
            New Graph instance with extracted nodes and edges.

        Example
        -------
        >>> import requests
        >>> response = requests.post(url, json={"query": query})
        >>> graph = Graph.from_graphql(
        ...     response.json(),
        ...     nodes_path="data.characters.results",
        ... )
        """
        from anywidget_graph.converters import GraphQLConverter

        converter = GraphQLConverter(
            nodes_path=nodes_path,
            edges_path=edges_path,
            id_field=id_field,
            label_field=label_field,
        )
        data = converter.convert(result)
        return cls(nodes=data["nodes"], edges=data["edges"], **kwargs)

    @classmethod
    def from_dataframe(
        cls,
        nodes_df: Any,
        edges_df: Any = None,
        *,
        id_col: str = "id",
        label_col: str | None = None,
        source_col: str = "source",
        target_col: str = "target",
        edge_label_col: str | None = None,
        **kwargs: Any,
    ) -> Graph:
        """Create a Graph from pandas DataFrames.

        All columns not used for structure become node/edge properties.

        Parameters
        ----------
        nodes_df : pandas.DataFrame
            DataFrame with node data. Must have an ID column.
        edges_df : pandas.DataFrame, optional
            DataFrame with edge data. Must have source and target columns.
        id_col : str
            Column name for node IDs.
        label_col : str, optional
            Column name for node labels.
        source_col : str
            Column name for edge source.
        target_col : str
            Column name for edge target.
        edge_label_col : str, optional
            Column name for edge labels.
        """
        nodes = []
        for _, row in nodes_df.iterrows():
            node = row.to_dict()
            node["id"] = str(node.pop(id_col))
            if label_col and label_col in node:
                node["label"] = str(node.pop(label_col))
            nodes.append(node)

        edges = []
        if edges_df is not None:
            for _, row in edges_df.iterrows():
                edge = row.to_dict()
                edge["source"] = str(edge.pop(source_col))
                edge["target"] = str(edge.pop(target_col))
                if edge_label_col and edge_label_col in edge:
                    edge["label"] = str(edge.pop(edge_label_col))
                edges.append(edge)

        return cls(nodes=nodes, edges=edges, **kwargs)

    @classmethod
    def from_networkx(cls, G: Any, *, label_attr: str | None = None, **kwargs: Any) -> Graph:
        """Create a Graph from a NetworkX graph.

        Parameters
        ----------
        G : networkx.Graph
            A NetworkX graph object.
        label_attr : str, optional
            Node attribute to use as label. Tries 'name', 'label', or node ID.
        """
        nodes = []
        for n, data in G.nodes(data=True):
            node = {"id": str(n), **{k: v for k, v in data.items() if not isinstance(v, (dict, list, set))}}
            if label_attr and label_attr in data:
                node["label"] = str(data[label_attr])
            elif "name" in data:
                node["label"] = str(data["name"])
            elif "label" in data:
                node["label"] = str(data["label"])
            nodes.append(node)

        edges = []
        for u, v, data in G.edges(data=True):
            edge = {
                "source": str(u),
                "target": str(v),
                **{k: v2 for k, v2 in data.items() if not isinstance(v2, (dict, list, set))},
            }
            edges.append(edge)

        return cls(nodes=nodes, edges=edges, **kwargs)

    def on_node_click(self, callback: Callable[[str, dict], None]) -> Callable:
        """Register a callback for node click events.

        Parameters
        ----------
        callback : Callable[[str, dict], None]
            Function called with (node_id, node_attributes) when a node is clicked.

        Returns
        -------
        Callable
            The callback function (for decorator usage).
        """
        self._node_click_callbacks.append(callback)

        def observer(change: dict) -> None:
            if change["new"] is not None:
                node_data = change["new"].copy()
                node_id = node_data.pop("id", None)
                for cb in self._node_click_callbacks:
                    cb(node_id, node_data)

        self.observe(observer, names=["selected_node"])
        return callback

    def on_edge_click(self, callback: Callable[[dict], None]) -> Callable:
        """Register a callback for edge click events.

        Parameters
        ----------
        callback : Callable[[dict], None]
            Function called with edge data when an edge is clicked.

        Returns
        -------
        Callable
            The callback function (for decorator usage).
        """
        self._edge_click_callbacks.append(callback)

        def observer(change: dict) -> None:
            if change["new"] is not None:
                for cb in self._edge_click_callbacks:
                    cb(change["new"])

        self.observe(observer, names=["selected_edge"])
        return callback

    def on_selection(self, callback: Callable[[list[str]], None]) -> Callable:
        """Register a callback for multi-select events.

        Parameters
        ----------
        callback : Callable[[list[str]], None]
            Function called with list of selected node IDs when selection changes.

        Returns
        -------
        Callable
            The callback function (for decorator usage).
        """

        def observer(change: dict) -> None:
            if change["new"]:
                callback(change["new"])

        self.observe(observer, names=["selected_nodes"])
        return callback

    # ------------------------------------------------------------------ #
    #  Static HTML export                                                 #
    # ------------------------------------------------------------------ #

    _HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
body {{ margin: 0; background: {background}; font-family: sans-serif; }}
#container {{ width: {width}; height: {height}; }}
.tooltip {{
  position: absolute; display: none;
  background: rgba(0,0,0,0.85); color: #fff;
  padding: 8px 12px; border-radius: 6px; font-size: 12px;
  pointer-events: none; z-index: 100; max-width: 220px;
}}
.tooltip-row {{
  display: flex; justify-content: space-between;
  gap: 12px; padding: 1px 0;
}}
.tooltip-key {{ color: #999; font-weight: 500; white-space: nowrap; }}
</style>
</head>
<body>
<div id="container"></div>
<div id="tooltip" class="tooltip"></div>
<script type="module">
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";
import circular from "https://esm.sh/graphology-layout@0.6.1/circular.js";
import random from "https://esm.sh/graphology-layout@0.6.1/random.js";
import forceAtlas2 from "https://esm.sh/graphology-layout-forceatlas2@0.10.1";

const DATA = {json_data};
const OPTIONS = {json_options};

const COLOR_SCALES = {{
  viridis: [
    [0.267,0.004,0.329],[0.282,0.141,0.458],[0.253,0.265,0.530],[0.207,0.372,0.553],
    [0.164,0.471,0.558],[0.128,0.567,0.551],[0.134,0.658,0.517],[0.267,0.749,0.441],
    [0.478,0.821,0.318],[0.741,0.873,0.150],[0.993,0.906,0.144]],
  plasma: [
    [0.050,0.030,0.528],[0.295,0.012,0.615],[0.492,0.012,0.658],[0.654,0.072,0.639],
    [0.798,0.195,0.561],[0.897,0.329,0.445],[0.963,0.480,0.314],[0.993,0.640,0.186],
    [0.980,0.807,0.086],[0.940,0.975,0.131],[0.940,0.975,0.131]],
  inferno: [
    [0.001,0.000,0.014],[0.110,0.066,0.290],[0.280,0.086,0.470],[0.447,0.096,0.460],
    [0.612,0.140,0.381],[0.762,0.233,0.272],[0.882,0.370,0.170],[0.959,0.551,0.069],
    [0.977,0.754,0.065],[0.936,0.960,0.309],[0.988,1.000,0.644]],
  magma: [
    [0.001,0.000,0.014],[0.099,0.068,0.265],[0.232,0.094,0.450],[0.383,0.107,0.520],
    [0.533,0.137,0.512],[0.683,0.199,0.453],[0.822,0.303,0.369],[0.925,0.452,0.293],
    [0.975,0.637,0.264],[0.985,0.835,0.361],[0.987,0.991,0.750]],
  cividis: [
    [0.000,0.135,0.305],[0.074,0.192,0.351],[0.145,0.247,0.382],[0.228,0.302,0.390],
    [0.310,0.358,0.393],[0.394,0.414,0.390],[0.482,0.470,0.379],[0.575,0.530,0.358],
    [0.672,0.595,0.325],[0.775,0.666,0.274],[0.880,0.742,0.199]],
  turbo: [
    [0.190,0.072,0.232],[0.231,0.322,0.745],[0.137,0.572,0.938],[0.069,0.773,0.800],
    [0.200,0.910,0.510],[0.507,0.979,0.254],[0.775,0.953,0.136],[0.953,0.804,0.098],
    [0.993,0.561,0.090],[0.914,0.286,0.063],[0.647,0.082,0.033]],
}};

const CATEGORICAL_COLORS = [
  "#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#84cc16","#ec4899","#14b8a6",
];

const DISPLAY_NAME_FIELDS = ["name", "title", "label", "display", "id"];

function getColorFromScale(value, scaleName, domain) {{
  const scale = COLOR_SCALES[scaleName] || COLOR_SCALES.viridis;
  const [min, max] = domain || [0, 1];
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  const idx = t * (scale.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  if (i >= scale.length - 1) {{
    const c = scale[scale.length - 1];
    return `rgb(${{Math.round(c[0]*255)}},${{Math.round(c[1]*255)}},${{Math.round(c[2]*255)}})`;
  }}
  const c1 = scale[i], c2 = scale[i + 1];
  const r = Math.round((c1[0] + f * (c2[0] - c1[0])) * 255);
  const g = Math.round((c1[1] + f * (c2[1] - c1[1])) * 255);
  const b = Math.round((c1[2] + f * (c2[2] - c1[2])) * 255);
  return `rgb(${{r}},${{g}},${{b}})`;
}}

function getCategoricalColor(value) {{
  let hash = 0;
  const str = String(value);
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return CATEGORICAL_COLORS[Math.abs(hash) % CATEGORICAL_COLORS.length];
}}

function autoLabel(node) {{
  for (const field of DISPLAY_NAME_FIELDS) {{
    const val = node[field];
    if (val != null && String(val)) return String(val);
  }}
  if (Array.isArray(node.labels) && node.labels.length > 0) return node.labels[0];
  return String(node.id || "");
}}

function computeNodeColor(node, colorField, colorScale, colorDomain) {{
  if (node.color) return node.color;
  if (!colorField || node[colorField] === undefined) return "#6366f1";
  const value = node[colorField];
  if (typeof value === "number") return getColorFromScale(value, colorScale, colorDomain);
  return getCategoricalColor(value);
}}

function computeNodeSize(node, sizeField, sizeDomain, sizeRange) {{
  if (node.size !== undefined) return node.size;
  if (!sizeField || node[sizeField] === undefined || !sizeDomain) return 10;
  const [min, max] = sizeDomain;
  const t = max > min ? (node[sizeField] - min) / (max - min) : 0.5;
  return sizeRange[0] + t * (sizeRange[1] - sizeRange[0]);
}}

// --- Build graph ---
const graph = new Graph();
const nodes = DATA.nodes || [];
const edges = DATA.edges || [];

const colorField = OPTIONS.color_field;
const colorScale = OPTIONS.color_scale || "viridis";
let colorDomain = OPTIONS.color_domain;
const sizeField = OPTIONS.size_field;
const sizeRange = OPTIONS.size_range || [5, 30];

if (colorField && !colorDomain) {{
  const vals = nodes.map(n => n[colorField]).filter(v => typeof v === "number");
  if (vals.length > 0) colorDomain = [Math.min(...vals), Math.max(...vals)];
}}

let sizeDomain = null;
if (sizeField) {{
  const vals = nodes.map(n => n[sizeField]).filter(v => typeof v === "number");
  if (vals.length > 0) sizeDomain = [Math.min(...vals), Math.max(...vals)];
}}

const edgeColorField = OPTIONS.edge_color_field;
const edgeColorScale = OPTIONS.edge_color_scale || "viridis";
let edgeColorDomain = null;
if (edgeColorField) {{
  const vals = edges.map(e => e[edgeColorField]).filter(v => typeof v === "number");
  if (vals.length > 0) edgeColorDomain = [Math.min(...vals), Math.max(...vals)];
}}

const edgeSizeField = OPTIONS.edge_size_field;
const edgeSizeRange = OPTIONS.edge_size_range || [1, 8];
let edgeSizeDomain = null;
if (edgeSizeField) {{
  const vals = edges.map(e => e[edgeSizeField]).filter(v => typeof v === "number");
  if (vals.length > 0) edgeSizeDomain = [Math.min(...vals), Math.max(...vals)];
}}

nodes.forEach(node => {{
  graph.addNode(node.id, {{
    label: autoLabel(node),
    x: node.x ?? Math.random() * 100,
    y: node.y ?? Math.random() * 100,
    size: computeNodeSize(node, sizeField, sizeDomain, sizeRange),
    color: computeNodeColor(node, colorField, colorScale, colorDomain),
  }});
}});

edges.forEach(edge => {{
  let color = edge.color || "#94a3b8";
  if (edgeColorField && edge[edgeColorField] !== undefined) {{
    const val = edge[edgeColorField];
    color = typeof val === "number"
      ? getColorFromScale(val, edgeColorScale, edgeColorDomain)
      : getCategoricalColor(val);
  }}
  let size = edge.size || 2;
  if (edgeSizeField && edge[edgeSizeField] !== undefined && edgeSizeDomain) {{
    const [min, max] = edgeSizeDomain;
    const t = max > min ? (edge[edgeSizeField] - min) / (max - min) : 0.5;
    size = edgeSizeRange[0] + t * (edgeSizeRange[1] - edgeSizeRange[0]);
  }}
  graph.addEdge(edge.source, edge.target, {{
    label: edge.label || "",
    size: size,
    color: color,
  }});
}});

// --- Apply layout ---
const layoutName = OPTIONS.layout || "force";
if (graph.order > 0) {{
  switch (layoutName) {{
    case "circular":
      circular.assign(graph);
      break;
    case "random":
      random.assign(graph);
      break;
    case "force":
      forceAtlas2.assign(graph, {{ iterations: 50, settings: {{ gravity: 1, scalingRatio: 2 }} }});
      break;
  }}
}}

// --- Create Sigma renderer ---
const container = document.getElementById("container");
const renderer = new Sigma(graph, container, {{
  renderLabels: OPTIONS.show_labels,
  renderEdgeLabels: OPTIONS.show_edge_labels,
  defaultNodeColor: "#6366f1",
  defaultEdgeColor: "#94a3b8",
  labelColor: {{ color: OPTIONS.dark_mode ? "#ccc" : "#333" }},
  labelSize: 12,
  labelWeight: "500",
}});

// --- Tooltip ---
const tooltip = document.getElementById("tooltip");

renderer.on("enterNode", ({{ node, event }}) => {{
  const attrs = graph.getNodeAttributes(node);
  const data = {{ id: node, ...attrs }};
  const original = nodes.find(n => n.id === node) || {{}};
  let html = "";
  for (const [k, v] of Object.entries(original)) {{
    if (k === "x" || k === "y") continue;
    let display = v;
    if (typeof v === "number") display = Number.isInteger(v) ? v : v.toFixed(3);
    if (Array.isArray(v)) display = v.join(", ");
    html += `<div class="tooltip-row"><span class="tooltip-key">${{k}}:</span><span>${{display}}</span></div>`;
  }}
  if (html) {{
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
  }}
}});

renderer.getMouseCaptor().on("mousemovebody", (e) => {{
  if (tooltip.style.display === "block") {{
    tooltip.style.left = (e.x + 15) + "px";
    tooltip.style.top = (e.y + 15) + "px";
  }}
}});

renderer.on("leaveNode", () => {{
  tooltip.style.display = "none";
}});

renderer.on("enterEdge", ({{ edge }}) => {{
  const attrs = graph.getEdgeAttributes(edge);
  const [source, target] = graph.extremities(edge);
  let html = `<div class="tooltip-row"><span class="tooltip-key">source:</span><span>${{source}}</span></div>`;
  html += `<div class="tooltip-row"><span class="tooltip-key">target:</span><span>${{target}}</span></div>`;
  if (attrs.label) html += `<div class="tooltip-row">` +
    `<span class="tooltip-key">label:</span><span>${{attrs.label}}</span></div>`;
  tooltip.innerHTML = html;
  tooltip.style.display = "block";
}});

renderer.on("leaveEdge", () => {{
  tooltip.style.display = "none";
}});
</script>
</body>
</html>
"""

    def to_html(
        self,
        width: str = "100%",
        height: str = "600px",
        title: str = "Graph Visualization",
    ) -> str:
        """Export the current graph as a self-contained HTML string.

        The resulting HTML loads Graphology and Sigma.js from the esm.sh CDN,
        embeds all current node/edge data plus visual settings, and renders the
        graph with layout, color/size mapping, labels, zoom/pan, and tooltips.

        Parameters
        ----------
        width : str
            CSS width for the graph container (default ``"100%"``).
        height : str
            CSS height for the graph container (default ``"600px"``).
        title : str
            HTML page title (default ``"Graph Visualization"``).

        Returns
        -------
        str
            A complete, self-contained HTML document.
        """
        data = {"nodes": list(self.nodes), "edges": list(self.edges)}
        options = {
            "background": self.background,
            "show_labels": self.show_labels,
            "show_edge_labels": self.show_edge_labels,
            "dark_mode": self.dark_mode,
            "color_field": self.color_field,
            "color_scale": self.color_scale,
            "color_domain": self.color_domain,
            "size_field": self.size_field,
            "size_range": list(self.size_range),
            "edge_color_field": self.edge_color_field,
            "edge_color_scale": self.edge_color_scale,
            "edge_size_field": self.edge_size_field,
            "edge_size_range": list(self.edge_size_range),
            "layout": self.layout,
        }
        return self._HTML_TEMPLATE.format(
            title=title,
            background=self.background,
            width=width,
            height=height,
            json_data=json.dumps(data),
            json_options=json.dumps(options),
        )

    def save_html(self, path: str, **kwargs: Any) -> None:
        """Save the graph as a self-contained HTML file.

        Parameters
        ----------
        path : str
            Destination file path.
        **kwargs
            Forwarded to :meth:`to_html` (``width``, ``height``, ``title``).
        """
        from pathlib import Path

        Path(path).write_text(self.to_html(**kwargs), encoding="utf-8")
