#!/usr/bin/env node
/* wayback.js — what the domain had before the jobs site, so old addresses that still have links or
   searches can be redirected or rebuilt. Two read-only sources:
     1. Search Console: every page with impressions in the last 16 months up to the jobs site's launch,
        with its top queries (the pages that still have search demand);
     2. Internet Archive CDX index: every archived address (the pages that may still have links).
   Then checks what each old address returns today. Writes data/old-urls.json. */
const fs = require("fs"), path = require("path");
const G = require("../google.js");

const SITE = "https://news-views.in";
const LAUNCH = "2026-10-13";   // the day before the jobs site went live
const UA = "news-views.in old-page audit (site owner; contact via https://news-views.in/contact/)";

async function fromSearchConsole(out) {
  if (!G.loadKey()) { out.gscError = "GOOGLE_SERVICE_ACCOUNT_JSON not set"; return new Map(); }
  const token = await G.getToken("https://www.googleapis.com/auth/webmasters");
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
    return { ok: r.ok, status: r.status, j };
  };
  const sites = await api("GET", "https://www.googleapis.com/webmasters/v3/sites");
  out.gscProperties = (sites.j.siteEntry || []).map((s) => `${s.siteUrl} (${s.permissionLevel})`);
  const pages = new Map();
  for (const s of sites.j.siteEntry || []) {
    if (!/news-views\.in/.test(s.siteUrl)) continue;
    const P = encodeURIComponent(s.siteUrl);
    const q = (dimensions, rowLimit) => api("POST", `https://www.googleapis.com/webmasters/v3/sites/${P}/searchAnalytics/query`,
      { startDate: "2025-01-01", endDate: LAUNCH, dimensions, rowLimit, dataState: "all" });
    const [byPage, byPQ, byMonth] = await Promise.all([q(["page"], 1000), q(["page", "query"], 5000), q(["date"], 600)]);
    if (!byPage.ok) { out.gscError = `${s.siteUrl}: HTTP ${byPage.status} ${JSON.stringify(byPage.j).slice(0, 200)}`; continue; }
    // monthly totals: when did the old site have traffic?
    const months = {};
    for (const r of byMonth.j.rows || []) { const m = r.keys[0].slice(0, 7); months[m] = months[m] || { clicks: 0, impressions: 0 }; months[m].clicks += r.clicks; months[m].impressions += r.impressions; }
    out.gscMonths = { ...(out.gscMonths || {}), [s.siteUrl]: months };
    for (const r of byPage.j.rows || []) {
      let u; try { u = new URL(r.keys[0]); } catch { continue; }
      const key = (u.pathname.replace(/\/+$/, "") || "/") + (u.search || "");
      const v = pages.get(key) || { path: key, clicks: 0, impressions: 0, queries: [] };
      v.clicks += r.clicks; v.impressions += r.impressions; v.position = +r.position.toFixed(1);
      pages.set(key, v);
    }
    for (const r of byPQ.j.rows || []) {
      let u; try { u = new URL(r.keys[0]); } catch { continue; }
      const v = pages.get((u.pathname.replace(/\/+$/, "") || "/") + (u.search || ""));
      if (v && v.queries.length < 8) v.queries.push(`${r.keys[1]} (${r.impressions} impr, pos ${r.position.toFixed(0)})`);
    }
  }
  return pages;
}

async function fromArchive(out) {
  const m = new Map();
  const cdx = "https://web.archive.org/cdx/search/cdx?url=news-views.in&matchType=domain&output=json&fl=original,timestamp,statuscode,mimetype&filter=statuscode:200&to=20261013&limit=20000";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(cdx, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(120000) });
      const text = await r.text();
      if (!r.ok || !/^\s*\[/.test(text)) { out.archiveError = `HTTP ${r.status}: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200)}`; await new Promise((s) => setTimeout(s, attempt * 20000)); continue; }
      delete out.archiveError;
      for (const [orig, ts, , mime] of JSON.parse(text).slice(1)) {
        let u; try { u = new URL(orig.replace(/^http:/, "https:")); } catch { continue; }
        if (!/html/i.test(mime)) continue;
        const key = (u.pathname.replace(/\/+$/, "") || "/") + (u.search || "");
        const v = m.get(key) || { path: key, captures: 0, first: ts, last: ts };
        v.captures++; if (ts < v.first) v.first = ts; if (ts > v.last) v.last = ts;
        m.set(key, v);
      }
      break;
    } catch (e) { out.archiveError = e.message; await new Promise((s) => setTimeout(s, attempt * 20000)); }
  }
  return m;
}

(async () => {
  const out = { at: new Date().toISOString(), urls: [] };
  let gsc = new Map(), arc = new Map();
  try { gsc = await fromSearchConsole(out); } catch (e) { out.gscError = e.message; }
  try { arc = await fromArchive(out); } catch (e) { out.archiveError = e.message; }
  const all = new Map();
  for (const [k, v] of gsc) all.set(k, { ...v });
  for (const [k, v] of arc) all.set(k, { ...(all.get(k) || { path: k }), captures: v.captures, first: v.first, last: v.last });
  out.urls = [...all.values()].sort((a, b) => (b.clicks || 0) - (a.clicks || 0) || (b.impressions || 0) - (a.impressions || 0) || (b.captures || 0) - (a.captures || 0)).slice(0, 500);
  out.counts = { searchConsole: gsc.size, archive: arc.size, merged: all.size };
  for (const u of out.urls.slice(0, 200)) {
    try {
      const res = await fetch(SITE + u.path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
      u.now = res.status; if (res.status >= 300 && res.status < 400) u.to = res.headers.get("location");
    } catch (e) { u.now = "error"; }
  }
  fs.writeFileSync(path.join(__dirname, "..", "data", "old-urls.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`old urls: search console ${gsc.size}, archive ${arc.size}${out.gscError ? " | gsc error " + out.gscError : ""}${out.archiveError ? " | archive error " + out.archiveError : ""}`);
})();
