#!/usr/bin/env node
/**
 * Google Indexing API pinger — JOB pages only (the API is for JobPosting pages; never guides/updates/other pages).
 *
 * data/indexing-state.json remembers what was sent: { "<url>": { sentAt, hash, deleted? }, "_day": { date, used },
 * "_retry": [urls] }. hash = title / application_end / apply_link / total_vacancies, so a job is announced again only when
 * one of those changes. Each run, within a budget of 200 notifications per Indian day (shared by every run that day):
 *   1. new live jobs (this build's data/new-urls.txt) and URLs that hit the quota (429) last time
 *   2. URL_UPDATED for live jobs whose hash changed since they were sent (a corrigendum, an extension)
 *   3. live jobs never sent, with 5+ days left to apply, biggest vacancy count first (the backlog drains slowly)
 *   4. URL_DELETED for job URLs that were sent before and are now redirected (retired / merged)
 * A 429 stops the run; the unsent URLs are kept in _retry, so they are not lost when pending-urls.txt is emptied.
 *
 * Auth: a Google Cloud service-account JSON key in GOOGLE_SERVICE_ACCOUNT_JSON (a GitHub secret). Without it the
 * script exits quietly. Usage:
 *   node ping-google.js            # the plan above
 *   node ping-google.js url1 url2  # URL_UPDATED for these job URLs only (still within the daily budget)
 *   node ping-google.js --plan     # print what would be sent; nothing is sent, no key needed
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA = (f) => path.join(ROOT, "data", f);
const SITE_URL = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).url.replace(/\/$/, ""); }
  catch { return "https://news-views.in"; }
})();
const DAILY = Number(process.env.INDEXING_DAILY || 200);
// The backlog (step 3) may use at most this many a day, so jobs found later in the day still get their slot.
const DRAIN_DAILY = Number(process.env.INDEXING_DRAIN || 80);
const STATE_FILE = DATA("indexing-state.json");
const PLAN_ONLY = process.argv.includes("--plan");
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const jobUrl = (id) => `${SITE_URL}/jobs/${id}/`;
const hashOf = (j) => crypto.createHash("sha1").update(JSON.stringify([j.title || "", j.application_end || "", j.apply_link || "", Number(j.total_vacancies) || 0, j.notice_status || ""])).digest("hex").slice(0, 12);

/** What to send this run, in order, within the budget left today: { todo: [{ url, type, hash? }], deferred: [urls] }
    (deferred = new / changed URLs that did not fit today, kept for tomorrow). Pure (no network). */
function plan({ jobs, redirects, state, newUrls, today, budget, drainLeft = DRAIN_DAILY }) {
  const B = require("./build.js");                         // the site's own rules for "live" (statusOf) — builds nothing
  const L = require("./lib.js");
  const byUrl = new Map();
  for (const j of jobs) if (j && j.id && j.title && !L.isNonGovt(j)) byUrl.set(jobUrl(j.id), j);
  const live = (j) => j && B.statusOf(j).live;
  const daysLeft = (j) => (j.application_end ? Math.round((Date.parse(j.application_end) - Date.parse(today)) / 86400000) : null);
  const out = [], seen = new Set(), deferred = [];
  const add = (url, type, keep = false) => {
    if (seen.has(url)) return false;
    if (out.length >= budget) { if (keep) deferred.push(url); return false; }
    seen.add(url); const j = byUrl.get(url); out.push(type === "URL_DELETED" ? { url, type } : { url, type, hash: hashOf(j) }); return true;
  };
  // 1. new this build + quota leftovers
  for (const u of [...(state._retry || []), ...newUrls]) { const j = byUrl.get(u); if (live(j) && (!state[u] || state[u].hash !== hashOf(j))) add(u, "URL_UPDATED", true); }
  // 2. changed since sent
  // (a cancelled job is no longer live but must be re-crawled, so Google Jobs drops its open listing)
  for (const [u, j] of byUrl) if (state[u] && !state[u].deleted && state[u].hash && state[u].hash !== hashOf(j) && (live(j) || j.notice_status)) add(u, "URL_UPDATED", true);
  // 3. never sent, 5+ days left, biggest first (at most drainLeft today)
  let drained = 0;
  for (const [u] of [...byUrl].filter(([u, j]) => !state[u] && live(j) && daysLeft(j) !== null && daysLeft(j) >= 5)
    .sort((a, b) => (Number(b[1].total_vacancies) || 0) - (Number(a[1].total_vacancies) || 0))) {
    if (drained >= drainLeft) break;
    if (add(u, "URL_UPDATED")) drained++;
  }
  // 4. sent before, now redirected
  for (const [from] of redirects) {
    const m = /^\/jobs\/([^/]+)\/$/.exec(from || ""); if (!m) continue;
    const u = jobUrl(m[1]);
    if (state[u] && !state[u].deleted && !byUrl.has(u)) add(u, "URL_DELETED");
  }
  return { todo: out, deferred, drained };
}

// ---- Build a signed JWT and exchange it for an access token (no deps) ----
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
async function getAccessToken(KEY) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: KEY.client_email, scope: "https://www.googleapis.com/auth/indexing", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signer = crypto.createSign("RSA-SHA256"); signer.update(unsigned);
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signer.sign(KEY.private_key))}` }) });
  const data = await res.json();
  if (!data.access_token) throw new Error("token error: " + JSON.stringify(data));
  return data.access_token;
}
async function publish(token, url, type) {
  const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ url, type }) });
  return res.status;
}

async function main() {
  const RAW = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!PLAN_ONLY && !RAW.trim()) { console.log("Indexing API: GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping (this is optional)."); return; }
  const today = todayIST();
  const state = readJson(STATE_FILE, {});
  if (!state._day || state._day.date !== today) state._day = { date: today, used: 0, drained: 0 };
  const budget = Math.max(0, DAILY - state._day.used);
  const jobs = readJson(DATA("jobs.json"), []), redirects = readJson(DATA("redirects.json"), []);
  const cli = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a) && /\/jobs\/[^/]+\/?$/.test(a));
  const newUrls = String((() => { try { return fs.readFileSync(DATA("new-urls.txt"), "utf8"); } catch { return ""; } })())
    .split("\n").map((s) => s.trim()).filter((u) => /\/jobs\/[^/]+\/$/.test(u));
  const p = cli.length ? { todo: cli.slice(0, budget).map((url) => ({ url, type: "URL_UPDATED", hash: hashOf(jobs.find((j) => jobUrl(j.id) === url) || {}) })), deferred: [], drained: 0 }
    : plan({ jobs, redirects, state, newUrls, today, budget, drainLeft: Math.max(0, DRAIN_DAILY - (state._day.drained || 0)) });
  const todo = p.todo;
  const count = (t) => todo.filter((x) => x.type === t).length;
  console.log(`Indexing API: ${todo.length} to send (${count("URL_UPDATED")} updated, ${count("URL_DELETED")} deleted); ${state._day.used}/${DAILY} used today (IST ${today}).`);
  if (PLAN_ONLY) { for (const x of todo.slice(0, 40)) console.log(`  ${x.type} ${x.url}`); return; }
  if (!todo.length) { state._retry = [...new Set([...(state._retry || []), ...p.deferred])].slice(0, 400); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + "\n"); return; }

  let KEY; try { KEY = JSON.parse(RAW); } catch { console.log("Indexing API: service-account JSON is not valid JSON — skipping."); return; }
  let token; try { token = await getAccessToken(KEY); } catch (e) { console.log("Indexing API: auth failed — " + e.message + " (skipping)."); return; }

  let ok = 0, fail = 0, limited = false;
  const retry = [...p.deferred];   // new / changed URLs that did not fit in today's budget go first tomorrow
  state._day.drained = (state._day.drained || 0) + p.drained;
  for (let i = 0; i < todo.length; i++) {
    const x = todo[i];
    let status = 0;
    try { status = await publish(token, x.url, x.type); } catch { status = 0; }
    if (status === 429) {   // quota spent: keep this URL and every unsent new/changed one for the next run
      limited = true; state._day.used = DAILY;
      retry.push(...todo.slice(i).filter((y) => y.type === "URL_UPDATED").map((y) => y.url));
      break;
    }
    state._day.used++;
    if (status === 200) {
      ok++;
      state[x.url] = x.type === "URL_DELETED" ? { ...(state[x.url] || {}), deleted: true, deletedAt: new Date().toISOString() } : { sentAt: new Date().toISOString(), hash: x.hash };
    } else { fail++; if (fail <= 3) console.log(`  ping ${status}: ${x.type} ${x.url}`); if (x.type === "URL_UPDATED" && status >= 500) retry.push(x.url); }
    await new Promise((r) => setTimeout(r, 120));   // gentle pacing
  }
  // leftovers from earlier runs that were sent now drop out; the new 429/5xx ones stay (at most 400)
  state._retry = [...new Set([...retry, ...(state._retry || []).filter((u) => !state[u] && !todo.some((x) => x.url === u))])].slice(0, 400);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + "\n");
  console.log(`Indexing API: sent ${ok}${fail ? `, ${fail} failed` : ""}${limited ? `, quota reached — ${retry.length} kept for the next run` : ""}.`);
  try { require("./lib.js").logRun("indexing-api", { ok: fail === 0 && !limited, submitted: ok, failed: fail, limited, kept: state._retry.length, usedToday: state._day.used }); } catch { /* optional */ }
}

module.exports = { plan, hashOf };
if (require.main === module) main().catch((e) => { console.log("Indexing API error (non-fatal): " + e.message); });
