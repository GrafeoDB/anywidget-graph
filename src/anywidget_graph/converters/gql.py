"""Converter for ISO GQL query results.

GQL (Graph Query Language) is the ISO standard graph query language.
Its result format is similar to Cypher, so this module provides an
alias to the CypherConverter.
"""

from __future__ import annotations

from anywidget_graph.converters.cypher import CypherConverter

# GQL uses the same result format as Cypher
GQLConverter = CypherConverter

__all__ = ["GQLConverter"]
