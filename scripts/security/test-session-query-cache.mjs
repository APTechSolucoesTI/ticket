import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as session from "../../apps/web/src/lib/session.ts";

// Execute the actual provider with React, Query and DOM. Only alias resolution
// and TSX transpilation are adapted for Node; no application component is mocked.
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const React = requireWeb("react");
const { createRoot } = requireWeb("react-dom/client");
const { QueryClient, QueryClientProvider, useQuery, useQueryClient } =
  requireWeb("@tanstack/react-query");
const ts = requireWeb("typescript");
const { JSDOM } = createRequire(requireWeb.resolve("isomorphic-dompurify"))("jsdom");
const dom = new JSDOM("<body></body>", { url: "http://session.example.test" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = ts.transpileModule(
  readFileSync(new URL("../../apps/web/src/lib/auth.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
);
const authModule = { exports: {} };
new Function("require", "exports", "module", compiled.outputText)(
  (name) => (name === "@/lib/session" ? session : requireWeb(name)),
  authModule.exports,
  authModule,
);
const { AuthProvider, useAuth } = authModule.exports;

function token(userId, tenantId, name = "Fixture") {
  return `fixture.${Buffer.from(
    JSON.stringify({
      sub: userId,
      tenant_id: tenantId,
      name,
      email: `${userId}@example.test`,
      app: "apticket",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url")}.signature`;
}

async function fixture(t, query = async (user) => `${user.id}/${user.tenantId}`) {
  localStorage.clear();
  session.setToken(token("user-a", "tenant-a"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let calls = 0;
  let activeClient = client;
  function Probe() {
    activeClient = useQueryClient();
    const { user } = useAuth();
    const result = useQuery({
      queryKey: ["tickets"],
      enabled: !!user,
      queryFn: () => {
        calls++;
        return query(user);
      },
    });
    return React.createElement("div", null, `${user?.id ?? "anonymous"}:${result.data ?? "empty"}`);
  }
  t.after(async () => {
    await React.act(async () => root.unmount());
    client.clear();
    container.remove();
    localStorage.clear();
  });
  await React.act(async () =>
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(AuthProvider, null, React.createElement(Probe)),
      ),
    ),
  );
  async function flush() {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  await flush();
  return {
    get client() {
      return activeClient;
    },
    container,
    flush,
    calls: () => calls,
  };
}

test("logout removes cached data and mutation state before another account can use it", async (t) => {
  const f = await fixture(t);
  f.client.getMutationCache().build(f.client, { mutationKey: ["edit-ticket"] });
  await React.act(async () => session.clearToken());
  assert.equal(f.client.getQueryData(["tickets"]), undefined);
  assert.equal(f.client.getMutationCache().getAll().length, 0);
  assert.equal(f.container.textContent, "anonymous:empty");
});

test("changing account replaces data held by active observers using a legacy query key", async (t) => {
  const f = await fixture(t);
  assert.equal(f.container.textContent, "user-a:user-a/tenant-a");
  await React.act(async () => session.setToken(token("user-b", "tenant-b")));
  await f.flush();
  assert.equal(f.container.textContent, "user-b:user-b/tenant-b");
});

test("changing only the tenant creates a separate cache boundary", async (t) => {
  const f = await fixture(t);
  await React.act(async () => session.setToken(token("user-a", "tenant-b")));
  await f.flush();
  assert.equal(f.client.getQueryData(["tickets"]), "user-a/tenant-b");
});

test("late results from the previous account cannot overwrite the new account", async (t) => {
  let release;
  const f = await fixture(t, (user) =>
    user.id === "user-a"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve("user-b/tenant-b"),
  );
  await React.act(async () => session.setToken(token("user-b", "tenant-b")));
  await f.flush();
  await React.act(async () => release("private-user-a"));
  await f.flush();
  assert.equal(f.client.getQueryData(["tickets"]), "user-b/tenant-b");
  assert.equal(f.container.textContent, "user-b:user-b/tenant-b");
});

test("renewing the same identity preserves its useful cache", async (t) => {
  const f = await fixture(t);
  await React.act(async () => session.setToken(token("user-a", "tenant-a", "Updated name")));
  await f.flush();
  assert.equal(f.calls(), 1);
  assert.equal(f.client.getQueryData(["tickets"]), "user-a/tenant-a");
});

test("a session change in another tab clears the previous identity", async (t) => {
  const f = await fixture(t);
  const next = token("user-b", "tenant-b");
  await React.act(async () => {
    localStorage.setItem("apticket_session_token", next);
    window.dispatchEvent(
      new window.StorageEvent("storage", {
        key: "apticket_session_token",
        newValue: next,
        storageArea: localStorage,
      }),
    );
  });
  await f.flush();
  assert.equal(f.container.textContent, "user-b:user-b/tenant-b");
});

test("rejection of the current session also removes protected cache", async (t) => {
  const f = await fixture(t);
  await React.act(async () =>
    session.handleSessionResponse(new Response(null, { status: 401 }), session.getToken()),
  );
  assert.equal(f.client.getQueryData(["tickets"]), undefined);
  assert.equal(f.container.textContent, "anonymous:empty");
});

test("a late optimistic rollback cannot put the previous account into the new cache", async (t) => {
  const f = await fixture(t);
  const oldClient = f.client;
  let rejectRequest;
  const request = new Promise((_resolve, reject) => {
    rejectRequest = reject;
  });
  const mutation = oldClient.getMutationCache().build(oldClient, {
    mutationFn: () => request,
    onMutate: () => ({ previous: oldClient.getQueryData(["tickets"]) }),
    onError: (_error, _variables, context) => oldClient.setQueryData(["tickets"], context.previous),
  });
  const completion = mutation.execute({}).catch(() => {});
  await React.act(async () => {
    await Promise.resolve();
  });
  await React.act(async () => session.setToken(token("user-b", "tenant-b")));
  await f.flush();
  await React.act(async () => {
    rejectRequest(new Error("synthetic update failure"));
    await completion;
  });
  await f.flush();
  assert.equal(f.client.getQueryData(["tickets"]), "user-b/tenant-b");
  assert.equal(f.container.textContent, "user-b:user-b/tenant-b");
});
