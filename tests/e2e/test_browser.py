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
