// Embed the Paged.js polyfill source as a TS string so it can be injected into
// the hidden print webview at runtime (the bundled plugin ships no node_modules).
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const polyfill = join(here, "..", "node_modules", "pagedjs", "dist", "paged.polyfill.js");
const out = join(here, "..", "src", "pagedjs-bundle.ts");

let source = readFileSync(polyfill, "utf8");

// PATCH: Paged.js's Layout constructor reads `this.element.offsetParent.getBoundingClientRect()`
// unguarded. `offsetParent` is null for any element that is display:none (or an
// ancestor is) at layout time — which throws mid-pagination and makes Paged.js
// drop the surrounding content. Fall back to the parent/body so layout proceeds
// instead of crashing. This is THE fix for missing paragraphs on export.
const NEEDLE = "this.parentBounds = this.element.offsetParent.getBoundingClientRect();";
const PATCH =
  "this.parentBounds = (this.element.offsetParent || this.element.parentNode || this.element).getBoundingClientRect();";
if (!source.includes(NEEDLE)) {
  throw new Error("embed-pagedjs: offsetParent guard target not found — Paged.js internals changed; re-check the patch.");
}
source = source.replace(NEEDLE, PATCH);

// PATCH: Paged.js's overflow finder intentionally ignores floats when choosing
// the node where a page should break. Upstream issue #153 shows this causes
// floats near page ends to be clipped/truncated or missed. Paged.js footnotes
// use the same float-based machinery, so long footnote areas can make the
// body content render under the footnotes instead of being pushed to the next
// page. Treat floats like normal elements for overflow break detection.
const FLOAT_SKIP_NEEDLE = "if (!br && !isFloat && isElement(node)) {";
const FLOAT_SKIP_PATCH = "if (!br && isElement(node)) {";
if (!source.includes(FLOAT_SKIP_NEEDLE)) {
  throw new Error("embed-pagedjs: float-overflow target not found — Paged.js internals changed; re-check the patch.");
}
source = source.replace(FLOAT_SKIP_NEEDLE, FLOAT_SKIP_PATCH);

writeFileSync(
  out,
  `// AUTO-GENERATED from pagedjs/dist/paged.polyfill.js — do not edit by hand.\n` +
    `export const PAGEDJS_SOURCE = ${JSON.stringify(source)};\n`
);
console.log(`embedded pagedjs polyfill (${source.length} bytes, offsetParent-guard patched) -> src/pagedjs-bundle.ts`);
