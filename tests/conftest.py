"""Shared fixtures for the anywidget-graph test suite."""

from __future__ import annotations

import shutil
import subprocess

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
        pytest.skip("Node.js is not installed (CI installs it; locally install Node 22.18+ to run the JS checks)")
    # The front end and its tests are TypeScript, which Node runs without a loader from 22.18 (and 23.6) on
    version = subprocess.run([path, "--version"], capture_output=True, text=True, check=False).stdout.strip()
    major, minor = (int(part) for part in version.lstrip("v").split(".")[:2])
    if (major, minor) < (22, 18) or (major == 23 and minor < 6):
        pytest.skip(f"Node.js {version} cannot run TypeScript directly: the JS checks need Node 22.18+")
    return path
