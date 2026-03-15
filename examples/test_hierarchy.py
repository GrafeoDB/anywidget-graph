"""Marimo demo: hierarchical repo-like graph to test force layout with hub-spoke data."""

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
    # Simulate a repository structure:
    # 1 Repository -> 4 Directories -> Files -> TypeDefinitions
    nodes = [
        {"id": "repo", "labels": ["Repository"], "name": "my-app"},
    ]
    edges = []

    dirs = ["src", "lib", "tests", "config"]
    file_id = 0
    type_id = 0

    for d in dirs:
        did = f"dir_{d}"
        nodes.append({"id": did, "labels": ["Directory"], "name": d})
        edges.append({"source": "repo", "target": did, "label": "CONTAINS", "type": "CONTAINS"})

        # Each directory has 3-8 files
        import random

        random.seed(hash(d))
        n_files = random.randint(3, 8)
        for i in range(n_files):
            fid = f"file_{file_id}"
            fname = f"{d}/file_{i}.py"
            nodes.append({"id": fid, "labels": ["File"], "name": fname})
            edges.append({"source": did, "target": fid, "label": "CONTAINS", "type": "CONTAINS"})
            file_id += 1

            # Each file has 1-5 type definitions
            n_types = random.randint(1, 5)
            for _j in range(n_types):
                tid = f"type_{type_id}"
                tname = f"Class_{type_id}"
                nodes.append({"id": tid, "labels": ["TypeDefinition"], "name": tname})
                edges.append({"source": fid, "target": tid, "label": "DEFINES", "type": "DEFINES"})
                type_id += 1

                # Some types depend on other types (cross-file references)
                if type_id > 3 and random.random() < 0.3:
                    dep = f"type_{random.randint(0, type_id - 2)}"
                    edges.append({"source": tid, "target": dep, "label": "DEPENDS_ON", "type": "DEPENDS_ON"})

        # Some cross-directory imports
        if d != "src":
            edges.append(
                {
                    "source": did,
                    "target": "dir_src",
                    "label": "IMPORTS_FROM",
                    "type": "IMPORTS_FROM",
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

Hierarchical repo graph: Repository -> Directories -> Files -> TypeDefinitions
""")
    return ()


if __name__ == "__main__":
    app.run()
