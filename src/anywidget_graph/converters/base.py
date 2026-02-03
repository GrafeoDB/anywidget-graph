"""Base types and protocols for result converters."""

from __future__ import annotations

from typing import Any, Protocol, TypedDict


class NodeDict(TypedDict, total=False):
    """Standard node representation.

    Required:
        id: Unique identifier for the node.

    Optional:
        label: Display label for the node.
        labels: List of type labels (e.g., Neo4j labels).
        Additional properties are allowed.
    """

    id: str
    label: str
    labels: list[str]


class EdgeDict(TypedDict, total=False):
    """Standard edge representation.

    Required:
        source: ID of the source node.
        target: ID of the target node.

    Optional:
        label: Display label/type for the edge.
        Additional properties are allowed.
    """

    source: str
    target: str
    label: str


class GraphData(TypedDict):
    """Standard graph data format returned by converters."""

    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class ResultConverter(Protocol):
    """Protocol for converting query results to graph data.

    Implementations should handle the specific result format of their
    query language and return a standardized GraphData structure.

    Example
    -------
    >>> class MyConverter:
    ...     def convert(self, result: Any) -> GraphData:
    ...         nodes = [{"id": "1", "label": "Node"}]
    ...         edges = [{"source": "1", "target": "2"}]
    ...         return {"nodes": nodes, "edges": edges}
    """

    def convert(self, result: Any) -> GraphData:
        """Convert raw query result to nodes and edges.

        Parameters
        ----------
        result : Any
            Raw query result from the database driver.

        Returns
        -------
        GraphData
            Dictionary with 'nodes' and 'edges' lists.
        """
        ...
