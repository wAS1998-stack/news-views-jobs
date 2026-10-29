#!/usr/bin/env node
/* telegram-info.js — checks the Telegram bot token and channel (read-only) and saves public details to
   data/telegram.json: which token clean-up (if any) makes the token valid, the channel title, @username or existing
   invite link, and subscriber count. Never prints the token; never creates or revokes invite links. */
const fs = require("fs"), path = require("path");
const RAW = process.env.TELEGRAM_BOT_TOKEN || "", CHAT_RAW = process.env.TELEGRAM_CHAT_ID || "";
const variants = {
  raw: RAW,
  trimmed: RAW.trim(),
  unquoted: RAW.trim().replace(/^["']|["']$/g, ""),
  noBotPrefix: RAW.trim().replace(/^["']|["']$/g, "").replace(/^bot/i, ""),
  noWhitespace: RAW.replace(/\s+/g, "").replace(/^["']|["']$/g, "").replace(/^bot/i, ""),
};
(async () => {
  const out = { at: new Date().toISOString(), tokenLength: RAW.length, tokenLooksLike: /^\d{6,}:[\w-]{30,}$/.test(variants.noWhitespace) ? "id:secret" : "unexpected format",
    chatLooksLike: /^@\w+$/.test(CHAT_RAW.trim()) ? "@username" : /^-?\d+$/.test(CHAT_RAW.trim()) ? "numeric id" : "unexpected format", checks: {} };
  if (!RAW || !CHAT_RAW) { out.error = "telegram secrets not set"; }
  else {
    let good = null;
    for (const [name, tok] of Object.entries(variants)) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`); const j = await r.json();
        out.checks[name] = j.ok ? `ok (@${j.result.username})` : `HTTP ${r.status} ${j.description || ""}`.trim();
        if (j.ok && !good) good = { name, tok };
      } catch (e) { out.checks[name] = "error " + e.message; }
    }
    out.workingTokenForm = good ? good.name : null;
    if (good) {
      const call = async (m, q) => (await fetch(`https://api.telegram.org/bot${good.tok}/${m}?${new URLSearchParams(q)}`)).json();
      const chat = CHAT_RAW.trim();
      const c = await call("getChat", { chat_id: chat });
      if (c.ok) {
        const r = c.result;
        Object.assign(out, { type: r.type, title: r.title || null, username: r.username || null, link: r.username ? `https://t.me/${r.username}` : (r.invite_link || null) });
        const n = await call("getChatMemberCount", { chat_id: chat }); if (n.ok) out.members = n.result;
      } else out.chatError = String(c.description || "getChat failed").slice(0, 160);
    }
  }
  // Write only when something changed or once a day, so frequent runs don't create commit noise.
  const file = path.join(__dirname, "..", "data", "telegram.json");
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const same = (a, b) => JSON.stringify({ ...a, at: 0, checks: 0, members: 0 }) === JSON.stringify({ ...b, at: 0, checks: 0, members: 0 });
  if (!same(prev, out) || !prev.at || Date.now() - Date.parse(prev.at) > 86400000) fs.writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ ...out, checks: undefined }));
})();
