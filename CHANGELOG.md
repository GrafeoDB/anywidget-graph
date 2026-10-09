# Changelog

## 0.4.0 2026-10-09

### Features

- **Linked lanes**: `lanes` shows several graphs side by side in one canvas, each with its own layout and title; edges between lanes (or marked `cross`) are drawn as soft curves on an overlay and light up with hover or selection
- **Live append**: `append()` (or the `append_batch` state a host sets) adds nodes and edges without a re-layout; existing nodes keep their positions, new ones fade in and edges draw in, staggered by `append_stagger_ms` and kept under 1.5 s per batch (`append_animation="none"` turns it off)
- **Lane widths, column lanes and action lanes**: a lane can be narrower or wider (`width`), stack its nodes in a column (`arrange: "column"`), or hold a clickable glyph instead of nodes (`action`, `glyph`, `caption`) that reports clicks in `lane_action`; the camera frames every lane and the lanes stretch to the canvas's shape
- **Pulse**: `pulse_nodes` gives the listed nodes a soft pulse
- **Host theme**: `theme` sets the background, panels, text, borders and accent from the host page
- **Feature detection**: the widget sets `_features` when it renders
- **Fill the host**: `fill=True` makes the widget take its host element's size (100% wide and high) and follow its resizes; `width` and `height` are then ignored

### Improvements

- **Grafeo 0.5.44**: the `grafeo` extra now requires `grafeo>=0.5.44,<0.7`, ready for the 0.6.0 release
- **Browser engine 0.5.44**: WASM mode loads `@grafeo-db/wasm@0.5.44` (was 0.5.0) from jsDelivr; the version is set in one place (`GRAFEO_WASM_VERSION` in `ui/grafeo-embed.js`)
- **Paths and lists render**: results with `RETURN p`, `collect(n)`, variable-length relationships or `nodes(p)` / `relationships(p)` now show their nodes and edges in all three Grafeo modes; nodes that are only referenced by a path or an edge are looked up
- **Shared Grafeo result conversion** for the server and WASM modes (`ui/grafeo-result.js`)
- Schema panel shows counts in Grafeo server and WASM modes
- Grafeo server errors show the server's `detail` message instead of raw JSON
- Unknown query languages in embedded mode (for example AQL) report Grafeo's error instead of a GQL syntax error
- The ESM bundler renames every backend function automatically and no longer touches method calls with the same name
- Weekly CI job runs the suite against the newest grafeo on PyPI, pre-releases included; the CI Python matrix now really runs 3.13 and 3.14

### Bug Fixes

- Fixed WASM mode: `@grafeo-db/wasm` is built for bundlers since 0.5.x and has no init function, so the esm.sh import failed; the binary is now instantiated directly (0.5.0 also panicked on every query in the browser)
- Fixed Grafeo server and WASM results rendering nothing: nodes and edges were matched on `labels` / `type` / `start` instead of Grafeo's `_labels` / `_type` / `_source` / `_target`
- Fixed Grafeo server schema request (`/databases/{name}/schema` does not exist, now `GET /db/{name}/schema`)
- Fixed Grafeo schema parsing in WASM mode and in `GrafeoBackend.fetch_schema()` (labels are `{name, count}` objects)
- Fixed a node property called `id` (or an edge property called `source` / `target`) replacing the engine identity, which left edges pointing at missing nodes and blanked the widget (the demo data has such properties)
- Fixed duplicate edges from undirected matches in embedded mode
- Fixed neighbor expansion on Grafeo: integer ids were compared as strings (`id(n) = "42"`) and never matched; node ids are now escaped in generated queries, and SPARQL / GraphQL sessions expand with Cypher
- Fixed the widget going blank when an edge's endpoint is missing or a node id repeats (Graphology throws), for example when new results replace the demo data
- Demo mode loads its statements one at a time and refreshes the schema panel afterwards
- Fixed `Sigma: Container has no width` when the widget is mounted in a hidden or not yet sized container (a closed panel, a tab); it now renders once the container has a size

## 0.3.1 2026-03-16

### New Features

- **Lasso selection**: Freeform lasso tool for selecting nodes by drawing around them

### Bug Fixes

- Fixed missing ICONS import causing zoom and lasso buttons to fail
- Fixed `lassoSvg` referenced before declaration, crashing widget on load

## 0.3.0

### New Features

- **Automatic dark mode**: Detects host theme (marimo `class="dark"`, `data-theme`, `prefers-color-scheme`) and syncs automatically via MutationObserver

### Improvements

- Increased node spread in spring layout: stronger charge repulsion, larger link distance and collision radius for clearer hub-spoke separation
- Spring layout renamed to "Default" in the layout dropdown
- Updated color palette: blue accent and slate-based neutrals, replacing the previous indigo tint
- Theme toggle auto-hidden when running inside a themed host (e.g. marimo)
- Dark mode label colors update dynamically with theme changes

## 0.2.10

### New Features

- **d3-force spring layout**: New default layout using d3-force with charge, link-distance and collision forces; produces clean hub-spoke rings for hierarchical data
- **Degree-based node sizing**: Nodes auto-sized by connection count when no explicit `size_field` is set; hub nodes appear larger, pushing neighbors into natural rings
- **Filter-aware layouts**: Switching layout or clicking refresh re-runs the layout using only visible nodes, respecting type filters and search state

### Improvements

- Spring layout is the new default
- Force layout uses `linLogMode` for better community separation
- Cluster layout filters out hidden node types before packing
- Filter panel refresh button triggers a layout refresh

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
