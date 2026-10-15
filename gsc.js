#!/usr/bin/env node
/**
 * gsc.js — Search Console on autopilot (runs once a day inside the workflow).
 *
 *  1. Submits sitemap.xml so Google always has the latest URL list.
 *  2. Pulls the last 28 days of performance by page and by page+query.
 *  3. Writes data/gsc.json: totals, top pages, top queries and "opportunities" —
 *     pages Google already shows on page 1–2 (position 4–20) with real impressions.
 *     enrich-jobs.js then strengthens exactly those pages (FAQ answers for the
 *     real queries people typed), which is the fastest legitimate way to move up.
 *
 * Auth: the GOOGLE_SERVICE_ACCOUNT_JSON secret (already used for the Indexing API).
 * The service account must be a user on the Search Console property — it already
 * is if the Indexing API works. Without the secret, this exits quietly.
 */
const fs = require("fs");
const path = require("path");
const G = require("./google.js");
const L = require("./lib.js");

const ROOT = __dirname;
const OUT = path.join(ROOT, "data", "gsc.json");
const SITE = (L.CONFIG.url || "https://news-views.in").replace(/\/$/, "");
const HOST = SITE.replace(/^https?:\/\//, "");
const day = (d) => d.toISOString().slice(0, 10);

async function api(token, method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, j };
}

async function main() {
  if (!G.loadKey()) { console.log("GSC: GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping."); return; }
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  if (prev.date === day(new Date()) && !process.env.GSC_FORCE) { console.log("GSC: already synced today."); return; }

  const token = await G.getToken("https://www.googleapis.com/auth/webmasters");
  // Which property does the service account have? Prefer the domain property.
  const sites = await api(token, "GET", "https://www.googleapis.com/webmasters/v3/sites");
  const list = (sites.j.siteEntry || []).map((s) => s.siteUrl);
  const prop = list.find((s) => s === `sc-domain:${HOST}`) || list.find((s) => s.replace(/\/$/, "") === SITE) || list.find((s) => s.includes(HOST.replace(/^www\./, "")));
  if (!prop) {
    const msg = `service account has no access to a Search Console property for ${HOST} (sees: ${list.join(", ") || "none"})`;
    console.log("GSC: " + msg); L.logRun("gsc", { ok: false, error: msg, serviceAccount: G.loadKey().client_email,
      fix: "Search Console → news-views.in → Settings → Users and permissions → Add user → this email → Owner" });
    return;
  }
  const P = encodeURIComponent(prop);

  // 1) sitemap
  const sm = await api(token, "PUT", `https://www.googleapis.com/webmasters/v3/sites/${P}/sitemaps/${encodeURIComponent(SITE + "/sitemap.xml")}`);
  console.log(`GSC: property ${prop} | sitemap submit HTTP ${sm.status}`);

  // 2) performance (GSC data lags ~2-3 days)
  const end = new Date(Date.now() - 2 * 86400000), start = new Date(end.getTime() - 27 * 86400000);
  const q = (dimensions, rowLimit) => api(token, "POST", `https://www.googleapis.com/webmasters/v3/sites/${P}/searchAnalytics/query`,
    { startDate: day(start), endDate: day(end), dimensions, rowLimit, dataState: "all" });
  const [byPage, byQuery, byPQ, byDate] = await Promise.all([q(["page"], 1000), q(["query"], 500), q(["page", "query"], 5000), q(["date"], 40)]);
  if (!byPage.ok) { console.log("GSC: query failed", byPage.status, JSON.stringify(byPage.j).slice(0, 200)); L.logRun("gsc", { ok: false, error: "HTTP " + byPage.status }); return; }

  const rows = (r) => (r.j.rows || []).map((x) => ({ keys: x.keys, clicks: x.clicks, impressions: x.impressions, ctr: +(x.ctr * 100).toFixed(2), position: +x.position.toFixed(1) }));
  const pages = rows(byPage).map((r) => ({ page: r.keys[0].replace(SITE, ""), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
  const queries = rows(byQuery).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
  const pq = rows(byPQ).map((r) => ({ page: r.keys[0].replace(SITE, ""), query: r.keys[1], impressions: r.impressions, clicks: r.clicks, position: r.position }));
  const daily = rows(byDate).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions }));
  const totals = pages.reduce((t, p) => ({ clicks: t.clicks + p.clicks, impressions: t.impressions + p.impressions }), { clicks: 0, impressions: 0 });

  // 3) opportunities: page 1-2 rankings with impressions — the cheapest positions to win
  const opp = pages.filter((p) => p.position >= 4 && p.position <= 20 && p.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 60)
    .map((p) => ({ ...p, queries: pq.filter((x) => x.page === p.page).sort((a, b) => b.impressions - a.impressions).slice(0, 8).map((x) => ({ q: x.query, impressions: x.impressions, position: x.position })) }));
  // low CTR on good positions → title/description problem
  const lowCtr = pages.filter((p) => p.position <= 6 && p.impressions >= 50 && p.ctr < 2).slice(0, 30);

  const out = { date: day(new Date()), property: prop, range: [day(start), day(end)], totals, daily,
    topPages: pages.slice(0, 50), topQueries: queries.slice(0, 100), opportunities: opp, lowCtr };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  L.logRun("gsc", { ok: true, property: prop, clicks28d: totals.clicks, impressions28d: totals.impressions, pages: pages.length, opportunities: opp.length, sitemap: sm.status });
  console.log(`GSC: 28d clicks ${totals.clicks}, impressions ${totals.impressions}, ${pages.length} pages with impressions, ${opp.length} opportunities.`);
}
main().catch((e) => { console.log("GSC error (non-fatal): " + e.message); try { L.logRun("gsc", { ok: false, error: e.message }); } catch {} });
