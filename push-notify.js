#!/usr/bin/env node
/**
 * push-notify.js — job alerts for the Android app (Firebase Cloud Messaging, free).
 * Runs after a build is live (update-jobs.yml). For the jobs and updates this build published (data/new-urls.txt) it
 * sends notifications to the app's topics. Each phone subscribes only to what its owner chose:
 *   s-<state> (or s-any)        home state(s); all-India jobs go to everyone
 *   q-<qualification>           every level the person qualifies for ("Graduate" = q-10th-pass, q-12th-pass, q-graduate)
 *   results                     results / admit cards / answer keys of major exams
 *   l-en or l-hi                language of the notification
 *   o-<department>              departments the person follows (e.g. o-ssc, o-rrb): every new job, admit card, result…
 * A job is sent once per language to: (its state or s-any) AND (its lowest qualification level) AND language.
 * At most 6 jobs (largest first) and 3 results per build; data/pushed.json remembers what was sent.
 * Needs the FIREBASE_SERVICE_ACCOUNT_JSON secret (Firebase console → Project settings → Service accounts →
 * Generate new private key). Without it the script exits quietly. Never fails the workflow.
 */
const fs = require("fs");
const path = require("path");
const G = require("./google.js");
const L = require("./lib.js");

const ROOT = __dirname;
const SITE = (L.CONFIG.url || "https://news-views.in").replace(/\/$/, "");
const PUSHED = path.join(ROOT, "data", "pushed.json");
const MAX_JOBS = 6, MAX_UPDATES = 3, MAX_FOLLOW = 20;
// same rule as the app (Alerts.orgTopic) and build.js slug()
const orgTopic = (o) => "o-" + String(o || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
// lowest level first; engineering/diploma is its own track
const RANK = { "10th-pass": 1, "12th-pass": 2, "graduate": 3, "post-graduate": 4 };

function jobTopic(q) {
  const levels = q.filter((x) => RANK[x]).sort((a, b) => RANK[a] - RANK[b]);
  if (levels.length) return `q-${levels[0]}`;
  return q.includes("engineering-diploma") ? "q-engineering-diploma" : "q-graduate";
}
function jobCondition(job, lang) {
  const parts = [];
  const st = (job.s || [])[0];
  if (st === "gulf") parts.push("'s-gulf' in topics");
  else if (st && st !== "all-india") parts.push(`('s-${st}' in topics || 's-any' in topics)`);
  parts.push(`'${jobTopic(job.q || [])}' in topics`);
  parts.push(`'l-${lang}' in topics`);
  return parts.join(" && ");
}
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00Z"); return isNaN(d) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }); };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (!raw.trim()) { console.log("push-notify: FIREBASE_SERVICE_ACCOUNT_JSON not set — app alerts off."); return; }
  let key; try { key = JSON.parse(raw); } catch { console.log("push-notify: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."); return; }
  const project = key.project_id;
  let index; try { index = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "app", "v1", "index.json"), "utf8")); }
  catch { console.log("push-notify: dist/app/v1/index.json missing (build first)."); return; }
  let urls = []; try { urls = fs.readFileSync(path.join(ROOT, "data", "new-urls.txt"), "utf8").split("\n").map((x) => x.trim()).filter(Boolean); } catch {}
  let pushed = {}; try { pushed = JSON.parse(fs.readFileSync(PUSHED, "utf8")); } catch {}
  const idOf = (u, kind) => ((u.match(new RegExp(`/${kind}/([^/]+)/`)) || [])[1]);
  const jobIds = new Set(urls.map((u) => idOf(u, "jobs")).filter(Boolean));
  const updIds = new Set(urls.map((u) => idOf(u, "updates")).filter(Boolean));
  const jobs = index.jobs.filter((j) => jobIds.has(j.id) && !pushed[`j:${j.id}`]).sort((a, b) => b.v - a.v).slice(0, MAX_JOBS);
  const updates = index.updates.filter((u) => updIds.has(u.id) && u.big && u.ty !== "exam-date" && !pushed[`u:${u.id}`]).slice(0, MAX_UPDATES);
  // followers of a department get everything new from it (same notification tag, so a phone that also matched the
  // state/qualification alert sees it once)
  const follow = [
    ...index.jobs.filter((j) => jobIds.has(j.id) && j.o && !pushed[`fj:${j.id}`]).map((j) => ({ kind: "job", x: j })),
    ...index.updates.filter((u) => updIds.has(u.id) && u.o && !pushed[`fu:${u.id}`]).map((u) => ({ kind: "update", x: u })),
  ].slice(0, MAX_FOLLOW);
  if (!jobs.length && !updates.length && !follow.length) { console.log("push-notify: nothing new to send."); L.logRun("push", { ok: true, sent: 0 }); return; }

  const token = await G.getToken("https://www.googleapis.com/auth/firebase.messaging", key);
  const send = async (message) => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(20000),
    });
    return r.ok ? "ok" : `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
  };
  const log = [];
  let sent = 0;
  for (const j of jobs) {
    for (const lang of ["en", "hi"]) {
      const title = cut(lang === "hi" && j.th ? j.th : j.t, 90);
      const facts = [j.v ? `${j.v.toLocaleString("en-IN")} ${lang === "hi" ? "पद" : j.v === 1 ? "post" : "posts"}` : "", j.en ? `${lang === "hi" ? "अंतिम तिथि" : "Last date"} ${fmtDate(j.en)}` : ""].filter(Boolean).join(" · ");
      const res = await send({
        condition: jobCondition(j, lang),
        notification: { title, body: facts || (lang === "hi" ? "नई सरकारी नौकरी" : "New government job") },
        data: { kind: "job", id: j.id, url: `${SITE}/jobs/${j.id}/` },
        android: { priority: "HIGH", notification: { channel_id: "jobs", tag: `j-${j.id}` } },
      });
      log.push(`job ${j.id} ${lang}: ${res}`); if (res === "ok") sent++;
    }
    pushed[`j:${j.id}`] = new Date().toISOString().slice(0, 10);
  }
  const typeName = { result: ["Result", "परिणाम"], "admit-card": ["Admit card", "प्रवेश पत्र"], "answer-key": ["Answer key", "उत्तर कुंजी"] };
  for (const u of updates) {
    for (const lang of ["en", "hi"]) {
      const res = await send({
        condition: `'results' in topics && 'l-${lang}' in topics`,
        notification: { title: cut(lang === "hi" && u.th ? u.th : u.t, 90), body: (typeName[u.ty] || ["Update", "अपडेट"])[lang === "hi" ? 1 : 0] + (u.o ? ` · ${u.o}` : "") },
        data: { kind: "update", id: u.id, url: `${SITE}/updates/${u.id}/` },
        android: { priority: "HIGH", notification: { channel_id: "results", tag: `u-${u.id}` } },
      });
      log.push(`update ${u.id} ${lang}: ${res}`); if (res === "ok") sent++;
    }
    pushed[`u:${u.id}`] = new Date().toISOString().slice(0, 10);
  }
  for (const { kind, x } of follow) {
    const topic = orgTopic(x.o);
    if (topic === "o-") continue;
    for (const lang of ["en", "hi"]) {
      const title = cut(lang === "hi" && (x.thc || x.th) ? (x.thc || x.th) : (x.tc || x.t), 90);
      const body = kind === "job"
        ? [x.v ? `${x.v.toLocaleString("en-IN")} ${lang === "hi" ? "पद" : x.v === 1 ? "post" : "posts"}` : "", x.en ? `${lang === "hi" ? "अंतिम तिथि" : "Last date"} ${fmtDate(x.en)}` : ""].filter(Boolean).join(" · ") || (lang === "hi" ? "नई भर्ती" : "New recruitment")
        : (typeName[x.ty] || ["Update", "अपडेट"])[lang === "hi" ? 1 : 0] + ` · ${x.o}`;
      const res = await send({
        condition: `'${topic}' in topics && 'l-${lang}' in topics`,
        notification: { title, body },
        data: { kind, id: x.id, url: `${SITE}/${kind === "job" ? "jobs" : "updates"}/${x.id}/` },
        android: { priority: "HIGH", notification: { channel_id: kind === "job" ? "jobs" : "results", tag: `${kind === "job" ? "j" : "u"}-${x.id}` } },
      });
      log.push(`follow ${topic} ${x.id} ${lang}: ${res}`); if (res === "ok") sent++;
    }
    pushed[`${kind === "job" ? "fj" : "fu"}:${x.id}`] = new Date().toISOString().slice(0, 10);
  }
  // keep 60 days of history
  const keep = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(pushed)) if (pushed[k] < keep) delete pushed[k];
  fs.writeFileSync(PUSHED, JSON.stringify(pushed, null, 2) + "\n");
  console.log(`push-notify: ${sent} sent\n  ` + log.join("\n  "));
  L.logRun("push", { ok: log.every((x) => x.endsWith(": ok")), sent, log: log.slice(0, 30) });
}
if (require.main === module) main().catch((e) => console.log("push-notify error (non-fatal): " + e.message));
module.exports = { jobCondition, jobTopic, orgTopic };
