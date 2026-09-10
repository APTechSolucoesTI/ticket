// Teste visual com APIs simuladas: não acessa tenant nem Banco Inter reais.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const files = readdirSync("apps/web/.output/server/_ssr");
function functionId(prefix, name) {
  const file = files.find((candidate) => candidate.startsWith(prefix));
  const source = readFileSync(`apps/web/.output/server/_ssr/${file}`, "utf8");
  return source.match(new RegExp(`id: "([^"]+)",\\s+name: "${name}"`))[1];
}

const permissionsId = functionId("permissions.functions-", "getMyPermissions");
const listId = functionId("inter-settings.functions-", "listInterSettings");
const configureId = functionId("inter-settings.functions-", "configureInterWebhook");
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: process.env.TEST_HOST_RESOLVER
    ? [`--host-resolver-rules=${process.env.TEST_HOST_RESOLVER}`]
    : [],
});
mkdirSync("artifacts/inter-settings", { recursive: true });

try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    let active = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const payload = btoa(
        JSON.stringify({
          sub: "d2000000-0000-4000-8000-000000000001",
          email: "visual@example.test",
          name: "Administrador de teste",
          tenant_id: "d1000000-0000-4000-8000-000000000001",
          app: "apticket",
          exp: 4102444800,
        }),
      );
      localStorage.setItem("apticket_session_token", `test.${payload}.mock`);
    });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.includes("/_serverFn/")) {
        if (url.includes(configureId)) {
          active = true;
          return route.fulfill({
            json: {
              result: {
                ok: true,
                state: "registered",
                message: "Webhook de homologação configurado no Inter.",
              },
              context: {},
            },
          });
        }
        const result = url.includes(permissionsId)
          ? [
              { module: "configuracoes", action: "view" },
              { module: "empresa", action: "view" },
              { module: "empresa", action: "edit" },
            ]
          : url.includes(listId)
            ? [
                {
                  environment: "sandbox",
                  account: "123456",
                  is_active: true,
                  certificate_expires_at: "2040-01-01T00:00:00Z",
                  certificate_fingerprint: "TEST-FINGERPRINT",
                  version: 1,
                  updated_at: "2026-09-10T12:00:00Z",
                  webhook_status: active ? "active" : "not_configured",
                  webhook_callback_base_url: active
                    ? "https://apticket.example.test/backend/webhooks/inter/sandbox"
                    : null,
                  webhook_registered_at: active ? "2026-09-10T13:00:00Z" : null,
                  webhook_updated_at: active ? "2026-09-10T13:00:00Z" : null,
                  webhook_last_error_code: null,
                  webhook_last_error_message: null,
                },
              ]
            : [];
        return route.fulfill({ json: { result, context: {} } });
      }
      if (!url.startsWith(baseUrl)) return route.fulfill({ json: [] });
      return route.continue();
    });

    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("tab", { name: "Banco Inter", exact: true }).click();
    await page.getByText("Atualizações automáticas", { exact: true }).waitFor();
    await page.getByText("Não configurado", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Configurar webhook", exact: true }).click();
    await page.getByText("Webhook de homologação configurado no Inter.").waitFor();
    await page.getByText("Ativo", { exact: true }).waitFor();
    const bodyWidth = await page.locator("body").evaluate((element) => element.scrollWidth);
    assert.ok(bodyWidth <= width, `horizontal overflow at ${width}px`);
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `artifacts/inter-settings/webhook-active-${width}.png`,
      fullPage: true,
    });
    console.log(`PASS Inter webhook settings and layout ${width}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
