#!/usr/bin/env node
/**
 * telegram-post.js — posts each new job to your Telegram channel.
 *
 * Why this exists: SEO takes months. In the Indian Sarkari / Gulf jobs market,
 * Telegram and WhatsApp are how most candidates actually receive notifications.
 * A channel gives you traffic from day one instead of waiting on Google, and the
 * repeat visits and brand searches it creates also help the site's SEO trust.
 *
 * Setup (once):
 *   1. In Telegram, message @BotFather -> /newbot -> copy the token
 *   2. Create a public channel, add the bot as an administrator
 *   3. Add GitHub secrets: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (e.g. @yourchannel)
 *
 * Without those secrets this script does nothing and the workflow continues.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();
const SITE = (CONFIG.url || "https://news-views.in").replace(/\/$/, "");
const BRAND = CONFIG.brand || CONFIG.name || "News-Views";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT = process.env.TELEGRAM_CHAT_ID || "";
const MAX_POSTS = Number(process.env.TELEGRAM_MAX || CONFIG.maxTelegramPerRun || 8);

const JOBS = path.join(ROOT, "data", "jobs.json");
const NEWURLS = path.join(ROOT, "data", "new-urls.txt");
const POSTED = path.join(ROOT, "data", "posted.json");

const esc = (s) => String(s || "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d) => {
  if (!d) return "";
  const x = new Date(d + "T00:00:00");
  if (isNaN(x)) return "";
  return x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const inr = (n) => Number(n).toLocaleString("en-IN");

function message(job) {
  const L = [];
  L.push(`<b>${esc(job.title)}</b>`);
  L.push("");
  if (job.organization) L.push(`🏛 <b>Department:</b> ${esc(job.org_short || job.organization)}`);
  if (job.total_vacancies) L.push(`👥 <b>Vacancies:</b> ${inr(job.total_vacancies)}`);
  if (job.qualification) L.push(`🎓 <b>Qualification:</b> ${esc(String(job.qualification).slice(0, 90))}`);
  if (job.location) L.push(`📍 <b>Location:</b> ${esc(job.location)}`);
  if (job.salary) L.push(`💰 <b>Salary:</b> ${esc(String(job.salary).slice(0, 70))}`);
  if (job.application_end) L.push(`⏳ <b>Last date:</b> ${esc(fmtDate(job.application_end))}`);
  L.push("");
  L.push(`📄 Full details, eligibility and how to apply:`);
  L.push(`${SITE}/jobs/${job.id}/`);
  L.push("");
  L.push(`— ${esc(BRAND)}`);
  return L.join("\n");
}

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT, text, parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    let why = "";
    try { why = (await res.json()).description || ""; } catch { /* ignore */ }
    return { ok: false, status: res.status, why };
  }
  return { ok: true };
}

function loadPosted() {
  try {
    const p = JSON.parse(fs.readFileSync(POSTED, "utf8"));
    return new Set(Array.isArray(p) ? p : (p.ids || []));
  } catch { return new Set(); }
}

async function main() {
  if (!TOKEN || !CHAT) {
    console.log("Telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping (see telegram-post.js header for setup).");
    return;
  }
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(JOBS, "utf8")); } catch { console.log("Telegram: cannot read jobs.json"); return; }
  if (!Array.isArray(jobs) || !jobs.length) return;

  const posted = loadPosted();

  // Prefer the exact URLs this run added; fall back to newest unposted jobs.
  let ids = [];
  try {
    ids = fs.readFileSync(NEWURLS, "utf8").split("\n")
      .map((u) => (u.match(/\/jobs\/([^/]+)\//) || [])[1]).filter(Boolean);
  } catch { /* no new-urls this run */ }
  if (!ids.length) {
    ids = [...jobs].sort((a, b) => (b.published || "").localeCompare(a.published || ""))
      .map((j) => j.id).slice(0, 20);
  }

  const queue = [];
  for (const id of ids) {
    if (posted.has(id) || queue.some((j) => j.id === id)) continue;
    const job = jobs.find((j) => j.id === id);
    if (job && job.title) queue.push(job);
    if (queue.length >= MAX_POSTS) break;
  }

  if (!queue.length) { console.log("Telegram: nothing new to post."); return; }
  console.log(`Telegram: posting ${queue.length} job(s) to ${CHAT}`);

  let sent = 0;
  for (const job of queue) {
    const r = await send(message(job));
    if (r.ok) { posted.add(job.id); sent++; console.log(`  ✓ ${job.title}`); }
    else {
      console.log(`  ✗ HTTP ${r.status} ${r.why}`);
      if (r.status === 401 || r.status === 403 || r.status === 400) break;   // config problem — stop retrying
    }
    await new Promise((res) => setTimeout(res, 3500));   // Telegram rate limit: ~20 msgs/min to a channel
  }

  if (sent) {
    // Keep the last 2000 ids so the file stays small.
    fs.writeFileSync(POSTED, JSON.stringify([...posted].slice(-2000), null, 2) + "\n");
    console.log(`Telegram: posted ${sent} job(s).`);
  }
}
main();
