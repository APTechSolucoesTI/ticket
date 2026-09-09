// Real frontend with mocked APIs: never creates real receivables/requests.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const files = readdirSync("apps/web/.output/server/_ssr");
function functionId(prefix, name) {
  const source = readFileSync(
    "apps/web/.output/server/_ssr/" + files.find((f) => f.startsWith(prefix)),
    "utf8",
  );
  return source.match(new RegExp('id: "([^"]+)",\\s+name: "' + name + '"'))[1];
}
const permissionsId = functionId("permissions.functions-", "getMyPermissions");
const reviewId = functionId("inter-charges.functions-", "getInterChargeReview");
const prepareId = functionId("inter-charges.functions-", "prepareInterCharge");
const payerReviewId = functionId("inter-charges.functions-", "getInterPayerReview");
const payerConfirmId = functionId("inter-charges.functions-", "confirmInterPayer");
const emitId = functionId("inter-charges.functions-", "emitInterSandboxCharge");
const receivable = {
  id: "e1000000-0000-0000-0000-000000000001",
  cliente_nome: "Cliente de teste",
  documento_referencia: "REC-TESTE",
  valor_original: 1500,
  valor_aberto: 1500,
  vencimento_em: "2026-10-15",
  status_cobranca: "a_faturar",
  billing_cycle_id: "cycle-test",
  competencia: "2026-09-01",
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
mkdirSync("artifacts/inter-settings", { recursive: true });
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    let editable = true,
      fail = false,
      payerFail = false,
      calls = 0,
      payerCalls = 0,
      emitCalls = 0,
      requests = [],
      payerState = "confirmation_required";
    const payerReview = () => ({
      state: payerState,
      missing_fields: payerState === "missing_data" ? ["tax_id", "zip"] : [],
      request_id: "e3000000-0000-0000-0000-000000000001",
      environment: "sandbox",
      binding_id: payerState === "binding_required" ? null : "e4000000-0000-0000-0000-000000000001",
      snapshot_id: payerState === "confirmed" ? "e5000000-0000-0000-0000-000000000001" : null,
      confirmed_at: payerState === "confirmed" ? "2026-09-09T12:10:00Z" : null,
      source_updated_at: "2026-09-09T11:00:00Z",
      source_fingerprint: "0123456789abcdef0123456789abcdef",
      seu_numero: "AP1234567890123",
      amount: 1500,
      due_date: "2026-10-15",
      payer: {
        name: "Cliente de teste",
        tax_id: "12345678000195",
        type: "JURIDICA",
        email: null,
        ddd: "11",
        phone: "999999999",
        street: "Rua Teste",
        number: "10",
        complement: null,
        district: "Centro",
        city: "São Paulo",
        state: "SP",
        zip: "01001000",
      },
      dispatch_enabled: false,
      canConfirm: editable,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const p = btoa(
        JSON.stringify({
          sub: "e2000000-0000-0000-0000-000000000001",
          email: "test@example.test",
          name: "Teste",
          tenant_id: "tenant-test",
          app: "apticket",
          exp: 4102444800,
        }),
      );
      localStorage.setItem("apticket_session_token", "test." + p + ".mock");
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.includes("/_serverFn/")) {
        if (url.includes(reviewId) && fail)
          return route.fulfill({
            json: { error: { message: "Falha de consulta simulada" }, context: {} },
          });
        if (url.includes(prepareId)) {
          calls++;
          requests = [
            {
              id: "e3000000-0000-0000-0000-000000000001",
              environment: "sandbox",
              amount: 1500,
              due_date: "2026-10-15",
              status: "blocked_homologation",
              created_at: "2026-09-09T12:00:00Z",
              deleted_at: null,
              dispatch_attempts: 0,
              dispatch_started_at: null,
              bank_request_id: null,
              bank_status: null,
              bank_accepted_at: null,
              last_error_code: null,
              last_error_message: null,
              updated_at: "2026-09-09T12:00:00Z",
            },
          ];
          return route.fulfill({
            json: {
              result: { id: "e3000000-0000-0000-0000-000000000001", reused: false },
              context: {},
            },
          });
        }
        if (url.includes(payerConfirmId)) {
          payerCalls++;
          payerState = "confirmed";
          return route.fulfill({
            json: {
              result: {
                id: "e5000000-0000-0000-0000-000000000001",
                reused: false,
                dispatch_enabled: false,
              },
              context: {},
            },
          });
        }
        if (url.includes(emitId)) {
          emitCalls++;
          requests[0] = {
            ...requests[0],
            status: "submitted",
            dispatch_attempts: 1,
            bank_request_id: "e6000000-0000-0000-0000-000000000001",
            bank_status: "EM_PROCESSAMENTO",
            bank_accepted_at: "2026-09-09T12:15:00Z",
            updated_at: "2026-09-09T12:15:00Z",
          };
          return route.fulfill({
            json: {
              result: {
                ok: true,
                state: "submitted",
                bank_request_id: requests[0].bank_request_id,
                reused: false,
                message: "Solicitação aceita pelo Inter e aguardando processamento assíncrono.",
              },
              context: {},
            },
          });
        }
        if (url.includes(payerReviewId) && payerFail)
          return route.fulfill({
            json: { error: { message: "Falha do pagador simulada" }, context: {} },
          });
        const result = url.includes(permissionsId)
          ? [
              { module: "financeiro", action: "view" },
              ...(editable ? [{ module: "financeiro", action: "edit" }] : []),
            ]
          : url.includes(payerReviewId)
            ? payerReview()
            : url.includes(reviewId)
              ? { receivable, canPrepare: editable, requests }
              : [];
        return route.fulfill({ json: { result, context: {} } });
      }
      if (url.includes("/rest/v1/contas_receber")) return route.fulfill({ json: [receivable] });
      if (!url.startsWith("http://127.0.0.1:4173")) return route.fulfill({ json: [] });
      return route.continue();
    });
    async function open() {
      await page.goto("http://127.0.0.1:4173/finance");
      const button = page.getByRole("button", { name: "Cobrança Inter", exact: true });
      try {
        await button.click();
      } catch (error) {
        console.error("UI diagnostic", {
          url: page.url(),
          body: (await page.locator("body").innerText()).slice(0, 1200),
          errors,
        });
        throw error;
      }
    }
    await open();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Nenhuma solicitação neste ambiente.").waitFor();
    const submit = dialog.getByRole("button", { name: "Registrar preparação", exact: true });
    assert.equal(await submit.isDisabled(), true);
    await dialog.getByRole("checkbox").check();
    await submit.click();
    await dialog.getByText("Aguardando homologação", { exact: true }).waitFor();
    assert.equal(calls, 1);
    assert.equal(
      await dialog.getByRole("button", { name: "Registrar preparação", exact: true }).count(),
      0,
    );
    await dialog.getByText("Confirmação necessária", { exact: true }).waitFor();
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Confirmar pagador", exact: true }).click();
    await dialog.getByText("Pagador confirmado", { exact: true }).waitFor();
    assert.equal(payerCalls, 1);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Emitir no sandbox", exact: true }).click();
    await dialog.getByText("Solicitação aceita pelo Inter", { exact: true }).waitFor();
    assert.equal(emitCalls, 1);
    assert.equal(
      await dialog.getByRole("button", { name: "Emitir no sandbox", exact: true }).count(),
      0,
    );
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 1001,
    );
    assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: `artifacts/inter-settings/charge-review-${width}.png` });
    payerState = "confirmation_outdated";
    await dialog.getByRole("button", { name: "Atualizar pagador" }).click();
    await dialog.getByText("Confirmação desatualizada", { exact: true }).waitFor();
    payerState = "missing_data";
    await dialog.getByRole("button", { name: "Atualizar pagador" }).click();
    await dialog.getByText("Cadastro incompleto", { exact: true }).waitFor();
    await dialog.getByText("CNPJ", { exact: true }).last().waitFor();
    assert.equal(await dialog.getByRole("link", { name: "Abrir cadastro de clientes" }).count(), 1);
    payerState = "binding_required";
    await dialog.getByRole("button", { name: "Atualizar pagador" }).click();
    await dialog.getByText("Vínculo bancário necessário", { exact: true }).waitFor();
    if (width === 1440) {
      payerFail = true;
      await dialog.getByRole("button", { name: "Atualizar pagador" }).click();
      await dialog.getByText("Dados do pagador indisponíveis", { exact: true }).waitFor();
      payerFail = false;
      await dialog.getByRole("button", { name: "Tentar novamente" }).click();
      await dialog.getByText("Vínculo bancário necessário", { exact: true }).waitFor();
    }
    payerState = "confirmed";
    await dialog.getByRole("button", { name: "Atualizar pagador" }).click();
    requests[0].amount = 1600;
    await dialog.getByRole("button", { name: "Atualizar consulta" }).click();
    await dialog.getByText("O recebível mudou", { exact: false }).waitFor();
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    requests[0].amount = 1500;
    payerState = "confirmation_required";
    editable = false;
    await page.reload();
    await page.getByRole("button", { name: "Cobrança Inter", exact: true }).click();
    await dialog.getByText("Somente leitura.", { exact: false }).first().waitFor();
    assert.equal(
      await dialog.getByRole("button", { name: "Registrar preparação", exact: true }).count(),
      0,
    );
    await dialog.getByRole("tab", { name: "Produção / Oficial" }).click();
    await dialog
      .getByText("Envio ao banco bloqueado em Produção / Oficial", { exact: false })
      .waitFor();
    assert.equal(
      await dialog.getByRole("button", { name: "Confirmar pagador", exact: true }).count(),
      0,
    );
    assert.equal(
      await dialog.getByRole("button", { name: "Emitir no sandbox", exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    if (width === 1440) {
      fail = true;
      await page.reload();
      await page.getByRole("button", { name: "Cobrança Inter", exact: true }).click();
      await dialog.getByRole("button", { name: "Tentar novamente" }).waitFor({ timeout: 20000 });
      fail = false;
      await dialog.getByRole("button", { name: "Tentar novamente" }).click();
      await dialog.getByText("Somente leitura.", { exact: false }).first().waitFor();
    }
    console.log(`PASS Inter payer states, confirmation, retry, read-only and layout ${width}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
