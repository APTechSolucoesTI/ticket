import assert from "node:assert/strict";
import { getToken, setToken, subscribe, handleSessionResponse } from "../../apps/web/src/lib/session.ts";

const values = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key),
};
let changes = 0;
const unsubscribe = subscribe(() => changes++);
try {
  setToken("synthetic-old-session");
  handleSessionResponse(new Response(null, { status: 403 }), "synthetic-old-session");
  assert.equal(getToken(), "synthetic-old-session", "permission denial does not log the user out");
  handleSessionResponse(new Response(null, { status: 503 }), "synthetic-old-session");
  assert.equal(getToken(), "synthetic-old-session", "outage does not log the user out");
  setToken("synthetic-renewed-session");
  handleSessionResponse(new Response(null, { status: 401 }), "synthetic-old-session");
  assert.equal(getToken(), "synthetic-renewed-session", "delayed rejection preserves the renewed JWT");
  handleSessionResponse(new Response(null, { status: 401 }), null);
  assert.equal(getToken(), "synthetic-renewed-session", "anonymous requests cannot clear a session");
  const response = new Response(null, { status: 401 });
  assert.equal(handleSessionResponse(response, "synthetic-renewed-session"), response);
  assert.equal(getToken(), null, "the current rejected session is removed from browser storage");
  assert.equal(changes, 3, "logout notifies the UI exactly once");
  console.log("PASS browser logout: current 401, renewal race, anonymous request, permissions and outages");
} finally {
  unsubscribe();
  delete globalThis.window;
  delete globalThis.localStorage;
}
