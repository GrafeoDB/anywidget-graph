"""Marimo demo for anywidget-graph."""

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
    # Create a simple graph from a dictionary
    graph = Graph.from_dict(
        {
            "nodes": [
                {"id": "alice", "label": "Alice", "color": "#4CAF50"},
                {"id": "bob", "label": "Bob", "color": "#2196F3"},
                {"id": "carol", "label": "Carol", "color": "#FF9800"},
                {"id": "paper", "label": "Graph Theory", "color": "#9C27B0"},
            ],
            "edges": [
                {"source": "alice", "target": "bob", "label": "knows"},
                {"source": "alice", "target": "carol", "label": "knows"},
                {"source": "bob", "target": "carol", "label": "knows"},
                {"source": "alice", "target": "paper", "label": "authored"},
                {"source": "bob", "target": "paper", "label": "reviewed"},
            ],
        },
        width=800,
        height=500,
    )

    graph
    return (graph,)


@app.cell
def _(graph, mo):
    # Display selected node info
    mo.md(f"**Selected node:** {graph.selected_node}")
    return ()


if __name__ == "__main__":
    app.run()
