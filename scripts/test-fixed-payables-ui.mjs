// Browser tests use isolated APIs; pgTAP verifies persistence and authorization.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const dir = "apps/web/.output/server/_ssr";
const source = readFileSync(`${dir}/${readdirSync(dir).find((f) => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const company = "af300000-0000-4000-8000-000000000001", tenant = "af100000-0000-4000-8000-000000000001";
const secondCompany = "af300000-0000-4000-8000-000000000002";
const supplier = "af800000-0000-4000-8000-000000000001", documentType = "af900000-0000-4000-8000-000000000001";
const categories = [1, 2].map((n) => ({ id: `af400000-0000-4000-8000-00000000000${n}`, code: `10.0${n}.0001`, name: n === 1 ? "Aluguéis" : "Serviços" }));
const centers = [1, 2].map((n) => ({ id: `af500000-0000-4000-8000-00000000000${n}`, code: `20.0${n}.0001`, name: n === 1 ? "Operações" : "Administrativo" }));
const allocate = (items, values) => items.map((item, i) => ({ item_id: item.id, code: item.code, name: item.name, percentage: values[i] }));
const snapshotPayload = (p) => ({ ...p, category_allocations: p.category_allocations.map((a) => ({ ...categories.find((c) => c.id === a.item_id), ...a })), cost_center_allocations: p.cost_center_allocations.map((a) => ({ ...centers.find((c) => c.id === a.item_id), ...a })) });
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "fixed-payables-isolated-secret" }, stdio: "ignore" });
let browser, active;
const choose = async (page, trigger, name) => {
  await trigger.click();
  await page.getByRole("option", { name, exact: true }).click();
  await page.getByRole("dialog", { name: "Selecionar opção", exact: true }).waitFor({ state: "hidden" });
};
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  mkdirSync("artifacts/fixed-payables", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    const errors = [], saves = [], confirmations = [], mutations = [], occurrenceOffsets = [], uploads = [], cleanups = [];
    let readOnly = false, failSave = false;
    const original = { id: "template", operating_company_id: company, supplier_id: supplier, supplier_name: "Imobiliária Centro", document_type_id: documentType, description: "Aluguel da sede", total_amount: 100, due_day: 31, start_month: "2027-01-01", end_month: "2027-03-01", is_active: true, revision: 0, notes: "Locação mensal", category_allocations: allocate(categories, [70, 30]), cost_center_allocations: allocate(centers, [60, 40]), deleted_at: null };
    const templates = [original];
    const occurrences = [1, 2, 3].map((n) => ({ ...original, id: `occurrence-${n}`, fixed_payable_id: original.id, competence: `2027-0${n}-01`, due_date: `2027-0${n}-${n === 2 ? "28" : "31"}`, status: "forecast", confirmed_payable_id: null }));
    const payables = [{ id: "normal", operating_company_id: company, supplier_id: supplier, supplier_contract_id: null, origin_type: "manual", document_number: "EXISTENTE", description: "Serviço já confirmado", cycle_start: "2027-01-01", cycle_end: "2027-02-01", due_date: "2027-01-20", total_amount: 80, status: "scheduled", billing_unit: "fixed", measured_quantity: 1, unit_price: 80, allocation_status: "complete", revision: 0, terms_snapshot: { supplier_name: "Imobiliária Centro" } }];
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); active = page;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => { const claims = btoa(JSON.stringify({ sub: "af200000-0000-4000-8000-000000000001", name: "Financeiro", email: "teste@example.test", tenant_id: "af100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 })); localStorage.setItem("apticket_session_token", `test.${claims}.mock`); });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.includes("/storage/v1/object/")) {
        if (request.method() === "DELETE") { cleanups.push(request.postDataJSON()); return route.fulfill({ json: [] }); }
        uploads.push(url); return route.fulfill({ json: { Key: url.split("/object/")[1] } });
      }
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["financeiro", "financeiro_contas_pagar", "financeiro_contas_fixas"].flatMap((module) => ["view", ...(readOnly ? [] : ["edit"])].map((action) => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rpc/get_financial_settings")) return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (url.includes("/rpc/save_fixed_payable_occurrence")) {
        const data = request.postDataJSON(); mutations.push(data); Object.assign(occurrences.find((o) => o.id === data.p_id), snapshotPayload(data.p_payload), { revision: data.p_expected_revision + 1 }); return route.fulfill({ json: true });
      }
      if (url.includes("/rpc/save_fixed_payable")) {
        const data = request.postDataJSON();
        if (failSave) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada ao salvar conta fixa." } });
        saves.push(data);
        if (data.p_id) Object.assign(templates.find((t) => t.id === data.p_id), snapshotPayload(data.p_payload), { revision: data.p_expected_revision + 1 });
        else templates.push({ ...snapshotPayload(data.p_payload), supplier_name: "Imobiliária Centro", id: "new-template", is_active: true, revision: 0, deleted_at: null });
        return route.fulfill({ json: data.p_id ?? "new-template" });
      }
      if (url.includes("/rpc/confirmar_previsao_conta_fixa")) {
        const data = request.postDataJSON();
        if (failSave) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada na confirmação." } });
        confirmations.push(data); const o = occurrences.find((o) => o.id === data.p_id);
        Object.assign(o, snapshotPayload(data.p_payload), { status: "confirmed", confirmed_payable_id: "confirmed", revision: data.p_expected_revision + 1 });
        payables.push({ ...payables[0], id: "confirmed", document_number: data.p_payload.document_number, description: o.description, total_amount: o.total_amount, due_date: o.due_date });
        return route.fulfill({ json: "confirmed" });
      }
      if (url.includes("/rpc/set_fixed_payable_active")) { const data = request.postDataJSON(); mutations.push(data); Object.assign(templates.find((t) => t.id === data.p_id), { is_active: data.p_active, revision: data.p_expected_revision + 1 }); return route.fulfill({ json: true }); }
      if (url.includes("/rpc/skip_fixed_payable_occurrence")) { const data = request.postDataJSON(); mutations.push(data); occurrences.find((o) => o.id === data.p_id).deleted_at = "2026-10-14"; return route.fulfill({ json: true }); }
      if (url.includes("/rpc/delete_fixed_payable")) { const data = request.postDataJSON(); mutations.push(data); templates.find((t) => t.id === data.p_id).deleted_at = "2026-10-14"; return route.fulfill({ json: true }); }
      if (url.includes("/rest/v1/fixed_payable_occurrences")) {
        const params = new URL(url).searchParams, offset = Number(params.get("offset") ?? 0), limit = Number(params.get("limit") ?? 1000);
        occurrenceOffsets.push(offset);
        return route.fulfill({ json: occurrences.filter((o) => !o.deleted_at).slice(offset, offset + limit) });
      }
      if (url.includes("/rest/v1/fixed_payables")) return route.fulfill({ json: templates.filter((t) => !t.deleted_at) });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: company, legal_name: "APTech" }, { id: secondCompany, legal_name: "APTech Filial" }] });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: tenant } });
      if (url.includes("/rest/v1/suppliers")) return route.fulfill({ json: [{ id: supplier, legal_name: "Imobiliária Centro", trade_name: null }] });
      if (url.includes("/rest/v1/financial_document_types")) return route.fulfill({ json: [{ id: documentType, code: "BOL", name: "Boleto", availability: "both", is_active: true }] });
      if (url.includes("/rest/v1/financial_categories")) return route.fulfill({ json: categories });
      if (url.includes("/rest/v1/financial_cost_centers")) return route.fulfill({ json: centers });
      if (url.includes("/rest/v1/supplier_payables")) return route.fulfill({ json: payables });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4173/finance/payables/fixed");
    await choose(page, page.getByRole("combobox", { name: "Empresa operadora", exact: true }), "APTech Filial");
    await page.getByRole("button", { name: "Nova conta fixa", exact: true }).click();
    const secondCompanyDialog = page.getByRole("dialog", { name: "Nova conta fixa", exact: true });
    await secondCompanyDialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true }).getByText("APTech Filial", { exact: true }).waitFor();
    await secondCompanyDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await choose(page, page.getByRole("combobox", { name: "Empresa operadora", exact: true }), "APTech");
    await page.getByRole("button", { name: "Nova conta fixa", exact: true }).click();
    let dialog = page.getByRole("dialog").last();
    await dialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true }).getByText("APTech", { exact: true }).waitFor();
    await page.screenshot({ path: `artifacts/fixed-payables/company-${width}.png`, animations: "disabled" });
    assert.equal(await dialog.locator("#fixed-document").count(), 0);
    assert.equal(await dialog.locator("#fixed-mode").getAttribute("readonly"), "");
    assert.equal(await dialog.getByRole("button", { name: "Calcular parcelas" }).count(), 0);
    await choose(page, dialog.locator("#fixed-supplier"), "Imobiliária Centro");
    await choose(page, dialog.locator("#fixed-document-type"), "BOL - Boleto");
    await dialog.locator("#fixed-description").fill("Internet corporativa");
    await dialog.locator("#fixed-amount").fill("250,75");
    await dialog.locator("#fixed-start").fill("2028-01");
    await dialog.locator("#fixed-end").fill("2027-12");
    await dialog.locator("#fixed-day").fill("31");
    for (const [label, dimension, items] of [["categoria", "Categorias financeiras", categories], ["centro de custo", "Centros de custo", centers]]) {
      await dialog.getByRole("button", { name: `Adicionar ${label}`, exact: true }).click();
      await choose(page, dialog.getByRole("group", { name: `${dimension} *`, exact: true }).getByRole("combobox"), `${items[0].code} · ${items[0].name}`);
    }
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
    await dialog.getByText("Lançar até deve ser igual ou posterior ao mês inicial.", { exact: true }).waitFor();
    await dialog.locator("#fixed-end").fill(width === 1440 ? "2028-12" : "");
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await dialog.locator("#fixed-start").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/fixed-payables/new-${width}.png`, animations: "disabled" });
    failSave = true; await dialog.getByRole("button", { name: "Salvar", exact: true }).click(); await page.getByText(/Falha simulada ao salvar conta fixa/).waitFor();
    assert.equal(await dialog.locator("#fixed-description").inputValue(), "Internet corporativa");
    failSave = false; await dialog.getByRole("button", { name: "Salvar", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(saves[0].p_payload.end_month, width === 1440 ? "2028-12-01" : null);
    assert.equal(saves[0].p_payload.total_amount, 250.75);
    assert.equal(saves[0].p_payload.operating_company_id, company);
    assert.equal(saves[0].p_payload.document_number, "");
    await page.getByRole("button", { name: "Editar conta fixa Aluguel da sede", exact: true }).click();
    dialog = page.getByRole("dialog").last(); await dialog.locator("#fixed-amount").fill("150,00");
    assert.equal(await dialog.getByLabel("Categorias financeiras · percentual 2", { exact: true }).inputValue(), "30");
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
    let alert = page.getByRole("alertdialog"); await alert.getByText("Aplicar alteração às previsões futuras?", { exact: true }).waitFor();
    await alert.getByRole("button", { name: "Voltar", exact: true }).click(); assert.equal(saves.length, 1);
    await dialog.getByRole("button", { name: "Salvar", exact: true }).click(); await alert.getByRole("button", { name: "Aplicar e salvar", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(saves[1].p_apply_future, true); assert.equal(saves[1].p_expected_revision, 0);
    await page.getByRole("button", { name: "Ver previsões Aluguel da sede", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Previsões da conta fixa", exact: true }); await dialog.getByText("fevereiro de 2027", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Editar previsão 2027-02-01", exact: true }).click();
    const individual = page.getByRole("dialog", { name: "Editar previsão", exact: true }); await individual.locator("#fixed-amount").fill("175,00");
    await individual.getByRole("button", { name: "Salvar", exact: true }).click(); await individual.waitFor({ state: "hidden" });
    assert.equal(templates[0].total_amount, 150); assert.equal(occurrences[1].total_amount, 175);
    await dialog.getByRole("button", { name: "Excluir previsão 2027-03-01", exact: true }).click();
    alert = page.getByRole("alertdialog"); await alert.getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(occurrences[2].deleted_at, null);
    await dialog.getByRole("button", { name: "Excluir previsão 2027-03-01", exact: true }).click(); await alert.getByRole("button", { name: "Excluir", exact: true }).click(); await alert.waitFor({ state: "hidden" });
    await page.goto("http://127.0.0.1:4173/finance/payables");
    await page.getByRole("combobox", { name: "Competência", exact: true }).click();
    const competenceFilter = page.getByRole("dialog", { name: "Competência - opções", exact: true });
    await competenceFilter.getByRole("option", { name: "Todas as competências", exact: true }).click();
    await competenceFilter.getByRole("button", { name: "Concluir", exact: true }).click();
    await competenceFilter.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Confirmar previsão Aluguel da sede 2027-01-01", exact: true }).waitFor();
    const actualSummary = page.locator("div.rounded-lg").filter({ has: page.getByText("A pagar · títulos confirmados", { exact: true }) });
    await actualSummary.getByText(/80,00/).waitFor();
    await choose(page, page.getByRole("combobox", { name: "Tipo de lançamento", exact: true }), "Somente títulos");
    assert.equal(await page.getByRole("button", { name: /Confirmar previsão/ }).count(), 0);
    await choose(page, page.getByRole("combobox", { name: "Tipo de lançamento", exact: true }), "Somente previsões");
    assert.equal(await page.getByRole("button", { name: "Alterar EXISTENTE", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Confirmar previsão Aluguel da sede 2027-01-01", exact: true }).click();
    dialog = page.getByRole("dialog").last();
    await dialog.getByRole("group", { name: "Empresa operadora do lançamento", exact: true }).getByText("APTech", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Confirmar e criar título", exact: true }).click();
    await dialog.getByText("Informe o número do documento com pelo menos 2 caracteres.", { exact: true }).waitFor(); assert.equal(confirmations.length, 0);
    await dialog.locator("#fixed-document").fill("ALUGUEL-JAN-2027"); await dialog.locator("#fixed-amount").fill("123,45");
    await dialog.locator("#fixed-due").fill("2027-02-05");
    await dialog.getByLabel("Selecionar arquivos para anexar", { exact: true }).setInputFiles([
      { name: "aluguel.pdf", mimeType: "application/pdf", buffer: Buffer.from("boleto aluguel") },
      { name: "recibo.pdf", mimeType: "application/pdf", buffer: Buffer.from("recibo") },
    ]);
    await choose(page, dialog.getByRole("combobox", { name: "Tipo do anexo 1 *", exact: true }), "Boleto");
    await choose(page, dialog.getByRole("combobox", { name: "Tipo do anexo 2 *", exact: true }), "Outros");
    await dialog.getByRole("button", { name: "Confirmar e criar título", exact: true }).click();
    await page.getByText("recibo.pdf: Descreva o tipo do anexo.", { exact: true }).waitFor();
    assert.equal(uploads.length, 0); assert.equal(confirmations.length, 0);
    await dialog.getByLabel("Descrição do tipo 2 *", { exact: true }).fill("Recibo de locação");
    assert.equal(await dialog.getByRole("combobox", { name: /Parcela do anexo/ }).count(), 0);
    await page.screenshot({ path: `artifacts/fixed-payables/confirm-${width}.png`, animations: "disabled" });
    failSave = true; await dialog.getByRole("button", { name: "Confirmar e criar título", exact: true }).click(); await page.getByText(/Falha simulada na confirmação/).waitFor();
    failSave = false; await dialog.getByRole("button", { name: "Confirmar e criar título", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
    assert.equal(confirmations.length, 1); assert.equal(confirmations[0].p_payload.total_amount, 123.45);
    assert.equal(confirmations[0].p_payload.attachments.length, 2);
    assert.deepEqual(confirmations[0].p_payload.attachments.map(a => a.installment_number), [1,1]);
    assert.equal(confirmations[0].p_payload.attachments[1].type_description, "Recibo de locação");
    assert.equal(cleanups.length, 1, "cleans up uploads when confirmation fails");
    assert.deepEqual(confirmations[0].p_payload.category_allocations.map((a) => Number(a.percentage)), [70, 30]);
    assert.equal(templates[0].total_amount, 150); assert.equal(occurrences[1].total_amount, 175);
    assert.equal(await page.getByRole("button", { name: "Confirmar previsão Aluguel da sede 2027-01-01", exact: true }).count(), 0);
    await actualSummary.getByText(/203,45/).waitFor();
    await choose(page, page.getByRole("combobox", { name: "Tipo de lançamento", exact: true }), "Títulos e previsões");
    await page.getByText("Fixa confirmada", { exact: true }).waitFor();
    await page.screenshot({ path: `artifacts/fixed-payables/list-${width}.png`, animations: "disabled" });
    await page.goto("http://127.0.0.1:4173/finance/payables/fixed");
    await page.getByRole("button", { name: "Inativar Aluguel da sede", exact: true }).click();
    await choose(page, page.getByRole("combobox", { name: "Situação dos modelos", exact: true }), "Inativas");
    await page.getByRole("button", { name: "Reativar Aluguel da sede", exact: true }).click();
    await choose(page, page.getByRole("combobox", { name: "Situação dos modelos", exact: true }), "Ativas");
    await page.getByRole("button", { name: "Excluir conta fixa Internet corporativa", exact: true }).click();
    alert = page.getByRole("alertdialog"); await alert.getByRole("button", { name: "Excluir", exact: true }).click(); await alert.waitFor({ state: "hidden" });
    await page.getByRole("textbox", { name: "Buscar contas fixas", exact: true }).fill("Inexistente"); await page.getByText("Nenhuma conta fixa encontrada", { exact: true }).waitFor();
    readOnly = true; await page.reload(); await page.getByRole("button", { name: "Ver previsões Aluguel da sede", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Nova conta fixa", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Editar conta fixa Aluguel da sede", exact: true }).count(), 0);
    if (width === 1440) {
      assert.equal(await page.locator('nav[aria-label="Menu principal"] a[aria-current="page"][href="/finance/payables/fixed"]').count(), 1);
      assert.equal(await page.locator('nav[aria-label="Menu principal"] a[aria-current="page"][href="/finance/payables"]').count(), 0);
      for (let n = 0; n < 1000; n++) occurrences.push({ ...occurrences[1], id: `bulk-${n}`, fixed_payable_id: `bulk-template-${n}`, total_amount: 1, deleted_at: null });
      await page.reload();
      await page.getByText(/1\.175,00/).waitFor();
      assert.ok(occurrenceOffsets.includes(1000), "loads the second page for complete totals");
    }
    assert.deepEqual(errors, []);
    console.log(`PASS fixed templates, scope, individual edits/skips, confirmation, totals, filters, inactivity, deletion and readonly at ${width}px`);
    await page.close();
  }
} catch (e) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/fixed-payables/failure.png" }); } throw e; }
finally { await browser?.close(); app.kill(); }
