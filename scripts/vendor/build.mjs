// Bundle the graph libraries into one script the widget inlines, and collect the licenses of every bundled package.
// Run after `npm ci` in this folder: npm run build
import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "src", "anywidget_graph", "ui", "vendor");

const result = await build({
  entryPoints: [join(here, "entry.mjs")],
  bundle: true,
  format: "iife",
  globalName: "anywidgetGraphVendor",
  minify: true,
  legalComments: "none",
  target: "es2020",
  metafile: true,
  outfile: join(out, "graph-libs.min.js"),
});

// Every package that ended up in the bundle, with its license text
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(input);
  if (match) packages.set(match[1].replace("\\", "/"), true);
}
const sections = [...packages.keys()].sort().map((name) => {
  const folder = join(here, "node_modules", name);
  const { version, license } = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  const file = readdirSync(folder).find((f) => /^licen[cs]e/i.test(f));
  const text = file ? readFileSync(join(folder, file), "utf8").trim() : `(no license file; package.json says ${license})`;
  return `== ${name}@${version} (${license})\n\n${text}\n`;
});
writeFileSync(
  join(out, "graph-libs.LICENSES.txt"),
  `Licenses of the packages bundled in graph-libs.min.js (built by scripts/vendor)\n\n${sections.join("\n")}`,
);
console.log(`graph-libs.min.js: ${[...packages.keys()].sort().join(", ")}`);
