"""Azure CosmosDB database backend (Gremlin API)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass


class CosmosDBBackend:
    """Backend for Azure CosmosDB with Gremlin API.

    Parameters
    ----------
    endpoint : str
        CosmosDB Gremlin endpoint (e.g., "wss://myaccount.gremlin.cosmos.azure.com:443/").
    database : str
        Database name.
    container : str
        Container/graph name.
    primary_key : str
        CosmosDB primary key for authentication.
    """

    def __init__(
        self,
        endpoint: str = "",
        database: str = "",
        container: str = "",
        primary_key: str = "",
    ) -> None:
        self._endpoint = endpoint
        self._database = database
        self._container = container
        self._primary_key = primary_key
        self._client: Any = None

    @property
    def query_language(self) -> str:
        return "gremlin"

    @property
    def client(self) -> Any:
        if self._client is None:
            from gremlin_python.driver import client, serializer

            self._client = client.Client(
                self._endpoint,
                "g",
                username=f"/dbs/{self._database}/colls/{self._container}",
                password=self._primary_key,
                message_serializer=serializer.GraphSONSerializersV2d0(),
            )
        return self._client

    def execute(self, query: str, *, language: str = "gremlin") -> tuple[list[dict], list[dict]]:
        """Execute a Gremlin query and return (nodes, edges)."""
        from anywidget_graph.converters.gremlin import GremlinConverter

        result = self.client.submit(query).all().result()
        data = GremlinConverter().convert(result)
        return data["nodes"], data["edges"]

    def fetch_schema(self) -> tuple[list[dict], list[dict]]:
        """Fetch schema from CosmosDB."""
        node_types: list[dict] = []
        edge_types: list[dict] = []
        try:
            labels = self.client.submit("g.V().label().dedup()").all().result()
            for label in labels:
                node_types.append({"label": label, "properties": []})
            edge_labels = self.client.submit("g.E().label().dedup()").all().result()
            for label in edge_labels:
                edge_types.append({"type": label, "properties": []})
        except Exception:
            pass
        return node_types, edge_types

    def close(self) -> None:
        """Close the Gremlin client connection."""
        if self._client:
            self._client.close()
            self._client = None
