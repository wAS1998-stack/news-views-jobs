#!/usr/bin/env node
/**
 * inspect-urls.js — asks Google (Search Console URL Inspection API) what it knows about a sample of
 * our pages: indexed or not, last crawl, canonical, JobPosting detected — and (Indexing API metadata)
 * whether our "new job" notifications reached Google. Writes data/url-inspection.json.
 * Needs GOOGLE_SERVICE_ACCOUNT_JSON (service account is Owner on https://news-views.in/).
 */
const fs = require("fs");
const path = require("path");
const G = require("../google.js");
const ROOT = path.join(__dirname, "..");
const SITE = "https://news-views.in";
const PROP = SITE + "/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const istDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

(async () => {
  if (!G.loadKey()) { console.log("no key"); return; }
  const token = await G.getToken("https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/indexing");
  const jobsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "jobs.json"), "utf8"));
  const jobs = (Array.isArray(jobsRaw) ? jobsRaw : jobsRaw.jobs).filter((j) => j && j.id && j.published);
  const updRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "updates.json"), "utf8"));
  const updates = (Array.isArray(updRaw) ? updRaw : updRaw.updates).filter((u) => u && u.id);
  const today = istDate(new Date());
  const ageOf = (iso) => Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(String(iso).slice(0, 10) + "T00:00:00Z")) / 86400000);

  // sample: up to 6 jobs per publish day for the last 14 days, plus hubs and recent updates
  const byDay = new Map();
  for (const j of [...jobs].sort((a, b) => String(b.published).localeCompare(String(a.published)))) {
    const a = ageOf(j.published); if (a < 0 || a > 14) continue;
    const arr = byDay.get(a) || []; if (arr.length < 6) { arr.push(j); byDay.set(a, arr); }
  }
  const targets = [];
  for (const [a, arr] of [...byDay.entries()].sort((x, y) => x[0] - y[0])) for (const j of arr) targets.push({ kind: "job", age: a, url: `${SITE}/jobs/${j.id}/` });
  for (const p of ["/", "/latest/", "/jobs/", "/updates/", "/closing-soon/", "/hi/"]) targets.push({ kind: "hub", age: null, url: SITE + p });
  for (const u of updates.slice(0, 8)) targets.push({ kind: "update", age: u.date ? ageOf(u.date) : null, url: `${SITE}/updates/${u.id}/` });

  const rows = [];
  for (const t of targets) {
    const row = { ...t };
    try {
      const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ inspectionUrl: t.url, siteUrl: PROP, languageCode: "en-IN" }) });
      const j = await r.json();
      if (!r.ok) row.error = `HTTP ${r.status} ${(j.error && j.error.message || "").slice(0, 160)}`;
      else {
        const s = j.inspectionResult && j.inspectionResult.indexStatusResult || {};
        const rr = j.inspectionResult && j.inspectionResult.richResultsResult;
        Object.assign(row, { verdict: s.verdict, coverage: s.coverageState, indexing: s.indexingState, fetch: s.pageFetchState,
          lastCrawl: s.lastCrawlTime, robots: s.robotsTxtState, googleCanonical: s.googleCanonical, userCanonical: s.userCanonical,
          sitemaps: (s.sitemap || []).length, referring: (s.referringUrls || []).length,
          rich: rr ? { verdict: rr.verdict, types: (rr.detectedItems || []).map((d) => d.richResultType) } : null });
      }
    } catch (e) { row.error = e.message; }
    if (t.kind === "job") {
      try {
        const m = await fetch(`https://indexing.googleapis.com/v3/urlNotifications/metadata?url=${encodeURIComponent(t.url)}`, { headers: { Authorization: `Bearer ${token}` } });
        const mj = await m.json();
        row.indexingApi = m.ok ? (mj.latestUpdate ? mj.latestUpdate.notifyTime : "no-update") : `HTTP ${m.status}`;
      } catch (e) { row.indexingApi = "err " + e.message; }
    }
    rows.push(row); await sleep(250);
  }
  const bucket = (a) => a === null ? "n/a" : a <= 1 ? "0-1 days" : a <= 3 ? "2-3 days" : a <= 7 ? "4-7 days" : "8-14 days";
  const summary = {};
  for (const r of rows) {
    const k = r.kind === "job" ? `job ${bucket(r.age)}` : r.kind;
    summary[k] = summary[k] || {};
    const c = r.error ? "ERROR" : (r.coverage || "?");
    summary[k][c] = (summary[k][c] || 0) + 1;
  }
  const notified = rows.filter((r) => r.kind === "job" && r.indexingApi && /^\d{4}-/.test(r.indexingApi)).length;
  const out = { at: new Date().toISOString(), property: PROP, inspected: rows.length, jobsNotifiedViaIndexingApi: notified, summary, rows };
  fs.writeFileSync(path.join(ROOT, "data", "url-inspection.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ inspected: rows.length, notified, summary }, null, 1));
})().catch((e) => { console.log("inspect error: " + e.message); process.exit(0); });
