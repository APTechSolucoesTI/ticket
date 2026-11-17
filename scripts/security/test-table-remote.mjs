import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
const webRoot = fileURLToPath(new URL("../../apps/web/", import.meta.url));
const require = createRequire(path.join(webRoot, "package.json"));
const React = require("react");
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");
const { JSDOM } = createRequire(require.resolve("isomorphic-dompurify"))("jsdom");
const dom = new JSDOM("<body></body>", { url: "http://table.example.test" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
for (const key of [
  "Node",
  "NodeFilter",
  "Element",
  "DocumentFragment",
  "MutationObserver",
  "CustomEvent",
  "HTMLInputElement",
  "HTMLSelectElement",
])
  globalThis[key] = window[key];
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
const cache = new Map();
function source(name) {
  if (name === "@/lib/use-permissions")
    return {
      usePermissions: () => {
        throw new Error("Unexpected permission network access in table fixture");
      },
    };
  const base = path.join(webRoot, "src", name.slice(2));
  const file = [base, base + ".tsx", base + ".ts"].find(existsSync);
  assert.ok(file, name);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  new Function("require", "exports", "module", compiled.outputText)(
    (name) => (name.startsWith("@/") ? source(name) : require(name)),
    module.exports,
    module,
  );
  return module.exports;
}
const { ConfigurableTable } = source("@/components/configurable-table");
const { AuthProvider } = source("@/lib/auth");
const { useColumnPreferences } = source("@/hooks/use-column-preferences");
const session = source("@/lib/session");
const { tablePreferenceKey } = source("@/lib/table-preferences");

async function preferencesFixture(
  t,
  {
    columns = [
      { key: "number", label: "Número", identifier: true },
      { key: "subject", label: "Assunto" },
      { key: "status", label: "Status" },
    ],
    defaults = ["number", "subject"],
    seed,
  } = {},
) {
  localStorage.clear();
  seed?.();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container),
    client = new QueryClient();
  let current,
    listKey = "preferences-fixture";
  function Probe() {
    current = useColumnPreferences(listKey, columns, defaults);
    return React.createElement("span", null, current.visibleOrder.join(","));
  }
  async function render() {
    await React.act(async () =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(AuthProvider, null, React.createElement(Probe)),
        ),
      ),
    );
  }
  await render();
  t.after(async () => {
    await React.act(async () => root.unmount());
    client.clear();
    container.remove();
    localStorage.clear();
  });
  return {
    get current() {
      return current;
    },
    async save(order) {
      await React.act(async () => current.setVisibleOrder(order));
    },
    async pageSize(size) {
      await React.act(async () => current.setPageSize(size));
    },
    async identity(id, tenant) {
      const token = `fixture.${Buffer.from(JSON.stringify({ sub: id, tenant_id: tenant, email: "fixture@example.test", app: "apticket", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
      await React.act(async () => session.setToken(token));
    },
    async list(key) {
      listKey = key;
      await render();
    },
  };
}

test("preferences cannot hide every identifier or required column", async (t) => {
  const f = await preferencesFixture(t, {
    columns: [
      { key: "number", label: "Número", identifier: true },
      { key: "subject", label: "Assunto" },
      { key: "status", label: "Status", required: true },
    ],
  });
  await f.save(["subject"]);
  assert.ok(f.current.visibleOrder.includes("number"), "a ticket identifier must remain visible");
  assert.ok(f.current.visibleOrder.includes("status"), "required information must remain visible");
  await f.save([]);
  assert.ok(f.current.visibleOrder.length >= 2);
});

test("legacy orders are deduplicated and obsolete columns are discarded", async (t) => {
  const f = await preferencesFixture(t, {
    seed: () =>
      localStorage.setItem(
        "cols:anon:preferences-fixture",
        JSON.stringify(["subject", "subject", "removed"]),
      ),
  });
  assert.deepEqual(f.current.visibleOrder, ["number", "subject"]);
});

test("legacy preferences are assigned once and do not migrate into another tenant", async (t) => {
  const f = await preferencesFixture(t, {
    seed: () =>
      localStorage.setItem("cols:user-a:preferences-fixture", JSON.stringify(["number", "status"])),
  });
  await f.identity("user-a", "tenant-a");
  assert.deepEqual(f.current.visibleOrder, ["number", "status"]);
  await f.identity("user-a", "tenant-b");
  assert.deepEqual(f.current.visibleOrder, ["number", "subject"]);
  await f.identity("user-a", "tenant-a");
  assert.deepEqual(f.current.visibleOrder, ["number", "status"]);
});

test("preferences do not follow a user into another tenant or another list", async (t) => {
  const f = await preferencesFixture(t);
  await f.identity("user-a", "tenant-a");
  await f.save(["number", "status"]);
  await f.identity("user-a", "tenant-b");
  assert.deepEqual(f.current.visibleOrder, ["number", "subject"]);
  await f.identity("user-a", "tenant-a");
  assert.deepEqual(f.current.visibleOrder, ["number", "status"]);
  await f.list("other-list");
  assert.deepEqual(f.current.visibleOrder, ["number", "subject"]);
  await f.list("preferences-fixture");
  assert.deepEqual(f.current.visibleOrder, ["number", "status"]);
  await f.identity("user-b", "tenant-a");
  assert.deepEqual(f.current.visibleOrder, ["number", "subject"]);
});

test("page size is persisted independently per listing and invalid sizes use the default", async (t) => {
  const f = await preferencesFixture(t);
  await f.pageSize(50);
  assert.equal(f.current.pageSize, 50);
  await f.list("other-list");
  assert.equal(f.current.pageSize, 10);
  await f.list("preferences-fixture");
  assert.equal(f.current.pageSize, 50);
  await f.pageSize(11);
  assert.equal(f.current.pageSize, 10);
});

test("malformed stored preferences use safe defaults", async (t) => {
  const f = await preferencesFixture(t, {
    seed: () =>
      localStorage.setItem(
        tablePreferenceKey(null, "preferences-fixture"),
        '{"version":999,"visibleOrder":["status"],"pageSize":999}',
      ),
  });
  assert.deepEqual(f.current.visibleOrder, ["number", "subject"]);
  assert.equal(f.current.pageSize, 10);
});

test("blocked browser storage still allows applying preferences in memory", async (t) => {
  const originalGet = window.Storage.prototype.getItem,
    originalSet = window.Storage.prototype.setItem;
  const blocked = (key) => key.startsWith("table:") || key.startsWith("cols:");
  window.Storage.prototype.getItem = function (key) {
    if (blocked(key)) throw new Error("blocked storage");
    return originalGet.call(this, key);
  };
  window.Storage.prototype.setItem = function (key, value) {
    if (blocked(key)) throw new Error("blocked storage");
    return originalSet.call(this, key, value);
  };
  t.after(() => {
    window.Storage.prototype.getItem = originalGet;
    window.Storage.prototype.setItem = originalSet;
  });
  const f = await preferencesFixture(t);
  await f.save(["number", "status"]);
  await f.pageSize(20);
  assert.deepEqual(f.current.visibleOrder, ["number", "status"]);
  assert.equal(f.current.pageSize, 20);
});

test("one of several identifiers may be hidden while mandatory columns are retained", async (t) => {
  const f = await preferencesFixture(t, {
    columns: [
      { key: "number", label: "Número", identifier: true },
      { key: "subject", label: "Assunto", identifier: true },
      { key: "status", label: "Status", required: true },
    ],
  });
  await f.save(["subject"]);
  assert.deepEqual(f.current.visibleOrder, ["subject", "status"]);
});
async function fixture(t, { local = false, busy = false, pageSize = 50 } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const events = [];
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    number: 100 - index,
  }));
  const remote = {
    busy,
    page: 2,
    pageSize,
    total: 1205,
    sort: null,
    onPageChange: (value) => events.push(["page", value]),
    onPageSizeChange: (value) => events.push(["size", value]),
    onSortChange: (value) => events.push(["sort", value]),
  };
  async function render() {
    await React.act(async () =>
      root.render(
        React.createElement(
          QueryClientProvider,
          { client },
          React.createElement(
            AuthProvider,
            null,
            React.createElement(ConfigurableTable, {
              listKey: "remote-fixture",
              rows,
              rowKey: (row) => row.id,
              columns: [{ key: "number", label: "Número", cell: (row) => row.number }],
              remote: local ? undefined : remote,
            }),
          ),
        ),
      ),
    );
  }
  await render();
  t.after(async () => {
    await React.act(async () => root.unmount());
    client.clear();
    container.remove();
    localStorage.clear();
  });
  return {
    container,
    events,
    async update(next) {
      Object.assign(remote, next);
      await render();
    },
  };
}

test("settings cannot open on a pending remote snapshot", async (t) => {
  const f = await fixture(t, { busy: true, pageSize: 10 });
  await React.act(async () =>
    Array.from(f.container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Colunas"))
      .click(),
  );
  assert.equal(document.querySelector('[role="dialog"]') === null, true);
});

test("applying columns preserves an external page-size change while the dialog is open", async (t) => {
  const f = await fixture(t, { pageSize: 10 });
  await React.act(async () =>
    Array.from(f.container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Colunas"))
      .click(),
  );
  await f.update({ pageSize: 50 });
  await React.act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Aplicar")
      .click(),
  );
  assert.deepEqual(f.events, [], "an unchanged size selector must not restore its old snapshot");
});
test("remote rows are not paginated a second time and display the server total", async (t) => {
  const f = await fixture(t);
  assert.equal(f.container.querySelectorAll("tbody tr").length, 30);
  assert.ok(f.container.textContent.includes("51–100 de 1205"));
  assert.ok(f.container.textContent.includes("Página 2 de 25"));
  assert.equal(f.container.querySelectorAll('nav[aria-label="Paginação da listagem"]').length, 2);
});
test("remote pagination and sorting call the server controller without sorting the page locally", async (t) => {
  const f = await fixture(t);
  await React.act(async () =>
    Array.from(f.container.querySelectorAll("button"))
      .find((b) => b.textContent.includes("Número"))
      .click(),
  );
  assert.deepEqual(f.events[0], ["sort", { key: "number", dir: "asc" }]);
  assert.equal(f.container.querySelector("tbody td").textContent, "100");
  await React.act(async () => f.container.querySelector('[aria-label="Próxima página"]').click());
  assert.deepEqual(f.events[1], ["page", 3]);
});

test("pending remote updates block pagination and sort from the previous result", async (t) => {
  const f = await fixture(t, { busy: true });
  await React.act(async () => {
    f.container.querySelector('[aria-label="Próxima página"]').click();
    Array.from(f.container.querySelectorAll("button"))
      .find((b) => b.textContent.includes("Número"))
      .click();
  });
  assert.deepEqual(f.events, []);
});

test("local lists retain ten-row pages, local sort cycle and pagination", async (t) => {
  const f = await fixture(t, { local: true });
  const sort = Array.from(f.container.querySelectorAll("button")).find((b) =>
    b.textContent.includes("Número"),
  );
  assert.equal(f.container.querySelectorAll("tbody tr").length, 10);
  assert.ok(f.container.textContent.includes("1–10 de 30"));
  await React.act(async () => sort.click());
  assert.equal(f.container.querySelector("tbody td").textContent, "71");
  assert.equal(f.container.querySelector("th").getAttribute("aria-sort"), "ascending");
  await React.act(async () => f.container.querySelector('[aria-label="Próxima página"]').click());
  assert.equal(f.container.querySelector("tbody td").textContent, "81");
  await React.act(async () => sort.click());
  assert.ok(f.container.textContent.includes("1–10 de 30"));
  assert.equal(f.container.querySelector("tbody td").textContent, "100");
  assert.equal(f.container.querySelector("th").getAttribute("aria-sort"), "descending");
  await React.act(async () => sort.click());
  assert.equal(f.container.querySelector("th").getAttribute("aria-sort"), "none");
  assert.deepEqual(f.events, []);
});
