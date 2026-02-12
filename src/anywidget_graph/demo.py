"""Demo module for anywidget-graph.

Creates a pre-populated graph widget using Grafeo WASM mode.
The demo data is inserted into the browser-side WASM database
and a query is auto-executed, so the widget renders immediately
without any backend setup.

Usage:
    uv add "anywidget-graph[demo]"

    from anywidget_graph.demo import demo_graph
    graph = demo_graph()
"""

from __future__ import annotations

import json

from anywidget_graph.widget import Graph

# Classic movie/actor graph dataset — small enough to load instantly,
# rich enough to demonstrate labels, relationships, and properties.
DEMO_NODES = [
    {"id": "m1", "label": "The Matrix", "labels": ["Movie"], "year": 1999, "color": "#6366f1"},
    {"id": "m2", "label": "The Matrix Reloaded", "labels": ["Movie"], "year": 2003, "color": "#6366f1"},
    {"id": "m3", "label": "John Wick", "labels": ["Movie"], "year": 2014, "color": "#6366f1"},
    {"id": "m4", "label": "Speed", "labels": ["Movie"], "year": 1994, "color": "#6366f1"},
    {"id": "m5", "label": "Point Break", "labels": ["Movie"], "year": 1991, "color": "#6366f1"},
    {"id": "p1", "label": "Keanu Reeves", "labels": ["Person"], "born": 1964, "color": "#f59e0b"},
    {"id": "p2", "label": "Laurence Fishburne", "labels": ["Person"], "born": 1961, "color": "#f59e0b"},
    {"id": "p3", "label": "Carrie-Anne Moss", "labels": ["Person"], "born": 1967, "color": "#f59e0b"},
    {"id": "p4", "label": "Hugo Weaving", "labels": ["Person"], "born": 1960, "color": "#f59e0b"},
    {"id": "p5", "label": "Sandra Bullock", "labels": ["Person"], "born": 1964, "color": "#f59e0b"},
    {"id": "p6", "label": "Lana Wachowski", "labels": ["Person", "Director"], "born": 1965, "color": "#10b981"},
    {"id": "p7", "label": "Lilly Wachowski", "labels": ["Person", "Director"], "born": 1967, "color": "#10b981"},
    {"id": "p8", "label": "Chad Stahelski", "labels": ["Person", "Director"], "born": 1968, "color": "#10b981"},
]

DEMO_EDGES = [
    {"source": "p1", "target": "m1", "label": "ACTED_IN"},
    {"source": "p2", "target": "m1", "label": "ACTED_IN"},
    {"source": "p3", "target": "m1", "label": "ACTED_IN"},
    {"source": "p4", "target": "m1", "label": "ACTED_IN"},
    {"source": "p1", "target": "m2", "label": "ACTED_IN"},
    {"source": "p2", "target": "m2", "label": "ACTED_IN"},
    {"source": "p3", "target": "m2", "label": "ACTED_IN"},
    {"source": "p4", "target": "m2", "label": "ACTED_IN"},
    {"source": "p1", "target": "m3", "label": "ACTED_IN"},
    {"source": "p1", "target": "m4", "label": "ACTED_IN"},
    {"source": "p5", "target": "m4", "label": "ACTED_IN"},
    {"source": "p1", "target": "m5", "label": "ACTED_IN"},
    {"source": "p6", "target": "m1", "label": "DIRECTED"},
    {"source": "p7", "target": "m1", "label": "DIRECTED"},
    {"source": "p6", "target": "m2", "label": "DIRECTED"},
    {"source": "p7", "target": "m2", "label": "DIRECTED"},
    {"source": "p8", "target": "m3", "label": "DIRECTED"},
]

# GQL statements to populate the WASM database
DEMO_INSERT_STATEMENTS = """
CREATE (:Movie {id: 'm1', name: 'The Matrix', year: 1999});
CREATE (:Movie {id: 'm2', name: 'The Matrix Reloaded', year: 2003});
CREATE (:Movie {id: 'm3', name: 'John Wick', year: 2014});
CREATE (:Movie {id: 'm4', name: 'Speed', year: 1994});
CREATE (:Movie {id: 'm5', name: 'Point Break', year: 1991});
CREATE (:Person {id: 'p1', name: 'Keanu Reeves', born: 1964});
CREATE (:Person {id: 'p2', name: 'Laurence Fishburne', born: 1961});
CREATE (:Person {id: 'p3', name: 'Carrie-Anne Moss', born: 1967});
CREATE (:Person {id: 'p4', name: 'Hugo Weaving', born: 1960});
CREATE (:Person {id: 'p5', name: 'Sandra Bullock', born: 1964});
CREATE (:Person:Director {id: 'p6', name: 'Lana Wachowski', born: 1965});
CREATE (:Person:Director {id: 'p7', name: 'Lilly Wachowski', born: 1967});
CREATE (:Person:Director {id: 'p8', name: 'Chad Stahelski', born: 1968});
MATCH (p:Person {id: 'p1'}), (m:Movie {id: 'm1'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p2'}), (m:Movie {id: 'm1'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p3'}), (m:Movie {id: 'm1'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p4'}), (m:Movie {id: 'm1'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p1'}), (m:Movie {id: 'm2'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p2'}), (m:Movie {id: 'm2'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p3'}), (m:Movie {id: 'm2'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p4'}), (m:Movie {id: 'm2'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p1'}), (m:Movie {id: 'm3'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p1'}), (m:Movie {id: 'm4'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p5'}), (m:Movie {id: 'm4'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p1'}), (m:Movie {id: 'm5'}) CREATE (p)-[:ACTED_IN]->(m);
MATCH (p:Person {id: 'p6'}), (m:Movie {id: 'm1'}) CREATE (p)-[:DIRECTED]->(m);
MATCH (p:Person {id: 'p7'}), (m:Movie {id: 'm1'}) CREATE (p)-[:DIRECTED]->(m);
MATCH (p:Person {id: 'p6'}), (m:Movie {id: 'm2'}) CREATE (p)-[:DIRECTED]->(m);
MATCH (p:Person {id: 'p7'}), (m:Movie {id: 'm2'}) CREATE (p)-[:DIRECTED]->(m);
MATCH (p:Person {id: 'p8'}), (m:Movie {id: 'm3'}) CREATE (p)-[:DIRECTED]->(m);
""".strip()

DEMO_QUERY = "MATCH (n)-[r]->(m) RETURN n, r, m"


def demo_graph(**kwargs) -> Graph:
    """Create a demo Graph widget with pre-populated movie/actor data.

    The widget starts with data loaded instantly (no backend needed).
    The WASM backend is configured so you can run additional queries
    from the UI. The demo GQL statements are available in the WASM
    database for interactive exploration.

    Parameters
    ----------
    **kwargs
        Additional keyword arguments passed to Graph constructor.
        Overrides demo defaults.

    Returns
    -------
    Graph
        A ready-to-use Graph widget with demo data rendered.

    Example
    -------
    >>> from anywidget_graph.demo import demo_graph
    >>> graph = demo_graph()
    >>> graph  # renders in notebook
    """
    defaults = {
        "nodes": DEMO_NODES,
        "edges": DEMO_EDGES,
        "width": kwargs.pop("width", 900),
        "height": kwargs.pop("height", 600),
        "dark_mode": kwargs.pop("dark_mode", True),
        "database_backend": "grafeo",
        "query": DEMO_QUERY,
        "query_language": "gql",
    }
    defaults.update(kwargs)

    graph = Graph(**defaults)
    graph._demo_mode = True
    graph._demo_data = json.dumps(DEMO_INSERT_STATEMENTS.split("\n"))
    graph.grafeo_connection_mode = "wasm"

    return graph
