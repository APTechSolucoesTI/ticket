// Isolated browser QA. Requires a fixture-only node-server build, as test-ticket-ui.mjs does.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { startLocalApp } from "./local-app.mjs";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const fixtureRequire = createRequire(
  new URL("../../node_modules/.cache/atomic-flow-tools/package.json", import.meta.url),
);
const { chromium } = fixtureRequire("playwright");
const jwt = webRequire("jsonwebtoken");
const XLSX = webRequire("xlsx");
const directory = "node_modules/.cache/contact-channel-ui-qa";
await mkdir(directory, { recursive: true });
const userId = "bc100000-0000-4000-8000-000000000001";
const tenantId = "bc200000-0000-4000-8000-000000000001";
const company = { id: "bc300000-0000-4000-8000-000000000001", name: "Empresa de teste" };
const profile = {
  id: userId,
  tenant_id: tenantId,
  name: "Operador de teste",
  email: "operator@example.test",
  is_active: true,
  phone: null,
  avatar_url: null,
};
const permissions = [
  ...["view", "create", "edit"].map((action) => ({ module: "contatos", action, effective: true })),
  { module: "clientes", action: "view", effective: true },
];
const contacts = [];
const writes = [];
const portalRequests = [];
const errors = [];
const checks = [];
const observations = [];
let failContactList = false;
let contactListBatchLimit = 1000;
let contactListTimeouts = 0;
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
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const token = jwt.sign(
  {
    email: profile.email,
    name: profile.name,
    tenant_id: tenantId,
    session_version: 0,
    app: "apticket",
    role: "authenticated",
    aud: "authenticated",
  },
  "isolated-security-test-jwt-key",
  { subject: userId, expiresIn: "1h" },
);
await page.addInitScript((value) => localStorage.setItem("apticket_session_token", value), token);
page.on("pageerror", (error) => errors.push(error.message));
await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) =>
  route.abort(),
);
await page.route("https://fixture-supabase.example.test/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "content-type": "application/json",
  };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  let data = [];
  if (url.pathname.endsWith("/profiles")) data = profile;
  if (url.pathname.endsWith("/companies")) data = [company];
  if (url.pathname.endsWith("/contacts")) {
    if (request.method() === "GET" && failContactList) {
      return route.fulfill({
        status: 400,
        headers,
        json: { code: "PGRST200", message: "Test query rejected" },
      });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      const inserted = (Array.isArray(body) ? body : [body]).map((values) => ({
        id: `bc400000-0000-4000-8000-${String(contacts.length + 1).padStart(12, "0")}`,
        secondary_emails: [],
        secondary_phones: [],
        ...values,
        companies: { name: company.name },
        contact_companies: Array.isArray(body)
          ? []
          : [{ company_id: company.id, companies: { name: company.name } }],
      }));
      // IDs are stable even for multi-row imports.
      inserted.forEach((row, index) => {
        row.id = `bc400000-0000-4000-8000-${String(contacts.length + index + 1).padStart(12, "0")}`;
      });
      writes.push({ method: "POST", body });
      contacts.push(...inserted);
      data = Array.isArray(body) ? inserted : inserted[0];
    } else if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      Object.assign(
        contacts.find((contact) => contact.id === id),
        body,
      );
      writes.push({ method: "PATCH", body });
      data = null;
    } else {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      if (limit > contactListBatchLimit) {
        contactListTimeouts++;
        return route.fulfill({
          status: 500,
          headers,
          json: { code: "57014", message: "canceling statement due to statement timeout" },
        });
      }
      data = contacts.slice(offset, offset + Math.min(limit, 1000));
    }
  }
  return route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
});

async function newContact(name) {
  await page.getByRole("button", { name: "Novo contato", exact: true }).click();
  await page.locator("#contact-companies").click();
  await page.getByRole("option", { name: company.name }).click();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.locator("#contact-name").fill(name);
}
async function channel(kind, value, index = 0) {
  await page.locator(`#contact-${kind}`).click();
  if (index > 0) {
    await page
      .getByRole("button", {
        name: kind === "email" ? "Adicionar e-mail" : "Adicionar telefone",
        exact: true,
      })
      .click();
  }
  await page.locator(`#contact-${kind}-value-${index}`).fill(value);
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
}
async function save() {
  await page.getByRole("button", { name: "Salvar contato", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
async function edit(contact) {
  await page.goto(`${app.origin}/contacts?record=${contact.id}`);
  await page.getByRole("heading", { name: "Editar contato", exact: true }).waitFor();
}
async function blocked(expected) {
  const count = writes.length;
  await page.getByRole("button", { name: "Salvar contato", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: expected }).first().waitFor();
  assert.equal(writes.length, count, "invalid form must never mutate contacts");
}
async function spreadsheet(name, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Contatos");
  const path = `${directory}/${name}.xlsx`;
  XLSX.writeFile(workbook, path);
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await page
    .getByRole("button", { name: `Importar ${rows.length} linha(s)`, exact: true })
    .waitFor();
}

try {
  await page.goto(`${app.origin}/contacts`);
  await page.getByRole("button", { name: "Novo contato", exact: true }).waitFor();
  await newContact("Somente telefone");
  await channel("phone", "11999990001");
  await save();
  assert.equal(contacts.at(-1).email, null);
  assert.equal(contacts.at(-1).phone, "5511999990001");
  checks.push("create phone-only");

  await newContact("Somente email");
  await channel("email", " TEST@EXAMPLE.TEST ");
  await save();
  assert.equal(contacts.at(-1).phone, null);
  assert.equal(contacts.at(-1).email, "test@example.test");
  checks.push("create email-only and trim/lowercase");

  await newContact("Ambos canais");
  await channel("email", "both@example.test");
  await channel("phone", "11999990002");
  await save();
  assert.ok(contacts.at(-1).email && contacts.at(-1).phone);
  checks.push("create both channels");

  await newContact("Sem canais");
  await blocked("Informe pelo menos um e-mail ou telefone.");
  assert.equal(await page.locator("#contact-email").getAttribute("aria-invalid"), "true");
  assert.equal(await page.locator("#contact-phone").getAttribute("aria-invalid"), "true");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "contact-email");
  checks.push("neither blocked, inline errors and focus");
  await channel("email", "invalid-email");
  await channel("phone", "11999990003");
  await blocked("E-mail inválido");
  await channel("email", "valid@example.test");
  await channel("phone", "123");
  await blocked("Telefone inválido");
  checks.push("invalid supplied email/phone blocked even with other valid channel");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();

  await edit(contacts[0]);
  await channel("phone", "");
  await blocked("Informe pelo menos um e-mail ou telefone.");
  await channel("email", "replacement@example.test");
  await save();
  assert.equal(contacts[0].phone, null);
  assert.equal(contacts[0].email, "replacement@example.test");
  checks.push("edit last-channel removal blocked and replace phone with email");
  await edit(contacts[1]);
  await channel("email", "");
  await channel("phone", "11999990004");
  await save();
  assert.equal(contacts[1].email, null);
  assert.equal(contacts[1].phone, "5511999990004");
  checks.push("edit email-only to phone-only");
  await edit(contacts[2]);
  await channel("phone", "");
  await save();
  assert.equal(contacts[2].phone, null);
  checks.push("edit both to email-only");

  await newContact("Email secundário exclusivo");
  await channel("email", "secondary@example.test", 1);
  await save();
  assert.equal(contacts.at(-1).email, null);
  assert.deepEqual(contacts.at(-1).secondary_emails, ["secondary@example.test"]);
  checks.push("secondary-only email counts");
  await newContact("Telefone secundário exclusivo");
  await channel("phone", "11999990005", 1);
  await save();
  assert.equal(contacts.at(-1).phone, null);
  assert.deepEqual(contacts.at(-1).secondary_phones, ["5511999990005"]);
  checks.push("secondary-only phone counts");

  await spreadsheet("phone-only", [
    { Nome: "Importado telefone", Cliente: company.name, Telefone: "11999990101" },
    { Nome: "Ignorar sem canal", Cliente: company.name, Telefone: "" },
    { Nome: "Ignorar inválido", Cliente: company.name, Telefone: "123" },
  ]);
  await page.getByRole("button", { name: "Importar 3 linha(s)", exact: true }).click();
  await page.getByText("2 linha(s) ignorada(s)", { exact: true }).waitFor();
  const firstImport = writes.at(-1).body;
  assert.equal(firstImport.length, 1);
  assert.equal(firstImport[0].email, null);
  assert.equal(firstImport[0].phone, "5511999990101");
  await page.getByText("Informe pelo menos um e-mail ou telefone.", { exact: true }).waitFor();
  await page.getByText("Telefone inválido", { exact: true }).waitFor();
  checks.push("xlsx phone mapping without email, row-level neither/invalid skipped");
  await page.screenshot({ path: `${directory}/import-skipped-desktop-light.png`, fullPage: true });
  await page.getByRole("button", { name: "Fechar", exact: true }).click();

  await spreadsheet("mixed-channels", [
    {
      Nome: "Importado email",
      Cliente: company.name,
      "E-mail": "email-import@example.test",
      Telefone: "",
    },
    {
      Nome: "Importado ambos",
      Cliente: company.name,
      "E-mail": "both-import@example.test",
      Telefone: "11999990102",
    },
    {
      Nome: "Ignorar email inválido",
      Cliente: company.name,
      "E-mail": "bad",
      Telefone: "11999990103",
    },
    {
      Nome: "Ignorar telefone inválido",
      Cliente: company.name,
      "E-mail": "valid@example.test",
      Telefone: "123",
    },
  ]);
  await page.getByRole("button", { name: "Importar 4 linha(s)", exact: true }).click();
  await page.getByText("2 linha(s) ignorada(s)", { exact: true }).waitFor();
  assert.equal(writes.at(-1).body.length, 2);
  checks.push("xlsx email-only and both imported, invalid supplied fields skipped");
  await page.getByRole("button", { name: "Fechar", exact: true }).click();

  await page.getByRole("row", { name: /Importado email/ }).waitFor();
  await page.getByRole("button", { name: "Filtrar Cliente", exact: true }).click();
  await page.getByPlaceholder("Filtrar Cliente").fill(company.name);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("row", { name: /Importado email/ }).count(), 1);
  assert.equal(await page.getByRole("row", { name: /Importado ambos/ }).count(), 1);
  checks.push("xlsx imports remain visible under primary company filter");

  failContactList = true;
  await page.reload();
  await page.getByRole("heading", { name: "Contatos indisponíveis" }).waitFor({ timeout: 8000 });
  assert.equal(await page.getByText("Nenhum contato cadastrado", { exact: true }).count(), 0);
  failContactList = false;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await page.getByRole("row", { name: /Importado email/ }).waitFor();
  checks.push("list outage is distinct from empty results and retry restores contacts");

  const sampleCount = contacts.length;
  contactListBatchLimit = 100;
  contacts.push(
    ...Array.from({ length: 1001 }, (_, index) => ({
      ...contacts[0],
      id: `bulk-${index}`,
      name: index === 1000 ? "Último contato da importação em lote" : `Contato em lote ${index}`,
    })),
  );
  await page.reload();
  await page.getByRole("button", { name: "Filtrar Nome", exact: true }).click();
  await page.getByPlaceholder("Filtrar Nome").fill("Último contato da importação em lote");
  await page.keyboard.press("Escape");
  await page.getByRole("row", { name: /Último contato da importação em lote/ }).waitFor();
  assert.equal(contactListTimeouts, 1, "the contacts query lowers the limit after a timeout");
  contactListBatchLimit = 1000;
  contacts.splice(sampleCount);
  checks.push("contacts beyond the default API row limit stay visible");

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("apticket-theme", value), theme);
    await page.reload();
    await page.getByRole("button", { name: "Novo contato", exact: true }).waitFor();
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["tablet", 768, 1024],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `${directory}/list-${name}-${theme}.png`, fullPage: true });
      await newContact(`Visual ${theme} ${name}`);
      await channel("phone", "11999990999");
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth > innerWidth,
        dialog: [...document.querySelectorAll('[role="dialog"]')].some(
          (element) => element.scrollWidth > element.clientWidth + 1,
        ),
      }));
      assert.deepEqual(overflow, { page: false, dialog: false }, `${name}/${theme} overflow`);
      await page.screenshot({ path: `${directory}/form-${name}-${theme}.png`, fullPage: true });
      await page.locator("#contact-phone").focus();
      await page.keyboard.press("Enter");
      await page.locator("#contact-phone-value-0").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("#contact-phone-value-0").waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.id === "contact-phone");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "contact-phone");
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        const styles = getComputedStyle(element);
        return { tag: element.tagName, outline: styles.outlineStyle, shadow: styles.boxShadow };
      });
      assert.ok(focus.outline !== "none" || focus.shadow !== "none", "keyboard focus is visible");
      observations.push({ theme, viewport: name, keyboardFocus: focus });
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    }
  }
  checks.push(
    "desktop/tablet/mobile light+dark, fallback fonts, no form/page overflow, popover keyboard focus return",
  );

  const portalContactId = "bc500000-0000-4000-8000-000000000001";
  const chatTicketId = "bc600000-0000-4000-8000-000000000001";
  const portalSession = {
    found: true,
    contact: {
      id: portalContactId,
      name: "Contato somente telefone",
      email: null,
      company_name: company.name,
      can_open_tickets: true,
      is_portal_admin: true,
      is_portal_financial: false,
    },
    contracts: [],
    tickets: [],
    equipments: [],
    has_active_contract: false,
  };
  let chatMessages = [];
  await page.route(`${app.origin}/api/public/portal/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    assert.equal(request.headers().authorization, "Bearer fixture-portal-session");
    portalRequests.push({ path, body: request.postData() });
    let data = {};
    if (path.endsWith("/session")) data = portalSession;
    if (path.endsWith("/contacts")) data = { contacts: [] };
    if (path.endsWith("/chat-start")) {
      const body = request.postDataJSON();
      assert.equal(body.message, "Preciso de suporte sem e-mail");
      assert.equal(body.contract_id, undefined);
      chatMessages = [
        {
          id: "message-1",
          content: body.message,
          author_type: "contact",
          author_name: portalSession.contact.name,
          is_internal: false,
          created_at: new Date().toISOString(),
        },
      ];
      data = { ok: true, ticket_id: chatTicketId, number: 1 };
    }
    if (path.endsWith("/ticket-detail")) {
      assert.equal(request.postDataJSON().ticket_id, chatTicketId);
      data = { messages: chatMessages };
    }
    if (path.endsWith("/ticket-reply")) {
      assert.ok(request.postData().includes("Mensagem adicional sem e-mail"));
      chatMessages.push({
        id: "message-2",
        content: "Mensagem adicional sem e-mail",
        author_type: "contact",
        author_name: portalSession.contact.name,
        is_internal: false,
        created_at: new Date().toISOString(),
      });
      data = { ok: true };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      localStorage.setItem("apticket_portal_token_v1", "fixture-portal-session");
      localStorage.setItem("apticket-theme", "light");
      localStorage.removeItem("apticket_home_chat_v1");
    });
    await page.goto(`${app.origin}/portal`);
    await page.getByRole("button", { name: "Abrir chat de suporte", exact: true }).click();
    await page.getByRole("button", { name: "Iniciar chat", exact: true }).waitFor();
    await page
      .getByPlaceholder("Conte o que está acontecendo…")
      .fill("Preciso de suporte sem e-mail");
    await page.screenshot({
      path: `${directory}/portal-null-email-start-${name}.png`,
      fullPage: true,
    });
    const initialStarts = portalRequests.filter((request) =>
      request.path.endsWith("/chat-start"),
    ).length;
    await page.getByRole("button", { name: "Iniciar chat", exact: true }).click();
    await page.getByText("Chamado #1", { exact: true }).waitFor();
    await page.getByText("Preciso de suporte sem e-mail", { exact: true }).waitFor();
    assert.equal(
      portalRequests.filter((request) => request.path.endsWith("/chat-start")).length,
      initialStarts + 1,
    );
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("apticket_home_chat_v1"))),
      {
        contact_id: portalContactId,
        email: "",
        ticket_id: chatTicketId,
        number: 1,
      },
    );
    await page
      .getByRole("textbox", { name: "Mensagem", exact: true })
      .fill("Mensagem adicional sem e-mail");
    await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
    await page.getByText("Mensagem adicional sem e-mail", { exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Abrir chat de suporte", exact: true }).click();
    await page.getByText("Chamado #1", { exact: true }).waitFor();
    await page.getByText("Mensagem adicional sem e-mail", { exact: true }).waitFor();
    assert.equal(
      portalRequests.filter((request) => request.path.endsWith("/chat-start")).length,
      initialStarts + 1,
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: `${directory}/portal-null-email-chat-${name}.png`,
      fullPage: true,
    });
  }
  checks.push(
    "portal null-email session starts chat, polls messages, sends reply and restores chat by contact ID on desktop/mobile",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${directory}/results.json`,
    JSON.stringify({ checks, observations, writes, portalRequests, errors }, null, 2),
  );
  console.log(`PASS ${checks.length} contact-channel UI checks`);
  console.log(JSON.stringify(checks, null, 2));
  console.log(`Screenshots: ${directory}`);
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png`, fullPage: true });
  console.error(
    "Browser errors",
    errors,
    "URL",
    page.url(),
    "Writes",
    writes,
    "Portal requests",
    portalRequests,
    "Diagnostics",
    app.diagnostics(),
  );
  throw error;
} finally {
  await browser.close();
  await app.close();
}
