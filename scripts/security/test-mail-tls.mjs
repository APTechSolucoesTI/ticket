import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const nodemailer = require("nodemailer");
const { createOutboundNetwork } = require("@apticket/outbound-network");
const tempRoot = realpathSync(tmpdir());
const directory = mkdtempSync(path.join(tempRoot, "apticket-mail-tls-"));
const openssl = process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
  ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
const sockets = new Set(), servers = [], transports = [];
const track = socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); };
try {
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=mail.example.test", "-addext", "subjectAltName=DNS:mail.example.test",
    "-keyout", path.join(directory, "key.pem"), "-out", path.join(directory, "cert.pem")], { stdio: "ignore" });
  const key = readFileSync(path.join(directory, "key.pem")), cert = readFileSync(path.join(directory, "cert.pem"));
  const context = tls.createSecureContext({ key, cert });
  const names = [];
  function smtp(socket, encrypted, greeting = true) {
    track(socket);
    if (greeting) socket.write("220 fixture ESMTP\r\n");
    let buffer = "";
    function data(chunk) {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n"), line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (/^EHLO|^HELO/.test(line)) socket.write(encrypted ? "250 fixture\r\n" : "250-fixture\r\n250 STARTTLS\r\n");
        else if (line === "STARTTLS") {
          socket.removeListener("data", data);
          socket.write("220 start TLS\r\n");
          const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
          secure.once("secure", () => names.push(secure.servername));
          smtp(secure, true, false);
          return;
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    }
    socket.on("data", data);
  }
  const implicit = tls.createServer({ key, cert }, socket => { names.push(socket.servername); smtp(socket, true); });
  implicit.on("tlsClientError", () => {});
  const startTls = net.createServer(socket => smtp(socket, false));
  servers.push(implicit, startTls);
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  for (const [server, secure] of [[implicit, true], [startTls, false]]) {
    let lookups = 0;
    const network = createOutboundNetwork({
      lookup: async () => [{ address: ++lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }],
      connect: options => {
        options.lookup(options.host, { all: true }, (error, rows) => { assert.ifError(error); assert.equal(rows[0].address, "8.8.8.8"); });
        // Only the isolated fixture transport redirects the checked socket.
        return net.createConnection({ host: "127.0.0.1", port: server.address().port });
      },
    });
    const transporter = nodemailer.createTransport({ host: "mail.example.test", port: server.address().port,
      secure, tls: { ca: cert }, getSocket: network.publicSmtpSocket("mail.example.test", server.address().port) });
    transports.push(transporter);
    assert.equal(await transporter.verify(), true);
    assert.equal(lookups, 1, "TLS upgrade cannot trigger a second DNS resolution");
  }
  assert.deepEqual(names, ["mail.example.test", "mail.example.test"], "SNI preserved for implicit TLS and STARTTLS");
  const wrongName = createOutboundNetwork({ lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    connect: () => net.createConnection({ host: "127.0.0.1", port: implicit.address().port }) });
  const refused = nodemailer.createTransport({ host: "wrong.example.test", port: implicit.address().port,
    secure: true, tls: { ca: cert }, getSocket: wrongName.publicSmtpSocket("wrong.example.test", implicit.address().port) });
  transports.push(refused);
  await assert.rejects(refused.verify(), /not match certificate|altnames/i);
  console.log("PASS real SMTP TLS: pinned TCP, SNI, implicit TLS, STARTTLS and wrong certificate rejection; no messages sent");
} finally {
  for (const transport of transports) transport.close();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  const relative = path.relative(tempRoot, realpathSync(directory));
  assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(directory).startsWith("apticket-mail-tls-"));
  rmSync(directory, { recursive: true });
}
