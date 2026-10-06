"""Shared fixtures for the anywidget-graph test suite."""

from __future__ import annotations

import shutil

import pytest

# A small social graph: Alix -KNOWS-> Gus -KNOWS-> Vincent.
# Alix carries properties named `id` and `source` on purpose: they must
# never replace the identity the widget derives from the engine.
SEED_QUERY = (
    "INSERT (:Person {name: 'Alix', age: 30, id: 'p1'})"
    "-[:KNOWS {since: 2020, source: 'school'}]->(:Person {name: 'Gus'})"
    "-[:KNOWS]->(:Person {name: 'Vincent'})"
)


@pytest.fixture
def grafeo_db():
    """An in-memory Grafeo database seeded with SEED_QUERY."""
    import grafeo

    db = grafeo.GrafeoDB()
    db.execute(SEED_QUERY)
    return db


@pytest.fixture
def ids(grafeo_db) -> dict[str, str]:
    """Widget node ids (stringified engine ids) by person name."""
    rows = grafeo_db.execute("MATCH (n:Person) RETURN n.name AS name, id(n) AS id")
    return {row["name"]: str(row["id"]) for row in rows}


@pytest.fixture(scope="session")
def node_bin() -> str:
    """Path to the Node.js binary used to check the JavaScript side."""
    path = shutil.which("node")
    if path is None:
        pytest.skip("Node.js is not installed (CI installs it; locally install Node 18+ to run the JS checks)")
    return path
