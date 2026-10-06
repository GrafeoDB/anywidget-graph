"""Grafeo database backend (Python-side execution).

Grafeo returns result rows as dicts. Entities are encoded as dicts with
metadata keys, and that encoding is the contract this module depends on:

- node: ``{"_id": int, "_labels": [str, ...], **properties}``
- edge: ``{"_id": int, "_type": str, "_source": int, "_target": int, **properties}``
- path: ``{"nodes": [int, ...], "edges": [int, ...]}`` (ids only)

Entities can also sit inside lists (``collect(n)``, variable-length edge
variables, ``nodes(p)``). Ids that are referenced but not returned as
entities (path members, edge endpoints) are resolved with
``db.get_node(id)`` / ``db.get_edge(id)``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar

from anywidget_graph.converters import (
    get_node_id,
    is_node,
    is_relationship,
    node_to_dict,
    relationship_to_dict,
)


@dataclass(slots=True)
class _GraphAccumulator:
    """Nodes and edges collected from one result, plus ids still to resolve."""

    nodes: dict[str, dict] = field(default_factory=dict)
    edges: dict[Any, dict] = field(default_factory=dict)
    grafeo_edge_keys: set[Any] = field(default_factory=set)
    path_node_ids: set[int] = field(default_factory=set)
    path_edge_ids: set[int] = field(default_factory=set)


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
        return self._process_result(self._run(query, language))

    def _run(self, query: str, language: str) -> Any:
        method_name = self._LANGUAGE_METHODS.get(language)
        if method_name and hasattr(self._db, method_name):
            return getattr(self._db, method_name)(query)
        if method_name is None and language not in ("", "gql") and hasattr(self._db, "execute_language"):
            # Lets the engine reject unsupported languages with a clear error
            return self._db.execute_language(language, query)
        return self._db.execute(query)

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch schema from Grafeo database.

        ``db.schema()`` returns ``{"labels": [{"name", "count"}], "edge_types": [...]}``;
        plain string entries are accepted as well.
        """
        if not hasattr(self._db, "schema"):
            return [], []
        schema = self._db.schema()
        if not isinstance(schema, dict):
            return [], []
        node_types = [self._schema_entry(item, "label") for item in schema.get("labels") or []]
        edge_types = [self._schema_entry(item, "type") for item in schema.get("edge_types") or []]
        return node_types, edge_types

    @staticmethod
    def _schema_entry(item: Any, key: str) -> dict:
        if isinstance(item, dict):
            entry: dict = {key: str(item.get("name", "")), "properties": list(item.get("properties") or [])}
            if isinstance(item.get("count"), int):
                entry["count"] = item["count"]
            return entry
        return {key: str(item), "properties": []}

    def _process_result(self, result: Any) -> tuple[list[dict], list[dict]]:
        """Process query results into nodes and edges."""
        acc = _GraphAccumulator()

        records = list(result) if hasattr(result, "__iter__") else [result]
        for record in records:
            for _key, value in self._extract_items(record):
                self._add_top_level(acc, value)

        self._resolve_missing(acc)

        edges = [
            edge
            for key, edge in acc.edges.items()
            if key not in acc.grafeo_edge_keys or (edge["source"] in acc.nodes and edge["target"] in acc.nodes)
        ]
        return list(acc.nodes.values()), edges

    def _add_top_level(self, acc: _GraphAccumulator, value: Any) -> None:
        if self._add_grafeo_entity(acc, value):
            return
        # Values from other drivers or hand-built rows
        if is_node(value):
            node_id = get_node_id(value)
            if node_id not in acc.nodes:
                acc.nodes[node_id] = node_to_dict(value)
        elif is_relationship(value):
            acc.edges[("generic", len(acc.edges))] = relationship_to_dict(value)
        else:
            self._add_nested(acc, value)

    def _add_value(self, acc: _GraphAccumulator, value: Any) -> None:
        if not self._add_grafeo_entity(acc, value):
            self._add_nested(acc, value)

    def _add_nested(self, acc: _GraphAccumulator, value: Any) -> None:
        """Search lists and plain maps for entities (collect, nodes(p), variable-length edges)."""
        if isinstance(value, list | tuple):
            for item in value:
                self._add_value(acc, item)
        elif isinstance(value, dict):
            for item in value.values():
                self._add_value(acc, item)

    def _add_grafeo_entity(self, acc: _GraphAccumulator, value: Any) -> bool:
        """Collect a Grafeo node, edge or path; return False for any other value."""
        if self._is_grafeo_node(value):
            node = self._grafeo_node_to_dict(value)
            acc.nodes.setdefault(node["id"], node)
            return True
        if self._is_grafeo_relationship(value):
            key = ("grafeo", value["_id"]) if "_id" in value else ("grafeo-anon", len(acc.edges))
            if key not in acc.edges:
                acc.edges[key] = self._grafeo_relationship_to_dict(value)
                acc.grafeo_edge_keys.add(key)
            return True
        if self._is_grafeo_path(value):
            for member, ids in ((value["nodes"], acc.path_node_ids), (value["edges"], acc.path_edge_ids)):
                for item in member:
                    if self._is_entity_id(item):
                        ids.add(item)
                    else:
                        self._add_value(acc, item)
            return True
        return False

    def _resolve_missing(self, acc: _GraphAccumulator) -> None:
        """Look up path members and edge endpoints that were only returned as ids."""
        get_edge = getattr(self._db, "get_edge", None)
        if get_edge is not None:
            for edge_id in sorted(acc.path_edge_ids):
                if ("grafeo", edge_id) in acc.edges:
                    continue
                edge = get_edge(edge_id)
                if edge is not None:
                    self._add_grafeo_entity(acc, self._edge_object_to_raw(edge))

        get_node = getattr(self._db, "get_node", None)
        if get_node is None:
            return
        wanted = {str(node_id): node_id for node_id in acc.path_node_ids}
        for key in acc.grafeo_edge_keys:
            edge = acc.edges[key]
            for endpoint in (edge["source"], edge["target"]):
                if endpoint.isdigit():
                    wanted.setdefault(endpoint, int(endpoint))
        for node_key, node_id in sorted(wanted.items(), key=lambda item: item[1]):
            if node_key in acc.nodes:
                continue
            node = get_node(node_id)
            if node is not None:
                self._add_grafeo_entity(acc, self._node_object_to_raw(node))

    @staticmethod
    def _is_entity_id(value: Any) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0

    @staticmethod
    def _node_object_to_raw(node: Any) -> dict:
        """Convert a ``grafeo.Node`` (from ``db.get_node``) to the row dict encoding."""
        return {**node.properties(), "_id": node.id, "_labels": list(node.labels)}

    @staticmethod
    def _edge_object_to_raw(edge: Any) -> dict:
        """Convert a ``grafeo.Edge`` (from ``db.get_edge``) to the row dict encoding."""
        return {
            **edge.properties(),
            "_id": edge.id,
            "_type": edge.edge_type,
            "_source": edge.source_id,
            "_target": edge.target_id,
        }

    @staticmethod
    def _is_grafeo_node(obj: Any) -> bool:
        """Check if a value is a Grafeo node dict (has ``_id`` and ``_labels``)."""
        return isinstance(obj, dict) and "_id" in obj and "_labels" in obj

    @staticmethod
    def _is_grafeo_relationship(obj: Any) -> bool:
        """Check if a value is a Grafeo relationship dict (has ``_source``, ``_target``, ``_type``)."""
        return isinstance(obj, dict) and "_source" in obj and "_target" in obj and "_type" in obj

    @staticmethod
    def _is_grafeo_path(obj: Any) -> bool:
        """Check if a value is a Grafeo path (``nodes`` and ``edges`` lists, no ``_id``)."""
        return (
            isinstance(obj, dict)
            and "_id" not in obj
            and isinstance(obj.get("nodes"), list)
            and isinstance(obj.get("edges"), list)
        )

    @staticmethod
    def _grafeo_node_to_dict(node: dict) -> dict:
        """Convert a Grafeo node dict to the widget node format.

        Properties are applied before ``id`` and ``labels`` so that a user
        property called ``id`` cannot replace the node identity that edges
        refer to.
        """
        labels = list(node.get("_labels") or [])
        props = {key: value for key, value in node.items() if not key.startswith("_")}
        result: dict = {}
        if labels:
            result["label"] = labels[0]
        result.update(props)
        result["id"] = str(node["_id"])
        if labels:
            result["labels"] = labels
        if "label" not in result and "name" in result:
            result["label"] = result["name"]
        return result

    @staticmethod
    def _grafeo_relationship_to_dict(rel: dict) -> dict:
        """Convert a Grafeo relationship dict to the widget edge format.

        ``source`` and ``target`` always come from the engine, never from
        properties with the same name.
        """
        result: dict = {"label": str(rel["_type"])}
        result.update({key: value for key, value in rel.items() if not key.startswith("_")})
        result["source"] = str(rel["_source"])
        result["target"] = str(rel["_target"])
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
