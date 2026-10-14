// Real UI with isolated API fixtures. SQL tests exercise the real database.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const directory = "apps/web/.output/server/_ssr";
const source = readFileSync(`${directory}/${readdirSync(directory).find((file) => file.startsWith("permissions.functions-"))}`, "utf8");
const permissionsId = source.match(/id:\s*"([^"]+)",\s*name:\s*"getMyPermissions"/)[1];
const operator = "ca300000-0000-4000-8000-000000000001";
const customer = "ca600000-0000-4000-8000-000000000001";
const supplier = "ca800000-0000-4000-8000-000000000001";
const categories = [1, 2].map((i) => ({ id: `ca400000-0000-4000-8000-00000000000${i}`, code: `10.01.000${i}`, name: i === 1 ? "Serviços" : "Licenças", direction: "both" }));
const centers = [1, 2].map((i) => ({ id: `ca500000-0000-4000-8000-00000000000${i}`, code: `20.01.000${i}`, name: i === 1 ? "Operações" : "Administração" }));
mkdirSync("artifacts/contract-allocations", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
let active;
try {
  for (const width of [1440, 768, 390]) for (const kind of ["customer", "supplier"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); active = page;
    const errors = []; let saved = null; let rows = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ sub: "ca200000-0000-4000-8000-000000000001", email: "teste@example.test", name: "Teste", tenant_id: "ca100000-0000-4000-8000-000000000001", app: "apticket", exp: 4102444800 }));
      localStorage.setItem("apticket_session_token", `test.${claims}.mock`);
    });
    await page.route("**/*", async (route) => {
      const request = route.request(), url = request.url();
      if (url.includes("/_serverFn/")) return route.fulfill({ json: { result: url.includes(permissionsId) ? ["contratos", "financeiro", "financeiro_contas_pagar"].flatMap((module) => ["view", "create", "edit", "delete"].map((action) => ({ module, action }))) : [], context: {} } });
      if (url.includes("/rest/v1/profiles")) return route.fulfill({ json: { tenant_id: "ca100000-0000-4000-8000-000000000001" } });
      if (url.includes("/rest/v1/operating_companies")) return route.fulfill({ json: [{ id: operator, legal_name: "APTech", trade_name: "APTech" }] });
      if (url.includes("/rest/v1/companies")) return route.fulfill({ json: [{ id: customer, name: "Cliente teste" }] });
      if (url.includes("/rest/v1/suppliers")) return route.fulfill({ json: [{ id: supplier, legal_name: "Fornecedor teste", is_active: true }] });
      if (url.includes("/rest/v1/financial_categories")) return route.fulfill({ json: categories });
      if (url.includes("/rest/v1/financial_cost_centers")) return route.fulfill({ json: centers });
      if (/\/rest\/v1\/(contracts|supplier_contracts)(\?|$)/.test(url)) {
        if (["POST", "PATCH"].includes(request.method())) {
          saved = request.postDataJSON();
          const enrich = (items, options) => items.map((item) => ({ ...item, ...options.find((option) => option.id === item.item_id) }));
          rows = [{ ...saved, id: "ca700000-0000-4000-8000-000000000001", numero_contrato: "CONT-001", category_allocations: enrich(saved.category_allocations, categories), cost_center_allocations: enrich(saved.cost_center_allocations, centers), companies: { name: "Cliente teste" }, operating_companies: { legal_name: "APTech" }, contract_types: null, sla_policies: null }];
          return route.fulfill({ json: kind === "customer" && request.method() === "POST" ? { id: rows[0].id } : null });
        }
        return route.fulfill({ json: rows });
      }
      if (!url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:4173/${kind === "customer" ? "contracts" : "supplier-contracts"}`);
    await page.getByRole("button", { name: "Novo contrato", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const save = dialog.getByRole("button", { name: "Salvar", exact: true });
    assert.equal(await save.isDisabled(), true);
    const categoryGroup = dialog.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Categorias financeiras" }) });
    const centerGroup = dialog.locator("fieldset").filter({ has: page.locator("legend", { hasText: "Centros de custo" }) });
    async function choose(trigger, name) { await trigger.click(); await page.getByRole("option", { name, exact: true }).click(); }
    for (const [group, type, options, percentage] of [[categoryGroup, "categoria", categories, "70"], [centerGroup, "centro de custo", centers, "60"]]) {
      await group.getByRole("button", { name: `Adicionar ${type}`, exact: true }).click();
      assert.equal(await group.locator("input").first().inputValue(), "100");
      await choose(group.getByRole("combobox").first(), `${options[0].code} · ${options[0].name}`);
      await group.locator("input").first().fill(percentage);
      await group.getByRole("button", { name: `Adicionar ${type}`, exact: true }).click();
      assert.equal(await group.locator("input").nth(1).inputValue(), String(100 - Number(percentage)));
      await group.getByRole("combobox").nth(1).click();
      assert.equal(await page.getByRole("option", { name: `${options[0].code} · ${options[0].name}`, exact: true }).getAttribute("data-disabled"), "");
      await page.getByRole("option", { name: `${options[1].code} · ${options[1].name}`, exact: true }).click();
    }
    await save.waitFor({ state: "visible" });
    await categoryGroup.locator("input").first().fill("69");
    await categoryGroup.getByText("Total: 99% · faltam 1%", { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    await categoryGroup.locator("input").first().fill("70.001");
    assert.equal(await save.isDisabled(), true);
    await categoryGroup.locator("input").first().fill("70");
    await centerGroup.locator("input").first().fill("0");
    assert.equal(await save.isDisabled(), true);
    await centerGroup.locator("input").first().fill("60");
    await choose(dialog.getByText(kind === "customer" ? "Cliente *" : "Fornecedor *", { exact: true }).locator("..").getByRole("combobox"), kind === "customer" ? "Cliente teste" : "Fornecedor teste");
    if (kind === "supplier") {
      await dialog.getByText("Descrição do contrato", { exact: true }).locator("..").locator("input,textarea").fill("Suporte e licenças");
      await dialog.getByText("Valor do contrato (R$)", { exact: true }).locator("..").locator("input").fill("100,01");
    }
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth), false);
    await categoryGroup.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/contract-allocations/${kind}-${width}.png` });
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(saved.category_allocations.map((row) => row.percentage), ["70", "30"]);
    assert.deepEqual(saved.cost_center_allocations.map((row) => row.percentage), ["60", "40"]);
    await page.getByRole("button", { name: "Editar contrato CONT-001", exact: true }).click();
    assert.equal(await categoryGroup.locator("input").first().inputValue(), "70");
    assert.equal(await categoryGroup.locator("input").nth(1).inputValue(), "30");
    await categoryGroup.locator("input").first().fill("40");
    await categoryGroup.locator("input").nth(1).fill("60");
    await centerGroup.getByRole("button", { name: "Remover centros de custo 2", exact: true }).click();
    await centerGroup.locator("input").first().fill("100");
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(saved.category_allocations.map((row) => row.percentage), ["40", "60"]);
    assert.deepEqual(saved.cost_center_allocations.map((row) => row.percentage), ["100"]);
    assert.deepEqual(errors, []);
    console.log(`PASS ${kind} allocation create/edit/remove at ${width}px`);
    await page.close();
  }
} catch (error) { if (active) { console.error(await active.locator("body").innerText()); await active.screenshot({ path: "artifacts/contract-allocations/failure.png" }); } throw error; }
finally { await browser.close(); }
