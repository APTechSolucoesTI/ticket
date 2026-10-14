// Real frontend with isolated APIs. Database behavior is covered by pgTAP.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
const source = readFileSync(`${directory}/${readdirSync(directory).find((file) => file.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "fe300000-0000-4000-8000-000000000001";
const tenant = "fe100000-0000-4000-8000-000000000001";
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture-publishable", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", JWT_SECRET: "financial-settings-isolated-test-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  mkdirSync("artifacts/financial-settings", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    let settings = { use_payable_approvals: true, use_collection_rules: true };
    let failSave = false, readOnly = false, scheduled = null, payments = [];
    const writes = [], errors = [];
    const payable = { id: "fea00000-0000-4000-8000-000000000001", tenant_id: tenant, operating_company_id: operator, supplier_id: "fe800000-0000-4000-8000-000000000001", supplier_contract_id: null, origin_type: "manual", document_type_id: null, installment_number: null, installment_count: null, document_number: "PAG-TESTE", description: "Licenças de software", cycle_start: "2026-10-01", cycle_end: "2026-11-01", due_date: "2026-10-30", billing_unit: "fixed", measured_quantity: 1, unit_price: 80, total_amount: 80, allocation_status: "complete", status: "scheduled", terms_snapshot: { supplier_name: "Fornecedor teste" }, financial_category_id: null, cost_center_id: null, financial_category_name: null, cost_center_name: null };
    const page = await browser.newPage({ viewport: { width, height: 900 } }); active = page;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "fe200000-0000-4000-8000-000000000001", email: "teste@example.test", name: "Teste", tenant_id: "fe100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["configuracoes", "financeiro", "financeiro_contas_pagar", "financeiro_contas_receber"].flatMap((module) => ["view", "create", "edit", "delete"].filter((action) => !(readOnly && module === "configuracoes" && action !== "view")).map((action) => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rest/v1/rpc/get_financial_settings")) return route.fulfill({ json: settings });
      if (url.includes("/rest/v1/rpc/save_financial_settings")) {
        const value = request.postDataJSON(); writes.push(value);
        if (failSave) return route.fulfill({ status: 400, json: { code: "23514", message: "Falha simulada ao salvar configurações." } });
        settings = { use_payable_approvals: value.p_use_payable_approvals, use_collection_rules: value.p_use_collection_rules };
        return route.fulfill({ json: true });
      }
      if (url.includes("/rest/v1/rpc/schedule_supplier_payment")) {
        scheduled = request.postDataJSON(); payable.status = "approved";
        payments = [{ id: "payment", status: "scheduled", payment_method: "pix", scheduled_date: "2026-10-30", scheduled_amount: 80, scheduled_by_name: "Teste", scheduled_at: "2026-10-14T12:00:00Z", bank_snapshot: { label: "Principal", holder_name: "Fornecedor teste", holder_tax_id: "12345678000190", pix_key: "teste@example.test" }, reconciliation_status: "pending" }];
        return route.fulfill({ json: "payment" });
      }
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: tenant } });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: operator, legal_name: "APTech", trade_name: null }] });
      if (url.includes("/rest/v1/supplier_payables")) return route.fulfill({ json: [payable] });
      if (url.includes("/rest/v1/supplier_payments")) return route.fulfill({ json: payments });
      if (url.includes("/rest/v1/supplier_bank_accounts")) return route.fulfill({ json: [{ id: "bank", label: "Principal", holder_name: "Fornecedor teste", holder_tax_id: "12345678000190", is_default: true }] });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    async function visitSettings() {
      await page.goto("http://127.0.0.1:4173/settings");
      await page.getByRole("tab", { name: "Financeiro", exact: true }).click();
      await page.locator("#use-payable-approvals").waitFor();
    }
    async function choose(id, value) { await page.locator(`#${id}`).click(); await page.getByRole("option", { name: value, exact: true }).click(); }
    async function moduleState(enabled) {
      await page.goto("http://127.0.0.1:4173/finance/receivables");
      await page.getByRole("heading", { name: "Contas a receber", exact: true }).waitFor();
      if (enabled) await page.getByRole("button", { name: "Régua de cobrança", exact: true }).waitFor();
      else { await page.getByText(/Régua de cobrança desativada em Administração/).waitFor(); assert.equal(await page.getByRole("button", { name: "Régua de cobrança", exact: true }).count(), 0); }
      await page.goto("http://127.0.0.1:4173/finance/payables");
      await page.getByRole("button", { name: "Detalhar PAG-TESTE", exact: true }).waitFor();
      if (enabled) await page.getByRole("button", { name: "Alçadas", exact: true }).waitFor();
      else { await page.getByText(/Alçada de aprovação desativada/).waitFor(); assert.equal(await page.getByRole("button", { name: "Alçadas", exact: true }).count(), 0); }
      await page.getByRole("button", { name: "Detalhar PAG-TESTE", exact: true }).click();
      const dialog = page.getByRole("dialog");
      if (enabled) { await dialog.getByRole("button", { name: "Enviar para aprovação", exact: true }).waitFor(); assert.equal(await dialog.getByRole("button", { name: "Programar pagamento", exact: true }).count(), 0); }
      else { await dialog.getByRole("button", { name: "Programar pagamento", exact: true }).waitFor(); assert.equal(await dialog.getByRole("button", { name: "Enviar para aprovação", exact: true }).count(), 0); }
    }
    await moduleState(true);
    await visitSettings();
    const save = page.getByRole("button", { name: "Salvar configurações", exact: true });
    assert.equal(await save.isDisabled(), true);
    await choose("use-payable-approvals", "Não");
    await choose("use-collection-rules", "Não");
    failSave = true;
    await save.click();
    await page.getByText(/Um dos valores informados não atende às regras deste cadastro/).waitFor();
    assert.deepEqual(settings, { use_payable_approvals: true, use_collection_rules: true });
    assert.equal(await page.locator("#use-payable-approvals").innerText(), "Não");
    failSave = false;
    await save.click();
    await page.getByText("Configurações financeiras salvas.", { exact: true }).waitFor();
    assert.deepEqual(settings, { use_payable_approvals: false, use_collection_rules: false });
    await visitSettings();
    assert.equal(await page.locator("#use-payable-approvals").innerText(), "Não");
    assert.equal(await page.locator("#use-collection-rules").innerText(), "Não");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/financial-settings/settings-${width}.png`, fullPage: true });
    await moduleState(false);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Programar pagamento", exact: true }).click();
    await dialog.getByRole("button", { name: "Programar", exact: true }).click();
    await page.getByText("Pagamento programado.", { exact: true }).waitFor();
    assert.equal(scheduled.p_supplier_payable_id, payable.id);
    assert.equal(scheduled.p_bank_account_id, "bank");
    await visitSettings();
    await choose("use-collection-rules", "Sim");
    await save.click();
    await page.getByText("Configurações financeiras salvas.", { exact: true }).waitFor();
    assert.deepEqual(settings, { use_payable_approvals: false, use_collection_rules: true });
    await choose("use-payable-approvals", "Sim");
    await page.getByRole("button", { name: "Descartar alterações", exact: true }).click();
    assert.equal(await page.locator("#use-payable-approvals").innerText(), "Não");
    readOnly = true;
    await visitSettings();
    assert.equal(await page.locator("#use-payable-approvals").isDisabled(), true);
    assert.equal(await page.locator("#use-collection-rules").isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Salvar configurações", exact: true }).count(), 0);
    assert.equal(writes.length, 3);
    assert.deepEqual(errors, []);
    console.log(`PASS financial settings save/reload/error/readonly and payable/receivable behavior at ${width}px`);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/financial-settings/failure.png" }); } throw error; }
finally { await browser?.close(); app.kill(); }
