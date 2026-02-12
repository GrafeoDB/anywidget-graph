"""Grafeo database backend (Python-side execution)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from anywidget_graph.converters import (
    get_node_id,
    is_node,
    is_relationship,
    node_to_dict,
    relationship_to_dict,
)

if TYPE_CHECKING:
    pass


class GrafeoBackend:
    """Backend for Grafeo database connections."""

    def __init__(self, db: Any) -> None:
        """Initialize with a GrafeoDB instance."""
        self._db = db

    @property
    def db(self) -> Any:
        """Get the underlying database instance."""
        return self._db

    def execute(self, query: str, *, language: str = "cypher") -> tuple[list[dict], list[dict]]:
        """Execute a query in the specified language and return (nodes, edges)."""
        result = self._db.execute(query)
        return self._process_result(result)

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch schema from Grafeo database."""
        if hasattr(self._db, "schema"):
            try:
                schema = self._db.schema()
                node_types = [
                    {"label": label, "properties": []}
                    for label in (schema.get("labels") if isinstance(schema, dict) else []) or []
                ]
                edge_types = [
                    {"type": t, "properties": []}
                    for t in (schema.get("edge_types") if isinstance(schema, dict) else []) or []
                ]
                return node_types, edge_types
            except Exception:
                pass
        return [], []

    def _process_result(self, result: Any) -> tuple[list[dict], list[dict]]:
        """Process query results into nodes and edges."""
        nodes: dict[str, dict] = {}
        edges: list[dict] = []

        records = list(result) if hasattr(result, "__iter__") else [result]

        for record in records:
            items = self._extract_items(record)
            for _key, value in items:
                if is_node(value):
                    node_id = get_node_id(value)
                    if node_id not in nodes:
                        nodes[node_id] = node_to_dict(value)
                elif is_relationship(value):
                    edges.append(relationship_to_dict(value))

        return list(nodes.values()), edges

    def _extract_items(self, record: Any) -> list[tuple[str, Any]]:
        """Extract key-value items from a record."""
        if hasattr(record, "items"):
            items = record.items() if callable(record.items) else record.items
            return list(items)
        elif hasattr(record, "data"):
            return list(record.data().items())
        elif isinstance(record, dict):
            return list(record.items())
        return []
