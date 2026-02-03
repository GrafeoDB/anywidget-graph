"""ArangoDB database backend."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from anywidget_graph.converters.base import GraphData

if TYPE_CHECKING:
    from arango.database import StandardDatabase


class ArangoConverter:
    """Convert ArangoDB AQL results to graph data."""

    def convert(self, result: Any) -> GraphData:
        """Convert AQL cursor result to nodes and edges.

        Parameters
        ----------
        result : Any
            AQL query cursor/result.

        Returns
        -------
        GraphData
            Dictionary with 'nodes' and 'edges' lists.
        """
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []

        for doc in result:
            if not isinstance(doc, dict):
                continue

            # Check if it's an edge document (_from and _to fields)
            if "_from" in doc and "_to" in doc:
                edge = self._edge_to_dict(doc)
                edges.append(edge)
            # Otherwise treat as vertex document
            elif "_key" in doc or "_id" in doc:
                node = self._vertex_to_dict(doc)
                nodes[node["id"]] = node

        return {"nodes": list(nodes.values()), "edges": edges}

    def _vertex_to_dict(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Convert ArangoDB vertex document to node dict."""
        # Extract ID from _key or _id
        if "_key" in doc:
            node_id = doc["_key"]
        elif "_id" in doc:
            node_id = doc["_id"].split("/")[-1]
        else:
            node_id = str(id(doc))

        result: dict[str, Any] = {
            "id": node_id,
            "label": doc.get("name", doc.get("label", node_id)),
        }

        # Add non-system properties
        for key, value in doc.items():
            if not key.startswith("_") and key not in ("name", "label"):
                result[key] = value

        return result

    def _edge_to_dict(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Convert ArangoDB edge document to edge dict."""
        result: dict[str, Any] = {
            "source": doc["_from"].split("/")[-1],
            "target": doc["_to"].split("/")[-1],
            "label": doc.get("label", doc.get("_key", "")),
        }

        # Add non-system properties
        for key, value in doc.items():
            if not key.startswith("_") and key not in ("label",):
                result[key] = value

        return result


class ArangoBackend:
    """Backend for ArangoDB multi-model database.

    Parameters
    ----------
    db : StandardDatabase | None
        Existing ArangoDB database connection.
    host : str
        ArangoDB host URL (default: "http://localhost:8529").
    username : str
        Username for authentication (default: "root").
    password : str
        Password for authentication (default: "").
    database : str
        Database name (default: "_system").

    Example
    -------
    >>> from anywidget_graph.backends import ArangoBackend
    >>> backend = ArangoBackend(
    ...     host="http://localhost:8529",
    ...     username="root",
    ...     password="password",
    ...     database="mydb",
    ... )
    >>> nodes, edges = backend.execute('''
    ...     FOR v, e IN 1..2 OUTBOUND 'users/alice' GRAPH 'social'
    ...     RETURN {vertex: v, edge: e}
    ... ''')

    Or with an existing connection:

    >>> from arango import ArangoClient
    >>> client = ArangoClient(hosts="http://localhost:8529")
    >>> db = client.db("mydb", username="root", password="password")
    >>> backend = ArangoBackend(db=db)
    """

    def __init__(
        self,
        db: StandardDatabase | None = None,
        host: str = "http://localhost:8529",
        username: str = "root",
        password: str = "",
        database: str = "_system",
    ) -> None:
        self._db = db
        self._host = host
        self._username = username
        self._password = password
        self._database = database
        self._converter = ArangoConverter()

    @property
    def query_language(self) -> str:
        """Return the default query language."""
        return "aql"

    @property
    def db(self) -> StandardDatabase:
        """Get or create the database connection."""
        if self._db is None:
            from arango import ArangoClient

            client = ArangoClient(hosts=self._host)
            self._db = client.db(
                self._database,
                username=self._username,
                password=self._password,
            )
        return self._db

    def execute(self, query: str) -> tuple[list[dict], list[dict]]:
        """Execute AQL query and return (nodes, edges).

        Parameters
        ----------
        query : str
            AQL query to execute.

        Returns
        -------
        tuple[list[dict], list[dict]]
            Tuple of (nodes, edges) lists.
        """
        cursor = self.db.aql.execute(query)
        data = self._converter.convert(cursor)
        return data["nodes"], data["edges"]

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch ArangoDB schema (collections).

        Returns
        -------
        tuple[list[dict], list[dict]]
            Tuple of (node_collections, edge_collections).
        """
        node_types: list[dict[str, Any]] = []
        edge_types: list[dict[str, Any]] = []

        for coll in self.db.collections():
            if coll["system"]:
                continue

            coll_obj = self.db.collection(coll["name"])
            info: dict[str, Any] = {
                "name": coll["name"],
                "count": coll_obj.count(),
            }

            # Edge collections have type 3
            if coll.get("type") == 3 or coll.get("type") == "edge":
                edge_types.append(info)
            else:
                node_types.append(info)

        return node_types, edge_types
