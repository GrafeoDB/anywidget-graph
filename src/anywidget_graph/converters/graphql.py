"""Converter for GraphQL query results."""

from __future__ import annotations

from typing import Any

from anywidget_graph.converters.base import GraphData


class GraphQLConverter:
    """Convert GraphQL JSON responses to graph data.

    Handles various GraphQL schema patterns:
    - Relay-style connections with nodes/edges
    - Simple lists of objects with references
    - Nested object structures

    Parameters
    ----------
    id_field : str
        Field name used for node IDs (default: "id").
    label_field : str
        Field name used for node labels (default: "name").
    nodes_path : str | None
        Dot-separated path to nodes list (e.g., "data.allPeople.nodes").
        If None, auto-detection is used.
    edges_path : str | None
        Dot-separated path to edges list (e.g., "data.connections.edges").
        If None, auto-detection is used.
    source_field : str
        Field name for edge source (default: "source").
    target_field : str
        Field name for edge target (default: "target").

    Example
    -------
    >>> import requests
    >>> response = requests.post(url, json={"query": query})
    >>> result = response.json()
    >>> converter = GraphQLConverter(
    ...     nodes_path="data.characters.results",
    ...     id_field="id",
    ...     label_field="name",
    ... )
    >>> data = converter.convert(result)
    """

    def __init__(
        self,
        id_field: str = "id",
        label_field: str = "name",
        nodes_path: str | None = None,
        edges_path: str | None = None,
        source_field: str = "source",
        target_field: str = "target",
    ) -> None:
        self.id_field = id_field
        self.label_field = label_field
        self.nodes_path = nodes_path
        self.edges_path = edges_path
        self.source_field = source_field
        self.target_field = target_field

    def convert(self, result: Any) -> GraphData:
        """Convert GraphQL result to nodes and edges.

        Parameters
        ----------
        result : Any
            GraphQL JSON response.

        Returns
        -------
        GraphData
            Dictionary with 'nodes' and 'edges' lists.
        """
        # Unwrap data envelope if present
        data = result.get("data", result) if isinstance(result, dict) else result

        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []

        # If explicit paths provided, use them
        if self.nodes_path:
            node_list = self._get_path(data, self.nodes_path) or []
            for item in node_list:
                if isinstance(item, dict):
                    node = self._item_to_node(item)
                    nodes[node["id"]] = node

        if self.edges_path:
            edge_list = self._get_path(data, self.edges_path) or []
            for item in edge_list:
                if isinstance(item, dict):
                    edge = self._item_to_edge(item)
                    if edge.get("source") and edge.get("target"):
                        edges.append(edge)

        # Otherwise, auto-detect structure
        if not self.nodes_path and not self.edges_path:
            self._auto_extract(data, nodes, edges, None)

        return {"nodes": list(nodes.values()), "edges": edges}

    def _get_path(self, data: Any, path: str) -> Any:
        """Navigate nested dict by dot-separated path."""
        for key in path.split("."):
            if isinstance(data, dict):
                data = data.get(key)
            elif isinstance(data, list) and key.isdigit():
                idx = int(key)
                data = data[idx] if idx < len(data) else None
            else:
                return None
        return data

    def _item_to_node(self, item: dict[str, Any]) -> dict[str, Any]:
        """Convert a dict item to node format."""
        node_id = str(item.get(self.id_field, id(item)))
        label = item.get(self.label_field, "")

        result: dict[str, Any] = {
            "id": node_id,
            "label": str(label) if label else node_id,
        }

        # Add scalar properties (skip nested objects and lists)
        for key, value in item.items():
            if key not in (self.id_field,) and not isinstance(value, (dict, list)):
                result[key] = value

        return result

    def _item_to_edge(self, item: dict[str, Any]) -> dict[str, Any]:
        """Convert a dict item to edge format."""
        source = item.get(self.source_field, item.get("from", ""))
        target = item.get(self.target_field, item.get("to", ""))

        # Handle nested node references
        if isinstance(source, dict):
            source = source.get(self.id_field, "")
        if isinstance(target, dict):
            target = target.get(self.id_field, "")

        return {
            "source": str(source),
            "target": str(target),
            "label": str(item.get("label", item.get("type", item.get("__typename", "")))),
        }

    def _auto_extract(
        self,
        data: Any,
        nodes: dict[str, dict[str, Any]],
        edges: list[dict[str, Any]],
        parent_id: str | None,
    ) -> None:
        """Auto-extract graph structure from nested data."""
        if isinstance(data, dict):
            # Check if this looks like a node (has ID field)
            if self.id_field in data:
                node = self._item_to_node(data)
                nodes[node["id"]] = node

                # Create edge from parent
                if parent_id and parent_id != node["id"]:
                    edges.append(
                        {
                            "source": parent_id,
                            "target": node["id"],
                            "label": "contains",
                        }
                    )

                # Process nested references
                for key, value in data.items():
                    if isinstance(value, dict) and self.id_field in value:
                        # Direct reference to another node
                        ref_node = self._item_to_node(value)
                        nodes[ref_node["id"]] = ref_node
                        edges.append(
                            {
                                "source": node["id"],
                                "target": ref_node["id"],
                                "label": key,
                            }
                        )
                    elif isinstance(value, list):
                        # List of possible references
                        for item in value:
                            if isinstance(item, dict) and self.id_field in item:
                                ref_node = self._item_to_node(item)
                                nodes[ref_node["id"]] = ref_node
                                edges.append(
                                    {
                                        "source": node["id"],
                                        "target": ref_node["id"],
                                        "label": key,
                                    }
                                )
            else:
                # Not a node, recurse into values
                for value in data.values():
                    self._auto_extract(value, nodes, edges, parent_id)

        elif isinstance(data, list):
            for item in data:
                self._auto_extract(item, nodes, edges, parent_id)
