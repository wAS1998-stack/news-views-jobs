#!/usr/bin/env node
/* telegram-info.js — reads the public details of the site's Telegram channel (title, @username or existing invite
   link, subscriber count) with the bot that already posts there, and saves them to data/telegram.json so the site
   can show a "Join our Telegram channel" button. Read-only: never creates or revokes invite links. */
const fs = require("fs"), path = require("path");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "", CHAT = process.env.TELEGRAM_CHAT_ID || "";
(async () => {
  const out = { at: new Date().toISOString() };
  if (!TOKEN || !CHAT) { out.error = "telegram secrets not set"; }
  else {
    const call = async (m, q) => { const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${m}?${new URLSearchParams(q)}`); return r.json(); };
    try {
      const c = await call("getChat", { chat_id: CHAT });
      if (c.ok) {
        const r = c.result;
        Object.assign(out, { type: r.type, title: r.title || null, username: r.username || null,
          link: r.username ? `https://t.me/${r.username}` : (r.invite_link || null) });
        const n = await call("getChatMemberCount", { chat_id: CHAT });
        if (n.ok) out.members = n.result;
      } else out.error = String(c.description || "getChat failed").slice(0, 160);
    } catch (e) { out.error = e.message; }
  }
  fs.writeFileSync(path.join(__dirname, "..", "data", "telegram.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(out));
})();
