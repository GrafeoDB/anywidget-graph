"""Database backend abstractions for anywidget-graph."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from anywidget_graph.backends.arango import ArangoBackend
from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.backends.ladybug import LadybugBackend
from anywidget_graph.backends.neo4j import Neo4jBackend

__all__ = [
    "BACKENDS",
    "QUERY_LANGUAGES",
    "ArangoBackend",
    "DatabaseBackend",
    "GrafeoBackend",
    "LadybugBackend",
    "Neo4jBackend",
]


@runtime_checkable
class DatabaseBackend(Protocol):
    """Protocol defining the interface for database backends.

    Implementations must provide:
    - execute(query) -> (nodes, edges)
    - fetch_schema() -> (node_types, edge_types)

    Example
    -------
    >>> class MyBackend:
    ...     def execute(self, query: str) -> tuple[list[dict], list[dict]]:
    ...         # Execute query and return nodes/edges
    ...         return [], []
    ...
    ...     def fetch_schema(self) -> tuple[list[dict], list[dict]]:
    ...         return [], []
    """

    def execute(self, query: str) -> tuple[list[dict], list[dict]]:
        """Execute a query and return (nodes, edges)."""
        ...

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch schema and return (node_types, edge_types)."""
        ...


# Backend registry for UI
BACKENDS = [
    {"id": "neo4j", "name": "Neo4j", "side": "browser", "language": "cypher"},
    {"id": "neo4j-python", "name": "Neo4j (Python)", "side": "python", "language": "cypher"},
    {"id": "grafeo", "name": "Grafeo", "side": "python", "language": "cypher"},
    {"id": "ladybug", "name": "LadybugDB", "side": "python", "language": "cypher"},
    {"id": "arango", "name": "ArangoDB", "side": "python", "language": "aql"},
]

# Query language registry
QUERY_LANGUAGES = [
    {"id": "cypher", "name": "Cypher", "enabled": True},
    {"id": "gql", "name": "GQL", "enabled": True},
    {"id": "sparql", "name": "SPARQL", "enabled": True},
    {"id": "gremlin", "name": "Gremlin", "enabled": True},
    {"id": "graphql", "name": "GraphQL", "enabled": True},
    {"id": "aql", "name": "AQL", "enabled": True},
]
