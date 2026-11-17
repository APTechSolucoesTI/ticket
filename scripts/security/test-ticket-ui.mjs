// Optional browser QA: install playwright in the ignored atomic-flow-tools directory.
// Requires a node-server build with VITE_SUPABASE_URL=https://fixture-supabase.example.test.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { startLocalApp } from "./local-app.mjs";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const fixtureRequire = createRequire(
  new URL("../../node_modules/.cache/atomic-flow-tools/package.json", import.meta.url),
);
const { chromium } = fixtureRequire("playwright");
const jwt = webRequire("jsonwebtoken");
const id = "bc100000-0000-4000-8000-000000000001",
  tenant = "bc200000-0000-4000-8000-000000000001";
const profile = {
  id,
  tenant_id: tenant,
  name: "Operador de teste",
  email: "operator@example.test",
  is_active: true,
  phone: null,
  avatar_url: null,
};
const permissions = ["tickets", "clientes", "contatos", "usuarios", "contratos"].map((module) => ({
  module,
  action: "view",
  effective: true,
}));
const app = await startLocalApp((request, response) => {
  const url = new URL(request.url, "http://fixture");
  const data = url.pathname.endsWith("/get_effective_permissions")
    ? permissions
    : url.pathname.endsWith("/profiles")
      ? profile
      : [];
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
});
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const requests = [],
  errors = [];
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const token = jwt.sign(
  {
    email: profile.email,
    name: profile.name,
    tenant_id: tenant,
    session_version: 0,
    app: "apticket",
    role: "authenticated",
    aud: "authenticated",
  },
  "isolated-security-test-jwt-key",
  { subject: id, expiresIn: "1h" },
);
await page.addInitScript((token) => localStorage.setItem("apticket_session_token", token), token);
page.on("pageerror", (error) => errors.push(error.message));
const now = new Date().toISOString();
const rows = Array.from({ length: 1205 }, (_, index) => ({
  id: `bc400000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  tenant_id: tenant,
  number: index + 1,
  subject: `Chamado ${index + 1}`,
  status: "new",
  pending_type: null,
  priority: "medium",
  channel: "manual",
  company_id: null,
  contact_id: null,
  contract_id: null,
  tipo_atendimento: "contratual",
  motivo_avulso: null,
  department_id: null,
  assigned_to: null,
  created_at: now,
  sla_resolution_due_at: null,
  sla_paused_at: null,
  resolved_at: null,
  closed_at: null,
  resolution_summary: null,
  companies: { name: "Ação Clínica" },
  contacts: { name: "Cliente de teste" },
  assigneeName: null,
}));
const metrics = {
  newCount: 1205,
  inProgress: 0,
  pending: 0,
  finished: 0,
  openCount: 1205,
  slaAtRisk: 0,
  currentPeriodCount: 1205,
  previousPeriodCount: 0,
  averageResolutionHours: 0,
  summary: {
    inProgress: 0,
    pending: 0,
    finished: 0,
    last7Count: 1205,
    last7DailyAverage: 1205 / 7,
    trendPercent: 100,
    averageResolutionMs: null,
    resolutionSample: 0,
  },
  latest: rows.slice(-6).reverse(),
  timezone: "America/Sao_Paulo",
};
let failLists = false;
let delayedSize = null;
await page.route("https://fixture-supabase.example.test/**", async (route) => {
  const request = route.request(),
    url = new URL(request.url()),
    body = request.postDataJSON() ?? {};
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "content-type": "application/json",
  };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  let data = [];
  if (url.pathname.endsWith("/list_ticket_inbox")) {
    requests.push(body);
    if (body._page_size === 100 && delayedSize) await delayedSize.promise;
    if (failLists)
      return route.fulfill({
        status: 500,
        headers,
        body: JSON.stringify({ message: "private database detail must stay hidden" }),
      });
    let matching = rows.filter(
      (row) =>
        !body._search ||
        `${row.subject} Ação Clínica`.toLowerCase().includes(body._search.toLowerCase()),
    );
    if (body._filters?.status?.length)
      matching = matching.filter((row) => body._filters.status.includes(row.status));
    if (body._sort_key === "number")
      matching.sort((a, b) => (a.number - b.number) * (body._sort_direction === "asc" ? 1 : -1));
    else matching.reverse();
    const total = matching.length,
      size = body._page_size,
      page = Math.max(1, Math.min(body._page, Math.ceil(total / size)));
    data = { items: matching.slice((page - 1) * size, page * size), total, page, pageSize: size };
  } else if (url.pathname.endsWith("/get_ticket_metrics")) {
    data = {
      ...metrics,
      volume: Array.from({ length: body._period_days }, (_, index) => ({
        date: `${index + 1}/11`,
        iso: `2026-11-${String(index + 1).padStart(2, "0")}`,
        criados: index === 0 ? 1205 : 0,
        resolvidos: 0,
      })),
    };
  } else if (url.pathname.endsWith("/profiles")) data = [profile];
  return route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
});
await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) =>
  route.abort(),
);
const directory = "node_modules/.cache/ticket-ui-qa";
await mkdir(directory, { recursive: true });
async function waitForText(text) {
  await page.getByText(text, { exact: true }).first().waitFor({ timeout: 20000 });
}
try {
  const canonical = await fetch(`${app.origin}/tickets`, { redirect: "manual" });
  assert.ok([200, 307].includes(canonical.status));
  assert.equal(
    new URL(canonical.headers.get("location") ?? "/tickets", app.origin).searchParams.has(
      "pageSize",
    ),
    false,
    "SSR must preserve an omitted page size",
  );
  await page.goto(`${app.origin}/tickets`);
  await waitForText("1–10 de 1205");
  assert.equal(await page.locator("tbody tr").count(), 10);
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  const draftTechnician = page
    .getByRole("dialog")
    .getByText("Técnico", { exact: true })
    .locator("..")
    .getByRole("checkbox");
  await draftTechnician.uncheck();
  const refetched = page.waitForResponse((response) =>
    response.url().endsWith("/list_ticket_inbox"),
  );
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await refetched;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await draftTechnician.isChecked(),
    false,
    "a background refresh must preserve the draft",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent?.includes("Colunas"));
  await page.getByRole("button", { name: "Próxima página", exact: true }).first().click();
  await waitForText("11–20 de 1205");
  assert.equal(new URL(page.url()).searchParams.get("page"), "2");
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: "Exibir #", exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("checkbox", { name: "Exibir Técnico", exact: true }).uncheck();
  await page.getByRole("button", { name: "Mover Assunto para cima", exact: true }).click();
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await waitForText("11–20 de 1205");
  assert.equal(await page.getByRole("columnheader", { name: "Técnico", exact: true }).count(), 0);
  assert.equal(await page.locator("th").first().textContent(), "Assunto");
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  await page.getByRole("button", { name: "Restaurar padrão", exact: true }).click();
  assert.equal(
    await page.getByRole("checkbox", { name: "Exibir Empresa", exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "Exibir Técnico", exact: true }).isChecked(),
    true,
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(await page.getByRole("columnheader", { name: "Técnico", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  await page.getByRole("button", { name: "Restaurar padrão", exact: true }).click();
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await waitForText("11–20 de 1205");
  assert.equal(await page.locator("th").first().textContent(), "#");
  await page.getByRole("columnheader", { name: "#" }).getByRole("button").focus();
  await page.keyboard.press("Enter");
  await waitForText("1–10 de 1205");
  assert.ok(requests.some((r) => r._sort_key === "number" && r._sort_direction === "asc"));
  assert.equal(await page.locator("tbody tr").first().locator("td").first().textContent(), "#1");
  await page.goBack();
  await waitForText("11–20 de 1205");
  await page.goForward();
  await waitForText("1–10 de 1205");
  await page.getByLabel("Buscar tickets", { exact: true }).fill("Chamado 1205");
  await waitForText("1–1 de 1");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByLabel("Buscar tickets", { exact: true }).fill("missing result");
  await page.getByText("Nenhum ticket corresponde aos filtros", { exact: true }).waitFor();
  await page.getByLabel("Buscar tickets", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await waitForText("1–10 de 1205");
  await page.getByRole("button", { name: "Exibir tickets em kanban" }).click();
  await page.getByText("O quadro exibe os tickets da página atual.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Exibir tickets em lista" }).click();
  await waitForText("1–10 de 1205");
  await page.goto(`${app.origin}/tickets?page=3`);
  await waitForText("21–30 de 1205");
  let release;
  delayedSize = {
    promise: new Promise((resolve) => {
      release = resolve;
    }),
  };
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  await page.getByLabel("Registros por página", { exact: true }).click();
  await page.getByRole("option", { name: "100 registros", exact: true }).click();
  await page.context().setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false);
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[aria-label="Próxima página"]')).every(
      (button) => button.disabled,
    ),
  );
  assert.equal(new URL(page.url()).searchParams.get("pageSize"), "100");
  assert.equal(
    await page.getByRole("button", { name: "Colunas", exact: true }).isDisabled(),
    true,
    "cannot open settings on a pending snapshot",
  );
  await page
    .getByRole("button", { name: "Próxima página", exact: true })
    .first()
    .evaluate((button) => button.click());
  assert.equal(new URL(page.url()).searchParams.get("page"), "1");
  const resumed = page.waitForRequest(
    (request) =>
      request.url().endsWith("/list_ticket_inbox") && request.postDataJSON()?._page_size === 100,
  );
  await page.context().setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true);
  await resumed;
  assert.equal(
    await page.getByRole("button", { name: "Próxima página", exact: true }).first().isDisabled(),
    true,
  );
  release();
  delayedSize = null;
  await waitForText("1–100 de 1205");
  assert.equal(await page.locator("tbody tr").count(), 100);
  const restoreStart = requests.length;
  await page.goto(`${app.origin}/tickets`);
  await waitForText("1–100 de 1205");
  assert.ok(
    requests.slice(restoreStart).every((request) => request._page_size === 100),
    "restoring a preference must not query a provisional size",
  );
  assert.equal(new URL(page.url()).searchParams.get("pageSize"), "100");
  await page.goto(`${app.origin}/tickets?pageSize=20`);
  await waitForText("1–20 de 1205");
  await page.goto(`${app.origin}/tickets`);
  await waitForText("1–100 de 1205");
  await page.goto(`${app.origin}/tickets?pageSize=10`);
  await waitForText("1–10 de 1205");
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 768, 1024],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    if (name === "mobile") {
      const filtersButton = page.getByRole("button", { name: "Filtros (3)", exact: true });
      await page.locator("body").click({ position: { x: 5, y: 100 } });
      await page.keyboard.press("f");
      assert.equal(
        await filtersButton.evaluate((button) => button === document.activeElement),
        true,
      );
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Departamento: todos", exact: true }).waitFor();
      await filtersButton.click();
      assert.equal(await filtersButton.getAttribute("aria-expanded"), "false");
    }
    for (const theme of ["light", "dark"]) {
      if (
        (await page.locator("html").evaluate((element) => element.classList.contains("dark"))) !==
        (theme === "dark")
      )
        await page.getByRole("button", { name: "Alternar tema" }).click();
      await page.screenshot({ path: `${directory}/tickets-${name}-${theme}.png`, fullPage: true });
      await page.getByRole("button", { name: "Colunas", exact: true }).click();
      await page.screenshot({ path: `${directory}/columns-${name}-${theme}.png`, fullPage: true });
      await page.keyboard.press("Escape");
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name}: page must not overflow horizontally`,
      );
    }
    if (name === "mobile") {
      await page
        .getByRole("navigation", { name: "Paginação da listagem", exact: true })
        .last()
        .scrollIntoViewIfNeeded();
      const offset = await page.locator("table").evaluate((table) => {
        const scroll = table.parentElement;
        scroll.scrollLeft = scroll.scrollWidth;
        return Math.abs(
          table.querySelector("tbody td").getBoundingClientRect().left -
            scroll.getBoundingClientRect().left,
        );
      });
      assert.ok(offset < 8, "mobile identifier stays visible while scrolling horizontally");
      await page.screenshot({ path: `${directory}/tickets-mobile-scrolled.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app.origin}/dashboard`);
  await page.getByRole("heading", { name: "Olá, Operador de teste!" }).waitFor();
  await page.getByText("1205", { exact: true }).first().waitFor();
  assert.equal(
    await page.locator("html").evaluate((element) => element.classList.contains("dark")),
    true,
  );
  await page.screenshot({ path: `${directory}/dashboard-desktop-dark.png`, fullPage: true });
  for (const [name, width, height] of [
    ["tablet", 768, 1024],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${directory}/dashboard-${name}-dark.png`, fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `dashboard ${name}: no overflow`,
    );
    await page.getByText("Últimos tickets", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${directory}/dashboard-${name}-latest-dark.png`,
      fullPage: true,
    });
  }
  failLists = true;
  await page.goto(`${app.origin}/tickets?search=error-fixture`);
  await page
    .getByText("Não foi possível carregar os tickets", { exact: true })
    .waitFor({ timeout: 25000 });
  assert.ok(!(await page.locator("body").textContent()).includes("private database detail"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser QA: draft retention, identifiers, apply/cancel/defaults, persisted sizes and explicit URLs; remote/offline pagination, list/kanban and safe errors; desktop/tablet/mobile, light/dark, keyboard and fallback fonts",
  );
  console.log(`Screenshots: ${directory}`);
} catch (error) {
  console.error(
    "Table preference diagnostics",
    await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(localStorage)
          .filter((key) => key.startsWith("table:") || key.startsWith("cols:"))
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    ),
  );
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true });
  console.error(
    "Browser errors",
    errors,
    "Current URL",
    page.url(),
    "Recent queries",
    requests.slice(-3),
    "App diagnostics",
    app.diagnostics(),
  );
  throw error;
} finally {
  await browser.close();
  await app.close();
}
