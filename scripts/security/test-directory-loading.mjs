import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startLocalApp } from "./local-app.mjs";

const require = createRequire(
  new URL("../../node_modules/.cache/atomic-flow-tools/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const jwt = createRequire(new URL("../../apps/web/package.json", import.meta.url))("jsonwebtoken");
const id = "bc400000-0000-4000-8000-000000000001";
const userId = "bc100000-0000-4000-8000-000000000001";
const tenantId = "bc200000-0000-4000-8000-000000000001";
const permissions = ["clientes", "fornecedores", "contratos", "contratos_fornecedores"].flatMap(
  (module) => ["view", "create", "edit"].map((action) => ({ module, action, effective: true })),
);
const app = await startLocalApp((request, response) => {
  const url = new URL(request.url, "http://fixture");
  const data = url.pathname.endsWith("/get_effective_permissions")
    ? permissions
    : { id: userId, tenant_id: tenantId, is_active: true };
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
});
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const token = jwt.sign(
    {
      email: "operator@example.test",
      tenant_id: tenantId,
      session_version: 0,
      app: "apticket",
      role: "authenticated",
      aud: "authenticated",
    },
    "isolated-security-test-jwt-key",
    { subject: userId, expiresIn: "1h" },
  );
  const fixtures = {
    companies: {
      id,
      name: "Cliente de teste",
      cnpj: "04.252.011/0001-10",
      notes: "Detalhe do cliente",
      cnaes: [],
    },
    suppliers: {
      id,
      legal_name: "Fornecedor de teste",
      category: "other",
      notes: "Detalhe do fornecedor",
      cnaes: [],
    },
    contracts: {
      id,
      numero_contrato: "CT-TESTE",
      ends_at: "2030-01-01",
      category_allocations: [],
      cost_center_allocations: [],
      financial_category_id: id,
      cost_center_id: id,
      financial_categories: { code: "1", name: "Categoria de teste" },
      financial_cost_centers: { code: "2", name: "Centro de teste" },
    },
    operating_companies: { id, legal_name: "Operadora de teste" },
    supplier_contracts: {
      id,
      operating_company_id: id,
      supplier_id: id,
      numero_contrato: "CT-FOR-TESTE",
      billing_unit: "fixed",
      tipo_medicao: "mensal",
      status: "active",
      base_amount: 100,
    },
  };
  for (const [path, table, label] of [
    ["customers", "companies", "cliente Cliente de teste"],
    ["suppliers", "suppliers", "Fornecedor de teste"],
    ["contracts", "contracts", "contrato CT-TESTE"],
    ["supplier-contracts", "supplier_contracts", "contrato CT-FOR-TESTE"],
  ]) {
    const page = await browser.newPage();
    const calls = [];
    const receivedContracts = Promise.withResolvers();
    const operatorResponse = Promise.withResolvers();
    await page.addInitScript(
      (value) => localStorage.setItem("apticket_session_token", value),
      token,
    );
    await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) =>
      route.abort(),
    );
    await page.route("https://fixture-supabase.example.test/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const resource = url.pathname.split("/").at(-1);
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "content-type": "application/json",
      };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      const selection = url.searchParams.get("select");
      const singleRecord = url.searchParams.has("id");
      calls.push({ resource, selection, singleRecord, method: request.method() });
      if (resource === "supplier_contracts") receivedContracts.resolve();
      if (resource === "get_supplier_contract_options") {
        await receivedContracts.promise;
        return route.fulfill({
          headers,
          json: {
            companies: [fixtures.operating_companies],
            suppliers: [fixtures.suppliers],
          },
        });
      }
      if (resource === "operating_companies" && table === "contracts") {
        await operatorResponse.promise;
      }
      if (resource === "companies" && request.method() === "PATCH") {
        return route.fulfill({
          status: 409,
          headers,
          json: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "companies_tenant_cnpj_uidx"',
          },
        });
      }
      const fixture = fixtures[resource];
      let data = fixture ? [fixture] : [];
      if (fixture && singleRecord) data = fixture;
      else if (fixture && selection && !selection.includes("notes")) {
        data = [Object.fromEntries(Object.entries(fixture).filter(([field]) => field !== "notes"))];
      }
      return route.fulfill({ headers, body: JSON.stringify(data) });
    });
    await page.goto(`${app.origin}/${path}`);
    const list = page.getByRole("table");
    await list.waitFor({ timeout: 7500 }).catch(async (error) => {
      throw new Error(await page.locator("body").innerText(), { cause: error });
    });
    const listCall = calls.find((call) => call.resource === table && !call.singleRecord);
    assert.ok(listCall, `expected ${table} list request`);
    assert.ok(!listCall.selection.startsWith("*"), `${table} must select only relevant columns`);
    if (table === "contracts") {
      assert.ok(listCall.selection.includes("!contracts_financial_category_tenant_fk"));
      assert.ok(listCall.selection.includes("!contracts_cost_center_tenant_fk"));
      assert.equal(calls.filter((call) => call.resource === "contracts").length, 1);
      assert.equal(
        calls.filter((call) =>
          [
            "companies",
            "operating_companies",
            "contract_types",
            "sla_policies",
            "financial_categories",
            "financial_cost_centers",
          ].includes(call.resource),
        ).length,
        0,
      );
      await list.getByText("1 - Categoria de teste", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Novo contrato", exact: true }).click();
      const description = page.getByPlaceholder(/Resumo exibido ao abrir tickets/);
      await description.fill("Descrição digitada antes de carregar a operadora");
      operatorResponse.resolve();
      await page.getByRole("combobox").filter({ hasText: "Operadora de teste" }).waitFor();
      assert.equal(
        await description.inputValue(),
        "Descrição digitada antes de carregar a operadora",
      );
    } else if (table === "supplier_contracts") {
      await list.getByText(fixtures.suppliers.legal_name, { exact: true }).waitFor();
      await list.getByText(fixtures.operating_companies.legal_name, { exact: true }).waitFor();
    } else {
      assert.ok(!listCall.selection.split(",").includes("notes"));
      assert.equal(calls.filter((call) => call.resource === table && call.singleRecord).length, 0);
      await list.getByRole("button", { name: `Editar ${label}`, exact: true }).click();
      await page.locator("textarea").filter({ visible: true }).first().waitFor();
      const notes = page.getByRole("dialog").locator("textarea").last();
      assert.equal(await notes.inputValue(), fixtures[table].notes);
      assert.equal(calls.filter((call) => call.resource === table && call.singleRecord).length, 1);
      if (table === "companies") {
        await page.getByRole("button", { name: "Salvar", exact: true }).click();
        await page.getByText("Já existe um cliente cadastrado com este CNPJ.").waitFor();
        assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
        assert.equal(calls.filter((call) => call.resource === "companies").length, 3);

        await page.goto(`${app.origin}/customers?record=${id}`);
        await notes.waitFor();
        assert.equal(await notes.inputValue(), fixtures[table].notes);
      }
    }
    console.log(`PASS ${path} list projection and deferred requests`);
    await page.close();
  }
} finally {
  await browser?.close();
  await app.close();
}
