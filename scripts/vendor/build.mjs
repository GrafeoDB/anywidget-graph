// Bundle the libraries into scripts the widget inlines, and collect the licenses of every bundled package:
// entry.mjs -> ui/vendor/graph-libs.min.js (graphology, sigma, ...; global anywidgetGraphVendor) and
// entry-3d.mjs -> ui/vendor/three.min.js (Three.js + OrbitControls for the 3D view; global anywidgetGraph3dVendor).
// Run after `npm ci` in this folder: npm run build
import { build } from "esbuild";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "src", "anywidget_graph", "ui", "vendor");

async function bundle(entry, globalName, outfile, licenseFile) {
  const result = await build({
    entryPoints: [join(here, entry)],
    bundle: true,
    format: "iife",
    globalName,
    minify: true,
    legalComments: "none",
    target: "es2020",
    metafile: true,
    outfile: join(out, outfile),
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
    join(out, licenseFile),
    `Licenses of the packages bundled in ${outfile} (built by scripts/vendor)\n\n${sections.join("\n")}`,
  );
  console.log(`${outfile}: ${[...packages.keys()].sort().join(", ")}`);
}

await bundle("entry.mjs", "anywidgetGraphVendor", "graph-libs.min.js", "graph-libs.LICENSES.txt");
await bundle("entry-3d.mjs", "anywidgetGraph3dVendor", "three.min.js", "three.LICENSES.txt");
