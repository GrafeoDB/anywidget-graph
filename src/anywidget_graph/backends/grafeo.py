"""Grafeo database backend (Python-side execution)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, ClassVar

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

    _LANGUAGE_METHODS: ClassVar[dict[str, str]] = {
        "cypher": "execute_cypher",
        "gremlin": "execute_gremlin",
        "graphql": "execute_graphql",
        "sparql": "execute_sparql",
        "sql": "execute_sql",
    }

    def __init__(self, db: Any) -> None:
        """Initialize with a GrafeoDB instance."""
        self._db = db

    @property
    def db(self) -> Any:
        """Get the underlying database instance."""
        return self._db

    def execute(self, query: str, *, language: str = "cypher") -> tuple[list[dict], list[dict]]:
        """Execute a query in the specified language and return (nodes, edges)."""
        method_name = self._LANGUAGE_METHODS.get(language)
        if method_name and hasattr(self._db, method_name):
            result = getattr(self._db, method_name)(query)
        else:
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
                if self._is_grafeo_node(value):
                    node_dict = self._grafeo_node_to_dict(value)
                    node_id = node_dict["id"]
                    if node_id not in nodes:
                        nodes[node_id] = node_dict
                elif self._is_grafeo_relationship(value):
                    edges.append(self._grafeo_relationship_to_dict(value))
                elif is_node(value):
                    node_id = get_node_id(value)
                    if node_id not in nodes:
                        nodes[node_id] = node_to_dict(value)
                elif is_relationship(value):
                    edges.append(relationship_to_dict(value))

        return list(nodes.values()), edges

    @staticmethod
    def _is_grafeo_node(obj: Any) -> bool:
        """Check if a value is a Grafeo node dict (has ``_id`` and ``_labels``)."""
        return isinstance(obj, dict) and "_id" in obj and "_labels" in obj

    @staticmethod
    def _is_grafeo_relationship(obj: Any) -> bool:
        """Check if a value is a Grafeo relationship dict (has ``_source``, ``_target``, ``_type``)."""
        return isinstance(obj, dict) and "_source" in obj and "_target" in obj and "_type" in obj

    @staticmethod
    def _grafeo_node_to_dict(node: dict) -> dict:
        """Convert a Grafeo node dict to the widget node format."""
        node_id = str(node["_id"])
        labels = node.get("_labels", [])
        result: dict = {"id": node_id}
        if labels:
            result["label"] = labels[0]
            result["labels"] = list(labels)
        for key, value in node.items():
            if not key.startswith("_"):
                result[key] = value
        if "label" not in result and "name" in result:
            result["label"] = result["name"]
        return result

    @staticmethod
    def _grafeo_relationship_to_dict(rel: dict) -> dict:
        """Convert a Grafeo relationship dict to the widget edge format."""
        result: dict = {
            "source": str(rel["_source"]),
            "target": str(rel["_target"]),
            "label": str(rel["_type"]),
        }
        for key, value in rel.items():
            if not key.startswith("_"):
                result[key] = value
        return result

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
