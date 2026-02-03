"""Converter for Cypher/Neo4j query results."""

from __future__ import annotations

from typing import Any

from anywidget_graph.converters.base import GraphData
from anywidget_graph.converters.common import (
    get_node_id,
    is_node,
    is_relationship,
    node_to_dict,
    relationship_to_dict,
)


class CypherConverter:
    """Convert Cypher query results to graph data.

    Handles various result formats from Neo4j and compatible databases:
    - Neo4j Python driver Result objects
    - Record objects with .items() or .data() methods
    - Path objects containing nodes and relationships
    - Lists of nodes/relationships

    Example
    -------
    >>> from neo4j import GraphDatabase
    >>> driver = GraphDatabase.driver(uri, auth=auth)
    >>> with driver.session() as session:
    ...     result = session.run("MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10")
    ...     converter = CypherConverter()
    ...     data = converter.convert(result)
    ...     print(f"Found {len(data['nodes'])} nodes")
    """

    def convert(self, result: Any) -> GraphData:
        """Convert Cypher result to nodes and edges.

        Parameters
        ----------
        result : Any
            Query result from Neo4j driver or compatible database.

        Returns
        -------
        GraphData
            Dictionary with 'nodes' and 'edges' lists.
        """
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []

        records = list(result) if hasattr(result, "__iter__") else [result]

        for record in records:
            for _key, value in self._extract_items(record):
                self._process_value(value, nodes, edges)

        return {"nodes": list(nodes.values()), "edges": edges}

    def _extract_items(self, record: Any) -> list[tuple[str, Any]]:
        """Extract key-value items from a record.

        Handles multiple record formats:
        - Records with .items() method (Neo4j Record)
        - Records with .data() method
        - Plain dictionaries
        """
        if hasattr(record, "items"):
            items = record.items() if callable(record.items) else record.items
            return list(items)
        elif hasattr(record, "data"):
            return list(record.data().items())
        elif isinstance(record, dict):
            return list(record.items())
        return []

    def _process_value(
        self,
        value: Any,
        nodes: dict[str, dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> None:
        """Process a single value, handling paths and collections recursively."""
        if value is None:
            return

        # Handle Path objects (have .nodes and .relationships attributes)
        if hasattr(value, "nodes") and hasattr(value, "relationships"):
            for node in value.nodes:
                node_id = get_node_id(node)
                if node_id not in nodes:
                    nodes[node_id] = node_to_dict(node)
            for rel in value.relationships:
                edges.append(relationship_to_dict(rel))
        # Handle individual nodes
        elif is_node(value):
            node_id = get_node_id(value)
            if node_id not in nodes:
                nodes[node_id] = node_to_dict(value)
        # Handle individual relationships
        elif is_relationship(value):
            edges.append(relationship_to_dict(value))
        # Handle lists/collections
        elif isinstance(value, (list, tuple)):
            for item in value:
                self._process_value(item, nodes, edges)
