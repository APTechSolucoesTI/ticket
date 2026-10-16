// Real UI with isolated API responses; pgTAP verifies persistence, authorization and audit.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
const source = readFileSync(`${directory}/${readdirSync(directory).find(f => f.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const company = "ad300000-0000-4000-8000-000000000001", tenant = "ad100000-0000-4000-8000-000000000001";
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "attachment-management-isolated-secret" }, stdio: "ignore" });
let browser, active;
async function choose(page, trigger, label) {
  await trigger.click(); await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("dialog", { name: "Selecionar opção", exact: true }).waitFor({ state: "hidden" });
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  mkdirSync("artifacts/entry-allocations", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    let readOnly = false, failAdd = false, failDelete = false, failLoad = true;
    const errors = [], additions = [], deletions = [], cleanups = [];
    const attachments = [{ id: "existing", supplier_payable_id: "contract", storage_path: "existing.pdf", file_name: "existente.pdf", file_size: 2048, attachment_type: "boleto", type_description: null, deleted_at: null }];
    const rows = [
      { id: "contract", document_number: "DOC-CONTRATO", origin_type: "contract", installment_number: null, installment_count: null, supplier_contract_id: "contract-id" },
      { id: "parcel", document_number: "DOC-PARCELA-2", origin_type: "manual", installment_number: 2, installment_count: 3, supplier_contract_id: null },
    ].map(row => ({ ...row, tenant_id: tenant, operating_company_id: company, supplier_id: "supplier", description: "Serviço de outubro", cycle_start: "2026-10-01", cycle_end: "2026-11-01", due_date: "2026-10-30", billing_unit: "fixed", measured_quantity: 1, unit_price: 80, total_amount: 80, allocation_status: "complete", status: "scheduled", revision: 0, terms_snapshot: { supplier_name: "Fornecedor teste" } }));
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); active = page;
    await page.clock.setFixedTime("2026-10-16T12:00:00Z");
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "ad200000-0000-4000-8000-000000000001", email: "test@example.test", name: "Teste", tenant_id: "ad100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async route => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["financeiro", "financeiro_contas_pagar"].flatMap(module => ["view", ...(readOnly ? [] : ["edit"])].map(action => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rpc/get_financial_settings")) return route.fulfill({ json: { use_payable_approvals: false, use_collection_rules: false } });
      if (url.includes("/storage/v1/object/")) {
        if (request.method() === "DELETE") { cleanups.push(request.postDataJSON()); return route.fulfill({ json: [] }); }
        if (request.method() === "POST") return route.fulfill({ json: { Key: url.split("/object/")[1] } });
        return route.fulfill({ body: "conteúdo do arquivo", contentType: "application/pdf" });
      }
      if (url.includes("/rpc/add_supplier_payable_attachments")) {
        const data = request.postDataJSON();
        if (failAdd) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada ao incluir anexos." } });
        additions.push(data);
        for (const item of data.p_attachments) attachments.push({ ...item, id: `new-${attachments.length}`, supplier_payable_id: data.p_payable_id, deleted_at: null });
        return route.fulfill({ json: true });
      }
      if (url.includes("/rpc/remove_supplier_payable_attachment")) {
        const data = request.postDataJSON();
        if (failDelete) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada ao excluir anexo." } });
        deletions.push(data); attachments.find(item => item.id === data.p_attachment_id).deleted_at = "2026-10-16";
        return route.fulfill({ json: true });
      }
      if (url.includes("/rest/v1/supplier_payable_attachments")) {
        if (failLoad) return route.fulfill({ status: 400, json: { message: "Falha simulada ao consultar anexos." } });
        const id = new URL(url).searchParams.get("supplier_payable_id")?.slice(3);
        assert.equal(new URL(url).searchParams.get("deleted_at"), "is.null");
        return route.fulfill({ json: attachments.filter(item => item.supplier_payable_id === id && !item.deleted_at) });
      }
      if (url.includes("/rest/v1/supplier_payables")) {
        assert.match(new URL(url).searchParams.get("select"), /supplier_payable_attachments\(id\)/);
        return route.fulfill({ json: rows.map(row => ({ ...row, supplier_payable_attachments: attachments.filter(item => item.supplier_payable_id === row.id && !item.deleted_at).map(({ id }) => ({ id })) })) });
      }
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: company, legal_name: "APTech" }] });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: tenant } });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4173/finance/payables");
    const indicator = name => page.getByRole("button", { name: `Gerenciar anexos ${name}`, exact: true });
    assert.equal(await indicator("DOC-CONTRATO").getAttribute("data-has-attachments"), "true");
    assert.equal(await indicator("DOC-PARCELA-2").getAttribute("data-has-attachments"), "false");
    await indicator("DOC-CONTRATO").click();
    const dialog = page.getByRole("dialog", { name: "Anexos do lançamento", exact: true });
    await dialog.getByRole("alert").getByText("Não foi possível consultar os anexos.", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Adicionar anexos", exact: true }).isDisabled(), true);
    failLoad = false; await dialog.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await dialog.getByText("existente.pdf", { exact: true }).waitFor();
    const download = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Baixar anexo existente.pdf", exact: true }).click();
    assert.equal((await download).suggestedFilename(), "existente.pdf");
    await dialog.getByRole("button", { name: "Excluir anexo existente.pdf", exact: true }).click();
    const alert = page.getByRole("alertdialog", { name: "Excluir anexo?", exact: true });
    await alert.getByRole("button", { name: "Cancelar", exact: true }).click(); assert.equal(deletions.length, 0);
    await dialog.getByRole("button", { name: "Excluir anexo existente.pdf", exact: true }).click();
    failDelete = true; await alert.getByRole("button", { name: "Excluir anexo", exact: true }).click();
    await page.getByText(/Falha simulada ao excluir anexo\./).waitFor();
    assert.equal(attachments[0].deleted_at, null);
    failDelete = false; await alert.getByRole("button", { name: "Excluir anexo", exact: true }).click(); await alert.waitFor({ state: "hidden" });
    await dialog.getByText("Este lançamento não possui anexos.", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    assert.equal(await indicator("DOC-CONTRATO").getAttribute("data-has-attachments"), "false");
    await indicator("DOC-PARCELA-2").click();
    await dialog.getByText("Parcela 2/3 · 0 de 20 anexos", { exact: true }).waitFor();
    await dialog.getByLabel("Selecionar arquivos para anexar", { exact: true }).setInputFiles([
      { name: "boleto.pdf", mimeType: "application/pdf", buffer: Buffer.from("boleto") },
      { name: "nfe.xml", mimeType: "application/xml", buffer: Buffer.from("<nfe/>") },
      { name: "contrato.pdf", mimeType: "application/pdf", buffer: Buffer.from("contrato") },
    ]);
    const save = dialog.getByRole("button", { name: "Incluir anexos", exact: true });
    await save.click(); await page.getByText("boleto.pdf: Selecione o tipo do anexo.", { exact: true }).waitFor(); assert.equal(additions.length, 0);
    for (const [index, name] of ["Boleto", "XML", "Outros"].entries()) await choose(page, dialog.getByRole("combobox", { name: `Tipo do anexo ${index + 1} *`, exact: true }), name);
    await save.click(); await page.getByText("contrato.pdf: Descreva o tipo do anexo.", { exact: true }).waitFor();
    await dialog.getByLabel("Descrição do tipo 3 *", { exact: true }).fill("Contrato de prestação de serviços");
    assert.equal(await dialog.getByRole("combobox", { name: /Parcela do anexo/ }).count(), 0, "destination is the selected installment");
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await dialog.getByRole("region", { name: "Anexos da conta a pagar", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/entry-allocations/manage-drafts-${width}.png`, animations: "disabled" });
    failAdd = true; await save.click(); await page.getByText(/Falha simulada ao incluir anexos\./).waitFor();
    assert.equal(cleanups.length, 1); assert.equal(additions.length, 0);
    assert.equal(await dialog.getByLabel("Descrição do tipo 3 *", { exact: true }).inputValue(), "Contrato de prestação de serviços");
    failAdd = false; await save.click(); await dialog.getByText("Parcela 2/3 · 3 de 20 anexos", { exact: true }).waitFor();
    assert.equal(additions[0].p_payable_id, "parcel");
    assert.deepEqual(additions[0].p_attachments.map(item => item.installment_number), [2,2,2]);
    await dialog.getByRole("region", { name: "Anexos do lançamento", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/entry-allocations/manage-saved-${width}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    assert.equal(await indicator("DOC-PARCELA-2").getAttribute("data-has-attachments"), "true");
    assert.equal(await indicator("DOC-CONTRATO").getAttribute("data-has-attachments"), "false");
    await indicator("DOC-PARCELA-2").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/entry-allocations/manage-indicators-${width}.png`, animations: "disabled" });
    readOnly = true; await page.reload(); await indicator("DOC-PARCELA-2").click();
    await dialog.getByRole("button", { name: "Baixar anexo nfe.xml", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Adicionar anexos", exact: true }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: /^Excluir anexo / }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: "Incluir anexos", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS attachment indicators, load errors, downloads, deletion/cancel/failure, typed batch inclusion, installment scope, cleanup, refresh and read-only at ${width}px`);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/entry-allocations/manage-failure.png" }); } throw error; }
finally { await browser?.close(); app.kill(); }
