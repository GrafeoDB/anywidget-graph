"""Neo4j database backend using the Python driver."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from anywidget_graph.converters.cypher import CypherConverter

if TYPE_CHECKING:
    from neo4j import Driver


class Neo4jBackend:
    """Backend for Neo4j database using the Python driver.

    This executes queries Python-side (not in browser).
    Use for server-side notebooks or when browser connectivity is limited.

    Parameters
    ----------
    driver : Driver | None
        Existing Neo4j driver instance.
    uri : str | None
        Neo4j connection URI (e.g., "neo4j://localhost:7687").
    auth : tuple[str, str] | None
        Authentication tuple (username, password).
    database : str
        Database name to use (default: "neo4j").

    Example
    -------
    >>> from anywidget_graph.backends import Neo4jBackend
    >>> backend = Neo4jBackend(
    ...     uri="neo4j://localhost:7687",
    ...     auth=("neo4j", "password"),
    ... )
    >>> nodes, edges = backend.execute("MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10")

    Or with an existing driver:

    >>> from neo4j import GraphDatabase
    >>> driver = GraphDatabase.driver(uri, auth=auth)
    >>> backend = Neo4jBackend(driver=driver)
    """

    def __init__(
        self,
        driver: Driver | None = None,
        uri: str | None = None,
        auth: tuple[str, str] | None = None,
        database: str = "neo4j",
    ) -> None:
        self._driver = driver
        self._uri = uri
        self._auth = auth
        self._database = database
        self._converter = CypherConverter()
        self._owns_driver = driver is None  # Track if we created the driver

    @property
    def query_language(self) -> str:
        """Return the default query language."""
        return "cypher"

    @property
    def driver(self) -> Driver:
        """Get or create the Neo4j driver."""
        if self._driver is None:
            if self._uri is None:
                msg = "Either driver or uri must be provided"
                raise ValueError(msg)
            from neo4j import GraphDatabase

            self._driver = GraphDatabase.driver(self._uri, auth=self._auth)
        return self._driver

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
        with self.driver.session(database=self._database) as session:
            result = session.run(query)
            records = list(result)  # Consume within session

        data = self._converter.convert(records)
        return data["nodes"], data["edges"]

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch Neo4j schema.

        Returns
        -------
        tuple[list[dict], list[dict]]
            Tuple of (node_types, edge_types) with label/type info and properties.
        """
        node_types: list[dict[str, Any]] = []
        edge_types: list[dict[str, Any]] = []

        with self.driver.session(database=self._database) as session:
            # Get node labels
            labels_result = session.run("CALL db.labels()")
            for record in labels_result:
                label = record[0]
                # Get properties for this label
                props_result = session.run(f"MATCH (n:`{label}`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 20")
                properties = [r[0] for r in props_result]
                node_types.append({"label": label, "properties": properties})

            # Get relationship types
            rel_types_result = session.run("CALL db.relationshipTypes()")
            for record in rel_types_result:
                rel_type = record[0]
                # Get properties for this type
                props_result = session.run(
                    f"MATCH ()-[r:`{rel_type}`]->() UNWIND keys(r) AS key RETURN DISTINCT key LIMIT 20"
                )
                properties = [r[0] for r in props_result]
                edge_types.append({"type": rel_type, "properties": properties})

        return node_types, edge_types

    def close(self) -> None:
        """Close the driver connection if we own it."""
        if self._driver and self._owns_driver:
            self._driver.close()
            self._driver = None

    def __enter__(self) -> Neo4jBackend:
        """Context manager entry."""
        return self

    def __exit__(self, *args: Any) -> None:
        """Context manager exit."""
        self.close()
