// Real built application, synthetic identities and loopback APIs only.
// PLAYWRIGHT_MODULE: installed playwright-core directory; PLAYWRIGHT_CHROMIUM: browser executable.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { startLocalApp } from "./security/local-app.mjs";

const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = webRequire("typescript");
function loadTs(path) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: module.exports });
  return module.exports;
}
const { MODULE_ORDER } = loadTs("apps/web/src/lib/permission-catalog.ts");
const { SETTINGS_SECTIONS, visibleSettingsNavigation, canAccessSettingsSection } = loadTs("apps/web/src/lib/settings-navigation.ts");
const { chromium } = createRequire(import.meta.url)(resolve(process.env.PLAYWRIGHT_MODULE));
const screenshots = resolve(process.env.SETTINGS_SCREENSHOTS ?? join(tmpdir(), "apticket-settings-navigation"));
mkdirSync(screenshots, { recursive: true });
const tenantId = "fe100000-0000-4000-8000-000000000001";
const userId = "fe200000-0000-4000-8000-000000000001";
const roleId = "fe300000-0000-4000-8000-000000000001";
const profile = { id: userId, tenant_id: tenantId, name: "Admin de teste", email: "admin@example.test", is_active: true, session_version: 0, user_roles: { role_id: roleId } };
const roles = [{ id: roleId, name: "Admin", description: "Administrador", is_system: true, created_at: "2026-10-23T00:00:00Z" }];
const catalog = MODULE_ORDER.flatMap(({ key, actions }) => actions.map((action) => ({ id: "fe400000-0000-4000-8000-" + String(1).padStart(12, "0"), module: key, action })));
catalog.forEach((permission, index) => { permission.id = "fe400000-0000-4000-8000-" + String(index + 1).padStart(12, "0"); });
let mode = "admin";
const requests = [];
function allowed(module, action) {
  return mode === "admin" || (mode === "readonly" && ["configuracoes", "departamentos"].includes(module) && action === "view") ||
    (mode === "operator" && ["configuracoes", "empresa_operadora"].includes(module) && action === "view") ||
    (mode === "supplier" && module === "contratos_fornecedores" && action === "view") ||
    (mode === "no-root" && module === "departamentos" && action === "view");
}
function fixture(url) {
  requests.push(url.pathname);
  const resource = url.pathname.split("/").at(-1);
  if (resource === "get_effective_permissions") return catalog.map((p) => ({ ...p, effective: allowed(p.module, p.action), granted_by_role: true, override: null }));
  if (resource === "has_permission") return true;
  if (resource === "profiles") return url.searchParams.has("id") ? profile : [profile];
  if (resource === "roles") return url.searchParams.has("id") ? roles[0] : roles;
  if (resource === "permissions") return catalog;
  if (resource === "role_permissions") return catalog.map((p) => ({ permission_id: p.id }));
  if (resource === "tenants") return { id: tenantId, name: "Empresa de teste", slug: "fixture" };
  if (resource === "get_financial_settings") return { use_payable_approvals: false, use_collection_rules: false };
  return [];
}
const app = await startLocalApp((request, response) => {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fixture(new URL(request.url, "http://fixture.test"))));
});
const token = webRequire("jsonwebtoken").sign({ email: profile.email, name: profile.name, role: "authenticated", aud: "authenticated", app: "apticket", tenant_id: tenantId, session_version: 0 }, "isolated-security-test-jwt-key", { subject: userId, expiresIn: "1h" });
let browser, currentPage;
const errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM, headless: true });
  async function pageFor(width, height = 1000) {
    const context = await browser.newContext({ viewport: { width, height }, bypassCSP: true });
    await context.addInitScript((value) => localStorage.setItem("apticket_session_token", value), token);
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: fixture(url), headers: { "access-control-allow-origin": "*" } });
      if (url.origin === app.origin) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => errors.push(error.message));
    currentPage = page;
    return page;
  }
  const desktop = await pageFor(1440);
  await desktop.goto(app.origin + "/settings");
  await desktop.getByRole("heading", { name: "Configurações", exact: true }).waitFor();
  assert.equal(await desktop.locator('main a[href^="/settings/"]').count(), 16);
  await desktop.screenshot({ path: join(screenshots, "desktop-directory.png"), fullPage: true });
  // Every former tab is reachable as an independent, reloadable page.
  for (const section of Object.values(SETTINGS_SECTIONS)) {
    await desktop.goto(app.origin + section.path);
    await desktop.getByRole("heading", { level: 1, name: section.label, exact: true }).waitFor();
    await desktop.getByRole("navigation", { name: "Caminho das configurações" }).waitFor();
    assert.equal(await desktop.getByText("Sem acesso", { exact: true }).count(), 0);
  }
  await desktop.goto(app.origin + SETTINGS_SECTIONS.roles.path);
  assert.equal(await desktop.getByRole("link", { name: "Visão geral", exact: true }).getAttribute("aria-current"), null);
  await desktop.locator("main").getByRole("button", { name: /^Admin/ }).click();
  await desktop.locator("main").getByText("Contratos de fornecedores", { exact: true }).waitFor();
  assert.equal(await desktop.locator("main").getByRole("checkbox", { checked: false }).count(), 0);
  await desktop.screenshot({ path: join(screenshots, "desktop-roles.png"), fullPage: true });
  await desktop.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Parâmetros financeiros", exact: true }).click();
  await desktop.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Integrações bancárias", exact: true }).click();
  await desktop.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Banco Inter", exact: true }).click();
  await desktop.getByRole("heading", { level: 1, name: "Banco Inter", exact: true }).waitFor();
  await desktop.screenshot({ path: join(screenshots, "desktop-bank.png"), fullPage: true });
  await desktop.goBack();
  await desktop.getByRole("heading", { level: 1, name: "Papéis", exact: true }).waitFor();
  await desktop.goForward();
  await desktop.getByRole("heading", { level: 1, name: "Banco Inter", exact: true }).waitFor();
  await desktop.reload();
  await desktop.getByRole("heading", { level: 1, name: "Banco Inter", exact: true }).waitFor();
  console.log("PASS admin: 16 sections, nested banking menu, reload and browser history");
  await desktop.context().close();

  for (const [width, height] of [[820, 1180], [390, 844]]) {
    const page = await pageFor(width, height);
    await page.goto(app.origin + "/settings");
    await page.getByRole("heading", { name: "Configurações", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(screenshots, "directory-" + width + ".png"), fullPage: true });
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    const menu = page.getByRole("dialog");
    await menu.getByRole("button", { name: "Parâmetros financeiros", exact: true }).click();
    await menu.getByRole("button", { name: "Integrações bancárias", exact: true }).click();
    await menu.getByRole("link", { name: "Banco Inter", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, "menu-" + width + ".png") });
    await menu.getByRole("link", { name: "Banco Inter", exact: true }).click();
    await page.getByRole("heading", { level: 1, name: "Banco Inter", exact: true }).waitFor();
    await menu.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(screenshots, "bank-" + width + ".png"), fullPage: true });
    console.log("PASS responsive menu, group expansion and leaf closes drawer at " + width + "px");
    await page.context().close();
  }

  mode = "readonly";
  const readonly = await pageFor(1440);
  await readonly.goto(app.origin + "/settings");
  await readonly.getByRole("heading", { name: "Configurações", exact: true }).waitFor();
  assert.equal(await readonly.locator('main a[href^="/settings/"]').count(), 2);
  assert.equal(await readonly.locator("main").getByRole("heading", { name: "Integrações", exact: true }).count(), 0);
  await readonly.locator('main a[href="/settings/catalogs/departments"]').click();
  await readonly.getByRole("heading", { level: 1, name: "Departamentos", exact: true }).waitFor();
  assert.equal(await readonly.locator("main").getByRole("button", { name: /Novo|Adicionar/ }).count(), 0);
  requests.length = 0;
  await readonly.goto(app.origin + SETTINGS_SECTIONS.users.path);
  await readonly.getByText("Sem acesso", { exact: true }).waitFor();
  assert.equal(requests.includes("/rest/v1/roles"), false, "Unauthorized Users page must not mount its queries");
  await readonly.context().close();
  mode = "operator";
  const operator = await pageFor(1440);
  await operator.goto(app.origin + SETTINGS_SECTIONS["operating-companies"].path);
  await operator.getByRole("heading", { level: 1, name: "Empresa Operadora", exact: true }).waitFor();
  assert.equal(await operator.getByText("Sem acesso", { exact: true }).count(), 0);
  await operator.goto(app.origin + SETTINGS_SECTIONS.inter.path);
  await operator.getByText("Sem acesso", { exact: true }).waitFor();
  await operator.context().close();
  mode = "no-root";
  const blocked = await pageFor(1440);
  await blocked.goto(app.origin + SETTINGS_SECTIONS.departments.path);
  await blocked.getByText("Sem acesso", { exact: true }).waitFor();
  assert.equal(visibleSettingsNavigation((module) => allowed(module, "view")).length, 0);
  await blocked.context().close();
  mode = "supplier";
  const supplier = await pageFor(1440);
  await supplier.goto(app.origin + "/dashboard");
  await supplier.getByRole("button", { name: "Gestão", exact: true }).click();
  const contractMenu = supplier.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Contratos", exact: true });
  assert.equal(await contractMenu.getAttribute("href"), "/supplier-contracts");
  await supplier.context().close();
  assert.equal(canAccessSettingsSection("inter", (module) => module !== "financeiro"), false);
  assert.deepEqual(errors, []);
  console.log("PASS permissions: hidden empty groups, readonly, direct URL denied, operator independence, root guard and supplier menu regression");
  console.log("Screenshots: " + screenshots);
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: join(screenshots, "failure.png"), fullPage: true });
    console.error((await currentPage.locator("body").innerText()).slice(0, 4000));
  }
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
