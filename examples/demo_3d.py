"""Marimo demo: the 3D view of anywidget-graph (Graph3D): the graph laid out and rendered in three dimensions."""

import marimo

__generated_with = "0.19.5"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell
def _():
    from anywidget_graph import Graph3D

    return (Graph3D,)


@app.cell
def _(Graph3D):
    # A citation network of scientific papers: topics are the colour-coded cluster hubs,
    # papers cite older papers, venues host them. No author roster: the papers are the actors.
    topics = {
        "Graph Databases": "#6366f1",
        "Query Languages": "#f59e0b",
        "Vector Search": "#10b981",
        "Embeddings": "#ef4444",
        "Visualization": "#8b5cf6",
        "WASM Engines": "#06b6d4",
        "Benchmarking": "#f97316",
        "LLM & Agents": "#ec4899",
    }
    venues = ["SIGMOD", "VLDB", "ICDE", "KDD", "WWW", "CHI"]
    # (title, year, citations, topic, venue)
    papers = [
        ("Grafeo: an embeddable graph database", 2024, 41, "Graph Databases", "SIGMOD"),
        ("Incremental graph algorithms", 2019, 112, "Graph Databases", "KDD"),
        ("Schema inference for property graphs", 2022, 44, "Graph Databases", "ICDE"),
        ("Property graph models compared", 2021, 67, "Graph Databases", "VLDB"),
        ("Graph compression for embedded engines", 2023, 38, "Graph Databases", "ICDE"),
        ("Concurrent transactions on property graphs", 2020, 55, "Graph Databases", "SIGMOD"),
        ("GQL query planning at scale", 2023, 63, "Query Languages", "VLDB"),
        ("Cypher vs GQL: a benchmark", 2021, 54, "Query Languages", "ICDE"),
        ("Path queries on property graphs", 2020, 71, "Query Languages", "SIGMOD"),
        ("Streaming graph queries", 2021, 58, "Query Languages", "VLDB"),
        ("Text-to-query with LLMs", 2024, 140, "Query Languages", "WWW"),
        ("Regular path queries in GQL", 2022, 47, "Query Languages", "ICDE"),
        ("Vector indexes in embedded engines", 2024, 37, "Vector Search", "ICDE"),
        ("Hybrid vector-graph retrieval", 2024, 96, "Vector Search", "KDD"),
        ("Approximate nearest neighbours in WASM", 2023, 33, "Vector Search", "WWW"),
        ("HNSW on small machines", 2022, 61, "Vector Search", "VLDB"),
        ("Vector search meets property graphs", 2023, 72, "Vector Search", "SIGMOD"),
        ("Embeddings meet graph traversal", 2023, 81, "Embeddings", "KDD"),
        ("Graph-aware text embeddings", 2022, 49, "Embeddings", "WWW"),
        ("Embedding spaces for entities", 2021, 66, "Embeddings", "VLDB"),
        ("Retrieval-augmented graph queries", 2024, 118, "Embeddings", "WWW"),
        ("Contrastive learning on graphs", 2020, 59, "Embeddings", "KDD"),
        ("Exploring property graphs in the browser", 2023, 29, "Visualization", "CHI"),
        ("Visual analytics of large graphs", 2020, 67, "Visualization", "CHI"),
        ("Force-directed layouts in 3D", 2023, 25, "Visualization", "CHI"),
        ("Panorama: graph overviews at scale", 2022, 36, "Visualization", "CHI"),
        ("Lens-based graph exploration", 2021, 31, "Visualization", "CHI"),
        ("WASM for graph workloads", 2022, 88, "WASM Engines", "VLDB"),
        ("Sandboxed query engines", 2021, 43, "WASM Engines", "ICDE"),
        ("WASM in the browser database", 2023, 52, "WASM Engines", "WWW"),
        ("Compiling GQL to WASM", 2024, 28, "WASM Engines", "ICDE"),
        ("Memory limits for embedded engines", 2020, 39, "WASM Engines", "VLDB"),
        ("Benchmarking graph databases: a survey", 2019, 130, "Benchmarking", "VLDB"),
        ("OLTP benchmarks for property graphs", 2021, 48, "Benchmarking", "SIGMOD"),
        ("Reproducible graph benchmarks", 2022, 35, "Benchmarking", "ICDE"),
        ("LDBC-style workloads in embedded DBs", 2023, 26, "Benchmarking", "VLDB"),
        ("LLMs as query writers", 2024, 152, "LLM & Agents", "WWW"),
        ("Agents over knowledge graphs", 2024, 95, "LLM & Agents", "KDD"),
        ("Tool use with graph backends", 2023, 44, "LLM & Agents", "WWW"),
        ("Evaluating text-to-GQL", 2024, 77, "LLM & Agents", "ICDE"),
        ("Graph RAG pipelines", 2024, 108, "LLM & Agents", "KDD"),
    ]

    def topic_id(t):
        return "t_" + t.lower().replace(" ", "_").replace("&", "and")

    nodes = [{"id": topic_id(t), "labels": ["Topic"], "name": t, "color": c} for t, c in topics.items()]
    nodes += [{"id": "v_" + v.lower(), "labels": ["Venue"], "name": v, "color": "#94a3b8"} for v in venues]
    for i, (title, year, cits, topic, _venue) in enumerate(papers):
        nodes.append(
            {
                "id": f"w{i}",
                "labels": ["Paper"],
                "name": title,
                "year": year,
                "citations": cits,
                "color": topics[topic],  # a paper takes its topic's colour: clusters read at a glance
            }
        )

    edges = []
    for i, (_title, _year, _cits, topic, venue) in enumerate(papers):
        edges.append({"source": f"w{i}", "target": "v_" + venue.lower(), "label": "PUBLISHED_IN"})
        edges.append({"source": f"w{i}", "target": topic_id(topic), "label": "ABOUT"})
    # Citations: within each topic every paper cites the 1-2 older papers of that topic,
    # and highly-cited papers also cite the benchmarking survey, a dense, layered network
    by_topic = {}
    for i, (_t, _y, _c, topic, _v) in enumerate(papers):
        by_topic.setdefault(topic, []).append(i)
    survey = next(i for i, p in enumerate(papers) if "survey" in p[0].lower())
    for _topic, ids in by_topic.items():
        ids.sort(key=lambda i: papers[i][1])
        for pos, i in enumerate(ids):
            for back in (1, 2):
                if pos - back >= 0:
                    edges.append({"source": f"w{i}", "target": f"w{ids[pos - back]}", "label": "CITES"})
            if papers[i][2] >= 80 and i != survey:
                edges.append({"source": f"w{i}", "target": f"w{survey}", "label": "CITES"})

    graph = Graph3D(
        nodes=nodes,
        edges=edges,
        width=800,
        height=600,
        size_field="citations",  # highly-cited hub papers are the big nodes
        force3d_repulsion=1.2,  # bloom: how strongly nodes push apart in 3D
        force3d_link_distance=None,  # spread: automatic from the node count
        edge_arrows=True,
    )
    # Drag to orbit, right-drag to pan, wheel to zoom; the toolbar's cube button switches back to 2D

    graph  # noqa: B018
    return (graph,)


@app.cell
def _(graph, mo):
    # Display selected node info
    mo.md(f"**Selected node:** {graph.selected_node}")
    return ()


if __name__ == "__main__":
    app.run()
