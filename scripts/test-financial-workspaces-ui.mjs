// Browser QA of the financial pages against isolated APIs; no production writes.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir = "apps/web/.output/server/_ssr";
const source = readFileSync(`${dir}/${readdirSync(dir).find(f => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const company = "af300000-0000-4000-8000-000000000001";
const companyName = "ALTA PERFORMANCE SOLUCOES EM TECNOLOGIA DA INFORMACAO LTDA";
const dimension = { financial_category_id: "category", financial_category_code: "01.01.0001", financial_category_name: "Serviços gerenciados MSP", cost_center_id: "center", cost_center_code: "01.01.0001", cost_center_name: "Operações e suporte técnico" };
const fixtures = {
  operating_companies: [{ id: company, legal_name: companyName }],
  operating_bank_accounts: [{ id: "bank", name: "Conta operacional", bank_name: "Inter", account_number: "123456-7", is_default: true }],
  bank_statement_transactions: [{ id: "transaction", posted_at: "2026-10-10", amount: 1500, memo: "Recebimento contrato de suporte", document_number: "MSP-001", reconciliation_status: "pending_review", difference_amount: null, ...dimension }],
  cash_flow_allocation_entries: [{ ...dimension, operating_company_id: company, source_id: "cash", source_type: "manual_receivable", document_number: "MSP-001", counterparty_name: "Cliente Tecnologia Ltda", description: "Serviços de monitoramento e suporte", competence: "2026-10-01", planned_date: "2026-10-20", realized_date: null, direction: "inflow", planned_amount: 1500, open_amount: 1500, realized_amount: 0, cash_status: "pending", source_status: "aberto" }],
  financial_budget_variance: [{ ...dimension, budget_entry_id: "budget", operating_company_id: company, period_month: "2026-10-01", direction: "inflow", budgeted_amount: 1500, planned_amount: 1500, realized_amount: 1200, variance_amount: -300, variance_percent: -20 }],
  contract_profitability: [{ operating_company_id: company, operating_company_name: companyName, contract_id: "contract", contract_number: "MSP-001", customer_name: "Cliente Tecnologia Ltda", period_month: "2026-10-01", gross_revenue: 1500, realized_revenue: 1200, allocated_cost: 800, gross_profit: 700, gross_margin_percent: 46.67 }],
  contract_mrr_projection: [{ operating_company_id: company, contract_id: "contract", contract_number: "MSP-001", customer_name: "Cliente Tecnologia Ltda", period_month: "2026-10-01", baseline_mrr: 1500, missing_value_version: false }],
  financial_management_statement: [{ ...dimension, operating_company_id: company, fiscal_year: 2026, fiscal_month: 10, period_month: "2026-10-01", direction: "inflow", result_group: "revenue", budgeted_result_amount: 1500, planned_result_amount: 1500, realized_result_amount: 1200 }],
  financial_period_closures: [{ id: "closure", period_month: "2026-09-01", revision: 1, status: "closed", revenue_realized: 1500, expense_realized: 800, result_realized: 700, result_budgeted: 700, snapshot_line_count: 2, closed_by_name: "Responsável financeiro", closed_at: "2026-10-01T12:00:00Z" }],
  fixed_payables: [{ id: "fixed", operating_company_id: company, supplier_name: "Imobiliária Centro", description: "Aluguel da sede", total_amount: 1500, due_day: 10, start_month: "2026-01-01", is_active: true, revision: 0, category_allocations: [], cost_center_allocations: [] }],
  fixed_payable_occurrences: [],
  contas_receber: [{ id: "receivable", operating_company_id: company, origin_type: "manual", documento_referencia: "MSP-001", descricao: "Serviços gerenciados", competencia: "2026-10-01", vencimento_em: "2026-10-20", valor_total: 1500, valor_aberto: 1500, status_cobranca: "a_faturar", cliente_nome: "Cliente Tecnologia Ltda", medicoes_contrato: null }],
  tickets_cobranca_avulsa: [{ id: "charge", ticket_id: "ticket", status_cobranca: "a_faturar", minutos_apurados: 60, valor_final: 150, tickets: { id: "ticket", number: 400, subject: "Suporte avulso", companies: { name: "Cliente Tecnologia Ltda" } } }],
};
const pages = [
  ["receivables", "Contas a receber", "MSP-001", "Nova conta", /Nova conta a receber/],
  ["payables/fixed", "Contas a pagar fixas", "Aluguel da sede", "Nova conta fixa", /Nova conta fixa/],
  ["banking", "Banco e conciliação", "Doc. MSP-001", "Conta", /Nova conta bancária/],
  ["cash-flow", "Fluxo de caixa", "MSP-001", "Classificações", /Classifica/],
  ["planning", "Planejamento", "Serviços gerenciados MSP", "Novo orçamento", /orçamento/i],
  ["analytics", "Resultados", "MSP-001"],
  ["closing", "Fechamento", "Revisão 1 · 2 linha(s)"],
];
const modules = ["financeiro", "financeiro_contas_receber", "financeiro_contas_pagar", "financeiro_contas_fixas", "financeiro_bancos", "financeiro_fluxo_caixa", "financeiro_planejamento", "financeiro_resultados", "financeiro_fechamento"];
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4175", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "financial-workspaces-isolated-test-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4175")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  mkdirSync("artifacts/financial-workspaces", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    const errors = [], requests = [];
    const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: "America/Sao_Paulo", acceptDownloads: true }); active = page;
    await page.clock.setFixedTime("2026-10-15T12:00:00Z");
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { const claims = btoa(JSON.stringify({ sub: "af200000-0000-4000-8000-000000000001", tenant_id: "af100000-0000-4000-8000-000000000001", name: "Financeiro", email: "test@example.test", app: "apticket", exp: 4102444800 })); localStorage.setItem("apticket_session_token", `test.${claims}.mock`); });
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.includes("/_serverFn/")) return route.fulfill({ json: { result: url.pathname.includes(permissionsId) ? modules.flatMap(module => ["view", "edit"].map(action => ({ module, action }))) : [], context: {} } });
      if (url.pathname === "/rest/v1/rpc/get_financial_settings") return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (url.pathname.startsWith("/rest/v1/rpc/")) return route.fulfill({ json: [] });
      if (url.pathname.startsWith("/rest/v1/")) { assert.equal(request.method(), "GET", "This visual QA must not write data"); requests.push(request.url()); return route.fulfill({ json: fixtures[url.pathname.slice(9)] ?? [] }); }
      if (url.origin !== "http://127.0.0.1:4175") return route.fulfill({ json: [] });
      return route.continue();
    });
    for (const [path, title, text, action, dialogName] of pages) {
      await page.goto(`http://127.0.0.1:4175/finance/${path}`);
      const heading = page.getByRole("heading", { level: 1, name: title, exact: true });
      await heading.waitFor();
      await page.getByText(text, { exact: true }).first().waitFor();
      assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
      assert.equal(await heading.evaluate(el => getComputedStyle(el).fontSize), "14px");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path}: page overflow at ${width}`);
      const header = heading.locator("xpath=ancestor::header");
      const box = await header.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      if (["cash-flow", "planning", "analytics"].includes(path)) await page.waitForTimeout(1800);
      await page.screenshot({ path: `artifacts/financial-workspaces/${path.replaceAll("/", "-")}-${width}.png`, fullPage: true, animations: "disabled" });
      const table = page.getByRole("table").last();
      await table.scrollIntoViewIfNeeded();
      const scrolling = await table.evaluate(el => {
        const container = el.parentElement;
        if (container.scrollWidth <= container.clientWidth) return true;
        container.scrollLeft = 100;
        const moved = container.scrollLeft > 0;
        container.scrollLeft = 0;
        return moved;
      });
      assert.equal(scrolling, true, `${path}: horizontal table scrolling`);
      await page.screenshot({ path: `artifacts/financial-workspaces/${path.replaceAll("/", "-")}-list-${width}.png`, animations: "disabled" });
      const companySelect = page.locator(".financial-workspace").getByRole("combobox").first();
      await companySelect.click();
      const popup = page.getByRole("dialog", { name: "Selecionar opção", exact: true });
      await popup.getByRole("combobox", { name: "Buscar opções", exact: true }).fill("ALTA PERFORMANCE");
      const option = popup.getByRole("option", { name: companyName, exact: true });
      await option.waitFor();
      assert.equal(await option.evaluate(el => getComputedStyle(el).fontSize), "12px");
      await option.click(); await popup.waitFor({ state: "hidden" });
      if (action) {
        await page.getByRole("button", { name: action, exact: true }).click();
        const dialog = page.getByRole("dialog", { name: dialogName }).last();
        await dialog.waitFor();
        const dialogBox = await dialog.boundingBox();
        assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= width + 1);
        await dialog.press("Escape"); await dialog.waitFor({ state: "hidden" });
      }
      if (path === "analytics") {
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "Excel XLSX", exact: true }).click();
        assert.match((await download).suggestedFilename(), /\.xlsx$/);
      }
      if (path === "closing") {
        await page.getByRole("button", { name: "Histórico de setembro de 2026", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Histórico do fechamento", exact: true });
        await dialog.waitFor(); await dialog.press("Escape"); await dialog.waitFor({ state: "hidden" });
      }
      console.log(`PASS ${path}: populated page, company search, controls, dialogs/export and responsive layout at ${width}px`);
    }
    assert.ok(requests.some(url => url.includes("financial_management_statement")));
    assert.deepEqual(errors, []);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/financial-workspaces/failure.png", fullPage: true }); } throw error; }
finally { await browser?.close(); app.kill(); }
