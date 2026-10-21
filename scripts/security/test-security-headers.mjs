import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { startLocalApp } from "./local-app.mjs";

const app = await startLocalApp();
try {
  const nonces = [];
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${app.origin}/auth`, { headers: { "x-apticket-csp-nonce": "attacker-controlled" } });
    assert.equal(response.status, 200, app.diagnostics());
    const policy = response.headers.get("content-security-policy");
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce && nonce !== "attacker-controlled");
    nonces.push(nonce);
    assert.ok(policy.includes("object-src 'none'") && policy.includes("frame-ancestors 'self'"));
    assert.ok(!policy.match(/script-src[^;]*'unsafe-(inline|eval)'/));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
    assert.ok(scripts.length > 0);
    for (const [, attributes] of scripts) assert.ok(attributes.includes(`nonce="${nonce}"`), attributes);
  }
  assert.notEqual(nonces[0], nonces[1], "never reuse HTML nonce across requests");
  const missing = await fetch(`${app.origin}/does-not-exist`);
  assert.equal(missing.headers.get("x-content-type-options"), "nosniff");
  if (process.env.APPSEC_BROWSER_MODULE) {
    const { chromium } = await import(pathToFileURL(process.env.APPSEC_BROWSER_MODULE).href);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.APPSEC_BROWSER_EXECUTABLE });
    try {
      const page = await browser.newPage();
      await page.route("**/*", route => route.request().url().startsWith(app.origin) ? route.continue() : route.abort());
      const violations = [];
      await page.exposeFunction("captureCspViolation", value => violations.push(value));
      await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.captureCspViolation({
        directive: event.effectiveDirective, source: event.sourceFile, line: event.lineNumber, blocked: event.blockedURI, sample: event.sample,
      })));
      await page.goto(`${app.origin}/auth`, { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: /Criar conta/ }).click();
      await page.getByLabel(/Seu nome/i).waitFor();
      assert.deepEqual(violations, [], "auth hydration and interactive controls must satisfy CSP");
      console.log("PASS Chromium: auth hydration and tab interaction under enforced nonce CSP");
    } finally { await browser.close(); }
  }
  console.log("PASS security headers: unique server nonce, scripts stamped, no inline/eval exemption, error coverage");
} finally { await app.close(); }
