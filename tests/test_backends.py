"""Tests for the Python-side backends: the call the widget makes, and the Neo4j backend with a fake driver."""

from __future__ import annotations

import inspect

import pytest

from anywidget_graph import Graph
from anywidget_graph.backends.arango import ArangoBackend
from anywidget_graph.backends.cosmosdb import CosmosDBBackend
from anywidget_graph.backends.grafeo import GrafeoBackend
from anywidget_graph.backends.ladybug import LadybugBackend
from anywidget_graph.backends.neo4j import Neo4jBackend


class _FakeSession:
    def __init__(self, ran: list[str], answers: dict[str, list]) -> None:
        self._ran = ran
        self._answers = answers

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, query: str) -> list:
        self._ran.append(query)
        return self._answers.get(query, [])


class _FakeDriver:
    def __init__(self, answers: dict[str, list]) -> None:
        self.ran: list[str] = []
        self._answers = answers

    def session(self, database: str | None = None) -> _FakeSession:
        return _FakeSession(self.ran, self._answers)


def _neo4j_with(monkeypatch: pytest.MonkeyPatch, answers: dict[str, list]) -> tuple[Neo4jBackend, _FakeDriver]:
    fake = _FakeDriver(answers)
    monkeypatch.setattr(Neo4jBackend, "driver", property(lambda _self: fake))
    return Neo4jBackend(uri="neo4j://unused"), fake


def test_fetch_schema_quotes_labels_and_types_with_a_backtick(monkeypatch):
    """A label or type holding a backtick stays one identifier, so it cannot end the quoting and change the query."""
    answers = {"CALL db.labels()": [["Odd`Label"]], "CALL db.relationshipTypes()": [["A`) DETACH DELETE (n"]]}
    backend, driver = _neo4j_with(monkeypatch, answers)
    backend.fetch_schema()
    assert "MATCH (n:`Odd``Label`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 20" in driver.ran
    assert "MATCH ()-[r:`A``) DETACH DELETE (n`]->() UNWIND keys(r) AS key RETURN DISTINCT key LIMIT 20" in driver.ran


def test_the_widget_runs_its_query_through_the_neo4j_backend(monkeypatch):
    """The widget passes the query language; a single-language backend takes it and runs the query."""
    backend, driver = _neo4j_with(monkeypatch, {})
    graph = Graph(backend=backend, query="MATCH (n) RETURN n", query_language="cypher")
    graph._execute_backend_query()
    assert graph.query_error == ""
    assert driver.ran == ["MATCH (n) RETURN n"]


@pytest.mark.parametrize("backend", [Neo4jBackend, ArangoBackend, LadybugBackend, CosmosDBBackend, GrafeoBackend])
def test_every_backend_takes_the_language_the_widget_passes(backend):
    language = inspect.signature(backend.execute).parameters.get("language")
    assert language is not None
    assert language.kind is inspect.Parameter.KEYWORD_ONLY
