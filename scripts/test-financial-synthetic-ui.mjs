// Real frontend with isolated API fixtures. SQL tests exercise the database rules.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
const source = readFileSync(`${directory}/${readdirSync(directory).find((file) => file.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "fb300000-0000-4000-8000-000000000001";
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], {
  env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture-publishable", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", JWT_SECRET: "synthetic-level-isolated-test-secret" },
  stdio: "ignore",
});
let browser, active;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  mkdirSync("artifacts/financial-synthetic", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) for (const kind of ["category", "cost_center"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    active = page;
    const errors = [], writes = [];
    const initial = [
      { id: "root", code: "10", name: "Grupo", classification_type: "synthetic" },
      { id: "second", code: "10.01", name: "Subgrupo", classification_type: "synthetic" },
      { id: "analytic", code: "10.01.0001", name: "Conta analítica", classification_type: "analytic" },
    ].map((item) => ({ ...item, operating_company_id: operator, direction: "both", description: null, is_global: false, is_active: true }));
    const rows = { category: structuredClone(initial), cost_center: structuredClone(initial) };
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "fb200000-0000-4000-8000-000000000001", email: "teste@example.test", name: "Teste", tenant_id: "fb100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["financeiro", "financeiro_fluxo_caixa"].flatMap((module) => ["view", "create", "edit", "delete"].map((action) => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: operator, legal_name: "Operadora teste", trade_name: null }] });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: "fb100000-0000-4000-8000-000000000001" } });
      if (url.includes("/rest/v1/rpc/save_financial_")) {
        const value = request.postDataJSON();
        const savedKind = url.includes("save_financial_category") ? "category" : "cost_center";
        writes.push({ kind: savedKind, ...value });
        const item = { id: value.p_id ?? `created-${writes.length}`, code: value.p_code, name: value.p_name, classification_type: value.p_classification_type, operating_company_id: operator, direction: value.p_direction ?? "both", description: value.p_description, is_global: value.p_is_global, is_active: value.p_is_active };
        rows[savedKind] = rows[savedKind].filter((row) => row.id !== item.id).concat(item).sort((a, b) => a.code.localeCompare(b.code));
        return route.fulfill({ json: item.id });
      }
      if (url.includes("/rest/v1/financial_categories")) return route.fulfill({ json: rows.category });
      if (url.includes("/rest/v1/financial_cost_centers")) return route.fulfill({ json: rows.cost_center });
      if (!url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4173/finance/cash-flow");
    await page.getByRole("combobox", { name: "Empresa operadora", exact: true }).click();
    await page.getByRole("option", { name: "Operadora teste", exact: true }).click();
    await page.getByRole("button", { name: "Classificações", exact: true }).click();
    const dialog = page.getByRole("dialog");
    if (kind === "cost_center") await dialog.getByRole("tab", { name: "Centros de custo", exact: true }).click();
    await dialog.getByRole("button", { name: "Adicionar abaixo de Subgrupo", exact: true }).click();
    const code = dialog.locator("#dimension-code"), name = dialog.locator("#dimension-name");
    const save = dialog.getByRole("button", { name: "Salvar", exact: true });
    assert.equal(await code.inputValue(), "10.01.0002");
    await name.fill("Sintética detalhada");
    await dialog.getByText("Tipo *", { exact: true }).locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Sintética", exact: true }).click();
    await code.fill("1001000");
    assert.equal(await save.isDisabled(), true);
    await code.fill("10010002");
    assert.equal(await save.isDisabled(), false);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    await page.screenshot({ path: `artifacts/financial-synthetic/${kind}-${width}.png` });
    await save.click();
    await code.waitFor({ state: "hidden" });
    if (kind === "cost_center") await dialog.getByRole("tab", { name: "Centros de custo", exact: true }).click();
    await dialog.getByText("Sintética detalhada", { exact: true }).waitFor();
    assert.equal(writes[0].p_code, "10.01.0002");
    assert.equal(writes[0].p_classification_type, "synthetic");
    assert.equal(await dialog.getByRole("button", { name: "Adicionar abaixo de Sintética detalhada", exact: true }).count(), 0);
    const row = dialog.getByText("Sintética detalhada", { exact: true }).locator("../..");
    assert.equal(await row.getByText("Sintética", { exact: true }).count(), 1);
    await dialog.getByRole("button", { name: "Editar Sintética detalhada", exact: true }).click();
    assert.equal(await code.inputValue(), "10.01.0002");
    await name.fill("Sintética editada");
    await save.click();
    await code.waitFor({ state: "hidden" });
    if (kind === "cost_center") await dialog.getByRole("tab", { name: "Centros de custo", exact: true }).click();
    await dialog.getByText("Sintética editada", { exact: true }).waitFor();
    assert.equal(writes[1].p_id, "created-1");
    assert.equal(writes[1].p_classification_type, "synthetic");
    await dialog.getByRole("button", { name: "Adicionar abaixo de Grupo", exact: true }).click();
    assert.equal(await code.inputValue(), "10.02");
    await name.fill("Sintética segundo nível");
    await save.click();
    await code.waitFor({ state: "hidden" });
    if (kind === "cost_center") await dialog.getByRole("tab", { name: "Centros de custo", exact: true }).click();
    await dialog.getByText("Sintética segundo nível", { exact: true }).waitFor();
    assert.equal(writes[2].p_classification_type, "synthetic");
    assert.equal(writes[2].p_code, "10.02");
    await dialog.getByRole("button", { name: "Recolher Grupo", exact: true }).click();
    assert.equal(await dialog.getByText("Sintética editada", { exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "Expandir Grupo", exact: true }).click();
    await dialog.getByText("Sintética editada", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${kind} synthetic second/third level create/edit/hierarchy at ${width}px`);
    await page.close();
  }
} catch (error) {
  if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/financial-synthetic/failure.png" }); }
  throw error;
} finally { await browser?.close(); app.kill(); }
