// Real UI with isolated APIs; pgTAP covers permissions, concurrency and auditing.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
const source = readFileSync(`${directory}/${readdirSync(directory).find((file) => file.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "ed300000-0000-4000-8000-000000000001", tenant = "ed100000-0000-4000-8000-000000000001";
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4173", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "payable-mutations-isolated-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch("http://127.0.0.1:4173")).ok) break; } catch { /* Wait for startup. */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  mkdirSync("artifacts/payable-mutations", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    let readOnly = false, failEdit = false, failDelete = false, conflictEdit = false;
    const errors = [], writes = [], deletions = [];
    const rows = ["MANUAL", "PARCELA-2", "CONTRATO", "PAGO", "PROGRAMADO"].map((document, index) => ({ id: `entry-${index}`, revision: 0, tenant_id: tenant, operating_company_id: operator, supplier_id: "supplier", supplier_contract_id: index === 2 ? "contract" : null, origin_type: index === 2 ? "contract" : "manual", document_type_id: null, installment_number: index < 2 ? index + 1 : null, installment_count: index < 2 ? 2 : null, document_number: document, description: `Conta ${document}`, cycle_start: "2026-10-01", cycle_end: "2026-11-01", due_date: "2026-10-30", billing_unit: "fixed", measured_quantity: 1, unit_price: 80, total_amount: 80, allocation_status: "complete", status: index === 3 ? "paid" : "scheduled", terms_snapshot: { supplier_name: "Fornecedor teste" }, last_change_reason: null, deleted_at: null }));
    const page = await browser.newPage({ viewport: { width, height: 900 } }); active = page;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => { const claims = btoa(JSON.stringify({ sub: "ed200000-0000-4000-8000-000000000001", email: "teste@example.test", name: "Teste", tenant_id: "ed100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 })); localStorage.setItem("apticket_session_token", `test.${claims}.mock`); });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["financeiro", "financeiro_contas_pagar"].flatMap((module) => ["view", "edit"].filter((action) => !(readOnly && module === "financeiro_contas_pagar" && action === "edit")).map((action) => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rest/v1/rpc/get_financial_settings")) return route.fulfill({ json: { use_payable_approvals: true, use_collection_rules: true } });
      if (url.includes("/rest/v1/rpc/update_supplier_payable")) {
        const value = request.postDataJSON();
        if (conflictEdit) {
          conflictEdit = false;
          Object.assign(rows.find((row) => row.id === value.p_id), { revision: value.p_expected_revision + 1, description: "Alterado por outro usuário" });
          return route.fulfill({ status: 400, json: { code: "40001", message: "Este lançamento foi atualizado por outra operação. Reabra a tela antes de continuar." } });
        }
        if (failEdit) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada na alteração." } });
        writes.push(value);
        Object.assign(rows.find((row) => row.id === value.p_id), { document_number: value.p_document_number, description: value.p_description, due_date: value.p_due_date, total_amount: value.p_total_amount, last_change_reason: value.p_reason, revision: value.p_expected_revision + 1 });
        return route.fulfill({ json: true });
      }
      if (url.includes("/rest/v1/rpc/delete_supplier_payable")) {
        const value = request.postDataJSON();
        if (failDelete) return route.fulfill({ status: 400, json: { code: "P0001", message: "Falha simulada na exclusão." } });
        deletions.push(value); rows.find((row) => row.id === value.p_id).deleted_at = "2026-10-14T12:00:00Z";
        return route.fulfill({ json: true });
      }
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: operator, legal_name: "APTech" }] });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: tenant } });
      if (url.includes("/rest/v1/supplier_payables")) return route.fulfill({ json: rows.filter((row) => !row.deleted_at) });
      if (url.includes("/rest/v1/supplier_payments")) return route.fulfill({ json: new URL(url).searchParams.get("supplier_payable_id")?.startsWith("eq.") ? [] : [{ supplier_payable_id: "entry-4", status: "scheduled" }] });
      if (url.includes("/rest/v1/supplier_payable_approval_requests")) return route.fulfill({ json: [{ id: "request", policy_name: "Alçada anterior", status: "cancelled", submitted_by_name: "Solicitante", submitted_at: "2026-10-01T12:00:00Z", cancellation_reason: "Lançamento alterado: ajuste solicitado" }] });
      if (url.includes("/rest/v1/supplier_payable_approval_steps")) return route.fulfill({ json: [{ id: "step", request_id: "request", step_order: 1, approver_name: "Responsável", status: "cancelled", decision_comment: "Alteração do lançamento" }] });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4173/finance/payables");
    await page.getByRole("button", { name: "Alterar MANUAL", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Alterar PAGO", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Excluir PAGO", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Alterar PROGRAMADO", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Alterar MANUAL", exact: true }).click();
    let dialog = page.getByRole("dialog");
    assert.equal(await dialog.locator("#edit-payable-description").inputValue(), "Conta MANUAL");
    await dialog.locator("#edit-payable-description").fill("Descartar edição");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(writes.length, 0);
    await page.getByRole("button", { name: "Alterar MANUAL", exact: true }).click();
    await dialog.locator("#edit-payable-description").fill("Licenças corrigidas");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await dialog.getByText("Informe o motivo com pelo menos 3 caracteres.", { exact: true }).waitFor();
    await dialog.locator("#edit-payable-reason").fill("Ajuste de valor e vencimento");
    await dialog.locator("#edit-payable-amount").fill("125,55");
    await dialog.locator("#edit-payable-due-date").fill("2026-11-30");
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({ path: `artifacts/payable-mutations/edit-${width}.png` });
    failEdit = true;
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.getByText(/Falha simulada na alteração/).waitFor();
    assert.equal(await dialog.locator("#edit-payable-description").inputValue(), "Licenças corrigidas");
    failEdit = false;
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(writes[0].p_total_amount, 125.55); assert.equal(writes[0].p_expected_revision, 0);
    assert.equal(rows[1].total_amount, 80);
    await page.getByRole("button", { name: "Detalhar MANUAL", exact: true }).click();
    await dialog.getByText("Encerrada", { exact: true }).waitFor();
    await dialog.getByText(/Etapa encerrada após alteração ou exclusão/).waitFor();
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Alterar CONTRATO", exact: true }).click();
    assert.equal(await dialog.locator("#edit-payable-amount").getAttribute("readonly"), "");
    assert.equal(await dialog.locator("#edit-payable-competence").getAttribute("readonly"), "");
    conflictEdit = true;
    await dialog.locator("#edit-payable-description").fill("Edição concorrente");
    await dialog.locator("#edit-payable-reason").fill("Testar revisão concorrente");
    await dialog.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.getByText(/Este lançamento foi atualizado por outra operação/).waitFor();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByText("Alterado por outro usuário", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Alterar CONTRATO", exact: true }).click();
    assert.equal(await dialog.locator("#edit-payable-description").inputValue(), "Alterado por outro usuário");
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Excluir MANUAL", exact: true }).click();
    let alert = page.getByRole("alertdialog");
    assert.equal(await alert.getByRole("button", { name: "Excluir lançamento", exact: true }).isDisabled(), true);
    await alert.getByRole("button", { name: "Cancelar", exact: true }).click();
    assert.equal(deletions.length, 0);
    await page.getByRole("button", { name: "Excluir MANUAL", exact: true }).click();
    await alert.locator("#delete-payable-reason").fill("Documento duplicado");
    await page.screenshot({ path: `artifacts/payable-mutations/delete-${width}.png`, animations: "disabled" });
    failDelete = true;
    await alert.getByRole("button", { name: "Excluir lançamento", exact: true }).click();
    await page.getByText(/Falha simulada na exclusão/).waitFor();
    assert.equal(await alert.locator("#delete-payable-reason").inputValue(), "Documento duplicado");
    failDelete = false;
    await alert.getByRole("button", { name: "Excluir lançamento", exact: true }).click();
    await alert.waitFor({ state: "hidden" });
    assert.equal(deletions[0].p_expected_revision, 1);
    assert.equal(await page.getByRole("button", { name: "Excluir MANUAL", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Alterar PARCELA-2", exact: true }).waitFor();
    readOnly = true;
    await page.reload();
    await page.getByRole("button", { name: "Detalhar PARCELA-2", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Alterar PARCELA-2", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Excluir PARCELA-2", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS payable edit/delete/cancel/errors/history/readonly/payment safeguards at ${width}px`);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/payable-mutations/failure.png" }); } throw error; }
finally { await browser?.close(); app.kill(); }
