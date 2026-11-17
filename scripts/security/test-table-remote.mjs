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
async function fixture(t, { local = false, busy = false } = {}) {
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
    pageSize: 50,
    total: 1205,
    sort: null,
    onPageChange: (value) => events.push(["page", value]),
    onPageSizeChange: () => {},
    onSortChange: (value) => events.push(["sort", value]),
  };
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
  t.after(async () => {
    await React.act(async () => root.unmount());
    client.clear();
    container.remove();
    localStorage.clear();
  });
  return { container, events };
}
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
