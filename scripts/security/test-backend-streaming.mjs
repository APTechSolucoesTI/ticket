import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { startLocalApp } from "./local-app.mjs";

let firstChunk;
const received = new Promise((resolve) => {
  firstChunk = resolve;
});
const app = await startLocalApp((req, res) => {
  assert.equal(req.url, "/stream-fixture?test=1");
  assert.equal(req.headers.authorization, "Bearer synthetic-token");
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    firstChunk();
  });
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ bytes }));
  });
});
let client;
let timeout;
try {
  client = request(`${app.origin}/backend/stream-fixture?test=1`, {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-token",
      "content-type": "application/octet-stream",
    },
  });
  const responseReady = once(client, "response");
  client.write(Buffer.alloc(32 * 1024));
  // Do not end the client body until the upstream receives its first chunk.
  // A proxy that calls arrayBuffer() deadlocks this proof and fails the test.
  await Promise.race([
    received,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Proxy buffered the request before forwarding")),
        5000,
      );
    }),
  ]);
  clearTimeout(timeout);
  client.end(Buffer.alloc(8 * 1024));
  const [response] = await responseReady;
  let body = "";
  for await (const chunk of response) body += chunk;
  assert.equal(response.statusCode, 200, app.diagnostics());
  assert.deepEqual(JSON.parse(body), { bytes: 40 * 1024 });
  console.log("PASS backend proxy streams before end-of-body and preserves credentials/path");
} finally {
  clearTimeout(timeout);
  client?.destroy();
  await app.close();
}
