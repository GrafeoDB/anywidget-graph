// The bundled graph libraries under the names the modules use. vendor/graph-libs.min.js is a script that ui/__init__.py
// puts in front of the widget's module, where it defines anywidgetGraphVendor (the widget needs no CDN for them).
export const { Graph, Sigma, circular, random, forceAtlas2, d3Force } = anywidgetGraphVendor;
