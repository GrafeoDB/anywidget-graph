"""Main Graph widget using anywidget and Sigma.js."""

from __future__ import annotations

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

    # === Selection State ===
    selected_node = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)
    selected_edge = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)

    # === Toolbar Visibility ===
    show_toolbar = traitlets.Bool(default_value=True).tag(sync=True)
    show_settings = traitlets.Bool(default_value=True).tag(sync=True)
    show_query_input = traitlets.Bool(default_value=True).tag(sync=True)

    # === Theme ===
    dark_mode = traitlets.Bool(default_value=True).tag(sync=True)

    # === Database Backend ===
    database_backend = traitlets.Unicode(default_value="neo4j").tag(sync=True)

    # === Neo4j Connection (browser-side) ===
    connection_uri = traitlets.Unicode(default_value="").tag(sync=True)
    connection_username = traitlets.Unicode(default_value="").tag(sync=True)
    connection_password = traitlets.Unicode(default_value="").tag(sync=True)
    connection_database = traitlets.Unicode(default_value="neo4j").tag(sync=True)

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

    # === Query Execution Trigger (for Python backends) ===
    _execute_query = traitlets.Int(default_value=0).tag(sync=True)

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
        database_backend: str = "neo4j",
        connection_uri: str = "",
        connection_username: str = "",
        connection_password: str = "",
        connection_database: str = "neo4j",
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
            nodes, edges = self._backend.execute(self.query)
            self.nodes = nodes
            self.edges = edges
        except Exception as e:
            self.query_error = str(e)
        finally:
            self.query_running = False

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
