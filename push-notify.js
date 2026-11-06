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
 *   quiz                        "today's quiz is out", once a morning (first build after 8 am IST with today's quiz)
 *   sv-<jobId>                  a job the person saved (while it is open): "new last date" when the feed's date moves later
 * A job is sent once per language to: (its state or s-any) AND (its lowest qualification level) AND language.
 * Budgets are per audience, not national: per build at most 2 jobs per state (and 2 central ones), per Indian day at
 * most 4 per state and 5 central, largest first — so a Bihar phone gets Bihar's jobs instead of whatever was biggest in
 * India. Results: 3 per build, 6 a day. Followers: results and admit cards before jobs, at most 5 a day per department.
 * Quiet hours 10 pm – 7 am IST: nothing is sent; anything not sent yet (caps, quiet hours) stays eligible for a day
 * (published since yesterday), so the morning builds catch up. data/pushed.json remembers what was sent (IST dates) —
 * an item counts as sent only when at least one of its messages was accepted — and each job's last date ("en:<id>").
 * Every message carries a time-to-live (a job alert is useless after its last date) and a collapse key.
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
const MAX_SEG_BUILD = 2, MAX_SEG_DAY = 4, MAX_CENTRAL_DAY = 5, MAX_UPDATES = 3, MAX_UPDATES_DAY = 6, MAX_FOLLOW = 30, MAX_ORG_DAY = 5, MAX_EXT = 10;
const QUIET_FROM = 22, QUIET_TO = 7;   // IST hours
const QUIZ_FROM = 8;                  // the quiz notification: not before 8 am IST
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
const fmtDate = (iso, hi) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00Z"); return isNaN(d) ? "" : d.toLocaleDateString(hi ? "hi-IN" : "en-IN", { day: "numeric", month: "short", timeZone: "UTC" }); };
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/* ---- notification copy (English / Hindi): what a candidate needs to decide whether to open it ---- */
const STATE_HI = {
  "andhra-pradesh": "आंध्र प्रदेश", "arunachal-pradesh": "अरुणाचल प्रदेश", assam: "असम", bihar: "बिहार", chhattisgarh: "छत्तीसगढ़", delhi: "दिल्ली",
  goa: "गोवा", gujarat: "गुजरात", haryana: "हरियाणा", "himachal-pradesh": "हिमाचल प्रदेश", jharkhand: "झारखंड", karnataka: "कर्नाटक", kerala: "केरल",
  "madhya-pradesh": "मध्य प्रदेश", maharashtra: "महाराष्ट्र", manipur: "मणिपुर", meghalaya: "मेघालय", mizoram: "मिज़ोरम", nagaland: "नागालैंड",
  odisha: "ओडिशा", punjab: "पंजाब", rajasthan: "राजस्थान", sikkim: "सिक्किम", "tamil-nadu": "तमिलनाडु", telangana: "तेलंगाना", tripura: "त्रिपुरा",
  "uttar-pradesh": "उत्तर प्रदेश", uttarakhand: "उत्तराखंड", "west-bengal": "पश्चिम बंगाल", "jammu-kashmir": "जम्मू और कश्मीर",
};
const QUAL_LABEL = { "10th-pass": ["10th pass", "10वीं पास"], "12th-pass": ["12th pass", "12वीं पास"], graduate: ["Graduate", "स्नातक"],
  "post-graduate": ["Post graduate", "स्नातकोत्तर"], "engineering-diploma": ["Engineering / Diploma", "इंजीनियरिंग / डिप्लोमा"] };
// only modes that say how to apply; "website" / "notice" / "page" are left out of the line (the app's button says it)
const MODE_LABEL = { apply: ["Apply online", "ऑनलाइन आवेदन"], form: ["Offline form", "ऑफलाइन फ़ॉर्म"], walkin: ["Walk-in", "वॉक-इन"], email: ["Apply by email", "ईमेल से आवेदन"] };
// "declared" only when the headline itself says a result is out (resultVerb); otherwise a neutral "update"
const RESULT_VERB = { result: ["Result update — check now", "रिजल्ट अपडेट — अभी देखें"], "admit-card": ["Admit card out — download now", "प्रवेश पत्र जारी — अभी डाउनलोड करें"],
  "answer-key": ["Answer key out", "उत्तर कुंजी जारी"], "exam-date": ["Exam date out", "परीक्षा तिथि जारी"] };
const TITLE_MAX = 65;

function lowestQual(q) {
  const levels = (q || []).filter((x) => RANK[x]).sort((a, b) => RANK[a] - RANK[b]);
  return levels[0] || ((q || []).includes("engineering-diploma") ? "engineering-diploma" : "");
}
/** "SSC CGL Recruitment 2026: 14,582 Assistant posts" — short title, then the number of posts (and the post when short).
    The title is kept whole where possible: the post name goes first, then an SEO tail after " – " is dropped. */
function jobTitle(j, lang) {
  const hi = lang === "hi";
  const name = String((hi && (j.thc || j.th)) || j.tc || j.t || "").trim();
  if (!(j.v > 0)) return cut(name, TITLE_MAX);
  const n = j.v.toLocaleString("en-IN");
  // the title already gives the number ("… for 2,861 Posts"): nothing to add
  // (as a whole number: the "2026" in a title must not hide a count of 2, 6, 20 or 26)
  const whole = new RegExp("(^|[^\\d,])(" + n.replace(/,/g, "\\,") + "|" + j.v + ")(?![\\d,])");
  if (whole.test(name)) return cut(name, TITLE_MAX);
  let post = String((hi ? j.ph : j.p) || "").replace(/\s*\b(posts?|vacanc(y|ies))\s*$/i, "").replace(/\s*(पद|पदों)\s*$/, "").trim();
  if (post.length > 28 || /,|\b(various|multiple|other|more)\b|अन्य|विभिन्न/i.test(post) || (post && name.toLowerCase().includes(post.toLowerCase()))) post = "";
  const posts = (p) => hi ? `${n}${p ? " " + p : ""} पद` : `${n}${p ? " " + p : ""} ${j.v === 1 ? "post" : "posts"}`;
  const sep = name.search(/\s[–—|-]\s|:\s/);
  const heads = [name, ...(sep >= 12 ? [name.slice(0, sep).trim()] : [])];
  for (const h of heads) for (const p of post ? [post, ""] : [""]) {
    const t = `${h}: ${posts(p)}`;
    if (t.length <= TITLE_MAX) return t;
  }
  const tail = posts("");
  return `${cut(heads[heads.length - 1], Math.max(20, TITLE_MAX - tail.length - 2))}: ${tail}`;
}
/** "Graduate · Bihar · Last date 20 Nov · Apply online". */
function jobBody(j, lang, stateNames) {
  const hi = lang === "hi", i = hi ? 1 : 0;
  const parts = [];
  const q = lowestQual(j.q);
  if (QUAL_LABEL[q]) parts.push(QUAL_LABEL[q][i]);
  const seg = segOf(j);
  const states = (j.s || []).filter((x) => x && x !== "all-india" && x !== "gulf");
  if (seg === "central") parts.push(hi ? "अखिल भारत" : "All India");
  else parts.push(((hi && STATE_HI[seg]) || stateNames[seg] || seg) + (states.length > 1 ? ` +${states.length - 1}` : ""));
  if (j.en) parts.push(`${hi ? "अंतिम तिथि" : "Last date"} ${fmtDate(j.en, hi)}`);
  const mode = j.m || (j.w ? "walkin" : "");
  if (MODE_LABEL[mode]) parts.push(MODE_LABEL[mode][i]);
  return parts.filter(Boolean).join(" · ") || (hi ? "नई सरकारी नौकरी" : "New government job");
}
function updateTitle(u, lang) { return cut(String((lang === "hi" && (u.thc || u.th)) || u.tc || u.t || ""), TITLE_MAX); }
function updateBody(u, lang) {
  const i = lang === "hi" ? 1 : 0;
  const declared = u.ty === "result" && /\bresults?\b/i.test(u.t || "") && /\b(out|declared|released|announced)\b|जारी|घोषित/i.test(`${u.t} ${u.th || ""}`);
  const verb = declared ? ["Result declared — check now", "रिजल्ट जारी — अभी देखें"][i] : (RESULT_VERB[u.ty] || ["New update", "नया अपडेट"])[i];
  const title = updateTitle(u, lang).toLowerCase();
  return u.o && !title.includes(String(u.o).toLowerCase()) ? `${verb} · ${u.o}` : verb;
}
/* Time to live: a job alert is pointless after the job's last date (IST, end of day); at most a day. */
const istEnd = (iso) => new Date(`${iso}T23:59:59+05:30`).getTime();
function jobTtl(j, now = Date.now()) { return j.en ? Math.min(86400, Math.floor((istEnd(j.en) - now) / 1000)) : 86400; }
const TTL_MIN = 3600;                  // a job closing within the hour is not announced any more
const TTL = { result: 86400, digest: 10800, quiz: 43200 };

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
  const open = (j) => !(j.en && j.en < today) && j.ns !== "cancelled";   // never alert about a closed or cancelled job
  const ttlOk = (j) => jobTtl(j) >= TTL_MIN;
  const istHour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }));
  const quiet = istHour >= QUIET_FROM || istHour < QUIET_TO;
  const since = dayBefore(today);
  const recent = (d) => !!d && d >= since;                  // published since yesterday (IST)
  const sentToday = (k) => pushed[k] === today;
  const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
  const stateNames = Object.fromEntries((index.states || []).map((x) => [x.slug, x.name]));
  const jobs0 = index.jobs || [], updates0 = index.updates || [];

  // every job's last date is remembered; a date that moved later is announced to the people who saved the job
  let enChanged = false;
  const ext = [];
  for (const j of jobs0) {
    if (!j.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(j.en || ""))) continue;
    const k = `en:${j.id}`, prev = pushed[k];
    if (!prev || j.en < prev || !open(j)) { if (prev !== j.en) { pushed[k] = j.en; enChanged = true; } continue; }
    if (j.en > prev) { if (!quiet && ttlOk(j) && ext.length < MAX_EXT) ext.push({ j, prev }); }   // quiet hours: the next morning
  }

  let jobs = [], updates = [], follow = [];
  if (!quiet) {
    // jobs: per-audience budgets (see the header)
    const dayCount = {}, buildCount = {};
    for (const j of jobs0) if (sentToday(`j:${j.id}`)) bump(dayCount, segOf(j));
    const cands = jobs0.filter((j) => (jobIds.has(j.id) || recent(j.pub)) && open(j) && ttlOk(j) && !pushed[`j:${j.id}`]).sort((a, b) => b.v - a.v);
    for (const j of cands) {
      const seg = segOf(j);
      if ((dayCount[seg] || 0) >= (seg === "central" ? MAX_CENTRAL_DAY : MAX_SEG_DAY) || (buildCount[seg] || 0) >= MAX_SEG_BUILD) continue;
      bump(dayCount, seg); bump(buildCount, seg); jobs.push(j);
    }
    // results / admit cards of major exams
    const updSent = Object.keys(pushed).filter((k) => k.startsWith("u:") && pushed[k] === today).length;
    updates = updates0.filter((u) => (updIds.has(u.id) || recent(u.d)) && u.big && u.ty !== "exam-date" && !pushed[`u:${u.id}`])
      .slice(0, Math.max(0, Math.min(MAX_UPDATES, MAX_UPDATES_DAY - updSent)));
    // followers get everything new from their departments (same notification tag, so a phone that also matched the
    // state/qualification alert sees it once): results and admit cards first, then jobs, a few per department a day
    const orgCount = {};
    for (const j of jobs0) if (j.o && sentToday(`fj:${j.id}`)) bump(orgCount, orgTopic(j.o));
    for (const u of updates0) if (u.o && sentToday(`fu:${u.id}`)) bump(orgCount, orgTopic(u.o));
    const fc = [
      ...updates0.filter((u) => u.o && (updIds.has(u.id) || recent(u.d)) && !pushed[`fu:${u.id}`]).map((u) => ({ kind: "update", x: u })),
      ...jobs0.filter((j) => j.o && (jobIds.has(j.id) || recent(j.pub)) && open(j) && ttlOk(j) && !pushed[`fj:${j.id}`]).map((j) => ({ kind: "job", x: j })),
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
  const todays = jobs0.filter((j) => j.pub === today && open(j));
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
  // the daily quiz: once a day, from the first build after 8 am IST, when today's quiz is in the feed
  const quizKey = `quiz:${today}`;
  const todaysQuiz = !quiet && istHour >= QUIZ_FROM && !pushed[quizKey] ? (index.quizzes || []).find((z) => z && z.id && z.date === today && z.n > 0) : null;

  const save = () => {
    // keep 60 days of history (dates as values: sent-on days, and the last dates of jobs)
    const keep = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    for (const k of Object.keys(pushed)) if (pushed[k] < keep) delete pushed[k];
    fs.writeFileSync(PUSHED, JSON.stringify(pushed, null, 2) + "\n");
  };
  if (!jobs.length && !updates.length && !follow.length && !digest.length && !ext.length && !todaysQuiz) {
    if (enChanged) save();
    console.log(`push-notify: nothing new to send${quiet ? " (quiet hours)" : ""}.`); L.logRun("push", { ok: true, sent: 0, quiet }); return;
  }

  const token = await G.getToken("https://www.googleapis.com/auth/firebase.messaging", key);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** One message; a rate limit (429) or server error (5xx) — or a dropped connection — is retried once. After 6 failures
      in a row FCM is taken to be down: the rest is skipped (and stays unsent, for the next build) instead of waiting on
      every message. */
  let failStreak = 0;
  const send = async (message) => {
    if (failStreak >= 6) return "skipped (FCM failing)";
    const res = await sendOnce(message);
    failStreak = res === "ok" ? 0 : failStreak + 1;
    return res;
  };
  const sendOnce = async (message) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ message }), signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        if (attempt === 0) { await sleep(1500); continue; }
        return `error ${String(e.message || e).slice(0, 120)}`;
      }
      if (r.ok) return "ok";
      const text = (await r.text().catch(() => "")).slice(0, 160);
      if ((r.status === 429 || r.status >= 500) && attempt === 0) {
        const ra = Number(r.headers.get("retry-after"));
        await sleep(Math.min(10, ra > 0 ? ra : 2) * 1000);
        continue;
      }
      return `HTTP ${r.status} ${text}`;
    }
    return "error retry";
  };
  /** The Android part of a message: channel, tag (one notification per item), time to live and collapse key. */
  const android = (priority, ttl, collapse, channel, tag) => ({ priority, ttl: `${Math.max(0, Math.floor(ttl))}s`, collapse_key: collapse.slice(0, 64),
    notification: { channel_id: channel, tag, click_action: CLICK } });
  const log = [];
  let sent = 0;
  for (const j of jobs) {
    let okAny = false;
    const ttl = jobTtl(j);
    for (const lang of ["en", "hi"]) {
      for (const condition of jobConditions(j, lang)) {
        const res = await send({
          condition,
          notification: { title: jobTitle(j, lang), body: jobBody(j, lang, stateNames) },
          data: { kind: "job", id: j.id, url: `${SITE}/jobs/${j.id}/` },
          android: android("HIGH", ttl, `j-${j.id}`, "jobs", `j-${j.id}`),
        });
        log.push(`job ${j.id} ${lang} [${condition}]: ${res}`); if (res === "ok") { sent++; okAny = true; }
      }
    }
    if (okAny) pushed[`j:${j.id}`] = today;               // not accepted at all: tried again on the next build
  }
  for (const u of updates) {
    let okAny = false;
    for (const lang of ["en", "hi"]) {
      const res = await send({
        condition: `'results' in topics && 'l-${lang}' in topics`,
        notification: { title: updateTitle(u, lang), body: updateBody(u, lang) },
        data: { kind: "update", id: u.id, url: `${SITE}/updates/${u.id}/` },
        android: android("HIGH", TTL.result, `u-${u.id}`, "results", `u-${u.id}`),
      });
      log.push(`update ${u.id} ${lang}: ${res}`); if (res === "ok") { sent++; okAny = true; }
    }
    if (okAny) pushed[`u:${u.id}`] = today;
  }
  for (const { kind, x } of follow) {
    const topic = orgTopic(x.o);
    if (topic === "o-") continue;
    let okAny = false;
    for (const lang of ["en", "hi"]) {
      const res = await send({
        condition: `'${topic}' in topics && 'l-${lang}' in topics`,
        notification: kind === "job" ? { title: jobTitle(x, lang), body: jobBody(x, lang, stateNames) } : { title: updateTitle(x, lang), body: updateBody(x, lang) },
        data: { kind, id: x.id, url: `${SITE}/${kind === "job" ? "jobs" : "updates"}/${x.id}/` },
        android: kind === "job" ? android("HIGH", jobTtl(x), `j-${x.id}`, "jobs", `j-${x.id}`) : android("HIGH", TTL.result, `u-${x.id}`, "results", `u-${x.id}`),
      });
      log.push(`follow ${topic} ${x.id} ${lang}: ${res}`); if (res === "ok") { sent++; okAny = true; }
    }
    if (okAny) pushed[`${kind === "job" ? "fj" : "fu"}:${x.id}`] = today;
  }
  // saved jobs whose last date moved later: once per new date, to the phones that saved them (app topic sv-<id>)
  for (const { j, prev } of ext) {
    let okAny = false;
    for (const lang of ["en", "hi"]) {
      const hi = lang === "hi";
      const name = String((hi && (j.thc || j.th)) || j.tc || j.t || "");
      // "new last date" (not "extended"): the feed's date moved later, which is almost always an official extension,
      // but a corrected reading of the notice looks the same
      const title = hi ? `नई अंतिम तिथि: ${fmtDate(j.en, true)}` : `New last date: ${fmtDate(j.en)}`;
      const body = cut(`${name} — ${hi ? "पहले" : "was"} ${fmtDate(prev, hi)}`, 160);
      const res = await send({
        condition: `'sv-${j.id}' in topics && 'l-${lang}' in topics`,
        notification: { title, body },
        data: { kind: "job", id: j.id, url: `${SITE}/jobs/${j.id}/` },
        android: android("HIGH", jobTtl(j), `ext-${j.id}`, "reminders", `x-${j.id}`),
      });
      log.push(`extended ${j.id} ${prev}->${j.en} ${lang}: ${res}`); if (res === "ok") { sent++; okAny = true; }
    }
    if (okAny) { pushed[`en:${j.id}`] = j.en; enChanged = true; }
  }
  if (digest.length) {
    let okAny = false;
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
          android: android("NORMAL", TTL.digest, "digest", "jobs", "digest"),
        });
        if (res !== "ok" || d.topic === "s-any") log.push(`digest ${d.topic} ${lang} (${d.total}): ${res}`);
        if (res === "ok") { sent++; okAny = true; }
      }
    }
    log.push(`digest: ${digest.length} audiences`);
    if (okAny) pushed[digestKey] = today;
  }
  if (todaysQuiz) {
    let okAny = false;
    for (const lang of ["en", "hi"]) {
      const hi = lang === "hi";
      const res = await send({
        condition: `'quiz' in topics && 'l-${lang}' in topics`,
        notification: hi
          ? { title: "आज का करंट अफेयर्स क्विज़ आ गया", body: `${todaysQuiz.n} प्रश्न — खेलें और अपनी लगातार दिनों की गिनती जारी रखें` }
          : { title: "Today's current affairs quiz is out", body: `${todaysQuiz.n} questions — play and keep your streak going` },
        data: { kind: "quiz", id: todaysQuiz.id, url: `${SITE}/quiz/${todaysQuiz.id}/` },
        android: android("NORMAL", TTL.quiz, "quiz", "quiz", "quiz"),
      });
      log.push(`quiz ${todaysQuiz.id} ${lang}: ${res}`); if (res === "ok") { sent++; okAny = true; }
    }
    if (okAny) pushed[quizKey] = today;
  }
  save();
  console.log(`push-notify: ${sent} sent\n  ` + log.join("\n  "));
  L.logRun("push", { ok: log.every((x) => x.endsWith(": ok") || x.startsWith("digest:")), sent, log: log.slice(0, 30) });
}
if (require.main === module) main().catch((e) => console.log("push-notify error (non-fatal): " + e.message));
module.exports = { jobCondition, jobConditions, jobTopic, jobTopics, orgTopic, jobTitle, jobBody, updateTitle, updateBody, jobTtl };
