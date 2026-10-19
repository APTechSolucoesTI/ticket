import assert from "node:assert/strict";
import { ESLint } from "eslint";

const lint = new ESLint({ overrideConfigFile: "eslint.security.config.mjs" });
const options = { filePath: "apps/api/src/security-lint-fixture.ts" };
const [unsafe] = await lint.lintText("eval(untrusted); new Buffer(untrusted);", options);
assert.ok(unsafe.messages.some(item => item.ruleId === "security/detect-eval-with-expression" && item.severity === 2));
assert.ok(unsafe.messages.some(item => item.ruleId === "security/detect-new-buffer" && item.severity === 2));
const [safe] = await lint.lintText("const bytes = Buffer.from('fixture');", options);
assert.equal(safe.errorCount, 0);
const [suppressed] = await lint.lintText("/* eslint-disable security/detect-eval-with-expression */\neval(untrusted);", options);
assert.ok(suppressed.messages.some(item => item.ruleId === "security/detect-eval-with-expression" && item.severity === 2));
console.log("PASS security lint rejects unsafe primitives and accepts safe construction");
