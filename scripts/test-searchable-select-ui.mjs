// Real application with isolated APIs: never writes tickets or bank bindings in production.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
function functionId(prefix, name) {
  const source = readFileSync(`${directory}/${readdirSync(directory).find(file => file.startsWith(prefix))}`, "utf8");
  return source.match(new RegExp(`id:\\s*"([^"]+)",\\s*name:\\s*"${name}"`))[1];
}
const permissionsId = functionId("permissions.functions-", "getMyPermissions");
const companiesId = functionId("inter-binding.functions-", "listInterOperatingCompanies");
const reviewId = functionId("inter-binding.functions-", "getInterBindingReview");
const user = "ae200000-0000-4000-8000-000000000001";
const tenant = "ae100000-0000-4000-8000-000000000001";
const ticketId = "ae300000-0000-4000-8000-000000000001";
const otherAgent = "ae200000-0000-4000-8000-000000000002";
const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], { env: { ...process.env, PORT: "4174", HOST: "127.0.0.1", SUPABASE_URL: "http://127.0.0.1:4189", SUPABASE_PUBLISHABLE_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture", JWT_SECRET: "searchable-select-isolated-test-secret" }, stdio: "ignore" });
let browser, active;
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch("http://127.0.0.1:4174")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  mkdirSync("artifacts/searchable-select", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const width of [1440, 768, 390]) {
    const errors = [], writes = [];
    let editable = true;
    const ticket = { id: ticketId, tenant_id: tenant, number: 123, subject: "Revisão de seletores", status: "in_progress", priority: "medium", channel: "email", assigned_to: user, created_at: "2026-10-15T12:00:00Z", companies: null, contacts: null, company_id: null, contact_id: null, total_sla_paused_seconds: 0 };
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); active = page;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(({ user, tenant }) => {
      const claims = btoa(JSON.stringify({ sub: user, tenant_id: tenant, name: "Teste", email: "test@example.test", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    }, { user, tenant });
    await page.route("**/*", async route => {
      const request = route.request(), url = request.url(), parsed = new URL(url);
      if (url.includes("/_serverFn/")) {
        const result = url.includes(permissionsId) ? ["tickets", "financeiro", "financeiro_contas_pagar", "financeiro_bancos"].flatMap(module => ["view", ...(editable ? ["edit"] : [])].map(action => ({ module, action })))
          : url.includes(companiesId) ? [{ id: "operator-a", legal_name: "Operadora Alfa", tax_id: "36471917000111" }, { id: "operator-b", legal_name: "Operadora Ágil", tax_id: "36471917000111" }]
          : url.includes(reviewId) ? { state: "confirmation_required", configuration_version: 5, account_last_four: "5678", certificate_expires_at: "2027-10-09T00:00:00Z", binding_id: null, confirmed_at: null, canConfirm: true } : [];
        return route.fulfill({ json: { result, context: {} } });
      }
      if (parsed.pathname === "/rest/v1/tickets") {
        if (request.method() === "PATCH") { const patch = request.postDataJSON(); writes.push(patch); Object.assign(ticket, patch); }
        return route.fulfill({ json: ticket });
      }
      if (parsed.pathname === "/rest/v1/profiles") return route.fulfill({ json: parsed.searchParams.has("order") ? [{ id: user, name: "Teste" }, { id: otherAgent, name: "Técnico Ágil" }] : { name: "Teste", tenant_id: tenant } });
      if (parsed.pathname === "/rest/v1/canned_responses") return route.fulfill({ json: [{ id: "canned", title: "Confirmação de atendimento", body: "Atendimento {{ticket}} em análise." }] });
      if (parsed.pathname === "/rest/v1/pause_reasons") return route.fulfill({ json: [{ id: "pause", name: "Aguardando autorização" }, { id: "other", name: "Outro" }] });
      if (url.includes("/rest/v1/") || !url.startsWith("http://127.0.0.1:4174")) return route.fulfill({ json: [] });
      return route.continue();
    });
    const popup = page.getByRole("dialog", { name: "Selecionar opção", exact: true });
    const search = page.getByRole("combobox", { name: "Buscar opções", exact: true });
    async function choose(trigger, query, label) {
      await trigger.click(); await search.fill(query);
      await page.getByRole("option", { name: label, exact: true }).click();
      await popup.waitFor({ state: "hidden" });
    }
    await page.goto(`http://127.0.0.1:4174/tickets/${ticketId}`);
    const status = page.getByRole("combobox", { name: "Status do ticket", exact: true });
    await status.waitFor();
    await choose(status, "atendimento", "Em atendimento");
    assert.equal(writes.length, 0);
    const canned = page.getByRole("combobox", { name: "Respostas padrão", exact: true });
    await choose(canned, "confirmacao", "Confirmação de atendimento");
    await choose(canned, "confirmacao", "Confirmação de atendimento");
    const reply = page.locator("textarea").first();
    assert.equal(await reply.inputValue(), "Atendimento #123 em análise.\n\nAtendimento #123 em análise.");
    assert.match(await canned.innerText(), /Respostas padrão/);
    await page.getByRole("button", { name: "Pausar atendimento", exact: true }).click();
    const pauseDialog = page.getByRole("dialog", { name: "Pausar atendimento", exact: true });
    await choose(pauseDialog.locator("#pause-reason"), "autorizacao", "Aguardando autorização");
    assert.match(await pauseDialog.locator("#pause-reason").innerText(), /Aguardando autorização/);
    await pauseDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    const assignee = page.getByRole("combobox", { name: "Técnico responsável", exact: true });
    await choose(assignee, "tecnico agil", "Técnico Ágil");
    await page.waitForFunction(() => document.body.innerText.includes("Técnico Ágil"));
    assert.equal(writes.at(-1).assigned_to, otherAgent);
    ticket.assigned_to = user;
    await page.reload();
    await choose(assignee, "nao atribuido", "Não atribuído");
    await assignee.filter({ hasText: "Não atribuído" }).waitFor();
    assert.equal(writes.at(-1).assigned_to, null);
    editable = false; ticket.assigned_to = user;
    await page.reload(); await status.waitFor();
    assert.equal(await status.isDisabled(), true);
    assert.equal(await assignee.isDisabled(), true);
    editable = true;
    await page.goto("http://127.0.0.1:4174/finance/banking");
    await page.getByRole("button", { name: "Empresa operadora", exact: true }).click();
    const binding = page.getByRole("dialog", { name: "Empresa operadora", exact: true });
    await binding.getByRole("checkbox").check();
    await choose(binding.getByRole("combobox", { name: "Empresa operadora", exact: true }), "agil", "Operadora Ágil");
    assert.equal(await binding.getByRole("checkbox").isChecked(), false);
    assert.match(await binding.getByRole("combobox", { name: "Empresa operadora", exact: true }).innerText(), /Operadora Ágil/);
    await binding.getByRole("combobox", { name: "Empresa operadora", exact: true }).click();
    await search.waitFor();
    await page.screenshot({ path: `artifacts/searchable-select/operator-${width}.png`, animations: "disabled" });
    const bounds = await popup.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 1001);
    assert.deepEqual(errors, []);
    console.log(`PASS ticket status, repeated canned response, pause reason, assignee ID/null, readonly, bank operator at ${width}px`);
    await page.close();
  }
} catch (error) {
  if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/searchable-select/failure.png" }); }
  throw error;
} finally { await browser?.close(); app.kill(); }
