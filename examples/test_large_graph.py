"""Marimo demo: large graph to test filtering, search, and LOD."""

import marimo

__generated_with = "0.19.5"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _():
    from anywidget_graph import Graph

    return (Graph,)


@app.cell
def _(Graph):
    import random

    random.seed(42)

    node_types = {
        "Person": 40,
        "Company": 15,
        "Product": 25,
        "City": 10,
        "Skill": 20,
    }

    edge_types = ["WORKS_AT", "LIVES_IN", "KNOWS", "MANAGES", "USES", "SELLS", "HAS_SKILL"]

    nodes = []
    node_ids = []
    for label, count in node_types.items():
        for i in range(count):
            nid = f"{label.lower()}_{i}"
            node_ids.append(nid)
            nodes.append(
                {
                    "id": nid,
                    "labels": [label],
                    "name": f"{label} {i}",
                }
            )

    edges = []
    for _ in range(250):
        src = random.choice(node_ids)
        tgt = random.choice(node_ids)
        if src != tgt:
            edges.append(
                {
                    "source": src,
                    "target": tgt,
                    "label": random.choice(edge_types),
                    "type": random.choice(edge_types),
                }
            )

    graph = Graph.from_dict(
        {"nodes": nodes, "edges": edges},
        width=1000,
        height=700,
    )

    graph  # noqa: B018
    return (graph,)


@app.cell
def _(graph, mo):
    mo.md(f"""
**Selected node:** {graph.selected_node}

Try:
- Open the Filter panel (sidebar button) to toggle node/edge types
- Use the search bar to filter (e.g. type "Person" or "Company")
- Zoom in/out to see label LOD
""")
    return ()


if __name__ == "__main__":
    app.run()
