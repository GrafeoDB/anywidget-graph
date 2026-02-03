"""Converter for Gremlin/TinkerPop query results."""

from __future__ import annotations

from typing import Any

from anywidget_graph.converters.base import GraphData


class GremlinConverter:
    """Convert Gremlin traversal results to graph data.

    Handles various TinkerPop result types:
    - Vertex objects
    - Edge objects
    - Path objects from path() traversals
    - ValueMap results from valueMap() traversals
    - Dictionaries from elementMap() traversals

    Example
    -------
    >>> from gremlin_python.driver import client
    >>> gremlin_client = client.Client('ws://localhost:8182/gremlin', 'g')
    >>> result = gremlin_client.submit("g.V().limit(10)").all().result()
    >>> converter = GremlinConverter()
    >>> data = converter.convert(result)
    """

    def convert(self, result: Any) -> GraphData:
        """Convert Gremlin result to nodes and edges.

        Parameters
        ----------
        result : Any
            Query result from Gremlin server.

        Returns
        -------
        GraphData
            Dictionary with 'nodes' and 'edges' lists.
        """
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []

        items = list(result) if hasattr(result, "__iter__") else [result]

        for item in items:
            self._process_item(item, nodes, edges)

        return {"nodes": list(nodes.values()), "edges": edges}

    def _process_item(
        self,
        item: Any,
        nodes: dict[str, dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> None:
        """Process a single result item."""
        if item is None:
            return

        # Path object (has .objects attribute)
        if hasattr(item, "objects"):
            for obj in item.objects:
                self._process_item(obj, nodes, edges)
        # Vertex
        elif self._is_vertex(item):
            node_id = str(item.id)
            if node_id not in nodes:
                nodes[node_id] = self._vertex_to_dict(item)
        # Edge
        elif self._is_edge(item):
            edges.append(self._edge_to_dict(item))
        # Dict (from valueMap, elementMap, etc.)
        elif isinstance(item, dict):
            self._process_dict(item, nodes, edges)
        # List/collection
        elif isinstance(item, (list, tuple)):
            for sub_item in item:
                self._process_item(sub_item, nodes, edges)

    def _is_vertex(self, obj: Any) -> bool:
        """Check if object is a Gremlin Vertex."""
        # Vertex has id and label but not outV/inV
        return hasattr(obj, "id") and hasattr(obj, "label") and not hasattr(obj, "outV") and not hasattr(obj, "inV")

    def _is_edge(self, obj: Any) -> bool:
        """Check if object is a Gremlin Edge."""
        # Edge has outV and inV
        return hasattr(obj, "outV") and hasattr(obj, "inV")

    def _vertex_to_dict(self, vertex: Any) -> dict[str, Any]:
        """Convert Vertex to dict."""
        result: dict[str, Any] = {
            "id": str(vertex.id),
            "label": str(vertex.label),
        }
        # Extract properties if available
        if hasattr(vertex, "properties"):
            props = vertex.properties
            if callable(props):
                props = props()
            if hasattr(props, "__iter__"):
                for prop in props:
                    if hasattr(prop, "key") and hasattr(prop, "value"):
                        result[prop.key] = prop.value
        return result

    def _edge_to_dict(self, edge: Any) -> dict[str, Any]:
        """Convert Edge to dict."""
        result: dict[str, Any] = {
            "source": str(edge.outV.id if hasattr(edge.outV, "id") else edge.outV),
            "target": str(edge.inV.id if hasattr(edge.inV, "id") else edge.inV),
            "label": str(edge.label),
        }
        # Extract properties if available
        if hasattr(edge, "properties"):
            props = edge.properties
            if callable(props):
                props = props()
            if isinstance(props, dict):
                result.update(props)
        return result

    def _process_dict(
        self,
        item: dict[str, Any],
        nodes: dict[str, dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> None:
        """Process a dictionary result (from elementMap/valueMap)."""
        # Check for edge indicators
        if "IN" in item and "OUT" in item:
            # This is an edge from elementMap()
            edge = {
                "source": str(item.get("OUT", {}).get("id", item.get("OUT", ""))),
                "target": str(item.get("IN", {}).get("id", item.get("IN", ""))),
                "label": str(item.get("label", "")),
            }
            # Add other properties
            for key, value in item.items():
                if key not in ("id", "label", "IN", "OUT"):
                    edge[key] = self._flatten_value(value)
            edges.append(edge)
        elif "id" in item:
            # This is a vertex
            node_id = str(item["id"])
            if node_id not in nodes:
                node = {"id": node_id}
                for key, value in item.items():
                    if key != "id":
                        node[key] = self._flatten_value(value)
                nodes[node_id] = node

    def _flatten_value(self, value: Any) -> Any:
        """Flatten single-element lists (common in valueMap results)."""
        if isinstance(value, list) and len(value) == 1:
            return value[0]
        return value
