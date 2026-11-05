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
 *   digest                      one evening summary a day (first build after 7 pm IST) of the day's biggest new jobs
 * A job is sent once per language to: (its state or s-any) AND (its lowest qualification level) AND language.
 * Budgets are per audience, not national: per build at most 2 jobs per state (and 2 central ones), per Indian day at
 * most 4 per state and 5 central, largest first — so a Bihar phone gets Bihar's jobs instead of whatever was biggest in
 * India. Results: 3 per build, 6 a day. Followers: results and admit cards before jobs, at most 5 a day per department.
 * Quiet hours 10 pm – 7 am IST: nothing is sent; anything not sent yet (caps, quiet hours) stays eligible for a day
 * (published since yesterday), so the morning builds catch up. data/pushed.json remembers what was sent (IST dates).
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
const MAX_SEG_BUILD = 2, MAX_SEG_DAY = 4, MAX_CENTRAL_DAY = 5, MAX_UPDATES = 3, MAX_UPDATES_DAY = 6, MAX_FOLLOW = 30, MAX_ORG_DAY = 5;
const QUIET_FROM = 22, QUIET_TO = 7;   // IST hours
/* The audience a job's budget is counted against: its first state, or "central" for all-India / central jobs
   (the same split jobConditions uses for its topics). */
const segOf = (j) => { const st = (j.s || []).filter(Boolean); return !st.length || st.includes("all-india") ? "central" : st[0]; };
const dayBefore = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
// same rule as the app (Alerts.orgTopic) and build.js slug()
const orgTopic = (o) => "o-" + String(o || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
// lowest level first; engineering/diploma is its own track
const RANK = { "10th-pass": 1, "12th-pass": 2, "graduate": 3, "post-graduate": 4 };

function jobTopic(q) {
  const levels = q.filter((x) => RANK[x]).sort((a, b) => RANK[a] - RANK[b]);
  if (levels.length) return `q-${levels[0]}`;
  return q.includes("engineering-diploma") ? "q-engineering-diploma" : "q-graduate";
}
/* Every qualification track that can apply: the lowest school/degree level, plus the diploma track when the notice
   accepts a diploma (a Diploma/ITI phone is not subscribed to q-graduate). */
function jobTopics(q) {
  const t = [jobTopic(q)];
  if (q.includes("engineering-diploma")) t.push("q-engineering-diploma");
  return [...new Set(t)];
}
/* One FCM condition per (state, qualification track): a condition may use at most 5 topics, so a job listing three
   states is sent three times — the phone shows it once (same notification tag, alert-once). */
function jobConditions(job, lang) {
  const states = (job.s || []).filter(Boolean);
  let stateClauses;
  // central / all-India jobs go to phones with "Central Government" on (s-central, on by default in the app)
  if (states.includes("all-india") || !states.length) stateClauses = ["'s-central' in topics"];
  else if (states[0] === "gulf") stateClauses = ["'s-gulf' in topics"];
  else stateClauses = states.filter((st) => st !== "gulf").slice(0, 3).map((st, i) => (i === 0 ? `('s-${st}' in topics || 's-any' in topics)` : `'s-${st}' in topics`));
  const out = [];
  for (const sc of stateClauses) for (const qt of jobTopics(job.q || [])) out.push([sc, `'${qt}' in topics`, `'l-${lang}' in topics`].filter(Boolean).join(" && "));
  return out;
}
function jobCondition(job, lang) { return jobConditions(job, lang)[0]; }
// notification taps open this action (an intent filter on MainActivity), not the launcher, so the job opens even
// when the app is already running in the background
const CLICK = "in.newsviews.app.OPEN_ITEM";
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
  const today = L.todayIST();
  const open = (j) => !(j.en && j.en < today);            // never alert about a job whose last date has passed
  const istHour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }));
  const quiet = istHour >= QUIET_FROM || istHour < QUIET_TO;
  const since = dayBefore(today);
  const recent = (d) => !!d && d >= since;                  // published since yesterday (IST)
  const sentToday = (k) => pushed[k] === today;
  const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };

  let jobs = [], updates = [], follow = [];
  if (!quiet) {
    // jobs: per-audience budgets (see the header)
    const dayCount = {}, buildCount = {};
    for (const j of index.jobs) if (sentToday(`j:${j.id}`)) bump(dayCount, segOf(j));
    const cands = index.jobs.filter((j) => (jobIds.has(j.id) || recent(j.pub)) && open(j) && !pushed[`j:${j.id}`]).sort((a, b) => b.v - a.v);
    for (const j of cands) {
      const seg = segOf(j);
      if ((dayCount[seg] || 0) >= (seg === "central" ? MAX_CENTRAL_DAY : MAX_SEG_DAY) || (buildCount[seg] || 0) >= MAX_SEG_BUILD) continue;
      bump(dayCount, seg); bump(buildCount, seg); jobs.push(j);
    }
    // results / admit cards of major exams
    const updSent = Object.keys(pushed).filter((k) => k.startsWith("u:") && pushed[k] === today).length;
    updates = index.updates.filter((u) => (updIds.has(u.id) || recent(u.d)) && u.big && u.ty !== "exam-date" && !pushed[`u:${u.id}`])
      .slice(0, Math.max(0, Math.min(MAX_UPDATES, MAX_UPDATES_DAY - updSent)));
    // followers get everything new from their departments (same notification tag, so a phone that also matched the
    // state/qualification alert sees it once): results and admit cards first, then jobs, a few per department a day
    const orgCount = {};
    for (const j of index.jobs) if (j.o && sentToday(`fj:${j.id}`)) bump(orgCount, orgTopic(j.o));
    for (const u of index.updates) if (u.o && sentToday(`fu:${u.id}`)) bump(orgCount, orgTopic(u.o));
    const fc = [
      ...index.updates.filter((u) => u.o && (updIds.has(u.id) || recent(u.d)) && !pushed[`fu:${u.id}`]).map((u) => ({ kind: "update", x: u })),
      ...index.jobs.filter((j) => j.o && (jobIds.has(j.id) || recent(j.pub)) && open(j) && !pushed[`fj:${j.id}`]).map((j) => ({ kind: "job", x: j })),
    ];
    for (const f of fc) {
      const t = orgTopic(f.x.o);
      if (t === "o-" || (orgCount[t] || 0) >= MAX_ORG_DAY) continue;
      bump(orgCount, t); follow.push(f);
      if (follow.length >= MAX_FOLLOW) break;
    }
  }
  // the daily summary: once a day, from the first build after 7 pm IST (before quiet hours), when at least 3 open jobs
  // were published today — one per state (its own jobs first, then central ones) and one for "All states" phones
  const digestKey = `digest:${today}`;
  const todays = index.jobs.filter((j) => j.pub === today && open(j));
  const digest = [];
  if (istHour >= 19 && !quiet && !pushed[digestKey] && todays.length >= 3) {
    const byV = (a, b) => b.v - a.v;
    digest.push({ topic: "s-any", total: todays.length, top: [...todays].sort(byV).slice(0, 3) });
    const central = todays.filter((j) => segOf(j) === "central").sort(byV);
    for (const st of (index.states || []).map((x) => x.slug).filter((x) => x && x !== "all-india" && x !== "gulf")) {
      const mine = todays.filter((j) => (j.s || []).includes(st)).sort(byV);
      if (!mine.length && !central.length) continue;
      digest.push({ topic: `s-${st}`, total: mine.length + central.length, top: [...mine, ...central].slice(0, 3) });
    }
  }
  if (!jobs.length && !updates.length && !follow.length && !digest.length) {
    console.log(`push-notify: nothing new to send${quiet ? " (quiet hours)" : ""}.`); L.logRun("push", { ok: true, sent: 0, quiet }); return;
  }

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
      for (const condition of jobConditions(j, lang)) {
        const res = await send({
          condition,
          notification: { title, body: facts || (lang === "hi" ? "नई सरकारी नौकरी" : "New government job") },
          data: { kind: "job", id: j.id, url: `${SITE}/jobs/${j.id}/` },
          android: { priority: "HIGH", notification: { channel_id: "jobs", tag: `j-${j.id}`, click_action: CLICK } },
        });
        log.push(`job ${j.id} ${lang} [${condition}]: ${res}`); if (res === "ok") sent++;
      }
    }
    pushed[`j:${j.id}`] = today;
  }
  const typeName = { result: ["Result", "परिणाम"], "admit-card": ["Admit card", "प्रवेश पत्र"], "answer-key": ["Answer key", "उत्तर कुंजी"] };
  for (const u of updates) {
    for (const lang of ["en", "hi"]) {
      const res = await send({
        condition: `'results' in topics && 'l-${lang}' in topics`,
        notification: { title: cut(lang === "hi" && u.th ? u.th : u.t, 90), body: (typeName[u.ty] || ["Update", "अपडेट"])[lang === "hi" ? 1 : 0] + (u.o ? ` · ${u.o}` : "") },
        data: { kind: "update", id: u.id, url: `${SITE}/updates/${u.id}/` },
        android: { priority: "HIGH", notification: { channel_id: "results", tag: `u-${u.id}`, click_action: CLICK } },
      });
      log.push(`update ${u.id} ${lang}: ${res}`); if (res === "ok") sent++;
    }
    pushed[`u:${u.id}`] = today;
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
        android: { priority: "HIGH", notification: { channel_id: kind === "job" ? "jobs" : "results", tag: `${kind === "job" ? "j" : "u"}-${x.id}`, click_action: CLICK } },
      });
      log.push(`follow ${topic} ${x.id} ${lang}: ${res}`); if (res === "ok") sent++;
    }
    pushed[`${kind === "job" ? "fj" : "fu"}:${x.id}`] = today;
  }
  if (digest.length) {
    for (const d of digest) {
      for (const lang of ["en", "hi"]) {
        const hi = lang === "hi";
        const title = hi ? `आज ${d.total} नई सरकारी नौकरियाँ` : `${d.total} new govt job${d.total === 1 ? "" : "s"} today`;
        const lines = d.top.map((j) => {
          const name = cut((hi && (j.thc || j.th)) || j.tc || j.t, 60);
          return j.v ? `${name}: ${j.v.toLocaleString("en-IN")} ${hi ? "पद" : j.v === 1 ? "post" : "posts"}` : name;
        });
        const body = cut(`${lines.join(" · ")} — ${hi ? "सभी देखने के लिए टैप करें" : "tap to see them all"}`, 230);
        const res = await send({
          condition: `'digest' in topics && '${d.topic}' in topics && 'l-${lang}' in topics`,
          notification: { title, body },
          data: { kind: "tab", id: "jobs", url: `${SITE}/latest/` },
          android: { priority: "NORMAL", notification: { channel_id: "jobs", tag: "digest", click_action: CLICK } },
        });
        if (res !== "ok" || d.topic === "s-any") log.push(`digest ${d.topic} ${lang} (${d.total}): ${res}`);
        if (res === "ok") sent++;
      }
    }
    log.push(`digest: ${digest.length} audiences`);
    pushed[digestKey] = today;
  }
  // keep 60 days of history
  const keep = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(pushed)) if (pushed[k] < keep) delete pushed[k];
  fs.writeFileSync(PUSHED, JSON.stringify(pushed, null, 2) + "\n");
  console.log(`push-notify: ${sent} sent\n  ` + log.join("\n  "));
  L.logRun("push", { ok: log.every((x) => x.endsWith(": ok")), sent, log: log.slice(0, 30) });
}
if (require.main === module) main().catch((e) => console.log("push-notify error (non-fatal): " + e.message));
module.exports = { jobCondition, jobConditions, jobTopic, jobTopics, orgTopic };
