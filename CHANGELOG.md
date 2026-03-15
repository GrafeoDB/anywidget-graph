# Changelog

## 0.2.9

### New Features

- **Filter panel**: Schema sidebar transformed into a filter panel with per-type checkboxes, counts, color pickers and "all / none" toggle links for both node and edge types
- **Type-based node coloring**: Nodes automatically colored by their type (first label), matching the filter panel swatches
- **Color pickers**: Click any type's color swatch in the filter panel to change it; graph updates in real-time
- **Level-of-detail labels**: Labels auto-hide on small or zoomed-out nodes; thresholds scale with graph size
- **Circle-packing cluster layout**: Deterministic circle packing with radius proportional to `sqrt(nodeCount)` and mini-force within each cluster for organic internal structure
- **Edge interaction**: Edges are now clickable with type shown in the properties panel

### Bug Fixes

- Fixed widget height growing on scroll; wrapper now locked to fixed height
- Fixed search filtering: now shows matching nodes plus first-degree neighbors and connecting edges, hides everything else
- Fixed parallel edge crash by using Graphology multi-graph mode
- Fixed graph disappearing when side panels open by refreshing renderer on resize
- Fixed dark mode label color: adapts to current theme

### Improvements

- Zoom controls reordered: fit, zoom-in, zoom-out at top; layout and mode at bottom
- Edge type shown in properties panel on click
- Internal attributes (`nodeType`, `edgeType`) hidden from properties panel

## 0.2.8

### New Features

- **Language-aware query dispatch**: GrafeoBackend routes queries to language-specific methods (`execute_cypher`, `execute_gremlin`, etc.) with fallback to generic `execute()`
- **Results drawer**: Bottom drawer with tabbed nodes/edges tables, pagination and query timing
- **Grafeo native dict support**: Detection and conversion of Grafeo's internal `_id`/`_labels`/`_source`/`_target`/`_type` dict format so native query results render correctly

### Improvements

- Added playground link at grafeo.ai to README

## 0.2.7

### Bug Fixes

- Fixed lasso/box selection behavior

### Improvements

- Quality-of-life improvements to search and toolbar

## 0.2.6

### New Features

- **Browser-side backends**: Added Grafeo server (HTTP), Grafeo WASM (browser-embedded) and Neo4j browser-side driver support
- **Settings panel**: Full connection UI with backend selector, connection mode, language picker and connect/disconnect
- **CosmosDB backend**: Added Azure CosmosDB Gremlin backend
- **Demo mode**: WASM-based demo with pre-populated dataset
- **Schema browser**: Sidebar with node labels and relationship types; click to query
- **Properties panel**: Right sidebar showing selected node/edge details
- **Zoom and pan controls**: Zoom in/out/fit buttons, box select mode, click select mode

### Improvements

- Updated docs, tests and dependencies
- HTML export template fix
- Zoom controls added to graph container

## 0.2.5

### New Features

- **Major UI overhaul**: Modular component architecture with toolbar, schema panel, settings, properties and results drawer
- **Multiple backends**: Grafeo, Neo4j, LadybugDB, ArangoDB and CosmosDB support
- **Test suite**: Comprehensive test coverage with 55+ tests
- **Node interaction**: Click, drag, pin, double-click expand, delete and multi-select
- **Force layout**: ForceAtlas2 with dynamic parameters scaling by graph size
- **Keyboard shortcuts**: F to fit, Escape to deselect, Delete to remove selected

### Improvements

- Consistent code formatting with ruff

## 0.2.4

### Bug Fixes

- Fixed ESM bundling issue in UI init

## 0.2.3

### Bug Fixes

- Fixed rendering issue in graph container
- Updated dependencies

## 0.2.2

### Improvements

- Added Apache 2.0 license
- ESM bundle aggregation for widget JS

## 0.2.1

### Improvements

- Updated README with usage examples
- Code formatting pass

## 0.1.0

- Initial release of anywidget-graph
