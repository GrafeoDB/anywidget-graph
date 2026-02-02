"""Main Graph widget using anywidget and Sigma.js."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import anywidget
import traitlets

if TYPE_CHECKING:
    from collections.abc import Callable

_ESM = """
import Graph from "https://esm.sh/graphology@0.25.4";
import Sigma from "https://esm.sh/sigma@3.0.0";

function render({ model, el }) {
  const container = document.createElement("div");
  container.style.width = model.get("width") + "px";
  container.style.height = model.get("height") + "px";
  container.style.border = "1px solid #ddd";
  container.style.borderRadius = "4px";
  container.style.background = model.get("background") || "#fafafa";
  el.appendChild(container);

  const graph = new Graph();

  const nodes = model.get("nodes") || [];
  nodes.forEach((node) => {
    graph.addNode(node.id, {
      label: node.label || node.id,
      x: node.x ?? Math.random() * 100,
      y: node.y ?? Math.random() * 100,
      size: node.size || 10,
      color: node.color || "#6366f1",
    });
  });

  const edges = model.get("edges") || [];
  edges.forEach((edge, i) => {
    graph.addEdge(edge.source, edge.target, {
      label: edge.label || "",
      size: edge.size || 2,
      color: edge.color || "#94a3b8",
    });
  });

  const renderer = new Sigma(graph, container, {
    renderLabels: model.get("show_labels"),
    renderEdgeLabels: model.get("show_edge_labels"),
    defaultNodeColor: "#6366f1",
    defaultEdgeColor: "#94a3b8",
    labelColor: { color: "#333" },
    labelSize: 12,
    labelWeight: "500",
  });

  renderer.on("clickNode", ({ node }) => {
    const nodeData = graph.getNodeAttributes(node);
    model.set("selected_node", { id: node, ...nodeData });
    model.save_changes();
  });

  renderer.on("clickEdge", ({ edge }) => {
    const edgeData = graph.getEdgeAttributes(edge);
    const [source, target] = graph.extremities(edge);
    model.set("selected_edge", { source, target, ...edgeData });
    model.save_changes();
  });

  renderer.on("clickStage", () => {
    model.set("selected_node", null);
    model.set("selected_edge", null);
    model.save_changes();
  });

  model.on("change:nodes", () => {
    graph.clear();
    const newNodes = model.get("nodes") || [];
    newNodes.forEach((node) => {
      graph.addNode(node.id, {
        label: node.label || node.id,
        x: node.x ?? Math.random() * 100,
        y: node.y ?? Math.random() * 100,
        size: node.size || 10,
        color: node.color || "#6366f1",
      });
    });
    const newEdges = model.get("edges") || [];
    newEdges.forEach((edge) => {
      graph.addEdge(edge.source, edge.target, {
        label: edge.label || "",
        size: edge.size || 2,
        color: edge.color || "#94a3b8",
      });
    });
    renderer.refresh();
  });

  model.on("change:edges", () => {
    graph.clearEdges();
    const newEdges = model.get("edges") || [];
    newEdges.forEach((edge) => {
      graph.addEdge(edge.source, edge.target, {
        label: edge.label || "",
        size: edge.size || 2,
        color: edge.color || "#94a3b8",
      });
    });
    renderer.refresh();
  });

  return () => {
    renderer.kill();
  };
}

export default { render };
"""

_CSS = """
.anywidget-graph {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
"""


class Graph(anywidget.AnyWidget):
    """Interactive graph visualization widget using Sigma.js."""

    _esm = _ESM
    _css = _CSS

    nodes = traitlets.List(trait=traitlets.Dict()).tag(sync=True)
    edges = traitlets.List(trait=traitlets.Dict()).tag(sync=True)

    width = traitlets.Int(default_value=800).tag(sync=True)
    height = traitlets.Int(default_value=600).tag(sync=True)
    background = traitlets.Unicode(default_value="#fafafa").tag(sync=True)
    show_labels = traitlets.Bool(default_value=True).tag(sync=True)
    show_edge_labels = traitlets.Bool(default_value=False).tag(sync=True)

    selected_node = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)
    selected_edge = traitlets.Dict(allow_none=True, default_value=None).tag(sync=True)

    def __init__(
        self,
        nodes: list[dict[str, Any]] | None = None,
        edges: list[dict[str, Any]] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(nodes=nodes or [], edges=edges or [], **kwargs)
        self._node_click_callbacks: list[Callable] = []
        self._edge_click_callbacks: list[Callable] = []

    @classmethod
    def from_dict(cls, data: dict[str, Any], **kwargs: Any) -> Graph:
        """Create a Graph from a dictionary with nodes and edges keys."""
        return cls(nodes=data.get("nodes", []), edges=data.get("edges", []), **kwargs)

    @classmethod
    def from_cypher(cls, result: Any, **kwargs: Any) -> Graph:
        """Create a Graph from Cypher query results."""
        nodes: dict[str, dict] = {}
        edges: list[dict] = []

        records = list(result) if hasattr(result, "__iter__") else [result]

        for record in records:
            if hasattr(record, "items"):
                items = record.items() if callable(record.items) else record.items
            elif hasattr(record, "data"):
                items = record.data().items()
            else:
                items = record.items() if isinstance(record, dict) else []

            for key, value in items:
                if _is_node(value):
                    node_id = _get_node_id(value)
                    if node_id not in nodes:
                        nodes[node_id] = _node_to_dict(value)
                elif _is_relationship(value):
                    edges.append(_relationship_to_dict(value))

        return cls(nodes=list(nodes.values()), edges=edges, **kwargs)

    def on_node_click(self, callback: Callable[[str, dict], None]) -> Callable:
        """Register a callback for node click events."""
        self._node_click_callbacks.append(callback)

        def observer(change: dict) -> None:
            if change["new"] is not None:
                node_data = change["new"].copy()
                node_id = node_data.pop("id", None)
                for cb in self._node_click_callbacks:
                    cb(node_id, node_data)

        self.observe(observer, names=["selected_node"])
        return callback

    def on_edge_click(self, callback: Callable[[dict], None]) -> Callable:
        """Register a callback for edge click events."""
        self._edge_click_callbacks.append(callback)

        def observer(change: dict) -> None:
            if change["new"] is not None:
                for cb in self._edge_click_callbacks:
                    cb(change["new"])

        self.observe(observer, names=["selected_edge"])
        return callback


def _is_node(obj: Any) -> bool:
    if hasattr(obj, "labels") and hasattr(obj, "element_id"):
        return True
    if hasattr(obj, "labels") and hasattr(obj, "properties"):
        return True
    if isinstance(obj, dict) and "id" in obj:
        return True
    return False


def _is_relationship(obj: Any) -> bool:
    if hasattr(obj, "type") and hasattr(obj, "start_node"):
        return True
    if hasattr(obj, "type") and hasattr(obj, "source") and hasattr(obj, "target"):
        return True
    if isinstance(obj, dict) and "source" in obj and "target" in obj:
        return True
    return False


def _get_node_id(node: Any) -> str:
    if hasattr(node, "element_id"):
        return str(node.element_id)
    if hasattr(node, "id"):
        return str(node.id)
    if isinstance(node, dict):
        return str(node.get("id", id(node)))
    return str(id(node))


def _node_to_dict(node: Any) -> dict:
    result: dict[str, Any] = {"id": _get_node_id(node)}

    if hasattr(node, "labels"):
        labels = list(node.labels) if hasattr(node.labels, "__iter__") else [node.labels]
        if labels:
            result["label"] = labels[0]
            result["labels"] = labels

    if hasattr(node, "properties"):
        props = node.properties if isinstance(node.properties, dict) else dict(node.properties)
        result.update(props)
    elif hasattr(node, "items"):
        result.update(dict(node))
    elif isinstance(node, dict):
        result.update(node)

    if "label" not in result and "name" in result:
        result["label"] = result["name"]

    return result


def _relationship_to_dict(rel: Any) -> dict:
    result: dict[str, Any] = {}

    if hasattr(rel, "start_node") and hasattr(rel, "end_node"):
        result["source"] = _get_node_id(rel.start_node)
        result["target"] = _get_node_id(rel.end_node)
    elif hasattr(rel, "source") and hasattr(rel, "target"):
        result["source"] = _get_node_id(rel.source)
        result["target"] = _get_node_id(rel.target)
    elif isinstance(rel, dict):
        result["source"] = str(rel.get("source", ""))
        result["target"] = str(rel.get("target", ""))

    if hasattr(rel, "type"):
        result["label"] = str(rel.type)
    elif isinstance(rel, dict) and "type" in rel:
        result["label"] = str(rel["type"])
    elif isinstance(rel, dict) and "label" in rel:
        result["label"] = str(rel["label"])

    if hasattr(rel, "properties"):
        props = rel.properties if isinstance(rel.properties, dict) else dict(rel.properties)
        result.update(props)
    elif hasattr(rel, "items") and not isinstance(rel, dict):
        result.update(dict(rel))

    return result
