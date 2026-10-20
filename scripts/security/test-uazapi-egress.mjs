import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { UazapiService } = require("./dist/channels/whatsapp/uazapi.service.js");
const { EmailSenderService } = require("./dist/channels/email/email-sender.service.js");
let httpConnections = 0, smtpConnections = 0;
const http = createServer((_request, response) => response.end('{"privateFixture":true}'));
http.on("connection", () => httpConnections++);
const smtp = createTcpServer(socket => { smtpConnections++; socket.destroy(); });
await Promise.all([new Promise(resolve => http.listen(0, "127.0.0.1", resolve)),
  new Promise(resolve => smtp.listen(0, "127.0.0.1", resolve))]);
try {
  const service = new UazapiService();
  for (const host of ["127.0.0.1", "2130706433", "[::ffff:127.0.0.1]"]) {
    const result = await service.call(`http://${host}:${http.address().port}`, "fixture-auth-token", "/instance/status");
    assert.equal(result.ok, false, "tenant integration must not reach a loopback service");
    assert.equal(httpConnections, 0, "private connection must be blocked before TCP");
    assert.ok(!JSON.stringify(result).includes("fixture-auth-token"));
  }
  const sender = new EmailSenderService({ get: () => "fixture.test" });
  await assert.rejects(sender.sendTenantEmail({ host: "127.0.0.1", port: smtp.address().port,
    secure: false, user: "fixture@example.test", password: "fixture-only" },
    { to: "nobody@example.test", subject: "fixture", text: "fixture" }), /outbound_destination_blocked/);
  assert.equal(smtpConnections, 0, "SMTP cannot connect to an internal destination");
  console.log("PASS compiled API: uazapi loopback/decimal/mapped IP and SMTP blocked before TCP");
} finally {
  http.closeAllConnections();
  await Promise.all([new Promise(resolve => http.close(resolve)), new Promise(resolve => smtp.close(resolve))]);
}
