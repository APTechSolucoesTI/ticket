// Exercise the real frontend and server functions against isolated HTTP fixtures.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const ownId = "ab200000-0000-4000-8000-000000000001";
const tenantId = "ab100000-0000-4000-8000-000000000001";
const secret = "profile-photo-isolated-test-secret-not-used-in-production";
const profile = { id: ownId, tenant_id: tenantId, name: "Luiz Teste", email: "luiz@example.test", phone: null, avatar_url: null, is_active: true };
const other = { ...profile, id: "ab200000-0000-4000-8000-000000000002", avatar_url: "other-user-photo.png" };
const files = new Map();
let failUpload = false, failSave = false, image;
const writes = [];
const fixtures = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const url = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const json = (data, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
  if (pathname === "/rest/v1/profiles") {
    const matches = url.searchParams.get("id") === `eq.${ownId}` && (!url.searchParams.has("tenant_id") || url.searchParams.get("tenant_id") === `eq.${tenantId}`);
    if (request.method === "PATCH") {
      if (failSave) return json({ message: "Fixture failed update" }, 500);
      const conditions = url.searchParams.get("avatar_url");
      const compare = !conditions || (conditions === "is.null" ? profile.avatar_url === null : conditions === `eq.${profile.avatar_url}`);
      if (!matches || !compare) return json([]);
      const fields = JSON.parse(body.toString());
      writes.push({ id: url.searchParams.get("id"), tenant: url.searchParams.get("tenant_id"), fields });
      Object.assign(profile, fields);
    }
    const result = matches ? [profile] : [];
    return json(request.headers.accept?.includes("vnd.pgrst.object") ? result[0] ?? null : result);
  }
  if (pathname.startsWith("/rest/v1/rpc/")) return json([]);
  if (pathname.startsWith("/storage/v1/object/sign/")) {
    const key = pathname.slice("/storage/v1/object/sign/apticket-profile-avatars/".length);
    if (request.method === "POST") return json({ signedURL: `/object/sign/apticket-profile-avatars/${key}?token=fixture` });
    if (!files.has(key)) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" }); return response.end(files.get(key));
  }
  if (pathname === "/storage/v1/object/apticket-profile-avatars" && request.method === "DELETE") {
    const { prefixes } = JSON.parse(body.toString());
    for (const key of prefixes) { assert.ok(key.startsWith(`${tenantId}/${ownId}/`)); files.delete(key); }
    return json(prefixes.map((name) => ({ name })));
  }
  if (pathname.startsWith("/storage/v1/object/apticket-profile-avatars/") && request.method === "POST") {
    if (failUpload) return json({ message: "Fixture failed upload" }, 500);
    const key = pathname.slice("/storage/v1/object/apticket-profile-avatars/".length);
    assert.ok(key.startsWith(`${tenantId}/${ownId}/`));
    assert.deepEqual(body, image);
    files.set(key, body);
    return json({ Key: `apticket-profile-avatars/${key}`, Id: "fixture" });
  }
  return json([]);
});
await new Promise((resolve) => fixtures.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${fixtures.address().port}`;
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: fixtureUrl, SUPABASE_PUBLISHABLE_KEY: "fixture-publishable", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", JWT_SECRET: secret }, stdio: ["ignore", "pipe", "pipe"] });
let appLog = ""; app.stdout.on("data", (chunk) => appLog += chunk); app.stderr.on("data", (chunk) => appLog += chunk);
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch { /* Wait for local server startup. */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ sub: ownId, tenant_id: tenantId, name: profile.name, email: profile.email, role: "authenticated", aud: "authenticated", app: "apticket", exp: 4102444800 })).toString("base64url");
const token = `${header}.${payload}.${createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")}`;
mkdirSync("artifacts/profile-photo", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
let active;
try {
  for (const width of [1440, 768, 390]) {
    profile.avatar_url = null; profile.phone = null; files.clear(); failSave = false; failUpload = false;
    const page = await browser.newPage({ viewport: { width, height: 900 } }); active = page;
    const errors = []; let uploadRequest;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { if (request.postData()?.includes("imageBase64")) uploadRequest = request; });
    await page.addInitScript((token) => localStorage.setItem("apticket_session_token", token), token);
    await page.route("**/*", (route) => route.request().url().startsWith("http://127.0.0.1") ? route.continue() : route.fulfill({ json: [] }));
    await page.goto("http://127.0.0.1:4173/profile");
    await page.getByRole("button", { name: "Adicionar foto", exact: true }).waitFor();
    image = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#0792b4"; ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "#e6f7ff"; ctx.beginPath(); ctx.arc(128, 88, 38, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(128, 244, 88, Math.PI, 0); ctx.fill();
      return canvas.toDataURL("image/png").split(",")[1];
    }), "base64");
    const input = page.getByLabel("Escolher foto de perfil", { exact: true });
    await input.setInputFiles({ name: "invalid.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg />") });
    await page.getByRole("alert").filter({ hasText: "Escolha uma imagem JPG, PNG ou WebP." }).waitFor();
    await input.setInputFiles({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await page.getByRole("alert").filter({ hasText: "A foto deve ter no máximo 2 MB." }).waitFor();
    await input.setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "Salvar foto", exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(files.size, 0);
    await input.setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
    const phone = page.getByLabel("Telefone", { exact: true }); await phone.fill("5511999991234"); const draftPhone = await phone.inputValue();
    await page.getByRole("button", { name: "Salvar foto", exact: true }).click();
    await page.getByRole("button", { name: "Remover foto", exact: true }).waitFor();
    await page.getByAltText("Minha foto de perfil", { exact: true }).waitFor();
    assert.equal(files.size, 1); assert.ok(profile.avatar_url.startsWith(`${tenantId}/${ownId}/`));
    assert.equal(await phone.inputValue(), draftPhone, "saving photo retains unsaved contact edits");
    const first = profile.avatar_url;
    if (width === 1440) {
      const original = JSON.parse(uploadRequest.postData());
      function findUpload(value) { if (value?.p?.k?.includes("imageBase64")) return value.p; if (value && typeof value === "object") for (const entry of Object.values(value)) { const found = findUpload(entry); if (found) return found; } }
      const attack = structuredClone(original);
      const attackData = findUpload(attack);
      attackData.v[attackData.k.indexOf("imageBase64")].s = Buffer.from("<svg>disguised file</svg>").toString("base64");
      const headers = { ...uploadRequest.headers(), authorization: `Bearer ${token}` }; delete headers["content-length"]; delete headers.host;
      const response = await page.request.post(uploadRequest.url(), { headers, data: JSON.stringify(attack) });
      assert.match(await response.text(), /conteúdo/);
      assert.equal(profile.avatar_url, first); assert.equal(files.size, 1);
      const foreignUser = structuredClone(original); const foreignData = findUpload(foreignUser);
      foreignData.k.push("userId"); foreignData.v.push({ t: 1, s: other.id });
      const denied = await page.request.post(uploadRequest.url(), { headers, data: JSON.stringify(foreignUser) });
      assert.match(await denied.text(), /unrecognized_keys|Unrecognized key|userId/, "API rejects overriding authenticated identity");
      assert.equal(profile.avatar_url, first); assert.equal(files.size, 1);
      assert.equal(other.avatar_url, "other-user-photo.png");
    }
    await page.reload(); await page.getByRole("button", { name: "Remover foto", exact: true }).waitFor();
    await input.setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: image });
    failSave = true;
    await page.getByRole("button", { name: "Salvar foto", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Não foi possível salvar sua foto." }).waitFor();
    assert.equal(profile.avatar_url, first); assert.equal(files.size, 1, "failed DB write cleans uploaded file and preserves previous photo");
    failSave = false; await page.getByRole("button", { name: "Salvar foto", exact: true }).click();
    await page.getByRole("button", { name: "Remover foto", exact: true }).waitFor();
    assert.notEqual(profile.avatar_url, first); assert.equal(files.has(first), false); assert.equal(files.size, 1);
    await page.screenshot({ path: `artifacts/profile-photo/profile-${width}.png`, fullPage: true });
    assert.equal(await page.locator("body").evaluate((element) => element.scrollWidth > window.innerWidth), false);
    await page.getByRole("button", { name: "Remover foto", exact: true }).click();
    await page.getByRole("button", { name: "Adicionar foto", exact: true }).waitFor();
    assert.equal(profile.avatar_url, null); assert.equal(files.size, 0);
    failUpload = true; await input.setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "Salvar foto", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Não foi possível enviar a foto." }).waitFor();
    assert.equal(profile.avatar_url, null); assert.equal(files.size, 0); failUpload = false;
    assert.equal(other.avatar_url, "other-user-photo.png");
    assert.deepEqual(errors, []);
    console.log(`PASS profile photo preview, upload, replace, persistence, remove and failures ${width}px`);
    await page.close();
  }
  assert.ok(writes.every((write) => write.id === `eq.${ownId}` && write.tenant === `eq.${tenantId}`));
} catch (error) {
  if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/profile-photo/failure.png" }); }
  console.error(appLog); throw error;
} finally { await browser.close(); app.kill(); await new Promise((resolve) => fixtures.close(resolve)); }
