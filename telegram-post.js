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

// Tolerate common paste slips in the secrets: spaces/newlines, quotes, or a leading "bot".
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").replace(/\s+/g, "").replace(/^["']|["']$/g, "").replace(/^bot(?=\d)/i, "");
const CHAT = (process.env.TELEGRAM_CHAT_ID || "").trim().replace(/^["']|["']$/g, "");
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

const UPD_ICON = { result: "✅ RESULT", "admit-card": "🎫 ADMIT CARD", "answer-key": "🔑 ANSWER KEY", "exam-date": "🗓 EXAM DATE" };
function updMessage(u) {
  const L = [`<b>${UPD_ICON[u.type] || "📢 UPDATE"}</b>`, `<b>${esc(u.title)}</b>`, ""];
  if (u.summary) L.push(esc(String(u.summary).slice(0, 280)), "");
  L.push(`📥 How to download + official link:`, `${SITE}/updates/${u.id}/`, "", `— ${esc(BRAND)}`);
  return L.join("\n");
}
function quizMessage(z) {
  const q = z.questions[0];
  return [`<b>🧠 ${esc(z.title)}</b>`, "", `Q1. ${esc(q.q)}`, ...q.options.map((o, i) => `${"ABCD"[i]}) ${esc(o)}`), "",
    `Answer + ${z.questions.length - 1} more questions 👇`, `${SITE}/quiz/${z.id}/`, "", `— ${esc(BRAND)}`].join("\n");
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
  // Only this run's new jobs are posted (no "newest 20" fallback — that re-posted old jobs).

  const queue = [];
  for (const id of ids) {
    if (posted.has(id) || queue.some((j) => j.id === id)) continue;
    const job = jobs.find((j) => j.id === id);
    const closed = job && job.application_end && String(job.application_end).slice(0, 10) < require("./lib.js").todayIST();
    if (job && job.title && !closed) queue.push(job);   // never announce a job whose last date has passed
    if (queue.length >= MAX_POSTS) break;
  }

  // Results, admit cards, answer keys and the daily quiz from this run
  let updates = [], quiz = [];
  try { updates = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "updates.json"), "utf8")); } catch {}
  try { quiz = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "quiz.json"), "utf8")); } catch {}
  let newUrls = []; try { newUrls = fs.readFileSync(NEWURLS, "utf8").split("\n"); } catch {}
  const extra = [];
  for (const u of newUrls) {
    let m = u.match(/\/updates\/([^/]+)\//);
    if (m) { const x = updates.find((y) => y.id === m[1]); if (x && !posted.has("u:" + x.id)) extra.push({ key: "u:" + x.id, text: updMessage(x), title: x.title }); continue; }
    m = u.match(/\/quiz\/([^/]+)\//);
    if (m) { const z = quiz.find((y) => y.id === m[1]); if (z && z.questions && z.questions.length && !posted.has("q:" + z.id)) extra.push({ key: "q:" + z.id, text: quizMessage(z), title: z.title }); }
  }
  const MAX_EXTRA = Number(process.env.TELEGRAM_MAX_UPDATES || CONFIG.maxTelegramUpdatesPerRun || 8);
  let sentExtra = 0;
  for (const it of extra.slice(0, MAX_EXTRA)) {
    const r = await send(it.text);
    if (r.ok) { posted.add(it.key); sentExtra++; console.log(`  ✓ ${it.title}`); }
    else { console.log(`  ✗ HTTP ${r.status} ${r.why}`); if (r.status === 401 || r.status === 403 || r.status === 400) break; }
    await new Promise((res) => setTimeout(res, 3500));
  }
  if (sentExtra) { fs.writeFileSync(POSTED, JSON.stringify([...posted].slice(-3000), null, 2) + "\n"); console.log(`Telegram: posted ${sentExtra} update/quiz message(s).`); }

  if (!queue.length) { console.log("Telegram: no new jobs to post."); return; }
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
    fs.writeFileSync(POSTED, JSON.stringify([...posted].slice(-3000), null, 2) + "\n");
    console.log(`Telegram: posted ${sent} job(s).`);
  }
}
main();
