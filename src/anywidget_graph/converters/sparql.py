"""Converter for SPARQL query results (RDF triples)."""

from __future__ import annotations

from typing import Any

from anywidget_graph.converters.base import GraphData


class SPARQLConverter:
    """Convert SPARQL query results to graph data.

    Handles RDF data from SPARQL endpoints:
    - SELECT queries with ?s ?p ?o bindings
    - CONSTRUCT queries returning triples
    - RDFLib result objects

    The converter treats URIs as node identifiers and predicates as edge labels.
    Literal values become node properties.

    Parameters
    ----------
    subject_var : str
        Variable name for subjects in SELECT results (default: "s").
    predicate_var : str
        Variable name for predicates in SELECT results (default: "p").
    object_var : str
        Variable name for objects in SELECT results (default: "o").
    node_label_predicate : str | None
        Predicate URI used for node labels (default: rdfs:label).
        Set to None to disable label extraction.

    Example
    -------
    >>> from rdflib import Graph as RDFGraph
    >>> g = RDFGraph()
    >>> g.parse("data.ttl")
    >>> result = g.query("SELECT ?s ?p ?o WHERE { ?s ?p ?o }")
    >>> converter = SPARQLConverter()
    >>> data = converter.convert(result)
    """

    def __init__(
        self,
        subject_var: str = "s",
        predicate_var: str = "p",
        object_var: str = "o",
        node_label_predicate: str | None = "http://www.w3.org/2000/01/rdf-schema#label",
    ) -> None:
        self.subject_var = subject_var
        self.predicate_var = predicate_var
        self.object_var = object_var
        self.node_label_predicate = node_label_predicate

    def convert(self, result: Any) -> GraphData:
        """Convert SPARQL result to nodes and edges.

        Parameters
        ----------
        result : Any
            SPARQL query result (e.g., from RDFLib or SPARQLWrapper).

        Returns
        -------
        GraphData
            Dictionary with 'nodes' and 'edges' lists.
        """
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        labels: dict[str, str] = {}  # URI -> label mapping

        bindings = list(self._iter_bindings(result))

        # First pass: collect labels
        if self.node_label_predicate:
            for binding in bindings:
                pred = self._get_value(binding, self.predicate_var)
                if pred == self.node_label_predicate:
                    subj = self._get_value(binding, self.subject_var)
                    obj = self._get_value(binding, self.object_var)
                    if subj and obj:
                        labels[subj] = obj

        # Second pass: build graph
        for binding in bindings:
            subj = self._get_value(binding, self.subject_var)
            pred = self._get_value(binding, self.predicate_var)
            obj = self._get_value(binding, self.object_var)

            if not subj or not pred:
                continue

            # Skip label triples (already processed)
            if pred == self.node_label_predicate:
                continue

            # Create subject node
            if subj not in nodes:
                nodes[subj] = {
                    "id": subj,
                    "label": labels.get(subj, self._extract_local_name(subj)),
                    "uri": subj,
                }

            # If object is a URI, create object node and edge
            if obj and self._is_uri(obj):
                if obj not in nodes:
                    nodes[obj] = {
                        "id": obj,
                        "label": labels.get(obj, self._extract_local_name(obj)),
                        "uri": obj,
                    }
                edges.append({
                    "source": subj,
                    "target": obj,
                    "label": self._extract_local_name(pred),
                    "predicate": pred,
                })
            elif obj:
                # Literal value - add as node property
                prop_name = self._extract_local_name(pred)
                nodes[subj][prop_name] = obj

        return {"nodes": list(nodes.values()), "edges": edges}

    def _iter_bindings(self, result: Any):
        """Iterate over result bindings."""
        # RDFLib Result
        if hasattr(result, "bindings"):
            yield from result.bindings
        # SPARQLWrapper JSON result
        elif isinstance(result, dict) and "results" in result:
            yield from result["results"].get("bindings", [])
        # Iterable of bindings
        elif hasattr(result, "__iter__"):
            yield from result

    def _get_value(self, binding: Any, var: str) -> str:
        """Extract value from a binding for a variable."""
        if isinstance(binding, dict):
            # SPARQLWrapper format: {"var": {"value": "..."}}
            val = binding.get(var, {})
            if isinstance(val, dict):
                return str(val.get("value", ""))
            return str(val) if val else ""
        # RDFLib format: binding[var] is an RDF term
        elif hasattr(binding, "__getitem__"):
            try:
                val = binding[var]
                return str(val) if val else ""
            except (KeyError, TypeError):
                return ""
        return ""

    def _is_uri(self, value: str) -> bool:
        """Check if a value looks like a URI."""
        return value.startswith(("http://", "https://", "urn:"))

    def _extract_local_name(self, uri: str) -> str:
        """Extract local name from URI (part after # or last /)."""
        if "#" in uri:
            return uri.split("#")[-1]
        if "/" in uri:
            return uri.rsplit("/", 1)[-1]
        return uri
