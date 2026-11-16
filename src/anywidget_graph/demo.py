"""Demo module for anywidget-graph.

Shows grafeo's Silicon Valley demo dataset: 64 people, companies, products, technologies, AI, places, cities and
events from the HBO series, and the 149 relationships between them. The graph renders without any backend; the
toolbar's query runs in the browser on Grafeo WASM, which loads the same dataset from the jsDelivr CDN.

Usage:
    uv add "anywidget-graph[demo]"

    from anywidget_graph.demo import demo_graph
    graph = demo_graph()
"""

from __future__ import annotations

import json
from typing import Any

from anywidget_graph.widget import Graph

# The toolbar's starting query: every node and every relationship (a node without one too), the graph drawn at first
DEMO_QUERY = "MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m"


def _silicon_valley() -> Any:
    try:
        from grafeo_datasets import silicon_valley
    except ImportError:
        raise ImportError('The demo needs the demo extra: uv add "anywidget-graph[demo]"') from None
    return silicon_valley


def demo_nodes() -> list[dict[str, Any]]:
    """The demo's nodes: one per node of the Silicon Valley dataset, shaped as a Grafeo query returns them.

    Each node has the dataset's ``key`` as ``id``, its ``name`` as ``label``, its node label (``Person``,
    ``Company``, ...) in ``labels``, and ``key``, ``name``, ``description`` and the node's other properties.
    """
    return [
        {
            "id": node["key"],
            "label": node["name"],
            "labels": [node["label"]],
            "key": node["key"],
            "name": node["name"],
            "description": node["description"],
            **node["props"],
        }
        for node in _silicon_valley().nodes()
    ]


def demo_edges() -> list[dict[str, Any]]:
    """The demo's edges: one per relationship of the Silicon Valley dataset, between node keys.

    Each edge has ``source`` and ``target`` (node keys), its type (``KNOWS``, ``WORKS_AT``, ...) as ``label``,
    and the relationship's properties.
    """
    return [
        {"source": edge["source"], "target": edge["target"], "label": edge["type"], **edge["props"]}
        for edge in _silicon_valley().edges()
    ]


def demo_graph(**kwargs: Any) -> Graph:
    """Create a demo Graph widget on grafeo's Silicon Valley demo dataset.

    The 64 nodes are coloured by node label and the 149 edges carry their relationship types. The graph is drawn
    from Python at once; Run sends the toolbar's GQL query to Grafeo WASM in the browser, which loads
    ``@grafeo-db/wasm`` and ``@grafeo-db/datasets`` from the jsDelivr CDN, so other queries on the same data work.

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
    defaults: dict[str, Any] = {
        "nodes": demo_nodes(),
        "edges": demo_edges(),
        "width": kwargs.pop("width", 900),
        "height": kwargs.pop("height", 600),
        "dark_mode": kwargs.pop("dark_mode", None),
        "database_backend": "grafeo",
        "grafeo_connection_mode": "wasm",
        "query": DEMO_QUERY,
        "query_language": "gql",
        "tooltip_fields": ["label", "labels", "description"],
    }
    defaults.update(kwargs)

    graph = Graph(**defaults)
    graph._demo_mode = True
    # Statements the browser runs after loading the dataset: none, the dataset is the demo
    graph._demo_data = json.dumps([])
    return graph
