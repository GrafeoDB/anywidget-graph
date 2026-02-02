# anywidget-graph

Interactive graph visualization for Python notebooks.

Works with Marimo, Jupyter, VS Code, Colab, anywhere [anywidget](https://anywidget.dev/) runs.

## Features

- **Universal** — One widget, every notebook environment
- **Backend-agnostic** — Grafeo, Neo4j, NetworkX, pandas, or raw dicts
- **Interactive** — Pan, zoom, click, expand neighbors, select paths
- **Customizable** — Colors, sizes, shapes, layouts
- **Performant** — Virtualized rendering for large graphs
- **Exportable** — PNG, SVG, JSON

## Installation

```bash
uv add anywidget-graph
```

## Quick Start

```python
from anywidget_graph import Graph

graph = Graph.from_dict({
    "nodes": [
        {"id": "alice", "label": "Alice", "group": "person"},
        {"id": "bob", "label": "Bob", "group": "person"},
        {"id": "paper", "label": "Graph Theory", "group": "document"},
    ],
    "edges": [
        {"source": "alice", "target": "bob", "label": "knows"},
        {"source": "alice", "target": "paper", "label": "authored"},
    ]
})

graph
```

## Data Sources

### Dictionary

```python
from anywidget_graph import Graph

graph = Graph.from_dict({
    "nodes": [{"id": "a"}, {"id": "b"}],
    "edges": [{"source": "a", "target": "b"}]
})
```

### Grafeo

```python
from grafeo import GrafeoDB
from anywidget_graph import Graph

db = GrafeoDB()
db.execute("INSERT (:Person {name: 'Alice'})-[:KNOWS]->(:Person {name: 'Bob'})")

result = db.execute("MATCH (a)-[r]->(b) RETURN a, r, b")
graph = Graph.from_grafeo(result)
```

### Neo4j

```python
from neo4j import GraphDatabase
from anywidget_graph import Graph

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))

with driver.session() as session:
    result = session.run("MATCH (a)-[r]->(b) RETURN a, r, b LIMIT 100")
    graph = Graph.from_neo4j(result)
```

### NetworkX

```python
import networkx as nx
from anywidget_graph import Graph

G = nx.karate_club_graph()
graph = Graph.from_networkx(G)
```

### pandas

```python
import pandas as pd
from anywidget_graph import Graph

edges = pd.DataFrame({
    "source": ["alice", "alice", "bob"],
    "target": ["bob", "carol", "carol"],
    "weight": [1.0, 0.5, 0.8]
})

graph = Graph.from_pandas(edges)
```

## Interactivity

### Events

```python
graph = Graph.from_dict(data)

@graph.on_node_click
def handle_node(node_id, node_data):
    print(f"Clicked: {node_id}")

@graph.on_edge_click  
def handle_edge(edge_id, edge_data):
    print(f"Edge: {edge_data['label']}")
```

### Selection

```python
graph.selected_nodes         # Get current selection
graph.select(["alice"])      # Select nodes
graph.clear_selection()      # Clear
```

### Expansion

```python
graph.expand("alice")        # Show neighbors
graph.collapse("alice")      # Hide neighbors
```

## Styling

### By Group

```python
graph = Graph.from_dict(
    data,
    node_styles={
        "person": {"color": "#4CAF50", "size": 30},
        "document": {"color": "#2196F3", "shape": "square"},
    }
)
```

### By Property

```python
graph = Graph.from_dict(
    data,
    node_color="group",                    # Color by field
    node_size=lambda n: n["score"] * 10,   # Size by function
    edge_width="weight",                   # Width by field
)
```

### Layouts

```python
Graph.from_dict(data, layout="force")        # Default
Graph.from_dict(data, layout="hierarchical")
Graph.from_dict(data, layout="circular")
Graph.from_dict(data, layout="grid")
```

## Options

```python
graph = Graph.from_dict(
    data,
    width=800,
    height=600,
    directed=True,
    labels=True,
    edge_labels=False,
    physics=True,
    zoom=(0.1, 4),
)
```

## Large Graphs

For 1000+ nodes:

```python
graph = Graph.from_dict(
    data,
    virtualize=True,
    cluster=True,
)
```

## Export

```python
graph.to_png("graph.png")
graph.to_svg("graph.svg")
graph.to_json("graph.json")
```

## Environment Support

| Environment | Supported |
|-------------|-----------|
| Marimo | ✅ |
| JupyterLab | ✅ |
| Jupyter Notebook | ✅ |
| VS Code | ✅ |
| Google Colab | ✅ |
| Databricks | ✅ |

## Related

- [anywidget](https://anywidget.dev/) — Custom Jupyter widgets made easy
- [Grafeo](https://github.com/GrafeoDB/grafeo) — Embeddable graph database
- [grafeo-web](https://github.com/GrafeoDB/grafeo-web) — Grafeo in the browser

## License

Apache-2.0
