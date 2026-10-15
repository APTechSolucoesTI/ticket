// Compiled application with isolated APIs, fixed clock and mixed financial periods.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir = "apps/web/.output/server/_ssr";
const source = readFileSync(`${dir}/${readdirSync(dir).find(f => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "af300000-0000-4000-8000-000000000001";
const entries = [
  ["OUT-AGENDADO", "2026-10-01", "2026-11-15", "scheduled", 100],
  ["OUT-PAGO", "2026-10-01", "2026-10-05", "paid", 40],
  ["OUT-ATRASADO", "2026-10-01", "2026-10-10", "scheduled", 70],
  ["SET-AGENDADO", "2026-09-01", "2026-12-15", "scheduled", 150],
  ["DEZ-APROVADO", "2026-12-01", "2027-01-15", "approved", 220],
  ["DEZ-2025-PAGO", "2025-12-01", "2025-12-15", "paid", 60],
].map(([document_number, cycle_start, due_date, status, total_amount], index) => ({ id: `entry-${index}`, operating_company_id: operator, supplier_id: "supplier", supplier_contract_id: null, origin_type: "manual", document_number, description: `Documento ${document_number}`, cycle_start, cycle_end: `${cycle_start.slice(0, 7)}-28`, due_date, status, total_amount, allocation_status: "complete", terms_snapshot: { supplier_name: "Fornecedor teste" } }));
const forecasts = [["Previsão Outubro", "2026-10-01", 30], ["Previsão Setembro", "2026-09-01", 45], ["Previsão Dezembro", "2026-12-01", 65]].map(([description, competence, total_amount], index) => ({ id: `forecast-${index}`, operating_company_id: operator, fixed_payable_id: `template-${index}`, supplier_id: "supplier", supplier_name: "Fornecedor teste", description, competence, due_date: `${competence.slice(0, 7)}-20`, status: "forecast", total_amount, category_allocations: [], cost_center_allocations: [], revision: 0 }));
const names = [...entries.map(entry => entry.document_number), ...forecasts.map(item => item.description)];
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4174", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "payable-filters-isolated-test-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4174")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  mkdirSync("artifacts/payable-mutations", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1914, 1440, 768, 390]) {
    const errors = [];
    let readOnly = false;
    const height = width === 1914 ? 907 : 1000;
    const page = await browser.newPage({ viewport: { width, height }, timezoneId: "America/Sao_Paulo" }); active = page;
    await page.clock.setFixedTime("2026-10-15T12:00:00Z");
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "af200000-0000-4000-8000-000000000001", tenant_id: "af100000-0000-4000-8000-000000000001", name: "Teste", email: "test@example.test", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async route => {
      const url = route.request().url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["financeiro", "financeiro_contas_pagar", "financeiro_contas_fixas"].flatMap(module => ["view", ...(readOnly ? [] : ["edit"])].map(action => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: operator, legal_name: "APTech" }] });
      if (url.includes("/rest/v1/supplier_payables")) return route.fulfill({ json: entries });
      if (url.includes("/rest/v1/fixed_payable_occurrences")) return route.fulfill({ json: forecasts });
      if (url.includes("/rest/v1/rpc/get_financial_settings")) return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4174")) return route.fulfill({ json: [] });
      return route.continue();
    });
    const competence = page.getByRole("combobox", { name: "Competência", exact: true });
    const status = page.getByRole("combobox", { name: "Status", exact: true });
    const search = page.getByRole("textbox", { name: "Buscar documento, fornecedor ou contrato", exact: true });
    const popup = label => page.getByRole("dialog", { name: `${label} - opções`, exact: true });
    async function select(label, options) {
      await page.getByRole("combobox", { name: label, exact: true }).click();
      for (const name of options) await popup(label).getByRole("option", { name, exact: true }).click();
      await popup(label).getByRole("button", { name: "Concluir", exact: true }).click();
      await popup(label).waitFor({ state: "hidden" });
    }
    async function shown(expected) {
      if (expected.length) await page.getByText(expected[0], { exact: true }).waitFor();
      else await page.getByText("Nenhum lançamento encontrado", { exact: true }).waitFor();
      for (const name of names) assert.equal(await page.getByText(name, { exact: true }).count(), expected.includes(name) ? 1 : 0, `${name} at ${width}px`);
    }
    async function totals(actual, forecast) {
      for (const [label, amount] of [["A pagar · títulos confirmados", actual], ["Previsto · contas fixas", forecast]]) {
        const summary = page.locator("div.rounded-lg").filter({ has: page.getByText(label, { exact: true }) });
        await summary.getByText(new RegExp(`${amount},00`)).waitFor();
      }
    }
    const current = ["OUT-AGENDADO", "OUT-PAGO", "OUT-ATRASADO", "Previsão Outubro"];
    await page.goto("http://127.0.0.1:4174/finance/payables");
    await competence.filter({ hasText: "outubro de 2026" }).waitFor();
    await shown(current); await totals(170, 30);
    const heading = page.getByRole("heading", { name: "Contas a pagar", exact: true });
    const header = page.locator("header").filter({ has: heading });
    assert.equal(await header.getByRole("link", { name: "Contas fixas", exact: true }).getAttribute("href"), "/finance/payables/fixed");
    const types = header.getByRole("button", { name: "Tipos de documento", exact: true });
    assert.equal(await types.count(), 1);
    assert.equal(await heading.evaluate(el => getComputedStyle(el).fontSize), "14px");
    assert.equal(await types.evaluate(el => getComputedStyle(el).fontSize), "12px");
    assert.equal(await search.evaluate(el => getComputedStyle(el).fontSize), "12px");
    assert.equal(await competence.evaluate(el => getComputedStyle(el).fontSize), "12px");
    const headerBounds = await header.boundingBox();
    assert.ok(headerBounds.x >= 0 && headerBounds.x + headerBounds.width <= width + 1);
    await types.click();
    const documentTypes = page.getByRole("dialog", { name: "Tipos de documento", exact: true });
    await documentTypes.waitFor();
    await documentTypes.press("Escape");
    await documentTypes.waitFor({ state: "hidden" });
    await page.screenshot({ path: `artifacts/payable-mutations/payable-layout-${width}.png`, animations: "disabled" });
    await competence.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/payable-mutations/filters-${width}.png`, animations: "disabled" });
    await competence.click();
    assert.equal(await popup("Competência").getByRole("option", { name: "outubro de 2026", exact: true }).getAttribute("aria-checked"), "true");
    await page.getByRole("combobox", { name: "Buscar competência", exact: true }).fill("09/2026");
    await popup("Competência").getByRole("option", { name: "setembro de 2026", exact: true }).click();
    assert.equal(await popup("Competência").isVisible(), true);
    await page.getByRole("combobox", { name: "Buscar competência", exact: true }).fill("");
    await page.screenshot({ path: `artifacts/payable-mutations/competence-multiple-${width}.png`, animations: "disabled" });
    const bounds = await popup("Competência").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
    await popup("Competência").getByRole("button", { name: "Concluir", exact: true }).click();
    assert.match(await competence.innerText(), /2 opções selecionadas/);
    await shown([...current, "SET-AGENDADO", "Previsão Setembro"]); await totals(320, 75);
    await select("Status", ["Agendado", "Pago", "Previsão"]);
    assert.match(await status.innerText(), /3 opções selecionadas/);
    await shown(["OUT-AGENDADO", "OUT-PAGO", "SET-AGENDADO", "Previsão Outubro", "Previsão Setembro"]); await totals(250, 75);
    await select("Status", ["Todos os status"]);
    await select("Competência", ["Todas as competências"]);
    await shown(names); await totals(540, 140);
    await select("Status", ["Atrasado"]); await shown(["OUT-ATRASADO"]); await totals(70, 0);
    await select("Status", ["Todos os status"]);
    await select("Competência", ["dezembro de 2025"]); await shown(["DEZ-2025-PAGO"]);
    await select("Status", ["Aprovado"]); await shown([]);
    await select("Status", ["Todos os status"]);
    await select("Competência", ["dezembro de 2025"]); // Removing the last selection restores all periods.
    await shown(names);
    await search.fill("OUT-AGENDADO"); await shown(["OUT-AGENDADO"]); await search.fill("");
    await page.getByRole("combobox", { name: "Tipo de lançamento", exact: true }).click();
    await page.getByRole("option", { name: "Somente previsões", exact: true }).click();
    await shown(forecasts.map(item => item.description));
    await competence.press("ArrowDown");
    await page.getByRole("combobox", { name: "Buscar competência", exact: true }).fill("10/2026");
    await page.getByRole("combobox", { name: "Buscar competência", exact: true }).press("Enter");
    await page.getByRole("combobox", { name: "Buscar competência", exact: true }).press("Escape");
    await popup("Competência").waitFor({ state: "hidden" });
    assert.equal(await competence.evaluate(el => el === document.activeElement), true);
    await shown(["Previsão Outubro"]);
    await page.clock.setFixedTime("2026-11-01T01:30:00Z"); // Still October in São Paulo.
    readOnly = true; await page.reload();
    await competence.filter({ hasText: "outubro de 2026" }).waitFor();
    await shown(current);
    assert.match(await status.innerText(), /Todos os status/);
    assert.equal(await page.getByRole("button", { name: "Nova conta", exact: true }).count(), 0);
    await select("Competência", ["Todas as competências"]);
    await select("Status", ["Pago", "Aprovado"]);
    await shown(["OUT-PAGO", "DEZ-APROVADO", "DEZ-2025-PAGO"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS payable competence default/local month, multi months/status, all/reset, cross-year, forecasts, overdue, totals, search, keyboard, readonly at ${width}px`);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/payable-mutations/filters-failure.png" }); } throw error; }
finally { await browser?.close(); app.kill(); }
