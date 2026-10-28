"""Browser tests: the bundled front end mounted in Chromium through a plain model (no Python, no notebook), the way an
app hosts it. They need Playwright and its Chromium (`uv run --with playwright python -m playwright install chromium`)
and are skipped without them; CI runs them in their own job."""

from __future__ import annotations

import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api")

# The host page: mount(values) renders the widget into a new pane with a model that fires change events inside set,
# as anywidget's does, and counts its listeners; destroy() runs the widget's cleanup
HOST_PAGE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>host</title>
<link rel="stylesheet" href="widget.css">
<style>body { margin: 0; background: #ffffff; } .pane { width: 900px; height: 520px; }</style>
</head>
<body>
<script type="module">
import widget from "./widget.mjs";
window.widget = widget;
window.mounts = [];
window.mount = (values, { width = 900, height = 520, paneTheme } = {}) => {
  const handlers = new Map();
  const model = {
    values,
    get: (key) => values[key],
    set: (key, value) => {
      if (values[key] === value) return;
      values[key] = value;
      (handlers.get(`change:${key}`) || []).slice().forEach((callback) => callback());
    },
    on: (event, callback) => handlers.set(event, [...(handlers.get(event) || []), callback]),
    off: (event, callback) => handlers.set(event, (handlers.get(event) || []).filter((c) => c !== callback)),
    save_changes() {},
    send() {},
    listeners: () => [...handlers.values()].reduce((n, list) => n + list.length, 0),
  };
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.style.width = width + "px";
  pane.style.height = height + "px";
  if (paneTheme) pane.dataset.theme = paneTheme;
  document.body.appendChild(pane);
  const destroy = widget.render({ model, el: pane });
  window.mounts.push({ model, pane, destroy });
  return window.mounts.length - 1;
};
window.ready = true;
</script>
</body>
</html>
"""


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return None


@pytest.fixture(scope="session")
def site(tmp_path_factory: pytest.TempPathFactory):
    """A local server for the bundle, its CSS and the host page; yields its base URL."""
    from anywidget_graph.ui import get_css, get_esm

    root = tmp_path_factory.mktemp("site")
    (root / "widget.mjs").write_text(get_esm(), encoding="utf-8")
    (root / "widget.css").write_text(get_css(), encoding="utf-8")
    (root / "host.html").write_text(HOST_PAGE, encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_QuietHandler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", root
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_api.sync_playwright() as playwright:
        try:
            chromium = playwright.chromium.launch()
        except Exception as error:  # Chromium not installed: the suite is skipped, as without Playwright
            pytest.skip(f"Chromium for Playwright is not installed: {error}")
        yield chromium
        chromium.close()


@pytest.fixture
def page(browser, site):
    """A fresh page on the host, with the page errors it raises in `page.errors`."""
    base, _root = site
    context = browser.new_context(viewport={"width": 1200, "height": 900})
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.errors = errors
    page.goto(f"{base}/host.html")
    page.wait_for_function("window.ready")
    yield page
    context.close()


def find_on_canvas(page, wrapper: int, wanted, step: int = 8):
    """Move the pointer over a widget's canvas until the tooltip shows text `wanted` accepts; its (x, y) or None."""
    box = page.locator(".awg-wrapper").nth(wrapper).locator(".awg-graph-container, canvas").first.bounding_box()
    tip = page.locator(".awg-wrapper").nth(wrapper).locator(".awg-tooltip")
    y = box["y"] + 4
    while y < box["y"] + box["height"] - 4:
        x = box["x"] + 4
        while x < box["x"] + box["width"] - 4:
            page.mouse.move(x, y)
            if tip.is_visible() and wanted(tip.text_content() or ""):
                return x, y
            x += step
        y += step
    return None


@pytest.fixture
def export_dir(tmp_path: Path) -> Path:
    return tmp_path
