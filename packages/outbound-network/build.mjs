import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

// The ESM source serves Nitro; generated CJS serves Nest/Jest. No runtime build
// or dependency install is needed. CI refuses drift between the two formats.
const source = readFileSync(new URL("./index.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const generated = "// Generated from index.mjs by build.mjs. Edit the ESM source.\n" + source
  .replace(/^import \* as (\w+) from "(node:[^"]+)";$/gm, 'const $1 = require("$2");')
  .replace(/^import \{ ([\w, ]+) \} from "(node:[^"]+)";$/gm, 'const { $1 } = require("$2");')
  .replace(/^export \{([\s\S]*?)\};\s*$/m, "Object.assign(exports, {$1});\n");
assert.ok(!/^import |^export /m.test(generated), "Unsupported module syntax in ESM source");
if (process.argv.includes("--check")) {
  assert.equal(readFileSync(new URL("./index.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n"), generated,
    "Run node packages/outbound-network/build.mjs to refresh CommonJS");
} else writeFileSync(new URL("./index.cjs", import.meta.url), generated);
