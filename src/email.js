import { ImapFlow } from "imapflow";

let cache = [];        // latest 5 emails: [{from, subject, snippet}]
let ready = false;

export async function startEmailFetcher(conf) {
  const client = new ImapFlow({
    host: conf.host,
    port: Number(conf.port),
    secure: conf.secure === "true",
    auth: { user: conf.user, pass: conf.pass }
  });
  try {
    await client.connect();
    console.log("[email] connected");
    await client.selectMailbox("INBOX");
    ready = true;
    // initial load + poll every 90s
    await refresh(client);
    setInterval(() => refresh(client).catch(console.error), 90_000);
  } catch (e) {
    console.error("[email] failed, running without emails", e.message);
  }
}

async function refresh(client) {
  if (!client || client.closed) return;
  const lock = await client.getMailboxLock("INBOX");
  try {
    const list = [];
    // get last 20, then map top 5
    for await (let msg of client.fetch({ seen: false, limit: 20, source: ">UID" }, { envelope: true, source: true })) {
      const from = msg.envelope.from?.[0]?.address || "Unknown";
      const subject = msg.envelope.subject || "(no subject)";
      const src = msg.source?.toString() || "";
      const snippet = src.replace(/\r?\n/g, " ").slice(0, 120);
      list.push({ from, subject, snippet });
    }
    cache = list.slice(0, 5);
    console.log("[email] cache", cache.length);
  } finally {
    lock.release();
  }
}

export function getRecentEmails(max = 2) {
  if (!ready) return [];
  return cache.slice(0, max);
}