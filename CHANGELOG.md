# Changelog

## 0.5.0 Unreleased

Grafeo 0.6 release: the Grafeo backends move to grafeo 0.6 (embedded, grafeo-server and WASM). Stay on 0.4.x for grafeo 0.5.

### Breaking

- **grafeo 0.6**: the `grafeo` extra requires `grafeo>=0.6.0b1,<0.7` (was `>=0.5.44,<0.7`), and WASM mode loads `@grafeo-db/wasm@0.6.0-beta.1` (was 0.5.44) from jsDelivr. grafeo 0.6 changes behavior you see in the query box: a GQL number with a point (`1.50`) is an exact decimal, integer overflow and division by zero fail the query, a `WHERE` right after `INSERT`, `CREATE`, `MERGE` or `DELETE` is an error, and GQL sorts nulls last in both directions (see grafeo's [Upgrading to 0.6](https://grafeo.dev/upgrading/0.6/))
- **Embedded databases migrate on first open**: grafeo 0.6 stores every database as one file in a new format. The first read-write open of a 0.5.x database (`grafeo.GrafeoDB(path)`) migrates it and keeps the old file as `<path>.pre-0.6`; 0.5.x cannot open the migrated file, so stop every 0.5.x process that uses it first and keep the copy as the way back. Opening a directory that is not a 0.5.x database (an empty one included) fails: pass a file path. See "Upgrading embedded databases from grafeo 0.5" in the README

### Bug Fixes

- **Security: data shows as text, never as markup**: the properties panel, the hover tooltip and the filter panel's property names put node and edge values (ids, labels, types, endpoints, property keys and values) into `innerHTML`, so a value such as `<img src=x onerror=...>` ran script in the page when the element was selected or hovered. They now build their rows from elements and text, so such a value shows literally. The Python-side backend name in the settings status is set as text too
- **Decimal properties reach the widget**: grafeo 0.6 returns GQL numbers with a point as exact decimals (`decimal.Decimal` in Python, `{"$decimal": "1.50"}` from WASM and grafeo-server). The widget model syncs as JSON, so a node or edge with such a property broke the embedded backend's sync and `to_json()`, and showed as an object in WASM mode. Decimals now become numbers in all three modes, so `size_field`, `color_field`, `edge_size_field` and `edge_color_field` use them
- **Dates and times in embedded mode**: `datetime.date`, `datetime.time` and `datetime.datetime` property values (which Python's JSON cannot write) become their ISO text; grafeo-server's tagged values (`{"$date": ...}`, `$time`, `$datetime`, `$duration`) become their text too, and in WASM mode integers past 2^53 become their text and vectors plain lists

### Improvements

- **Paths and literals carry their entities**: grafeo 0.6 returns paths with their nodes and edges, and nodes and edges inside list and map literals (`[n, 1]`, `{k: n}`) and from `startNode(r)` / `endNode(r)`; all of these draw without extra lookups. Paths with bare ids (grafeo 0.5) are still resolved
- **Dependencies**: sigma 3.0.3 in the bundled graph libraries (was 3.0.0), neo4j-driver 5.28.3 (was 5.28.0), the lockfile refreshed (`uv lock --upgrade`), and CI on actions/checkout v7, astral-sh/setup-uv v10.3.0, actions/setup-node v7, actions/upload-artifact v7 and actions/download-artifact v8

### Tests

- The engine contract tests follow grafeo 0.6: paths with entities (GQL and Cypher), entities in list and map literals, `startNode` / `endNode`, numbers with a point, null properties, null ordering in GQL and Cypher, and a `WHERE` after a write as an error; widget tests for decimals, dates and nulls end to end, and the Node tests for 0.6 paths, `$decimal` values in node properties and edge weights, and the other tagged values
- Node tests (`tests/js/panels.test.mjs`, a small fake DOM) that render a node, an edge and a filter item with markup in every value and check that no value reaches `innerHTML` and each shows literally

## 0.4.6 2026-10-20

### Bug Fixes

- **Dimmed items read the same on a light and a dark canvas**: a selection dims the other nodes and edges by mixing their colour towards the canvas colour (opaque) instead of making it translucent. Sigma's blending does not treat a colour's alpha as transparency, so the old translucent dimming barely dimmed on a dark canvas and all but vanished on a light one

## 0.4.5 2026-10-20

### Features

- **Arrows**: `edge_arrows=True` draws every edge as an arrow from source to target (also in `to_html()`)
- **Self-loops**: an edge from a node to itself is drawn as a loop over the node's edge, nested when a node has several, with its label (`show_edge_labels`) and an arrowhead (`edge_arrows`); sigma drew such edges as nothing
- **Neighbour highlight**: with `highlight_neighbors=True` a selected node keeps its neighbours and their edges lit; everything else dims and loses its labels
- **`preset` layout**: `layout="preset"` keeps the positions the nodes bring (`x`, `y`), also after trying another layout from the toolbar, which then offers Preset to go back

### Bug Fixes

- **Settings follow the model**: `show_edge_labels` and the new `edge_arrows` and `highlight_neighbors` apply when they change after the widget is drawn
- **`to_html()` and `save_html()` need no CDN**: the exported page carries the bundled graph libraries itself instead of loading graphology and sigma from esm.sh, so it opens offline and behind a network filter

## 0.4.4 2026-10-19

### Bug Fixes

- **The widget loads without a CDN**: graphology, sigma, graphology-layout, graphology-layout-forceatlas2 and d3-force are bundled with the widget (`ui/vendor/graph-libs.min.js`, built from pinned npm versions by `scripts/vendor`, licenses in `ui/vendor/graph-libs.LICENSES.txt`) instead of loaded from esm.sh on every render. A page that could not reach esm.sh or cdn.jsdelivr.net (offline, a network filter, a blocker, a CDN outage) showed "Failed to fetch dynamically imported module" instead of the graph
- **neo4j-driver loads when a Neo4j connection is made**: it was imported from cdn.jsdelivr.net with the widget, so every host needed the CDN even without Neo4j. The Neo4j backend and the Grafeo WASM backend are now the only parts that load code from the network, and only when they connect

## 0.4.3 2026-10-12

### Improvements

- **Python 3.15**: supported, and tested in CI on 3.12 to 3.15. marimo, which the widget does not import, installs on 3.12 to 3.14 only for now: its dependency loro has no 3.15 wheels yet (the widget works in marimo as soon as marimo installs on 3.15)
- **marimo moved to the `examples` extra**: the widget does not import marimo, so it is no longer a dependency; `pip install anywidget-graph[examples]` adds marimo to run the apps in `examples/`

## 0.4.2 2026-10-09

### Features

All opt-in per lane: a lane without these options is laid out exactly as in 0.4.1.

- **Force layout for a lane**: `layout: "force"` lays the lane out with forces inside its band (repulsion, collision, edges as springs, a pull towards the height of its partners in the lanes to its left), so a dense graph spreads over its lane instead of shrinking into a core; nodes never leave their lane, a crowded lane draws its nodes smaller, and the layout is deterministic. Appended nodes settle from where they land while older nodes stay put
- **Rows in a lane**: `rows: {"field": ..., "order": [...]}` splits a lane into rows top to bottom by a node field (sized by node count, with a minimum; other values go to an extra row at the bottom), with each row's name (with room of its own, no node under it) and a faint separator
- **Lay a lane out again on a big batch**: `relayout: <share>` lays the lane out again when one batch removes or adds more than that share of its nodes (a re-sample); its nodes glide to their new places
- **Colours per type**: `type_colors` (`{"nodes": {"<type>": "#hex"}, "edges": {"<type>": "#hex"}}`) colours the items of a type and their legend swatches, so the legend matches the drawing; an item's own `color` still wins
- **Labels for a lane's largest nodes**: `labels: {"count": n}` shows the labels of a lane's n largest nodes at the default zoom, and no others in that lane (hover or select a node to see its label). A label may cover smaller nodes on a soft backing, never a node as large, a labelled node or another label; it goes on the left of its node at the lane's right edge (never over a row's name), and a long name is shortened with an ellipsis
- **Defaults for hosts without Python**: a setting an app's own model leaves out reads as the widget's default (as a fresh Python `Graph()` has it), so for example labels show without the host sending `show_labels`
- `_features` adds `force_layout`, `lane_rows`, `relayout`, `type_colors` and `lane_labels`

### Documentation

- README: "Embedding in an app": the widget stays generic and the host decides looks, samples and lane layouts (all opt-in); the model contract for an app that mounts the front end without Python

### Bug Fixes

- Fixed the zoom controls covering the caption of an action lane at the right edge on a narrow canvas: when the rightmost lane is an action lane, the framing leaves room for the controls
- Fixed the empty canvas mapping lanes with the y axis pointing down while sigma points it up (nothing visible depended on it before rows)

## 0.4.1 2026-10-09

### Features

- **Remove in a batch**: `Graph.remove(nodes, edges)` (or `remove` in the `append_batch` a host sets) takes nodes (with every edge touching them) and edges out of the drawing; they fade out and nothing is laid out again. One batch can remove and add (a re-sample): an item removed and sent again stays where it is, with its new properties
- **Totals from the host**: `totals` (`{"nodes": {"<type>": n}, "edges": {"<type>": n}}`) shows "shown / total" in the count badge and the schema panel, for a host that sends a sample of a larger graph; a type the sample lacks shows as 0
- **Edges into an action lane**: an edge whose end is an action lane's id draws as a curve into its button, like the cross-lane curves (draws in, can be removed, lights up with its node, hides with it)
- **Lane icons**: an action lane shows the host's `icon` (SVG markup, where `currentColor` takes the accent, or an image URL); `glyph` colours still draw stacked bars, and without either a neutral "open" icon shows (it used to be stacked bars, a model icon)
- `_features` adds `lane_icons`, `action_edges`, `remove` and `totals`

### Improvements

- **Appended items stay**: `append()` also merges its items into `nodes` and `edges`, so `to_json()`, `to_html()` and a widget shown again include them; the widget sees the lists match what it draws and does not lay out again. Changing `lanes` or a style keeps appended items (it used to drop them); setting `nodes` or `edges` to other data still replaces everything drawn
- **The model holds what is drawn**: a host that sets `append_batch` itself (without `Graph.append`) gets the merged lists written back into `nodes` and `edges`, so the node count, the results table, the schema panel and the host see appended items too
- **Search across lanes**: a search also shows a match's partners in the other lanes, with the curves between them
- **Lane margins**: nodes keep a margin (6% per side) from their lane's edges, so none sits right under the lane title or on the border; laid-out, column and appended nodes alike
- **Lane colours from the widget**: the lane overlay (titles, buttons, curves) takes the widget's light or dark colours for a key the host theme leaves out (it fell back to fixed colours)
- **One redraw per change**: lanes, nodes, edges and style changes that arrive together are drawn once (a host that sets `lanes`, `nodes` and `edges` one after another got three layouts)
- **Dependencies**: the `dev` extra and group require `pytest>=9.1`, `ruff>=0.16` and `prek>=0.5`; the `pandas` extra requires `pandas>=3`, `cosmosdb` requires `gremlinpython>=3.8`

### Bug Fixes

- Fixed `append()` without lanes moving the drawn graph: new nodes now go next to their neighbours inside the area already drawn, so the camera keeps its scale (they were placed on a fixed 1000-unit square, which could make sigma rescale)
- Fixed cross-lane curves still drawn to a node hidden by a filter or a search
- Fixed `theme` keeping old colours when a key is left out or the theme is cleared, and a `dark_mode` change resetting the label colour the theme sets
- Fixed a click on an action lane's glyph going unreported in a widget shown twice (or shown again): `lane_action.seq` now counts on from the model's value instead of from 1 in every view
- Fixed the Delete key dropping appended items it did not delete
- Fixed `pulse_nodes` set before the widget renders being ignored
- Fixed nodes appended (or redrawn) during an active search staying hidden even when they match it
- Fixed appended nodes and their labels landing on top of each other: ids that differ only at the end (`n1`, `n2`, ...) got nearly the same spot, and nodes next to the same neighbour could share one. Nodes of the same neighbours now stack as rows at its height, one label line apart (then in the next column), clear of the labels already drawn, and their labels show at the default zoom (sigma's label grid dropped all but two of a stack)
- Fixed lane titles sitting at the top edge of an empty canvas, and the lanes jumping when the first node arrived (for example at the start of a live append): an empty canvas is now framed with sigma's stage padding, like a canvas with nodes

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
