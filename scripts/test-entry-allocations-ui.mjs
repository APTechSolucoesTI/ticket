// Actual application with isolated APIs; database invariants are covered by pgTAP.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir = "apps/web/.output/server/_ssr";
const source = readFileSync(`${dir}/${readdirSync(dir).find((f) => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "ae300000-0000-4000-8000-000000000001";
const secondOperator = "ae300000-0000-4000-8000-000000000002";
const secondOperatorName = "APTech Serviços Gerenciados e Soluções em Tecnologia da Informação";
const tenant = "ae100000-0000-4000-8000-000000000001";
const partner = "ae600000-0000-4000-8000-000000000001";
const documentType = "ae900000-0000-4000-8000-000000000001";
const categories = [1, 2].map((n) => ({ id: `ae400000-0000-4000-8000-00000000000${n}`, code: `10.0${n}.0001`, name: n === 1 ? "Serviços" : "Consultoria" }));
const centers = [1, 2].map((n) => ({ id: `ae500000-0000-4000-8000-00000000000${n}`, code: `20.0${n}.0001`, name: n === 1 ? "Operações" : "Administrativo" }));
const snapshots = (items, percentages) => items.map((item, i) => ({ item_id: item.id, code: item.code, name: item.name, percentage: percentages[i] }));
const searchablePartners = ["Ágil Soluções em Tecnologia", ...Array.from({ length: 40 }, (_, i) => `Empresa de serviços ${i + 1}`)].map((name, i) => ({ id: `search-${i}`, name, legal_name: name, trade_name: name }));
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "entry-allocation-isolated-test-secret" }, stdio: "ignore" });
let browser, active;
async function choose(page, trigger, name) {
  await trigger.click();
  await page.getByRole("option", { name, exact: true }).click();
}
async function percentages(dialog, dimension, values) {
  for (let i = 0; i < values.length; i++) await dialog.getByLabel(`${dimension} · percentual ${i + 1}`, { exact: true }).fill(String(values[i]));
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  mkdirSync("artifacts/entry-allocations", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) for (const kind of ["payable", "receivable"]) {
    const writes = [], edits = [], errors = [], queriedDirections = [];
    let failSave = false, inactive = false, readOnly = false;
    const classification = { source_id: "entry", financial_category_id: categories[0].id, cost_center_id: centers[0].id, category_allocations: snapshots(categories, [70, 30]), cost_center_allocations: snapshots(centers, [60, 40]) };
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); active = page;
    await page.clock.setFixedTime("2026-10-15T12:00:00Z");
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "ae200000-0000-4000-8000-000000000001", email: "test@example.test", name: "Teste", tenant_id: "ae100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionId) ? ["financeiro", "financeiro_contas_pagar", "financeiro_contas_receber"].flatMap((module) => ["view", ...(readOnly ? [] : ["edit"])].map((action) => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rest/v1/rpc/get_financial_settings")) return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (/\/rpc\/create_manual_(supplier_payable|receivable)_allocated/.test(url)) {
        if (failSave) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada ao salvar rateios." } });
        writes.push(request.postDataJSON()); return route.fulfill({ json: "group" });
      }
      if (url.includes("/rpc/classify_financial_entry_allocated")) {
        if (failSave) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada ao salvar rateios." } });
        const data = request.postDataJSON(); edits.push(data);
        classification.category_allocations = data.p_category_allocations.map((a) => ({ ...categories.find((c) => c.id === a.item_id), ...a }));
        classification.cost_center_allocations = data.p_cost_center_allocations.map((a) => ({ ...centers.find((c) => c.id === a.item_id), ...a }));
        return route.fulfill({ json: "classification" });
      }
      if (url.includes("/rest/v1/financial_entry_classifications")) return route.fulfill({ json: [classification] });
      if (url.includes("/rest/v1/financial_categories")) {
        const query = new URL(url).searchParams; queriedDirections.push(query.get("direction"));
        assert.equal(query.get("classification_type"), "eq.analytic"); assert.equal(query.get("is_active"), "eq.true");
        return route.fulfill({ json: inactive ? categories.slice(1) : categories });
      }
      if (url.includes("/rest/v1/financial_cost_centers")) return route.fulfill({ json: centers });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: operator, legal_name: "APTech" }, ...(width === 1440 ? [{ id: secondOperator, legal_name: secondOperatorName }] : [])] });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: tenant } });
      if (url.includes("/rest/v1/suppliers")) return route.fulfill({ json: [{ id: partner, legal_name: "Fornecedor teste", trade_name: "Fornecedor teste" }, ...searchablePartners] });
      if (url.includes("/rest/v1/companies")) return route.fulfill({ json: [{ id: partner, name: "Cliente teste" }, ...searchablePartners] });
      if (url.includes("/rest/v1/financial_document_types")) return route.fulfill({ json: [{ id: documentType, code: "OUT", name: "Outros", availability: "both", is_active: true }] });
      if (url.includes("/rest/v1/supplier_payables")) return route.fulfill({ json: [{ id: "entry", operating_company_id: operator, supplier_id: partner, origin_type: "manual", document_number: "RATEIO", description: "Serviços de outubro", cycle_start: "2026-10-01", cycle_end: "2026-11-01", due_date: "2026-10-30", total_amount: 100.01, allocation_status: "complete", status: "scheduled", terms_snapshot: { supplier_name: "Fornecedor teste" } }] });
      if (url.includes("/rest/v1/contas_receber")) return route.fulfill({ json: [{ id: "entry", operating_company_id: operator, company_id: partner, origin_type: "manual", documento_referencia: "RATEIO", cliente_nome: "Cliente teste", descricao: "Serviços de outubro", competencia: "2026-10-01", vencimento_em: "2026-10-30", valor_total: 100.01, valor_aberto: 100.01, status_cobranca: "a_faturar", medicoes_contrato: null }] });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:4173/finance/${kind === "payable" ? "payables" : "receivables"}`);
    if (width === 1440) await choose(page, page.getByRole("combobox", { name: "Empresa operadora", exact: true }), secondOperatorName);
    const classify = () => page.getByRole("button", { name: kind === "payable" ? "Classificar RATEIO" : "Classificar", exact: true });
    await page.getByRole("button", { name: "Nova conta", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^(Nova conta a (pagar|receber)|Classificar movimento)$/ });
    const companySummary = dialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true });
    if (kind === "receivable") assert.equal(await dialog.locator("#manual-entry-operator").isDisabled(), true);
    await companySummary.getByText(width === 1440 ? secondOperatorName : "APTech", { exact: true }).waitFor();
    await companySummary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/entry-allocations/company-${kind}-${width}.png`, animations: "disabled" });
    const counterparty = dialog.locator("#manual-entry-counterparty");
    const search = page.getByRole("combobox", { name: "Buscar opções", exact: true });
    const popup = page.getByRole("dialog", { name: "Selecionar opção", exact: true });
    await counterparty.click();
    await search.waitFor();
    assert.equal(await search.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.getByRole("option").count(), 42);
    assert.equal(await page.getByRole("listbox").evaluate(el => el.scrollHeight > el.clientHeight), true);
    const popupBounds = await popup.boundingBox();
    assert.ok(popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= width + 1 && popupBounds.y >= 0 && popupBounds.y + popupBounds.height <= 1001);
    assert.equal(await popup.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/entry-allocations/search-${kind}-${width}.png`, animations: "disabled" });
    await search.fill("AGIL solucoes");
    await page.getByRole("option", { name: "Ágil Soluções em Tecnologia", exact: true }).waitFor();
    assert.equal(await page.getByRole("option").count(), 1);
    await search.press("Enter");
    await popup.waitFor({ state: "hidden" });
    assert.match(await counterparty.innerText(), /Ágil Soluções em Tecnologia/);
    assert.equal(await counterparty.evaluate(el => el === document.activeElement), true);
    await counterparty.press("ArrowDown");
    await search.fill("inexistente xyz");
    await page.getByText("Nenhuma opção encontrada.", { exact: true }).waitFor();
    await popup.getByRole("button", { name: "Concluir", exact: true }).click();
    await popup.waitFor({ state: "hidden" });
    assert.match(await counterparty.innerText(), /Ágil Soluções em Tecnologia/);
    await counterparty.click();
    assert.equal(await search.inputValue(), "");
    await search.press("Escape");
    await popup.waitFor({ state: "hidden" });
    assert.equal(await dialog.isVisible(), true);
    await counterparty.click();
    await search.fill(kind === "payable" ? "Fornecedor teste" : "Cliente teste");
    await search.press("Enter");
    await popup.waitFor({ state: "hidden" });
    assert.match(await counterparty.innerText(), kind === "payable" ? /Fornecedor teste/ : /Cliente teste/);
    await dialog.locator("#manual-entry-document").fill("MULTI-001");
    await dialog.locator("#manual-entry-description").fill("Serviços de outubro com rateio");
    await dialog.locator("#manual-entry-total").fill("100,01");
    await dialog.locator("#manual-entry-competence").fill("2026-10");
    await dialog.locator("#manual-entry-due").fill("2026-10-30");
    assert.equal(await dialog.getByRole("button", { name: "Incluir conta", exact: true }).isDisabled(), true);
    for (const [dimension, label, items, values] of [["Categorias financeiras", "categoria", categories, [70, 30]], ["Centros de custo", "centro de custo", centers, [60, 40]]]) {
      await dialog.getByRole("button", { name: `Adicionar ${label}`, exact: true }).click();
      await choose(page, dialog.getByRole("group", { name: `${dimension} *`, exact: true }).getByRole("combobox").nth(0), `${items[0].code} · ${items[0].name}`);
      await percentages(dialog, dimension, [values[0]]);
      await dialog.getByRole("button", { name: `Adicionar ${label}`, exact: true }).click();
      assert.equal(await dialog.getByLabel(`${dimension} · percentual 2`, { exact: true }).inputValue(), String(values[1]));
      const trigger = dialog.getByRole("group", { name: `${dimension} *`, exact: true }).getByRole("combobox").nth(1);
      await trigger.click();
      assert.equal(await page.getByRole("option", { name: `${items[0].code} · ${items[0].name}`, exact: true }).getAttribute("aria-disabled"), "true");
      await page.getByRole("option", { name: `${items[1].code} · ${items[1].name}`, exact: true }).click();
    }
    await percentages(dialog, "Categorias financeiras", [69, 30]);
    assert.equal(await dialog.getByRole("button", { name: "Incluir conta", exact: true }).isDisabled(), true);
    await percentages(dialog, "Categorias financeiras", [70, 30]);
    if (width === 1440) {
      await choose(page, dialog.locator("#manual-entry-mode"), "Lançamento parcelado");
      await dialog.locator("#manual-entry-first-due").fill("2026-10-30");
      await dialog.getByRole("button", { name: "Calcular parcelas", exact: true }).click();
    }
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await dialog.locator("fieldset").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/entry-allocations/new-${kind}-${width}.png`, animations: "disabled" });
    const submit = dialog.getByRole("button", { name: width === 1440 ? "Incluir parcelas" : "Incluir conta", exact: true });
    failSave = true; await submit.click(); await page.getByText(/Falha simulada ao salvar rateios/).waitFor();
    assert.equal(await dialog.getByLabel("Categorias financeiras · percentual 1", { exact: true }).inputValue(), "70");
    failSave = false; await submit.click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(writes[0].p_operating_company_id, width === 1440 ? secondOperator : operator);
    assert.deepEqual(writes[0].p_category_allocations.map((a) => Number(a.percentage)), [70, 30]);
    assert.deepEqual(writes[0].p_cost_center_allocations.map((a) => Number(a.percentage)), [60, 40]);
    assert.equal(writes[0].p_installments.length, width === 1440 ? 2 : 1);
    await classify().click();
    assert.equal(await dialog.getByLabel("Categorias financeiras · percentual 2", { exact: true }).inputValue(), "30");
    assert.equal(await dialog.getByLabel("Centros de custo · percentual 2", { exact: true }).inputValue(), "40");
    await percentages(dialog, "Categorias financeiras", [45, 55]);
    await percentages(dialog, "Centros de custo", [25, 75]);
    await page.screenshot({ path: `artifacts/entry-allocations/classify-${kind}-${width}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(edits[0].p_source_type, kind === "payable" ? "supplier_payable" : "manual_receivable");
    assert.deepEqual(edits[0].p_category_allocations.map((a) => Number(a.percentage)), [45, 55]);
    await classify().click();
    assert.equal(await dialog.getByLabel("Categorias financeiras · percentual 2", { exact: true }).inputValue(), "55");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    classification.category_allocations = null; classification.cost_center_allocations = null;
    await page.reload(); await classify().click();
    assert.equal(await dialog.getByLabel("Categorias financeiras · percentual 1", { exact: true }).inputValue(), "100");
    assert.equal(await dialog.getByLabel("Centros de custo · percentual 1", { exact: true }).inputValue(), "100");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    inactive = true; await page.reload(); await classify().click();
    await dialog.getByText("Um item vinculado está inativo ou indisponível. Substitua-o antes de salvar.", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Salvar", exact: true }).isDisabled(), true);
    assert.ok(queriedDirections.includes(`in.(${kind === "payable" ? "outflow" : "inflow"},both)`));
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    readOnly = true; await page.reload();
    await page.getByText("Serviços de outubro", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Nova conta", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${kind} searchable select (accents, empty, scrolling, keyboard, focus, dismiss), creation/installments, allocations, errors, edit, legacy, permissions at ${width}px`);
    await page.close();
  }
} catch (e) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/entry-allocations/failure.png" }); } throw e; }
finally { await browser?.close(); app.kill(); }
