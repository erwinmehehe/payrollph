/**
 * Loopback-only SMTP sink for the pre-login tenant proof, hosted INSIDE the proof process. It accepts mail on 127.0.0.1
 * and hands each message to the proof in memory, so the proof reads a signup verification link the way its recipient
 * would: from the mail, never from the application's database and never through a file. It relays nothing, speaks no TLS
 * and refuses to bind any other interface.
 */
import net from "node:net";

export const PRELOGIN_SMTP_HOST = "127.0.0.1";
export const PRELOGIN_SMTP_PORT = 2525;
export const PRELOGIN_SMTP_URL = "smtp://" + PRELOGIN_SMTP_HOST + ":" + PRELOGIN_SMTP_PORT;

/**
 * Start the sink. Resolves once it is listening. Every accepted message is pushed to `inbox`
 * as { receivedAt, from, recipients, data } before the server acknowledges it.
 */
export function startPreloginSmtpSink(inbox) {
  if (!Array.isArray(inbox)) throw new Error("PRELOGIN_SMTP_SINK_REFUSED: an in-memory inbox array is required");
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "", inData = false, from = "", recipients = [];
    const reply = (line) => socket.write(line + "\r\n");
    reply("220 prelogin-sink.invalid loopback test sink");
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const data = buffer.slice(0, end).replace(/\r\n\.\./g, "\r\n.");
          buffer = buffer.slice(end + 5);
          inData = false;
          // Store before acknowledging, so a 250 means the inbox already holds the message.
          inbox.push({ receivedAt: new Date().toISOString(), from, recipients, data });
          from = ""; recipients = [];
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
