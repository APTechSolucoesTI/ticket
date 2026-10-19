import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = process.argv[2];
assert.ok(file, "Usage: node scripts/security/test-dependency-audit.mjs <pnpm-audit.json>");
const bytes = readFileSync(file);
const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8";
const audit = JSON.parse(bytes.toString(encoding).replace(/^\uFEFF/, ""));
assert.ok(audit.metadata?.vulnerabilities, "Audit must contain valid vulnerability metadata");
assert.equal(audit.metadata.vulnerabilities.critical, 0, "No critical dependency advisories permitted");
const advisories = Object.values(audit.advisories ?? {});
for (const module of ["@tanstack/react-start", "@tanstack/start-server-core", "proxy-addr",
  "shell-quote", "handlebars", "undici", "seroval", "engine.io", "dompurify"]) {
  assert.ok(!advisories.some(advisory => (advisory.module ?? advisory.module_name) === module),
    `Patched dependency must not retain a known advisory: ${module}`);
}
console.log("PASS patched dependency advisories and zero critical findings");
