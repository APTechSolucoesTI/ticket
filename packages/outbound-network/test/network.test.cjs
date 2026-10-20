const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const http = require("node:http");
const { gzipSync } = require("node:zlib");
const { OutboundNetworkError, isPublicAddress, createOutboundNetwork, publicHttpRequest } = require("../index.cjs");

let port, streamingChunks = 0;
const requests = [];
const fixture = http.createServer((request, response) => {
  requests.push({ url: request.url, host: request.headers.host, token: request.headers.token });
  if (request.url === "/private") { response.writeHead(302, { location: `http://127.0.0.1:${port}/secret` }).end(); }
  else if (request.url === "/cross") { response.writeHead(307, { location: `http://cdn.example.test:${port}/ok` }).end(); }
  else if (request.url === "/same") { response.writeHead(302, { location: "/ok" }).end(); }
  else if (request.url === "/loop") { response.writeHead(302, { location: "/loop" }).end(); }
  else if (request.url === "/declared") { response.writeHead(200, { "content-length": "9999999" }).write("a"); }
  else if (request.url === "/compressed") {
    const bytes = gzipSync(Buffer.alloc(4096, 65));
    response.writeHead(200, { "content-encoding": "gzip", "content-length": String(bytes.length) }).end(bytes);
  } else if (request.url === "/slow") { /* wait for the client deadline */ }
  else if (request.url === "/slow-body") { response.writeHead(200); response.flushHeaders(); }
  else if (request.url === "/stream") {
    streamingChunks = 0;
    response.writeHead(200, { "content-type": "application/octet-stream" });
    const timer = setInterval(() => { streamingChunks++; response.write(Buffer.alloc(1024)); }, 3);
    response.once("close", () => clearInterval(timer));
  } else response.writeHead(200, { "content-type": "text/plain" }).end("public fixture");
});
before(async () => { await new Promise(resolve => fixture.listen(0, "127.0.0.1", resolve)); port = fixture.address().port; });
after(async () => { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); });
const url = path => `http://media.example.test:${port}${path}`;
const blocked = code => error => error instanceof OutboundNetworkError && error.code === code;

// Test transport inspects the exact lookup/SNI/Host handed to Node, then connects
// only to the fixture. No test connection to the supplied public IP is made.
function network(lookup = async () => [{ address: "8.8.8.8", family: 4 }]) {
  const resolved = [], connections = [];
  const instance = createOutboundNetwork({ lookup: async (...args) => { resolved.push(args[0]); return lookup(...args); },
    request: (protocol, options, callback) => {
      assert.equal(protocol, "http:");
      options.lookup(options.hostname, { all: true }, (error, addresses) => {
        assert.ifError(error);
        assert.ok(addresses.every(row => isPublicAddress(row.address)));
        connections.push({ host: options.hostname, addresses, servername: options.servername });
      });
      return http.request({ ...options, hostname: "127.0.0.1", port, lookup: undefined, servername: undefined }, callback);
    } });
  return { ...instance, resolved, connections };
}

for (const address of ["0.0.0.0", "10.1.1.1", "100.64.0.1", "100.100.100.200", "127.0.0.1",
  "168.63.129.16", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.3.106",
  "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
  "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8",
  "64:ff9b::7f00:1", "64:ff9b:1::a00:1", "fc00::1", "fe80::1", "fe80::1%eth0", "ff02::1",
  "2001::1", "2001:20::1", "2001:db8::1", "2002:7f00:1::", "3fff::1", "not-an-address"]) {
  test(`reject non-public or transition address ${address}`, () => assert.equal(isPublicAddress(address), false));
}
for (const address of ["8.8.8.8", "1.1.1.1", "187.45.187.158", "192.185.176.232", "2001:4860:4860::8888", "2606:4700:4700::1111"]) {
  test(`allow public unicast ${address}`, () => assert.equal(isPublicAddress(address), true));
}
for (const target of ["http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1",
  "http://[::ffff:127.0.0.1]", "http://169.254.169.254/latest/meta-data/", "http://192.168.3.106:3000",
  "file:///etc/passwd", "ftp://8.8.8.8/file", "http://user:password@8.8.8.8", "http://localhost", "http://8.8.8.8/#fragment"]) {
  test(`reject unsafe URL before transport ${target}`, async () => {
    const client = network();
    await assert.rejects(client.publicHttpRequest(target), OutboundNetworkError);
    assert.equal(client.connections.length, 0);
  });
}
test("strict default rejects a real loopback listener without connecting", async () => {
  const count = requests.length;
  await assert.rejects(publicHttpRequest(`http://127.0.0.1:${port}/secret`), blocked("outbound_destination_blocked"));
  assert.equal(requests.length, count);
});
test("reject mixed public/private DNS and private DNS aliases before connecting", async () => {
  for (const addresses of [[{ address: "127.0.0.1", family: 4 }],
    [{ address: "8.8.8.8", family: 4 }, { address: "fd00::1", family: 6 }]]) {
    const client = network(async () => addresses);
    await assert.rejects(client.publicHttpRequest(url("/ok")), blocked("outbound_destination_blocked"));
    assert.equal(client.connections.length, 0);
  }
});
test("pin checked DNS answers while retaining the original Host and SNI", async () => {
  let lookups = 0;
  const client = network(async () => [{ address: ++lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }]);
  const result = await client.publicHttpRequest(url("/ok"));
  assert.equal(result.text(), "public fixture");
  assert.equal(lookups, 1, "the transport cannot re-resolve to a private IP");
  assert.deepEqual(client.connections[0], { host: "media.example.test", servername: "media.example.test", addresses: [{ address: "8.8.8.8", family: 4 }] });
  assert.equal(requests.at(-1).host, `media.example.test:${port}`);
});
test("revalidate every redirect before making a private connection", async () => {
  const client = network();
  await assert.rejects(client.publicHttpRequest(url("/private")), blocked("outbound_destination_blocked"));
  assert.equal(client.connections.length, 1);
  assert.ok(requests.every(request => request.url !== "/secret"));
});
test("allow public media redirect; reject credential-bearing cross-origin redirect", async () => {
  const client = network();
  assert.equal((await client.publicHttpRequest(url("/cross"))).text(), "public fixture");
  assert.deepEqual(client.resolved, ["media.example.test", "cdn.example.test"]);
  const credentials = network();
  await assert.rejects(credentials.publicHttpRequest(url("/cross"), { credentials: true, headers: { token: "fixture-secret" } }), blocked("outbound_redirect_blocked"));
  assert.equal(credentials.connections.length, 1);
  assert.ok(!requests.some(request => request.host.startsWith("cdn.") && request.token));
});
test("preserve credentials on same-origin redirects and stop redirect loops", async () => {
  const client = network();
  assert.equal((await client.publicHttpRequest(url("/same"), { credentials: true, headers: { token: "fixture" } })).status, 200);
  assert.equal(requests.at(-1).token, "fixture");
  const loop = network();
  await assert.rejects(loop.publicHttpRequest(url("/loop"), { maxRedirects: 2 }), blocked("outbound_redirect_limit"));
  assert.equal(loop.connections.length, 3);
});

test("recognize authentication headers without an explicit credentials flag", async () => {
  for (const header of ["authorization", "cookie", "token", "apikey", "x-api-key"]) {
    const client = network();
    await assert.rejects(client.publicHttpRequest(url("/cross"), { headers: { [header]: "fixture" } }), blocked("outbound_redirect_blocked"));
    assert.equal(client.connections.length, 1);
  }
});

test("pin a public IPv6 literal without performing DNS lookup", async () => {
  const client = network(() => { throw new Error("literal must not resolve DNS"); });
  assert.equal((await client.publicHttpRequest(`http://[2606:4700:4700::1111]:${port}/ok`)).status, 200);
  assert.deepEqual(client.connections[0].addresses, [{ address: "2606:4700:4700::1111", family: 6 }]);
  assert.equal(client.connections[0].servername, undefined);
});
test("bound Content-Length, missing Content-Length and decompressed bytes", async () => {
  const client = network();
  await assert.rejects(client.publicHttpRequest(url("/declared"), { maxBytes: 128 }), blocked("outbound_body_too_large"));
  await assert.rejects(client.publicHttpRequest(url("/compressed"), { maxBytes: 128 }), blocked("outbound_body_too_large"));
  await assert.rejects(client.publicHttpRequest(url("/stream"), { maxBytes: 2048 }), blocked("outbound_body_too_large"));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(streamingChunks < 12, "oversized stream is cancelled promptly");
});
test("abort slow headers, slow bodies, DNS and pre-aborted requests", async () => {
  const client = network();
  for (const path of ["/slow", "/slow-body"]) {
    await assert.rejects(client.publicHttpRequest(url(path), { timeoutMs: 30 }), blocked("outbound_aborted"));
  }
  const slowDns = network(() => new Promise(() => {}));
  await assert.rejects(slowDns.publicHttpRequest(url("/ok"), { timeoutMs: 30 }), OutboundNetworkError);
  assert.equal(slowDns.connections.length, 0);
  await assert.rejects(client.publicHttpRequest(url("/ok"), { signal: AbortSignal.abort() }), OutboundNetworkError);
});
test("pin IMAP endpoint with original SNI, and reject internal mail servers", async () => {
  const client = network();
  assert.deepEqual(await client.publicMailEndpoint("imap.example.test", 993), { host: "8.8.8.8", port: 993, servername: "imap.example.test" });
  for (const host of ["127.0.0.1", "192.168.3.106", "::1", "[::ffff:127.0.0.1]"]) {
    await assert.rejects(client.publicMailEndpoint(host, 993), blocked("outbound_destination_blocked"));
  }
  await assert.rejects(client.publicMailEndpoint("imap.example.test", 0), blocked("outbound_invalid_port"));
});
