// Real frontend with isolated APIs; no production financial writes.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir = "apps/web/.output/server/_ssr";
const source = readFileSync(`${dir}/${readdirSync(dir).find(f => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const companies = [1, 2].map(n => ({ id: `ac300000-0000-4000-8000-00000000000${n}`, legal_name: n === 1 ? "Operadora Alfa" : "Operadora Beta" }));
const rows = [1, 2, 3].map((n, index) => ({ id: `entry-${n}`, operating_company_id: companies[index]?.id ?? null, origin_type: n === 1 ? "manual" : n === 2 ? "recurring" : "measurement", documento_referencia: `DOC-${n}`, cliente_nome: `Cliente ${n}`, descricao: `Recebível da empresa ${n}`, competencia: "2026-10-01", vencimento_em: "2026-10-30", valor_total: n * 100, valor_aberto: n * 100, status_cobranca: "a_faturar", medicoes_contrato: null }));
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4174", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "receivable-company-isolated-test-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4174")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  mkdirSync("artifacts/entry-allocations", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    const errors = [], scopes = [];
    let readOnly = false, companyError = false, empty = false;
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); active = page;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "ac200000-0000-4000-8000-000000000001", tenant_id: "ac100000-0000-4000-8000-000000000001", name: "Teste", email: "test@example.test", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.includes("/_serverFn/")) return route.fulfill({ json: { result: url.pathname.includes(permissionsId) ? ["financeiro", "financeiro_contas_receber"].flatMap(module => ["view", ...(readOnly ? [] : ["edit"])].map(action => ({ module, action }))) : [], context: {} } });
      if (url.pathname === "/rest/v1/operating_companies") return route.fulfill(companyError ? { status: 400, json: { message: "Consulta de empresas indisponível" } } : { json: empty ? [] : companies });
      if (url.pathname === "/rest/v1/rpc/get_financial_settings") return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (url.pathname === "/rest/v1/contas_receber") {
        const scope = url.searchParams.get("operating_company_id"); scopes.push(scope);
        return route.fulfill({ json: scope ? rows.filter(row => `eq.${row.operating_company_id}` === scope) : rows });
      }
      if (url.pathname === "/rest/v1/tickets_cobranca_avulsa") return route.fulfill({ json: [{ id: "charge", ticket_id: "ticket", status_cobranca: "a_faturar", minutos_apurados: 20, valor_final: 50, valor_ajustado_manualmente: false, tickets: { id: "ticket", number: 400, subject: "Atendimento avulso geral", companies: { name: "Cliente avulso" } } }] });
      if (url.pathname.includes("/rest/v1/") || !request.url().startsWith("http://127.0.0.1:4174")) return route.fulfill({ json: [] });
      return route.continue();
    });
    const selector = page.getByRole("combobox", { name: "Empresa operadora", exact: true });
    const dialog = page.getByRole("dialog", { name: "Nova conta a receber", exact: true });
    async function choose(label) {
      await selector.click(); await page.getByRole("option", { name: label, exact: true }).click();
      await page.getByRole("dialog", { name: "Selecionar opção", exact: true }).waitFor({ state: "hidden" });
    }
    await page.goto("http://127.0.0.1:4174/finance/receivables");
    await selector.filter({ hasText: "Operadora Alfa" }).waitFor();
    await page.getByText("DOC-1", { exact: true }).waitFor();
    assert.equal(await page.getByText("DOC-2", { exact: true }).count(), 0);
    assert.equal(await page.getByText("DOC-3", { exact: true }).count(), 0);
    assert.ok(scopes.includes(`eq.${companies[0].id}`));
    await page.getByText(/1 lançamento\(s\).*100,00 em aberto/).waitFor();
    const selectorBounds = await selector.boundingBox();
    assert.ok(selectorBounds.y < 350 && selectorBounds.x >= 0 && selectorBounds.x + selectorBounds.width <= width + 1);
    await page.screenshot({ path: `artifacts/entry-allocations/receivable-company-card-${width}.png`, animations: "disabled" });
    await choose("Operadora Beta");
    await page.getByText("DOC-2", { exact: true }).waitFor();
    assert.equal(await page.getByText("DOC-1", { exact: true }).count(), 0);
    await page.getByText(/1 lançamento\(s\).*200,00 em aberto/).waitFor();
    assert.ok(scopes.includes(`eq.${companies[1].id}`));
    await page.getByRole("button", { name: "Nova conta", exact: true }).click();
    await dialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true }).getByText("Operadora Beta", { exact: true }).waitFor();
    assert.equal(await dialog.locator("#manual-entry-operator").isDisabled(), true);
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await choose("Todas as empresas");
    for (const row of rows) await page.getByText(row.documento_referencia, { exact: true }).waitFor();
    await page.getByText(/3 lançamento\(s\).*600,00 em aberto/).waitFor();
    assert.ok(scopes.includes(null));
    await page.getByRole("button", { name: "Nova conta", exact: true }).click();
    await dialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true }).getByText("Selecione a empresa operadora.", { exact: true }).waitFor();
    assert.equal(await dialog.locator("#manual-entry-operator").isEnabled(), true);
    await dialog.locator("#manual-entry-operator").click();
    await page.getByRole("option", { name: "Operadora Alfa", exact: true }).click();
    await dialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true }).getByText("Operadora Alfa", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByText("#400 Atendimento avulso geral", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    readOnly = true; await page.reload();
    await page.getByText("DOC-1", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Nova conta", exact: true }).count(), 0);
    await selector.waitFor();
    if (width === 1440) {
      companyError = true; await page.reload();
      await page.getByText("Empresas indisponíveis", { exact: true }).waitFor({ timeout: 20000 });
      assert.equal(await page.getByRole("button", { name: "Nova conta", exact: true }).count(), 0);
      companyError = false; await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
      await page.getByText("DOC-1", { exact: true }).waitFor();
      empty = true; await page.reload(); await page.getByText("Sem empresa operadora", { exact: true }).waitFor();
      assert.equal(await selector.isDisabled(), true);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS receivables company card, filter, totals, inherited company, all/legacy, permissions and states at ${width}px`);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/entry-allocations/receivable-company-failure.png" }); } throw error; }
finally { await browser?.close(); app.kill(); }
