// The bundled graph libraries under the names the modules use. vendor/graph-libs.min.js is a script that
// ui/__init__.py puts in front of the widget's module, where it defines anywidgetGraphVendor (the widget needs
// no CDN for them). The types come from the same packages, at the versions scripts/vendor bundles.
import type GraphologyGraph from "graphology";
import type { Sigma as SigmaConstructor } from "sigma";
import type { createNodeBorderProgram as createNodeBorderProgramFn } from "@sigma/node-border";
import type { circular as circularLayout, random as randomLayout } from "graphology-layout";
import type forceAtlas2Layout from "graphology-layout-forceatlas2";
import type * as d3ForceTypes from "d3-force";

declare global {
  // eslint-disable-next-line no-var
  var anywidgetGraphVendor: {
    Graph: typeof GraphologyGraph;
    Sigma: typeof SigmaConstructor;
    createNodeBorderProgram: typeof createNodeBorderProgramFn;
    circular: typeof circularLayout;
    random: typeof randomLayout;
    forceAtlas2: typeof forceAtlas2Layout;
    d3Force: typeof d3ForceTypes;
  };
}

export const { Graph, Sigma, createNodeBorderProgram, circular, random, forceAtlas2, d3Force } = anywidgetGraphVendor;
