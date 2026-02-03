"""LadybugDB database backend."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from anywidget_graph.converters.cypher import CypherConverter

if TYPE_CHECKING:
    pass


class LadybugBackend:
    """Backend for LadybugDB embedded graph database.

    LadybugDB is an embedded graph database that supports Cypher queries.

    Parameters
    ----------
    db : Any
        LadybugDB database instance.

    Example
    -------
    >>> from ladybug import LadybugDB
    >>> db = LadybugDB()
    >>> db.execute("CREATE (a:Person {name: 'Alice'})-[:KNOWS]->(b:Person {name: 'Bob'})")
    >>>
    >>> from anywidget_graph.backends import LadybugBackend
    >>> backend = LadybugBackend(db)
    >>> nodes, edges = backend.execute("MATCH (n)-[r]->(m) RETURN n, r, m")
    """

    def __init__(self, db: Any) -> None:
        self._db = db
        self._converter = CypherConverter()

    @property
    def query_language(self) -> str:
        """Return the default query language."""
        return "cypher"

    @property
    def db(self) -> Any:
        """Get the underlying database instance."""
        return self._db

    def execute(self, query: str) -> tuple[list[dict], list[dict]]:
        """Execute Cypher query and return (nodes, edges).

        Parameters
        ----------
        query : str
            Cypher query to execute.

        Returns
        -------
        tuple[list[dict], list[dict]]
            Tuple of (nodes, edges) lists.
        """
        result = self._db.execute(query)
        data = self._converter.convert(result)
        return data["nodes"], data["edges"]

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch LadybugDB schema.

        Returns
        -------
        tuple[list[dict], list[dict]]
            Tuple of (node_types, edge_types).
        """
        node_types: list[dict[str, Any]] = []
        edge_types: list[dict[str, Any]] = []

        # Try to get labels if supported
        try:
            labels_result = self._db.execute("CALL db.labels()")
            for record in labels_result:
                label = record[0] if hasattr(record, "__getitem__") else str(record)
                node_types.append({"label": label, "properties": []})
        except Exception:
            pass

        # Try to get relationship types if supported
        try:
            types_result = self._db.execute("CALL db.relationshipTypes()")
            for record in types_result:
                rel_type = record[0] if hasattr(record, "__getitem__") else str(record)
                edge_types.append({"type": rel_type, "properties": []})
        except Exception:
            pass

        return node_types, edge_types
