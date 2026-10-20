import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createRequire } from "node:module";

// Real Nodemailer over a loopback SMTP fixture. No external mail connection.
const apiRequire = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const nodemailer = webRequire("nodemailer");
const { simpleParser } = apiRequire("mailparser");
const { EmailSenderService } = apiRequire("./dist/channels/email/email-sender.service.js");
const sockets = new Set();
const messages = [];
const transports = [];
let rejectRecipients = false;
const server = createServer(socket => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.setEncoding("utf8");
  socket.write("220 fixture.test ESMTP\r\n");
  let buffer = "", receiving = false, raw = [];
  socket.on("data", data => {
    buffer += data;
    while (buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (receiving) {
        if (line === ".") {
          messages.push(raw.join("\r\n"));
          raw = [];
          receiving = false;
          socket.write("250 queued-fixture\r\n");
        } else raw.push(line.startsWith("..") ? line.slice(1) : line);
      } else if (/^(EHLO|HELO)\b/.test(line)) {
        socket.write("250-fixture.test\r\n250 AUTH PLAIN\r\n");
      } else if (/^AUTH PLAIN\b/.test(line)) socket.write("235 authenticated-fixture\r\n");
      else if (/^RCPT TO:/i.test(line) && rejectRecipients) socket.write("550 rejected-fixture\r\n");
      else if (/^DATA$/.test(line)) {
        receiving = true;
        socket.write("354 send-data\r\n");
      } else if (/^QUIT$/.test(line)) socket.end("221 bye\r\n");
      else socket.write("250 ok\r\n");
    }
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const originalCreateTransport = nodemailer.createTransport;
nodemailer.createTransport = (...args) => {
  assert.equal(args[0].host, "127.0.0.1", "SMTP fixture must never reach an external host");
  assert.equal(args[0].port, port);
  const transport = originalCreateTransport(...args);
  transports.push(transport);
  return transport;
};
const previousEnvironment = { ...process.env };
try {
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_SECURE: "false",
    SMTP_USER: "sender@example.test", SMTP_PASSWORD: "fixture-only-password",
    SMTP_FROM: "sender@example.test", SMTP_CLIENT_NAME: "fixture.test",
  });
  const { sendMail } = await import("../../apps/web/src/lib/mailer.server.ts");
  const sent = await sendMail({ to: "contact@example.test", subject: "OTP fixture",
    text: "Fixture code 123456", html: "<p>Fixture code <b>123456</b></p>" });
  assert.equal(sent.accepted.length, 1);
  const portal = await simpleParser(messages[0]);
  assert.equal(portal.subject, "OTP fixture");
  assert.match(portal.text, /123456/);
  assert.match(portal.html, /<b>123456<\/b>/);

  const sender = new EmailSenderService({ get: () => "fixture.test" });
  const fixturePdf = Buffer.from("%PDF-fixture-only");
  const result = await sender.sendTenantEmail({ host: "127.0.0.1", port, secure: false,
    user: "sender@example.test", password: "fixture-only-password", fromName: "Fixture" }, {
    to: "contact@example.test", subject: "Ticket fixture", text: "Fixture reply",
    html: "<p>Fixture reply</p>", inReplyTo: "<fixture-inbound@example.test>",
    references: "<fixture-inbound@example.test>",
    attachments: [{ filename: "fixture.pdf", content: fixturePdf, contentType: "application/pdf" }],
  });
  assert.ok(result.messageId);
  const reply = await simpleParser(messages[1]);
  assert.equal(reply.inReplyTo, "<fixture-inbound@example.test>");
  assert.equal(reply.attachments.length, 1);
  assert.deepEqual(reply.attachments[0].content, fixturePdf);
  rejectRecipients = true;
  await assert.rejects(sendMail({ to: "refused@example.test", subject: "Refused fixture",
    text: "fixture", html: "<p>fixture</p>" }));
  assert.equal(messages.length, 2, "refused delivery must not be reported as sent");
  console.log("PASS real Nodemailer: portal OTP, tenant reply, threading, attachment and SMTP refusal");
} finally {
  nodemailer.createTransport = originalCreateTransport;
  for (const transport of transports) transport.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  for (const key of Object.keys(process.env)) if (!(key in previousEnvironment)) delete process.env[key];
  Object.assign(process.env, previousEnvironment);
}
