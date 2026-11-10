#!/usr/bin/env node
/**
 * Loopback-only SMTP sink for the pre-login tenant proof. It accepts mail on 127.0.0.1 and appends each message as one
 * JSON line to a local file, so the proof reads a signup verification link the way its recipient would: from the mailbox,
 * never from the application's database. It relays nothing, speaks no TLS and refuses to bind any other interface.
 *
 *   node scripts/qa/tenant-prelogin-smtp-sink.mjs            # 127.0.0.1:2525 -> $TENANT_PRELOGIN_MAIL_FILE
 */
import { appendFileSync, writeFileSync } from "node:fs";
import net from "node:net";

export const PRELOGIN_SMTP_HOST = "127.0.0.1";
export const PRELOGIN_SMTP_PORT = 2525;
export const PRELOGIN_SMTP_URL = "smtp://" + PRELOGIN_SMTP_HOST + ":" + PRELOGIN_SMTP_PORT;

/** Start the sink. Resolves once it is listening; every accepted message is appended to mailFile as one JSON line. */
export function startPreloginSmtpSink(mailFile) {
  if (typeof mailFile !== "string" || mailFile.length === 0) throw new Error("PRELOGIN_SMTP_SINK_REFUSED: a mailbox file is required");
  writeFileSync(mailFile, "");
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "", inData = false, from = "", recipients = [], data = "";
    const reply = (line) => socket.write(line + "\r\n");
    reply("220 prelogin-sink.invalid loopback test sink");
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data = buffer.slice(0, end).replace(/\r\n\.\./g, "\r\n.");
          buffer = buffer.slice(end + 5);
          inData = false;
          // Persist before acknowledging, so a 250 means the mailbox already holds the message.
          appendFileSync(mailFile, JSON.stringify({ receivedAt: new Date().toISOString(), from, recipients, data }) + "\n");
          from = ""; recipients = []; data = "";
          reply("250 stored");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") reply("250 prelogin-sink.invalid");
        else if (verb === "MAIL") { from = line.slice(line.indexOf(":") + 1).trim(); reply("250 ok"); }
        else if (verb === "RCPT") { recipients.push(line.slice(line.indexOf(":") + 1).trim().replace(/^<|>$/g, "").toLowerCase()); reply("250 ok"); }
        else if (verb === "DATA") { inData = true; reply("354 end with <CRLF>.<CRLF>"); }
        else if (verb === "RSET") { from = ""; recipients = []; reply("250 ok"); }
        else if (verb === "NOOP") reply("250 ok");
        else if (verb === "QUIT") { reply("221 bye"); socket.end(); return; }
        else reply("502 command not implemented");
      }
    });
    socket.on("error", () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: this sink must never be reachable from another host.
    server.listen(PRELOGIN_SMTP_PORT, PRELOGIN_SMTP_HOST, () => resolve(server));
  });
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-prelogin-smtp-sink.mjs")) {
  const mailFile = process.env.TENANT_PRELOGIN_MAIL_FILE;
  if (!mailFile) { console.error("PRELOGIN_SMTP_SINK_REFUSED: TENANT_PRELOGIN_MAIL_FILE is required"); process.exit(2); }
  await startPreloginSmtpSink(mailFile);
  console.log("prelogin SMTP sink listening on " + PRELOGIN_SMTP_URL + " -> " + mailFile);
}
