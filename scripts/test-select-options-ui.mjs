// Real application with isolated APIs: checks sorting and native mouse-wheel scrolling.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
const source = readFileSync(`${directory}/${readdirSync(directory).find(file => file.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const names = ["Zulu", "Évora", "beta", "Ágil", ...Array.from({ length: 40 }, (_, i) => `Empresa ${40 - i}`)];
const companies = names.map((name, i) => ({ id: `company-${i}`, name, legal_name: name, trade_name: name }));
const sortedNames = [...names].sort(new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare);
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], {
  env: { ...process.env, PORT: "4177", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "select-options-isolated-test-secret" },
  stdio: "ignore",
});
let browser, active;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch("http://127.0.0.1:4177")).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  mkdirSync("artifacts/searchable-select", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    active = page;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "ae200000-0000-4000-8000-000000000001", tenant_id: "ae100000-0000-4000-8000-000000000001", name: "Teste", email: "test@example.test", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId)
        ? ["financeiro", "financeiro_contas_pagar", "contatos", "tickets"].flatMap(module => ["view", "create", "edit"].map(action => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rpc/get_financial_settings")) return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: "operator", legal_name: "APTech" }] });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: "ae100000-0000-4000-8000-000000000001" } });
      if (url.includes("/rest/v1/companies") || url.includes("/rest/v1/suppliers")) return route.fulfill({ json: companies });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4177")) return route.fulfill({ json: [] });
      return route.continue();
    });
    async function wheel(list, name) {
      await list.hover();
      await page.waitForTimeout(200);
      await list.evaluate(el => { el.scrollTop = 0; });
      const ancestors = () => page.locator('[role="dialog"]').evaluateAll(elements => elements.map(el => el.scrollTop));
      const before = await ancestors();
      const bodyBefore = await page.evaluate(() => window.scrollY);
      await page.mouse.wheel(0, 420);
      await page.waitForFunction(() => document.querySelector('[role="listbox"]')?.scrollTop > 0);
      const after = await list.evaluate(el => el.scrollTop);
      assert.ok(after > 0, `${name}: wheel scrolls down`);
      assert.deepEqual(await ancestors(), before, `${name}: parent dialog stays still`);
      assert.equal(await page.evaluate(() => window.scrollY), bodyBefore, `${name}: page stays still`);
      await page.screenshot({ path: `artifacts/searchable-select/wheel-${name}-${width}.png`, animations: "disabled" });
      await page.mouse.wheel(0, -420);
      await page.waitForFunction(previous => document.querySelector('[role="listbox"]')?.scrollTop < previous, after);
    }
    async function ordered(list, expected) {
      const labels = await list.getByRole("option").allTextContents();
      assert.deepEqual(labels.map(label => label.trim()), expected);
    }

    await page.goto("http://127.0.0.1:4177/finance/payables");
    await page.getByRole("button", { name: "Nova conta", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nova conta a pagar", exact: true });
    await dialog.locator("#manual-entry-counterparty").click();
    const list = page.getByRole("listbox");
    await list.getByRole("option", { name: "Zulu", exact: true }).waitFor();
    // Wheel first so the old modal/portal bug is caught independently of ordering.
    await wheel(list, "single-in-dialog");
    await ordered(list, sortedNames);
    const search = page.getByRole("combobox", { name: "Buscar opções", exact: true });
    await search.fill("empresa");
    await ordered(list, sortedNames.filter(name => name.startsWith("Empresa")));
    await search.fill("agil");
    await search.press("Enter");
    await page.getByRole("dialog", { name: "Selecionar opção", exact: true }).waitFor({ state: "hidden" });
    assert.match(await dialog.locator("#manual-entry-counterparty").innerText(), /Ágil/);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();

    await page.getByRole("combobox", { name: "Status", exact: true }).click();
    const statuses = await list.getByRole("option").allTextContents();
    assert.equal(statuses[0].trim(), "Todos os status");
    const statusNames = statuses.slice(1).map(name => name.trim());
    assert.deepEqual(statusNames, [...statusNames].sort(new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare));
    await wheel(list, "multiple-filter");
    await page.getByRole("option", { name: "Pago", exact: true }).click();
    assert.equal(await page.getByRole("option", { name: "Pago", exact: true }).getAttribute("aria-checked"), "true");
    await page.getByRole("button", { name: "Concluir", exact: true }).click();

    await page.goto("http://127.0.0.1:4177/contacts");
    await page.getByRole("button", { name: "Novo contato", exact: true }).click();
    await page.locator("#contact-companies").click();
    await list.getByRole("option", { name: "Zulu", exact: true }).waitFor();
    await wheel(list, "contact-in-dialog");
    await ordered(list, sortedNames);
    const clientSearch = page.getByRole("combobox", { name: "Buscar cliente", exact: true });
    await clientSearch.fill("empresa");
    await ordered(list, sortedNames.filter(name => name.startsWith("Empresa")));
    await clientSearch.fill("agil");
    await list.getByRole("option", { name: "Ágil", exact: true }).click();
    await clientSearch.fill("Zulu");
    await list.getByRole("option", { name: "Zulu", exact: true }).click();
    await page.getByRole("button", { name: "Concluir", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Definir Ágil como cliente principal", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("button", { name: "Definir Zulu como cliente principal", exact: true }).getAttribute("aria-pressed"), "false");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS wheel down/up without moving parent, Portuguese A–Z and numeric order, filtered order, keyboard, multiple selection and primary client at ${width}px`);
    await page.close();
  }
} catch (error) {
  if (active) await active.screenshot({ path: "artifacts/searchable-select/wheel-sort-failure.png" });
  throw error;
} finally { await browser?.close(); app.kill(); }
