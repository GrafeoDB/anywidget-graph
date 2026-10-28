"""Main Graph widget using anywidget and Sigma.js."""

from __future__ import annotations

import html
import json
import re
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

import anywidget
import traitlets
from traitlets import observe

from anywidget_graph.backends import DatabaseBackend
from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.ui import get_css, get_esm, get_vendor_js

if TYPE_CHECKING:
    from collections.abc import Callable


def _script_json(value: Any) -> str:
    """JSON for a ``<script>`` element: ``<``, ``>`` and ``&`` are escaped, so a value cannot close the element."""
    return json.dumps(value).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


# The page to_html() fills in (a str.format template: literal braces are doubled)
_EXPORT_TEMPLATE = Path(__file__).parent / "ui" / "export.html"

# A CSS colour or length the page writes into its <style>: plain values only, so a value cannot end the element
_CSS_VALUE = re.compile(r"^[#\w(),.%\s-]+$")
# The widget's canvas colours (styles.css --awg-graph-bg) and its default `background`
_CANVAS_LIGHT, _CANVAS_DARK, _DEFAULT_BACKGROUND = "#ffffff", "#181c1a", "#fafafa"


def _query_result_note(row_count: int | None, nodes: list, edges: list) -> str:
    """The note for a result without nodes or edges (the drawing stays), "" when the result is drawn.

    Mirrors ``queryResultNote`` in ui/defaults.js; ``row_count`` is None when the backend does not report it.
    """
    if nodes or edges:
        return ""
    if row_count == 0:
        return "The query returned no rows, so the drawing is unchanged."
    if not row_count:
        return "The query returned nothing to draw, so the drawing is unchanged."
    what = "1 row" if row_count == 1 else f"{row_count} rows"
    return (
        f"The query returned {what} without nodes, edges or paths, so the drawing is unchanged. "
        "Return graph elements (for example RETURN n, r, m) to draw them."
    )


def _css_value(value: Any, fallback: str) -> str:
    return value if isinstance(value, str) and _CSS_VALUE.match(value) else fallback


def _is_dark(color: str, fallback: bool) -> bool:
    """Whether a ``#rgb`` or ``#rrggbb`` colour is dark; ``fallback`` for any other notation."""
    digits = color.lstrip("#")
    if not color.startswith("#") or len(digits) not in (3, 6):
        return fallback
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    try:
        r, g, b = (int(digits[k : k + 2], 16) for k in (0, 2, 4))
    except ValueError:
        return fallback
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128


class _ChosenBool(traitlets.Bool):
    """A theme trait that records a choice in its `flag` trait whenever Python assigns it.

    Assigning the value the trait already has counts too: `graph.dark_mode = True` on a dark page keeps the widget dark
    after the page turns light. Values the widget writes from the browser arrive through `set_state` and are not a
    choice. The same contract as anywidget-archimate and anywidget-vector.
    """

    def __init__(self, *args: Any, flag: str, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.flag = flag

    def set(self, obj: Any, value: Any) -> None:
        super().set(obj, value)
        if not obj._applying_frontend_state:
            obj.set_trait(self.flag, True)


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
    # Take the host element's size (100% wide and high) and follow its resizes; width/height are then ignored
    fill = traitlets.Bool(default_value=False).tag(sync=True)
    background = traitlets.Unicode(default_value="#fafafa").tag(sync=True)
    show_labels = traitlets.Bool(default_value=True).tag(sync=True)
    show_edge_labels = traitlets.Bool(default_value=False).tag(sync=True)
    # Draw edges as arrows (source to target); self-loops are drawn as loops either way
    edge_arrows = traitlets.Bool(default_value=False).tag(sync=True)
    # A selected node keeps its neighbours and their edges lit; everything else dims
    highlight_neighbors = traitlets.Bool(default_value=False).tag(sync=True)

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
    # spring, force, cluster, circular, random, or preset (the nodes' own x and y)
    layout = traitlets.Unicode(default_value="spring").tag(sync=True)

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

    # === Visibility levels ===
    # Levels of detail, lowest first: [{"id": 0, "label": "All", "count": 5230}, ...]; `count` comes from the host.
    # A node's `level_field` holds the highest level it survives; the widget shows nodes with a level >= current_level
    # (the level just below dimmed with filtered_style="dim", hidden with "hide"); nodes without a level always show.
    levels = traitlets.List(trait=traitlets.Dict()).tag(sync=True)
    level_field = traitlets.Unicode(default_value="level").tag(sync=True)
    current_level = traitlets.Int(default_value=0).tag(sync=True)
    filtered_style = traitlets.Unicode(default_value="dim").tag(sync=True)

    # === Theme ===
    dark_mode = _ChosenBool(default_value=True, flag="_theme_explicit").tag(sync=True)
    # True when dark_mode is a choice (given to the constructor, set after display, or switched in the settings);
    # until then the front end follows the page's light or dark theme and reports it in dark_mode
    _theme_explicit = traitlets.Bool(default_value=False).tag(sync=True)
    # True while set_state applies the browser's state, so its dark_mode is not taken for a choice made in Python
    _applying_frontend_state = False

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
    query_time = traitlets.Float(default_value=0.0).tag(sync=True)
    query_error = traitlets.Unicode(default_value="").tag(sync=True)
    # What a finished query tells the viewer besides its result (nothing to draw, a cut at max_nodes); not an error
    query_note = traitlets.Unicode(default_value="").tag(sync=True)

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

    # === Linked lanes, incremental append, pulse and host theme (all off by default) ===
    lanes = traitlets.List(trait=traitlets.Dict()).tag(sync=True)
    append_batch = traitlets.Dict(default_value={}).tag(sync=True)
    append_stagger_ms = traitlets.Int(default_value=60).tag(sync=True)
    append_animation = traitlets.Unicode(default_value="draw").tag(sync=True)
    pulse_nodes = traitlets.List(default_value=[]).tag(sync=True)
    theme = traitlets.Dict(default_value={}).tag(sync=True)
    # A click on an action lane's glyph: {"lane": <lane id>, "seq": <n>} (seq counts up, so repeated clicks are seen)
    lane_action = traitlets.Dict(default_value={}).tag(sync=True)
    # Totals from the host when it sends a sample: {"nodes": {"<type>": n}, "edges": {"<type>": n}}; the count badge
    # and the schema panel show "shown / total" (a type without a total shows its count only)
    totals = traitlets.Dict(default_value={}).tag(sync=True)
    # Colours per type from the host: {"nodes": {"<type>": "#hex"}, "edges": {"<type>": "#hex"}}; they colour the items
    # of that type and the legend swatches (an item's own `color` still wins; other types keep the palette)
    type_colors = traitlets.Dict(default_value={}).tag(sync=True)
    _features = traitlets.List(default_value=[]).tag(sync=True)

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
        dark_mode: bool | None = None,
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
        dark_mode : bool, optional
            Whether to use dark theme. Left out (None), the widget follows the page's light or dark theme and
            reports it here; given, it keeps that theme.
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
        # dark_mode left out follows the page (the trait keeps its default until the front end reports the page's);
        # given, the trait records it as a choice, as for any later assignment from Python
        if dark_mode is not None:
            kwargs["dark_mode"] = dark_mode
        # Server mode reads grafeo_server_url; an http(s) connection_uri given instead names that server
        if (
            kwargs.get("grafeo_connection_mode") == "server"
            and "grafeo_server_url" not in kwargs
            and connection_uri.startswith(("http://", "https://"))
        ):
            kwargs["grafeo_server_url"] = connection_uri
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

    def append(self, nodes: list[dict[str, Any]] | None = None, edges: list[dict[str, Any]] | None = None) -> None:
        """Add nodes and edges to the drawn graph without a re-layout (merged by id).

        Existing nodes keep their positions. The items are also merged into ``nodes`` and ``edges`` (a node by id,
        its properties updated; an edge once per source, target and label), so ``to_json()``, ``to_html()`` and a
        widget shown again include them; the widget sees the lists match what it draws and does not lay out again.
        """
        nodes, edges = list(nodes or []), list(edges or [])
        merged_nodes = {node["id"]: node for node in self.nodes}
        for node in nodes:
            merged_nodes[node["id"]] = {**merged_nodes.get(node["id"], {}), **node}
        edge_keys = {(e["source"], e["target"], e.get("label") or "") for e in self.edges}
        merged_edges = list(self.edges)
        for edge in edges:
            key = (edge["source"], edge["target"], edge.get("label") or "")
            if key not in edge_keys:
                edge_keys.add(key)
                merged_edges.append(edge)
        seq = int(self.append_batch.get("seq", 0)) + 1
        with self.hold_sync():
            self.nodes = list(merged_nodes.values())
            self.edges = merged_edges
            self.append_batch = {"seq": seq, "nodes": nodes, "edges": edges}

    def remove(self, nodes: list[str] | None = None, edges: list[dict[str, Any]] | None = None) -> None:
        """Take nodes (with every edge touching them) and edges out of the drawn graph without a re-layout.

        They fade out; the rest stays where it is. An edge is ``{"source", "target"}`` (every edge between those ends)
        or with a ``"label"`` (that edge only). They also leave ``nodes`` and ``edges``.
        """
        ids, specs = set(nodes or []), list(edges or [])

        def named(edge: dict[str, Any]) -> bool:
            return any(
                edge["source"] == spec["source"]
                and edge["target"] == spec["target"]
                and (spec.get("label") is None or (edge.get("label") or "") == spec["label"])
                for spec in specs
            )

        kept_edges = [e for e in self.edges if e["source"] not in ids and e["target"] not in ids and not named(e)]
        seq = int(self.append_batch.get("seq", 0)) + 1
        with self.hold_sync():
            self.nodes = [n for n in self.nodes if n["id"] not in ids]
            self.edges = kept_edges
            self.append_batch = {
                "seq": seq,
                "nodes": [],
                "edges": [],
                "remove": {"nodes": list(nodes or []), "edges": specs},
            }

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

    def set_state(self, sync_data: dict[str, Any]) -> None:
        """Apply state from the browser (Jupyter and marimo both call this): a dark_mode it carries is the widget
        following the page, or a choice the browser already recorded, not a choice made in Python."""
        self._applying_frontend_state = True
        try:
            super().set_state(sync_data)
        finally:
            self._applying_frontend_state = False

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
            self.query_note = ""
            start = time.perf_counter()
            nodes, edges = self._backend.execute(self.query, language=self.query_language)
            self.query_time = (time.perf_counter() - start) * 1000
            # A result without nodes or edges keeps what is drawn, and the note says why
            self.query_note = _query_result_note(getattr(self._backend, "last_row_count", None), nodes, edges)
            if not self.query_note:
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
            lang = self.query_language if self.query_language in self._NEIGHBOR_QUERY_LANGUAGES else "cypher"
            query = self._build_neighbor_query(node_id, lang, integer_ids=isinstance(self._backend, GrafeoBackend))
            new_nodes, new_edges = self._backend.execute(query, language=lang)
            self._merge_graph(new_nodes, new_edges)
        except Exception as e:
            self.query_error = str(e)
        finally:
            self.query_running = False

    # Languages with a native neighbor query; expansion uses Cypher for the others
    _NEIGHBOR_QUERY_LANGUAGES = frozenset({"cypher", "gql", "gremlin", "aql"})

    @staticmethod
    def _string_literal(value: str, quote: str) -> str:
        """Quote a string for a query, escaping backslashes and the quote character."""
        escaped = value.replace("\\", "\\\\").replace(quote, "\\" + quote)
        return f"{quote}{escaped}{quote}"

    @classmethod
    def _build_neighbor_query(cls, node_id: str, language: str, *, integer_ids: bool = False) -> str:
        """Build a neighbor query for the given language.

        With ``integer_ids`` (Grafeo), a numeric node id is written as an
        integer literal: Grafeo ids are integers, so ``id(n) = "42"`` and
        ``g.V('42')`` never match.
        """

        def literal(quote: str) -> str:
            if integer_ids and node_id.isascii() and node_id.isdigit():
                return node_id
            return cls._string_literal(node_id, quote)

        if language == "gremlin":
            vertex = literal("'")
            return f"g.V({vertex}).bothE().as('e').otherV().as('v').select('e','v')"
        if language == "aql":
            # ArangoDB document ids ("collection/key") are always strings
            start = cls._string_literal(node_id, '"')
            return f'FOR v, e IN 1..1 ANY {start} GRAPH "default" RETURN {{v: v, e: e}}'
        # Cypher and GQL (also the fallback)
        node = literal('"')
        return f"MATCH (n)-[r]-(m) WHERE id(n) = {node} RETURN n, r, m"

    def _merge_graph(self, new_nodes: list[dict], new_edges: list[dict]) -> None:
        """Merge new nodes and edges into the existing graph, deduplicating."""
        existing_node_ids = {n["id"] for n in self.nodes}
        existing_edge_keys = {(e["source"], e["target"], e.get("label", "")) for e in self.edges}

        added = [n for n in new_nodes if n["id"] not in existing_node_ids]
        merged_nodes = list(self.nodes) + added
        merged_edges = list(self.edges) + [
            e for e in new_edges if (e["source"], e["target"], e.get("label", "")) not in existing_edge_keys
        ]

        if len(merged_nodes) > self.max_nodes:
            # The drawn graph stays; the room left goes to the new nodes with the most links to it, so the cut keeps
            # the neighbours that connect rather than whichever came first
            room = max(self.max_nodes - len(self.nodes), 0)
            links = dict.fromkeys((n["id"] for n in added), 0)
            for e in merged_edges:
                for end, other in ((e["source"], e["target"]), (e["target"], e["source"])):
                    if end in links and other in existing_node_ids:
                        links[end] += 1
            ranked = sorted(range(len(added)), key=lambda i: -links[added[i]["id"]])
            chosen = sorted(ranked[:room])
            merged_nodes = list(self.nodes)[: self.max_nodes] + [added[i] for i in chosen]
            kept_ids = {n["id"] for n in merged_nodes}
            merged_edges = [e for e in merged_edges if e["source"] in kept_ids and e["target"] in kept_ids]
            self.query_note = f"Graph truncated to {self.max_nodes} nodes. Call clear() or increase max_nodes."

        self.nodes = merged_nodes
        self.edges = merged_edges

    def expand_node(self, node_id: str) -> None:
        """Programmatically expand a node to show its neighbors."""
        self._expand_node(node_id)

    def clear(self) -> None:
        """Clear the graph and reset selection."""
        self.nodes = []
        self.edges = []
        # The traits allow None (nothing selected); set_trait says so where the attribute's type cannot
        self.set_trait("selected_node", None)
        self.set_trait("selected_edge", None)
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
    #  Export                                                              #
    # ------------------------------------------------------------------ #

    def to_json(self) -> str:
        """Export the graph data (nodes and edges) as a JSON string."""
        return json.dumps({"nodes": list(self.nodes), "edges": list(self.edges)})

    def to_html(
        self,
        width: str = "100%",
        height: str = "600px",
        title: str = "Graph Visualization",
    ) -> str:
        """Export the current graph as a self-contained HTML string.

        The resulting HTML carries Graphology and Sigma.js itself (no CDN, so it opens offline),
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
        # The page looks like the widget: the host theme's colours, else the canvas of the light or dark mode (or a
        # `background` set on the graph), with labels that read on it
        theme = self.theme or {}
        canvas = _CANVAS_DARK if self.dark_mode else _CANVAS_LIGHT
        if self.background != _DEFAULT_BACKGROUND:
            canvas = self.background
        background = _css_value(theme.get("background") or canvas, canvas)
        dark = _is_dark(background, self.dark_mode)
        label_color = _css_value(theme.get("text"), "#e0e0e0" if dark else "#333333")
        options = {
            "background": background,
            "label_color": label_color,
            "show_labels": self.show_labels,
            "show_edge_labels": self.show_edge_labels,
            "edge_arrows": self.edge_arrows,
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
        return _EXPORT_TEMPLATE.read_text(encoding="utf-8").format(
            title=html.escape(title),
            background=background,
            width=_css_value(width, "100%"),
            height=_css_value(height, "600px"),
            json_data=_script_json(data),
            json_options=_script_json(options),
            vendor_js=get_vendor_js(),
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
        Path(path).write_text(self.to_html(**kwargs), encoding="utf-8")
