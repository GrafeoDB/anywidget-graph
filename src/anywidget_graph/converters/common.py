"""Common node and edge conversion utilities."""

from __future__ import annotations

from typing import Any


def is_node(obj: Any) -> bool:
    """Check if an object represents a graph node."""
    if hasattr(obj, "labels") and hasattr(obj, "element_id"):
        return True
    if hasattr(obj, "labels") and hasattr(obj, "properties"):
        return True
    return isinstance(obj, dict) and "id" in obj


def is_relationship(obj: Any) -> bool:
    """Check if an object represents a graph relationship."""
    if hasattr(obj, "type") and hasattr(obj, "start_node"):
        return True
    if hasattr(obj, "type") and hasattr(obj, "source") and hasattr(obj, "target"):
        return True
    return isinstance(obj, dict) and "source" in obj and "target" in obj


def get_node_id(node: Any) -> str:
    """Extract the ID from a node object."""
    if hasattr(node, "element_id"):
        return str(node.element_id)
    if hasattr(node, "id"):
        return str(node.id)
    if isinstance(node, dict):
        return str(node.get("id", id(node)))
    return str(id(node))


def node_to_dict(node: Any) -> dict[str, Any]:
    """Convert a node object to a dictionary."""
    result: dict[str, Any] = {"id": get_node_id(node)}

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


def relationship_to_dict(rel: Any) -> dict[str, Any]:
    """Convert a relationship object to a dictionary."""
    result: dict[str, Any] = {}

    if hasattr(rel, "start_node") and hasattr(rel, "end_node"):
        result["source"] = get_node_id(rel.start_node)
        result["target"] = get_node_id(rel.end_node)
    elif hasattr(rel, "source") and hasattr(rel, "target"):
        result["source"] = get_node_id(rel.source)
        result["target"] = get_node_id(rel.target)
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
