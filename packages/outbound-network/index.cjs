// Generated from index.mjs by build.mjs. Edit the ESM source.
"use strict";

// Applies only to tenant/external integration destinations. Application-owned
// Supabase/API URLs use their existing, operator-controlled internal clients.
const dns = require("node:dns/promises");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const { domainToASCII } = require("node:url");
const { Transform, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");

const deniedV4 = new net.BlockList();
for (const [base, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["168.63.129.16", 32], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) deniedV4.addSubnet(base, prefix, "ipv4");
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const deniedV6 = new net.BlockList();
// Includes transition/tunnelling mechanisms, protocol assignments and docs.
for (const [base, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  deniedV6.addSubnet(base, prefix, "ipv6");
}

class OutboundNetworkError extends Error {
  constructor(code) { super(code); this.name = "OutboundNetworkError"; this.code = code; }
}
const failure = code => new OutboundNetworkError(code);

function isPublicAddress(address) {
  if (typeof address !== "string" || address.includes("%")) return false;
  const family = net.isIP(address);
  if (family === 4) return !deniedV4.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !deniedV6.check(address, "ipv6");
}

function normalizeHost(input) {
  if (typeof input !== "string" || !input || input !== input.trim()) throw failure("outbound_invalid_host");
  const host = input.startsWith("[") && input.endsWith("]") ? input.slice(1, -1) : input;
  if (/[\s\x00-\x1f\x7f/@\\?#%]/.test(host)) throw failure("outbound_invalid_host");
  if (net.isIP(host)) return host;
  const ascii = domainToASCII(host).toLowerCase().replace(/\.$/, "");
  if (!ascii || ascii.length > 253 || !ascii.includes(".") || ascii.split(".").some(label =>
    label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith("-") || label.endsWith("-"))) {
    throw failure("outbound_invalid_host");
  }
  return ascii;
}

function publicUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw failure("outbound_invalid_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw failure("outbound_invalid_url");
  }
  normalizeHost(url.hostname);
  return url;
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure("outbound_aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    const selected = options?.family ? addresses.filter(row => row.family === options.family) : addresses;
    if (!selected.length) return callback(failure("outbound_dns_failed"));
    if (options?.all) callback(null, selected.map(row => ({ ...row })));
    else callback(null, selected[0].address, selected[0].family);
  };
}

function byteLimiter(maxBytes) {
  let size = 0;
  return new Transform({ transform(chunk, _encoding, done) {
    size += chunk.length;
    done(size > maxBytes ? failure("outbound_body_too_large") : null, chunk);
  } });
}

async function readBody(response, maxBytes, signal) {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy(); throw failure("outbound_body_too_large");
  }
  const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase();
  let decoder;
  switch (encoding) {
    case "gzip": decoder = zlib.createGunzip(); break;
    case "deflate": decoder = zlib.createInflate(); break;
    case "br": decoder = zlib.createBrotliDecompress(); break;
    default: decoder = null;
  }
  if (!decoder && encoding !== "identity") { response.destroy(); throw failure("outbound_encoding_unsupported"); }
  const chunks = []; let size = 0;
  const sink = new Writable({ write(chunk, _encoding, done) {
    size += chunk.length;
    if (size > maxBytes) return done(failure("outbound_body_too_large"));
    chunks.push(chunk); done();
  } });
  // Bound both encoded and decoded bytes, even without Content-Length.
  await pipeline([response, byteLimiter(maxBytes), ...(decoder ? [decoder] : []), sink], { signal });
  return Buffer.concat(chunks, size);
}

// Dependencies are injectable for isolated protocol/DNS fixtures only. Normal
// consumers use the strict singleton below; no env/request flag disables it.
function createOutboundNetwork({ lookup = dns.lookup, request = (protocol, options, callback) =>
  (protocol === "https:" ? https : http).request(options, callback), connect = net.createConnection } = {}) {
  async function resolve(hostInput, port, signal = AbortSignal.timeout(15_000)) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw failure("outbound_invalid_port");
    const host = normalizeHost(hostInput);
    signal.throwIfAborted();
    const literal = net.isIP(host);
    let addresses;
    try { addresses = literal ? [{ address: host, family: literal }] :
      await abortable(lookup(host, { all: true, verbatim: true }), signal); }
    catch (error) { if (error instanceof OutboundNetworkError) throw error; throw failure("outbound_dns_failed"); }
    if (!addresses.length || addresses.some(row => !isPublicAddress(row.address) || net.isIP(row.address) !== row.family)) {
      throw failure("outbound_destination_blocked");
    }
    signal.throwIfAborted();
    return { host, port, addresses };
  }

  async function publicMailEndpoint(host, port) {
    const endpoint = await resolve(host, port);
    const selected = endpoint.addresses.find(row => row.family === 4) ?? endpoint.addresses[0];
    return { host: selected.address, port, servername: net.isIP(endpoint.host) ? undefined : endpoint.host };
  }

  function publicSmtpSocket(host, port) {
    return (_options, callback) => {
      const signal = AbortSignal.timeout(15_000);
      resolve(host, port, signal).then(endpoint => new Promise((done, reject) => {
        signal.throwIfAborted();
        const socket = connect({ host: endpoint.host, port, lookup: pinnedLookup(endpoint.addresses),
          autoSelectFamily: true });
        const abort = () => { socket.destroy(); reject(failure("outbound_aborted")); };
        signal.addEventListener("abort", abort, { once: true });
        const error = () => { signal.removeEventListener("abort", abort); reject(failure("outbound_connection_failed")); };
        socket.once("error", error);
        socket.once("connect", () => {
          signal.removeEventListener("abort", abort);
          socket.removeListener("error", error);
          socket.pause();
          done(socket);
        });
      })).then(connection => callback(null, { connection, secured: false }),
        error => callback(error instanceof OutboundNetworkError ? error : failure("outbound_connection_failed")));
    };
  }

  async function publicHttpRequest(input, options = {}) {
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    const redirects = options.maxRedirects ?? 5;
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(redirects) || redirects < 0 || redirects > 10
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw failure("outbound_invalid_options");
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let url = publicUrl(input), method = options.method ?? "GET", body = options.body;
    const origin = url.origin;
    const headers = new Headers(options.headers);
    const credentials = options.credentials || ["authorization", "cookie", "token", "apikey", "x-api-key"].some(name => headers.has(name));
    // Host is derived from the URL, and no untrusted proxy or transfer controls.
    for (const header of ["host", "connection", "proxy-authorization", "transfer-encoding", "content-length"]) headers.delete(header);
    headers.set("accept-encoding", "identity");
    try {
      for (let hop = 0; ; hop++) {
        const endpoint = await resolve(url.hostname, Number(url.port || (url.protocol === "https:" ? 443 : 80)), signal);
        const result = await new Promise((done, reject) => {
          const req = request(url.protocol, { protocol: url.protocol, hostname: endpoint.host, port: endpoint.port,
            path: url.pathname + url.search, method, headers: { ...Object.fromEntries(headers), host: url.host },
            lookup: pinnedLookup(endpoint.addresses), servername: net.isIP(endpoint.host) ? undefined : endpoint.host,
            agent: false, signal, maxHeaderSize: 16 * 1024 }, response => {
            const status = response.statusCode ?? 502;
            if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
              response.destroy(); done({ status, location: response.headers.location }); return;
            }
            readBody(response, maxBytes, signal).then(bytes => {
              const responseHeaders = new Headers();
              for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) {
                for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
              }
              done({ ok: status >= 200 && status < 300, status, headers: responseHeaders, bytes,
                text: () => bytes.toString("utf8") });
            }, reject);
          });
          req.on("error", reject);
          req.on("upgrade", (_response, socket) => { socket.destroy(); reject(failure("outbound_upgrade_rejected")); });
          req.end(body);
        });
        if (!result.location) return result;
        if (hop >= redirects) throw failure("outbound_redirect_limit");
        const next = publicUrl(new URL(result.location, url).href);
        if ((credentials && next.origin !== origin) || (url.protocol === "https:" && next.protocol !== "https:")) {
          throw failure("outbound_redirect_blocked");
        }
        if (result.status === 303 && method !== "HEAD" || [301, 302].includes(result.status) && method === "POST") {
          method = "GET"; body = undefined; headers.delete("content-type");
        }
        url = next;
      }
    } catch (error) {
      if (error instanceof OutboundNetworkError) throw error;
      throw failure(signal.aborted ? "outbound_aborted" : "outbound_request_failed");
    }
  }
  return { publicHttpRequest, publicMailEndpoint, publicSmtpSocket };
}

const { publicHttpRequest, publicMailEndpoint, publicSmtpSocket } = createOutboundNetwork();
Object.assign(exports, { OutboundNetworkError, isPublicAddress, createOutboundNetwork,
  publicHttpRequest, publicMailEndpoint, publicSmtpSocket });
