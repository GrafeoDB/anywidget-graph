"""The widget in a real browser, hosted through a plain model: what unit tests with a fake DOM cannot show."""

from __future__ import annotations

import json

from anywidget_graph import Graph
from tests.e2e.conftest import find_on_canvas

HOSTILE = "<img src=x onerror=window.__xss=1>"


def _mount(page, values: dict, **options) -> int:
    return page.evaluate("([values, options]) => window.mount(values, options)", [values, options])


def _chain(count: int) -> dict:
    nodes = [{"id": f"n{i}", "label": f"Node {i}"} for i in range(count)]
    edges = [{"source": f"n{i}", "target": f"n{i + 1}"} for i in range(count - 1)]
    return {"nodes": nodes, "edges": edges}


def _star3d() -> dict:
    """A hub at the origin and six leaves on the axes, placed by the host (preset): the 3D view frames the scene on
    its centre, so the hub is under the middle of the canvas."""
    axes = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    nodes = [{"id": "hub", "label": "Hub node", "labels": ["Hub"], "x": 0, "y": 0, "z": 0}]
    nodes += [
        {"id": f"leaf{i}", "label": f"Leaf {i}", "labels": ["Leaf"], "x": x, "y": y, "z": z}
        for i, (x, y, z) in enumerate(axes)
    ]
    edges = [{"source": "hub", "target": f"leaf{i}"} for i in range(len(axes))]
    return {"nodes": nodes, "edges": edges, "layout": "preset", "view": "3d"}


# In the page: how many pixels of a screenshot differ from its most common colour (the scene's background), and, with
# a second screenshot, how many pixels differ between the two
_PIXELS_JS = """async ([first, second]) => {
    const load = async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const a = await load(first);
    const counts = new Map();
    for (let i = 0; i < a.length; i += 4) {
        const key = (a[i] << 16) | (a[i + 1] << 8) | a[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const bg = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const far = (d, i, c) =>
        Math.abs(d[i] - ((c >> 16) & 255)) + Math.abs(d[i + 1] - ((c >> 8) & 255))
        + Math.abs(d[i + 2] - (c & 255)) > 60;
    let painted = 0;
    for (let i = 0; i < a.length; i += 4) if (far(a, i, bg)) painted++;
    let changed = 0;
    if (second) {
        const b = await load(second);
        for (let i = 0; i < a.length; i += 4) {
            if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) changed++;
        }
    }
    return { painted, changed };
}"""


def _pixels(page, first: bytes, second: bytes | None = None) -> dict:
    import base64

    def url(shot: bytes | None) -> str | None:
        return None if shot is None else "data:image/png;base64," + base64.b64encode(shot).decode()

    return page.evaluate(_PIXELS_JS, [url(first), url(second)])


def test_mounts_through_a_plain_model_without_any_network(page, site):
    """A host without Python renders the widget, and the widget loads nothing from outside the page's server."""
    base, _root = site
    outside: list[str] = []
    page.on("request", lambda request: None if request.url.startswith(base) else outside.append(request.url))
    _mount(page, _chain(10))
    page.wait_for_timeout(500)
    assert page.locator(".awg-count-badge").first.text_content() == "10 nodes · 9 edges"
    assert outside == []
    assert page.errors == []


def test_hostile_values_show_as_text_in_the_tooltip_and_the_properties_panel(page):
    values = {"nodes": [{"id": "a", "name": HOSTILE, "path": "<svg onload=window.__xss=2>"}], "edges": []}
    _mount(page, values)
    page.wait_for_timeout(300)
    spot = find_on_canvas(page, 0, lambda text: HOSTILE in text)
    assert spot is not None, "the node's tooltip shows its label literally"
    tooltip = page.locator(".awg-tooltip").first
    assert tooltip.locator("img, svg").count() == 0
    page.mouse.click(*spot)
    page.locator("button[title*='roperties']").first.click()
    panel = page.locator(".awg-properties-content").first
    assert HOSTILE in panel.text_content()
    assert "<svg onload=window.__xss=2>" in panel.text_content()
    assert panel.locator("img, svg:not(.awg-properties-header svg)").count() == 0
    # The panel shows the node's own fields, not the widget's drawing internals
    assert "undefined" not in panel.text_content()
    assert page.evaluate("window.__xss") is None


def test_a_view_destroyed_and_drawn_again_leaves_no_listener_behind(page):
    index = _mount(page, _chain(5))
    counts = page.evaluate(
        """(index) => {
            const mount = window.mounts[index];
            const counts = [mount.model.listeners()];
            for (let i = 0; i < 3; i++) {
                mount.destroy();
                mount.pane.replaceChildren();
                mount.destroy = window.widget.render({ model: mount.model, el: mount.pane });
                counts.push(mount.model.listeners());
            }
            mount.destroy();
            counts.push(mount.model.listeners());
            return counts;
        }""",
        index,
    )
    assert counts[0] > 0
    assert counts[:4] == [counts[0]] * 4
    assert counts[4] == 0


def test_the_theme_follows_the_page_until_it_is_a_choice(page):
    def themes() -> list[str]:
        return page.locator(".awg-wrapper").evaluate_all(
            "(els) => els.map((el) => el.classList.contains('awg-dark') ? 'dark' : 'light')"
        )

    def page_theme(dark: bool) -> None:
        page.evaluate("(dark) => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }", dark)
        page.wait_for_timeout(100)

    page_theme(False)
    follow = _mount(page, {**_chain(2), "dark_mode": True, "_theme_explicit": False})
    _mount(page, {**_chain(2), "dark_mode": False, "_theme_explicit": True})
    # A second view of the first widget, on the same model (one widget shown in two cells)
    page.evaluate(
        """(index) => {
            const pane = document.createElement("div");
            pane.className = "pane";
            document.body.appendChild(pane);
            window.widget.render({ model: window.mounts[index].model, el: pane });
        }""",
        follow,
    )
    assert themes() == ["light", "light", "light"]
    for dark in (True, False, True):
        page_theme(dark)
        expected = "dark" if dark else "light"
        assert themes() == [expected, "light", expected]
    assert page.evaluate("(i) => window.mounts[i].model.values._theme_explicit", follow) is False
    # A data-theme on the widget's own pane wins over the page's
    pane = _mount(page, _chain(2), paneTheme="light")
    assert themes()[-1] == "light"
    assert page.evaluate("(i) => window.mounts[i].model.values.dark_mode", pane) is False


def test_level_chips_show_the_counts_and_switch_the_level(page):
    nodes = [{"id": f"n{i}", "level": i % 4} for i in range(12)]
    levels = [
        {"id": 0, "label": "All", "count": 5230},
        {"id": 1, "label": "Inputs", "count": 1031},
        {"id": 2, "label": "After filters", "count": 412},
        {"id": 3, "label": "Sources used", "count": 98},
    ]
    index = _mount(page, {"nodes": nodes, "edges": [], "levels": levels, "current_level": 2})
    chips = page.locator(".awg-level-chip")
    assert chips.count() == 4
    assert chips.nth(0).text_content() == "All5,230"
    assert "awg-level-chip-active" in chips.nth(2).get_attribute("class")
    chips.nth(3).click()
    assert page.evaluate("(i) => window.mounts[i].model.values.current_level", index) == 3
    assert "awg-level-chip-active" in chips.nth(3).get_attribute("class")
    assert page.errors == []


def test_server_mode_query_box_connects_draws_and_explains(page):
    """The first query connects without pressing Connect; a write keeps the drawing with a note; an error shows."""
    node_a = {"_id": 0, "_labels": ["File"], "name": "a.py", "size": {"$decimal": "1.50"}}
    node_b = {"_id": 1, "_labels": ["File"], "name": "b.py"}
    edge = {"_id": 0, "_type": "IMPORTS", "_source": 0, "_target": 1}
    answers = {
        "MATCH (a)-[r]->(b) RETURN a, r, b": {"columns": ["a", "r", "b"], "rows": [[node_a, edge, node_b]]},
        "INSERT (:File)": {"columns": [], "rows": []},
    }

    def answer(route):
        url = route.request.url
        headers = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}
        if route.request.method == "OPTIONS":
            return route.fulfill(status=204, headers=headers)
        if url.endswith("/health"):
            return route.fulfill(json={"status": "ok"}, headers=headers)
        if url.endswith("/schema"):
            return route.fulfill(json={"labels": [{"name": "File", "count": 2}], "edge_types": []}, headers=headers)
        query = json.loads(route.request.post_data or "{}").get("query")
        if query in answers:
            return route.fulfill(json=answers[query], headers=headers)
        return route.fulfill(status=400, json={"error": "bad_request", "detail": "syntax error"}, headers=headers)

    page.route("http://grafeo.test/**", answer)
    values = {
        "database_backend": "grafeo",
        "grafeo_connection_mode": "server",
        "grafeo_server_url": "http://grafeo.test",
        "query_language": "gql",
        "query": "MATCH (a)-[r]->(b) RETURN a, r, b",
        "nodes": [],
        "edges": [],
    }
    _mount(page, values)
    box = page.locator("input.awg-query-input")
    message = page.locator(".awg-query-error")
    box.press("Enter")
    page.wait_for_function("document.querySelector('.awg-count-badge').textContent === '2 nodes · 1 edges'")
    box.fill("INSERT (:File)")
    box.press("Enter")
    page.wait_for_function("document.querySelector('.awg-query-error').textContent.includes('no rows')")
    assert "awg-query-note" in message.get_attribute("class")
    assert page.locator(".awg-count-badge").first.text_content() == "2 nodes · 1 edges"
    box.fill("MATCH (n RETURN n")
    box.press("Enter")
    page.wait_for_function("document.querySelector('.awg-query-error').textContent.includes('syntax error')")
    assert "awg-query-note" not in message.get_attribute("class")


def test_a_narrow_pane_keeps_every_toolbar_control_inside_the_widget(page):
    _mount(page, {**_chain(3), "fill": True, "show_query_input": True}, width=380, height=420)
    wrapper = page.locator(".awg-wrapper").first.bounding_box()
    controls = page.locator(".awg-toolbar > button, .awg-toolbar .awg-btn-primary, .awg-toolbar .awg-search-wrap")
    for i in range(controls.count()):
        box = controls.nth(i).bounding_box()
        assert box["x"] + box["width"] <= wrapper["x"] + wrapper["width"] + 1


def test_per_item_marks_are_drawn_over_the_canvas(page):
    """A ring and a badge draw on the overlay; a plain graph's overlay stays empty."""
    styled = {"nodes": [{"id": "a", "ring": "#e3a33b", "badge": "2/3", "opacity": 0.5}], "edges": []}
    _mount(page, _chain(2))
    _mount(page, styled)
    page.wait_for_timeout(300)
    painted = page.evaluate(
        """() => [...document.querySelectorAll('.awg-lanes-overlay')].map((canvas) => {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
            return count;
        })"""
    )
    assert painted[0] == 0
    assert painted[1] > 50
    assert page.errors == []


def test_the_html_export_runs_no_markup_from_the_data(page, export_dir):
    graph = Graph(nodes=[{"id": "a", "label": HOSTILE}, {"id": "</script><script>window.__xss=3</script>"}])
    path = export_dir / "export.html"
    graph.save_html(str(path), title="<b>Export</b>")
    page.goto(path.as_uri())
    page.wait_for_timeout(800)
    assert page.title() == "<b>Export</b>"
    assert page.evaluate("window.__xss") is None
    assert page.errors == []


def test_3d_view_mounts_a_webgl_canvas_without_any_network(page, site):
    """view="3d" (Graph3D) draws the graph in a Three.js canvas, loading nothing from outside the host's server."""
    base, _root = site
    outside: list[str] = []
    page.on("request", lambda request: None if request.url.startswith(base) else outside.append(request.url))
    _mount(page, {**_chain(12), "view": "3d"})
    page.wait_for_timeout(1200)
    assert page.locator("canvas.awg3-canvas").count() == 1
    assert page.locator(".awg-count-badge").first.text_content() == "12 nodes · 11 edges"
    assert outside == []
    assert page.errors == []


def test_the_toolbar_toggles_between_the_2d_and_3d_views(page, site):
    """The cube button switches `view`: the Sigma canvas is replaced by the Three.js canvas and back."""
    _mount(page, _chain(5))
    page.wait_for_timeout(400)
    # Sigma's canvas has no awg3-canvas class
    assert page.locator("canvas.awg3-canvas").count() == 0
    page.locator(".awg-view-btn").first.click()
    page.wait_for_timeout(1000)
    assert page.locator("canvas.awg3-canvas").count() == 1
    assert page.locator(".awg-count-badge").first.text_content() == "5 nodes · 4 edges"
    page.locator(".awg-view-btn").first.click()
    page.wait_for_timeout(400)
    assert page.locator("canvas.awg3-canvas").count() == 0
    assert page.errors == []


def _canvas_centre(page) -> tuple[float, float]:
    box = page.locator("canvas.awg3-canvas").bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def test_3d_view_hover_tooltip_and_click_selection(page, site):
    """In the 3D view a node under the cursor shows its tooltip and reports hovered_node, and a click selects it."""
    index = _mount(page, _star3d())
    page.wait_for_timeout(600)
    spot = _canvas_centre(page)
    page.mouse.move(spot[0] - 30, spot[1] - 30)
    page.mouse.move(*spot)
    tip = page.locator(".awg3-tooltip")
    assert tip.is_visible() and "Hub node" in (tip.text_content() or ""), tip.text_content()
    hovered = page.evaluate("(i) => window.mounts[i].model.get('hovered_node')", index)
    assert hovered and hovered["id"] == "hub" and "z" in hovered, hovered
    page.mouse.click(*spot)
    page.wait_for_timeout(150)
    selected = page.evaluate("(i) => window.mounts[i].model.get('selected_node')", index)
    selected_all = page.evaluate("(i) => window.mounts[i].model.get('selected_nodes')", index)
    assert selected["id"] == hovered["id"]
    assert selected_all == [hovered["id"]]
    assert page.errors == []


def test_3d_view_user_journey_orbit_zoom_settings_and_back(page, site):
    """The 3D view as a user drives it: orbit by dragging, zoom with the wheel, move the bloom slider in the
    settings panel, and switch back to 2D from the settings View select, all without a page error."""
    index = _mount(page, {**_chain(24), "view": "3d"})
    page.wait_for_timeout(2500)  # let the 3D force layout settle

    # Orbit: drag across the canvas; zoom: wheel in and out. The scene must keep painting.
    canvas = page.locator("canvas.awg3-canvas")
    box = canvas.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    page.mouse.move(cx - 160, cy - 80, steps=10)
    page.mouse.up()
    page.mouse.wheel(0, -800)
    page.wait_for_timeout(500)
    page.mouse.wheel(0, 800)
    page.wait_for_timeout(300)
    # The scene must keep painting: pixels that differ from the scene's background (its most common colour), so a
    # blank canvas counts none whatever its colour
    painted = _pixels(page, page.locator("canvas.awg3-canvas").screenshot())["painted"]
    assert painted > 2000, f"scene blank after orbit+zoom ({painted} painted pixels)"

    # Settings: the 3D section's bloom slider drives force3d_repulsion
    page.locator("button[title='Connection settings']").first.click()
    page.wait_for_timeout(300)
    slider = page.locator(".awg-3d-settings input[type='range']")
    assert slider.count() == 1
    slider.fill("2.5")
    page.wait_for_timeout(600)
    assert page.evaluate("(i) => window.mounts[i].model.get('force3d_repulsion')", index) == 2.5

    # The View select in the settings switches back to the 2D canvas
    page.locator(".awg-3d-settings select").first.select_option("2d")
    page.wait_for_timeout(600)
    assert page.locator("canvas.awg3-canvas").count() == 0
    assert page.locator(".awg-graph-container canvas").count() >= 1
    # And the model can switch it back to 3D (as Python does)
    page.evaluate("(i) => window.mounts[i].model.set('view', '3d')", index)
    page.wait_for_timeout(1200)
    assert page.locator("canvas.awg3-canvas").count() == 1
    assert page.errors == []


def test_3d_view_keeps_a_zoom_made_after_the_layout_settles(page, site):
    """Once the 3D force layout settles the camera is framed once; a wheel zoom afterwards stays."""
    _mount(page, {**_chain(16), "view": "3d", "show_labels": False})
    page.wait_for_timeout(4000)  # the layout settles and frames the scene
    before = page.locator("canvas.awg3-canvas").screenshot()
    page.mouse.move(*_canvas_centre(page))
    page.mouse.wheel(0, -600)
    page.wait_for_timeout(1500)  # the controls' damping comes to rest
    zoomed = page.locator("canvas.awg3-canvas").screenshot()
    page.wait_for_timeout(1000)
    later = page.locator("canvas.awg3-canvas").screenshot()
    painted = _pixels(page, before)["painted"]
    assert _pixels(page, before, zoomed)["changed"] > painted * 0.2, "the wheel zoomed the scene"
    assert _pixels(page, zoomed, later)["changed"] < painted * 0.02, "the zoom stays: nothing re-frames the camera"
    assert page.errors == []


def test_3d_view_hides_a_node_type_filtered_out_in_the_schema_panel(page, site):
    """A type switched off in the schema panel is not drawn in 3D: its nodes and their edges go, and the pointer
    finds nothing where they were."""
    index = _mount(page, _star3d())
    page.wait_for_timeout(600)
    spot = _canvas_centre(page)
    page.mouse.move(*spot)
    assert page.evaluate("(i) => window.mounts[i].model.get('hovered_node')?.id", index) == "hub"
    page.mouse.move(spot[0] + 300, spot[1] + 200)
    before = page.locator("canvas.awg3-canvas").screenshot()
    hidden = page.evaluate(
        """() => {
            const items = [...document.querySelectorAll('.awg-schema-item')];
            const item = items.find((el) => el.textContent.includes('Hub'));
            item.querySelector('.awg-filter-checkbox').click();
            return item.classList.contains('awg-filter-hidden') || !item.querySelector('.awg-filter-checkbox').checked;
        }"""
    )
    assert hidden
    page.wait_for_timeout(300)
    after = page.locator("canvas.awg3-canvas").screenshot()
    assert _pixels(page, before, after)["changed"] > 50, "the hub and its edges are gone from the scene"
    page.mouse.move(*spot)
    page.wait_for_timeout(100)
    assert page.evaluate("(i) => window.mounts[i].model.get('hovered_node')", index) is None
    assert not page.locator(".awg3-tooltip").is_visible()
    assert page.errors == []


def test_3d_view_append_keeps_what_is_drawn_in_place(page, site):
    """Graph.append in the 3D view adds the new node next to its neighbour; the nodes drawn before do not move and
    the camera stays."""
    index = _mount(page, {**_chain(12), "view": "3d", "show_labels": False, "show_axes": False, "show_grid": False})
    page.wait_for_timeout(4000)  # the layout settles
    before = page.locator("canvas.awg3-canvas").screenshot()
    # What Graph.append syncs: the merged nodes and edges, and the batch
    page.evaluate(
        """(i) => {
            const model = window.mounts[i].model;
            const node = { id: "new", label: "New" }, edge = { source: "n0", target: "new" };
            model.set("nodes", [...model.get("nodes"), node]);
            model.set("edges", [...model.get("edges"), edge]);
            model.set("append_batch", { seq: 1, nodes: [node], edges: [edge] });
        }""",
        index,
    )
    page.wait_for_timeout(500)
    after = page.locator("canvas.awg3-canvas").screenshot()
    pixels = _pixels(page, before, after)
    # Only the new node and its edge are new; a fresh layout would move every node
    assert pixels["changed"] < pixels["painted"] * 0.35, pixels
    assert page.locator(".awg-count-badge").first.text_content() == "13 nodes · 12 edges"
    assert page.errors == []


def test_the_3d_html_export_draws_the_scene_offline(page, export_dir):
    """Graph3D's save_html writes a page that draws the Three.js scene with no network and no page error."""
    from anywidget_graph import Graph3D

    star = _star3d()
    graph = Graph3D(nodes=star["nodes"], edges=star["edges"], layout="preset")
    path = export_dir / "export3d.html"
    graph.save_html(str(path), title="Scene")
    outside: list[str] = []
    page.on("request", lambda request: None if request.url.startswith("file:") else outside.append(request.url))
    page.goto(path.as_uri())
    page.wait_for_timeout(800)
    assert page.title() == "Scene"
    assert page.locator("canvas.awg3-canvas").count() == 1
    assert _pixels(page, page.locator("canvas.awg3-canvas").screenshot())["painted"] > 500
    # Hover and click work on the page's own model
    page.mouse.move(*_canvas_centre(page))
    assert "Hub node" in (page.locator(".awg3-tooltip").text_content() or "")
    assert outside == []
    assert page.errors == []


def test_the_html_export_draws_parallel_edges_numeric_ids_and_skips_dangling_edges(page, export_dir):
    """The export page draws what the widget draws: two edges between the same nodes, numeric ids, and an edge to a
    node that is not in the data skipped, instead of a blank page."""
    graph = Graph(
        nodes=[{"id": 1, "label": "One"}, {"id": 2, "label": "Two"}, {"id": "c", "label": "Three"}],
        edges=[
            {"source": 1, "target": 2, "label": "A"},
            {"source": 1, "target": 2, "label": "B"},
            {"source": 2, "target": "c"},
            {"source": "c", "target": "missing"},
        ],
    )
    path = export_dir / "export.html"
    graph.save_html(str(path))
    page.goto(path.as_uri())
    page.wait_for_timeout(800)
    assert page.errors == []
    drawn = page.evaluate("() => document.querySelectorAll('#container canvas').length")
    assert drawn > 0
