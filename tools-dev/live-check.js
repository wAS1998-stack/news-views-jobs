#!/usr/bin/env node
/**
 * live-check.js — end-to-end check of the DEPLOYED site (https://news-views.in), as a visitor, Google and the app see it.
 * Runs in GitHub Actions (check-live.yml, on demand): Claude's sandbox cannot reach the site. Read-only: it only fetches.
 * Writes data/live-report.json:
 *   { at, site, build, counts, summary: { ok, warn, fail }, problems: [...], checks: [{ id, level, detail }], pages: [...] }
 * level: "ok" | "warn" (worth a look) | "fail" (broken for users, Google or the app).
 *
 * What it checks: the build stamp and its age; the core files (robots, sitemaps, feed, search, assets, manifest, service
 * worker); the app feed (/app/v1/index.json and a few job / update / quiz files); the 404 page; http -> https and www ->
 * apex; a sample of retired URLs (301 to a page that exists); ~55 pages from the live sitemap (status, title,
 * description, canonical, robots meta, JSON-LD that parses, JobPosting fields, junk text); 60 more sitemap URLs for
 * their status; security and cache headers; Hindi pages; and that /api/relay refuses non-government hosts.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = (process.env.LIVE_SITE || "https://news-views.in").replace(/\/$/, "");
const PAGES_DEV = "https://news-views-jobs.pages.dev";
const MAP = process.env.LIVE_MAP || "";   // testing only: fetch the site's URLs from this origin instead (a local copy of dist/)
const UA = "news-views-live-check/1.0 (+https://news-views.in/about/)";
const checks = [], pages = [];
const add = (id, level, detail) => { checks.push({ id, level, detail: String(detail).slice(0, 400) }); };
const ok = (id, d = "") => add(id, "ok", d), warn = (id, d) => add(id, "warn", d), fail = (id, d) => add(id, "fail", d);

async function get(url, { manual = false, method = "GET", headers = {}, timeout = 25000 } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(MAP ? url.replace(SITE, MAP) : url, { method, redirect: manual ? "manual" : "follow", headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(timeout) });
    const buf = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, body: buf.toString("utf8"), bytes: buf.length, ms: Date.now() - t0, url: r.url };
  } catch (e) { return { status: 0, headers: new Headers(), body: "", bytes: 0, ms: Date.now() - t0, error: e.message, url }; }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const spread = (arr, n) => (arr.length <= n ? arr.slice() : Array.from({ length: n }, (_, k) => arr[Math.floor((k * arr.length) / n)]));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const attr = (html, re) => { const m = html.match(re); return m ? m[1].replace(/&amp;/g, "&") : ""; };
const JUNK = [/\[object Object\]/, /\bundefined\b(?! behaviour)/, /\bNaN\b/, /\[email\s*protected\]/i, /Invalid Date/, /\{\{[^}]{1,40}\}\}/, /\$\{[a-zA-Z_.]{1,40}\}/];

/** One HTML page as Google would judge it. `expectIndexable`: it came from the sitemap. */
async function checkPage(url, kind, expectIndexable = true) {
  const r = await get(url, { headers: { "accept-encoding": "gzip, br" } });
  const row = { url: url.replace(SITE, ""), kind, status: r.status, bytes: r.bytes, ms: r.ms, problems: [] };
  const bad = (p) => row.problems.push(p);
  if (r.status !== 200) { bad(`status ${r.status}${r.error ? " " + r.error : ""}`); pages.push(row); return row; }
  const h = r.body;
  if (!/text\/html/.test(r.headers.get("content-type") || "")) bad("content-type " + r.headers.get("content-type"));
  const title = attr(h, /<title>([^<]*)<\/title>/i), desc = attr(h, /<meta name="description" content="([^"]*)"/i);
  const canon = attr(h, /<link rel="canonical" href="([^"]*)"/i), robots = attr(h, /<meta name="robots" content="([^"]*)"/i);
  row.title = title.slice(0, 90);
  if (!title.trim()) bad("empty <title>");
  if (!desc.trim()) bad("no meta description");
  if (expectIndexable && canon !== url) bad(`canonical ${canon || "(none)"} != url`);
  if (expectIndexable && /noindex/i.test(robots)) bad("in the sitemap but noindex");
  const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const types = [];
  for (const raw of lds) {
    let j; try { j = JSON.parse(raw); } catch (e) { bad("JSON-LD does not parse: " + e.message.slice(0, 60)); continue; }
    for (const o of [].concat(j["@graph"] || j)) {
      types.push(o["@type"]);
      if (o["@type"] === "JobPosting") {
        for (const k of ["title", "description", "datePosted", "hiringOrganization", "jobLocation", "validThrough"]) if (!o[k]) bad("JobPosting without " + k);
        if (o.validThrough && new Date(o.validThrough).getTime() < Date.now() - 3 * 86400000) row.expired = o.validThrough;
        if (o.description && String(o.description).length < 120) bad("JobPosting description under 120 characters");
      }
    }
  }
  row.ld = [...new Set(types.flat().filter(Boolean))].join(",");
  if (kind === "job" && !/JobPosting/.test(row.ld) && !/closed-notice|has closed|cancelled|postponed/i.test(h)) bad("open job page without JobPosting");
  const t = text(h);
  row.words = t.split(" ").length;
  for (const re of JUNK) { const m = t.match(re); if (m) bad("junk text: " + t.slice(Math.max(0, m.index - 30), m.index + 40)); }
  if (!/<h1[\s>]/i.test(h)) bad("no <h1>");
  if (kind === "home" && !/not a government body|not affiliated with/i.test(t)) bad("no 'not a government body' statement");
  if (kind === "hindi" && !/सरकारी (संस्था|निकाय|वेबसाइट) नहीं|स्वतंत्र/.test(t)) bad("no Hindi 'not a government body' statement");
  pages.push(row);
  return row;
}

async function main() {
  const report = { at: new Date().toISOString(), site: SITE };

  // 1. which build is live, on the domain and on the Pages address
  const [vd, vp] = await Promise.all([get(`${SITE}/version.json?t=${Date.now()}`), get(`${PAGES_DEV}/version.json?t=${Date.now()}`)]);
  let build = {}, buildP = {};
  try { build = JSON.parse(vd.body); } catch { /* reported below */ }
  try { buildP = JSON.parse(vp.body); } catch { /* optional */ }
  report.build = { domain: build.build || `status ${vd.status}`, pagesDev: buildP.build || `status ${vp.status}`, at: build.at, files: build.files, maxFiles: build.maxFiles, archivedJobs: build.archivedJobs, archivedUpdates: build.archivedUpdates };
  if (build.files && build.maxFiles) (build.files > build.maxFiles * 0.92 ? warn : ok)("file budget", `${build.files} of ${build.maxFiles} files deployed (Cloudflare Pages limit); ${build.archivedJobs || 0} job and ${build.archivedUpdates || 0} update pages archived to fit`);
  if (!build.at) fail("version.json", `status ${vd.status} ${vd.error || ""}`);
  else {
    // For a minute or two after a deployment Cloudflare can still answer with pages of the previous one (a sweep that
    // started 13 seconds after a deploy saw 274 removed pages as 200): start four minutes after the build at the earliest.
    const settle = 4 * 60000 - (Date.now() - new Date(build.at).getTime());
    if (settle > 0 && settle <= 4 * 60000) { console.log(`Fresh deployment: waiting ${Math.round(settle / 1000)} s for it to settle.`); await new Promise((r) => setTimeout(r, settle)); }
    const ageH = (Date.now() - new Date(build.at).getTime()) / 3600000;
    report.build.ageHours = Math.round(ageH * 10) / 10;
    (ageH > 12 ? fail : ageH > 5 ? warn : ok)("build-age", `live build ${build.build}, ${report.build.ageHours} h old`);
    (build.build === buildP.build ? ok : warn)("domain-vs-pages", `domain ${build.build} / pages.dev ${buildP.build || vp.status}`);
  }

  // 2. core files
  const core = [
    ["/", /text\/html/, 5000], ["/robots.txt", /text\/plain/, 100], ["/sitemap.xml", /xml/, 5000], ["/sitemap-latest.xml", /xml/, 500],
    ["/news-sitemap.xml", /xml/, 100], ["/feed.xml", /xml/, 1000], ["/search.json", /json/, 5000], ["/styles.css", /css/, 2000],
    ["/site.js", /javascript/, 500], ["/sw.js", /javascript/, 200], ["/site.webmanifest", /json|manifest/, 100], ["/favicon.svg", /svg/, 100],
    ["/icon-192.png", /png/, 500], ["/og.png", /png/, 2000], ["/app/v1/index.json", /json/, 5000], ["/.well-known/assetlinks.json", /json/, 2],
  ];
  const coreRes = await pool(core, 6, async ([p, type, min]) => {
    const r = await get(SITE + p);
    const ct = r.headers.get("content-type") || "";
    if (r.status !== 200) fail("file " + p, `status ${r.status} ${r.error || ""}`);
    else if (!type.test(ct)) warn("file " + p, `content-type ${ct}`);
    else if (r.bytes < min) fail("file " + p, `only ${r.bytes} bytes`);
    else ok("file " + p, `${r.bytes} B, ${r.ms} ms, ${r.headers.get("cache-control") || "no cache-control"}`);
    return r;
  });
  const byPath = Object.fromEntries(core.map((c, i) => [c[0], coreRes[i]]));
  for (const p of ["/ads.txt", "/app-ads.txt"]) { const r = await get(SITE + p); add("file " + p, "ok", `status ${r.status}, ${r.bytes} B${r.status === 200 ? ": " + r.body.split("\n")[0].slice(0, 80) : " (expected until the ad IDs are set)"}`); }

  const robots = byPath["/robots.txt"].body;
  for (const need of ["Sitemap: " + SITE + "/sitemap.xml", "Disallow: /api/", "Disallow: /hi/jobs/"]) (robots.includes(need) ? ok : fail)("robots " + need, robots.includes(need) ? "" : "missing");
  // "Disallow: /" matters only in a group that applies to search engines; Cloudflare's managed robots.txt adds such
  // groups for AI crawlers (GPTBot, ClaudeBot, Google-Extended...), which do not affect Google Search.
  report.robotsTxt = robots.slice(0, 5000);
  const groups = []; let cur = null, inRules = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || inRules) { cur = { agents: [], rules: [] }; groups.push(cur); inRules = false; } cur.agents.push(v.toLowerCase()); }
    else if (cur && (k === "disallow" || k === "allow")) { inRules = true; cur.rules.push([k, v]); }
  }
  const blocksAll = (g) => g.rules.some(([k, v]) => k === "disallow" && v === "/") && !g.rules.some(([k, v]) => k === "allow" && v === "/");
  const search = /^(\*|googlebot|googlebot-news|googlebot-image|bingbot|slurp|duckduckbot|yandex|mediapartners-google|adsbot-google)$/;
  const blockedSearch = groups.filter(blocksAll).flatMap((g) => g.agents).filter((a) => search.test(a));
  const blockedOther = groups.filter(blocksAll).flatMap((g) => g.agents).filter((a) => !search.test(a));
  (blockedSearch.length ? fail : ok)("robots: search engines allowed", blockedSearch.length ? "blocked: " + blockedSearch.join(", ") : `${groups.length} groups`);
  if (blockedOther.length) add("robots: other crawlers blocked", "warn", `${blockedOther.length} (not written by build.js — Cloudflare's managed robots.txt?): ${blockedOther.join(", ")}`);
  if (robots.length > 600 && !/Cloudflare/i.test(robots)) add("robots.txt differs from the build", "warn", `${robots.length} bytes`);

  // 3. the app feed
  let index = null;
  try { index = JSON.parse(byPath["/app/v1/index.json"].body); } catch (e) { fail("app feed index.json", "does not parse: " + e.message); }
  if (index) {
    const ih = byPath["/app/v1/index.json"].headers;
    report.counts = { feedJobs: (index.jobs || []).length, feedUpdates: (index.updates || []).length, feedQuizzes: (index.quizzes || []).length, feedBytes: byPath["/app/v1/index.json"].bytes };
    for (const k of ["api", "built", "states", "quals", "cats", "jobs", "updates", "quizzes", "ads"]) if (index[k] == null) fail("app feed field " + k, "missing");
    ((index.jobs || []).length > 200 ? ok : fail)("app feed jobs", `${(index.jobs || []).length} jobs, ${(index.updates || []).length} updates, ${(index.quizzes || []).length} quizzes, minVersion ${index.minVersion}`);
    (/noindex/.test(ih.get("x-robots-tag") || "") ? ok : warn)("app feed noindex header", ih.get("x-robots-tag") || "missing");
    const builtAge = (Date.now() - new Date(index.at || index.built).getTime()) / 3600000;
    if (Number.isFinite(builtAge)) (builtAge > 12 ? fail : ok)("app feed age", `${Math.round(builtAge * 10) / 10} h`);
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const newest = (index.jobs || []).map((j) => j.pub || "").sort().pop() || "";
    const days = newest ? Math.round((new Date(today) - new Date(newest)) / 86400000) : 99;
    (days > 2 ? fail : ok)("newest job in the feed", `${newest} (${days} day(s) ago)`);
    report.counts.openJobs = (index.jobs || []).filter((j) => !j.en || j.en >= today).length;
    const one = async (dir, id, need) => {
      const r = await get(`${SITE}/app/v1/${dir}/${id}.json`);
      let j = null; try { j = JSON.parse(r.body); } catch { /* below */ }
      if (r.status !== 200 || !j) return fail(`app feed ${dir}/${id}`, `status ${r.status}, parses: ${!!j}`);
      const miss = need.filter((k) => j[k] == null || j[k] === "");
      (miss.length ? fail : ok)(`app feed ${dir}/${id}`, miss.length ? "missing " + miss.join(",") : `${r.bytes} B`);
      return j;
    };
    for (const j of spread(index.jobs || [], 5)) await one("j", j.id, ["id", "title", "url", "cta"]);
    for (const u of spread(index.updates || [], 3)) await one("u", u.id, ["id", "title"]);
    for (const q of (index.quizzes || []).slice(0, 2)) {
      const quiz = await one("q", q.id, ["id", "title", "questions"]);
      const badQ = ((quiz && quiz.questions) || []).filter((x) => !x.q || !Array.isArray(x.options) || x.options.length < 2 || !(x.answer >= 0 && x.answer < x.options.length));
      if (quiz) (badQ.length ? fail : ok)(`quiz ${q.id} questions`, badQ.length ? `${badQ.length} malformed` : `${quiz.questions.length} questions`);
    }
  }

  // 4. a page that does not exist, and the protocol / host redirects
  const nf = await get(`${SITE}/this-page-does-not-exist-${Date.now()}/`);
  (nf.status === 404 && /not found/i.test(nf.body) ? ok : fail)("404 page", `status ${nf.status}, ${nf.bytes} B`);
  const http = await get(SITE.replace("https://", "http://") + "/", { manual: true });
  ([301, 308].includes(http.status) && /^https:/.test(http.headers.get("location") || "") ? ok : warn)("http -> https", `status ${http.status} -> ${http.headers.get("location")}`);
  const www = await get(SITE.replace("https://", "https://www.") + "/", { manual: true });
  add("www host", [301, 308].includes(www.status) ? "ok" : "warn", `status ${www.status}${www.error ? " " + www.error : ""} -> ${www.headers.get("location") || "-"}`);

  // 5. retired URLs: each must answer 301/308 and end, in one hop, on a page that exists
  let reds = [];
  try { reds = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8")); } catch { warn("redirects.json", "not readable"); }
  const redSample = [...spread(reds, 25), ...reds.slice(-10)];
  let redBad = 0;
  await pool(redSample, 5, async ([from]) => {
    const r = await get(SITE + from, { manual: true });
    const loc = r.headers.get("location") || "";
    if (r.status === 200 && /^\/(hi\/)?(organization|state)\//.test(from)) return;   // the page has listings again: build.js drops its redirect
    if (![301, 308].includes(r.status) || !loc) { redBad++; return fail("redirect " + from, `status ${r.status}, location ${loc || "-"}`); }
    const t = await get(new URL(loc, SITE).toString(), { manual: true });
    if (t.status !== 200) { redBad++; fail("redirect " + from, `-> ${loc} answers ${t.status}${t.headers.get("location") ? " -> " + t.headers.get("location") : ""}`); }
  });
  if (redSample.length && !redBad) ok("retired URLs", `${redSample.length} of ${reds.length} sampled: all 301 to a live page`);

  // 6. pages from the live sitemap
  const locs = [...byPath["/sitemap.xml"].body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const lastmods = [...byPath["/sitemap.xml"].body.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)/g)].map((m) => [m[1], m[2]]);
  const of = (seg) => locs.filter((u) => u.startsWith(`${SITE}/${seg}/`) && u !== `${SITE}/${seg}/`);
  report.counts = { ...(report.counts || {}), sitemapUrls: locs.length, sitemapJobs: of("jobs").length, sitemapUpdates: of("updates").length };
  (locs.length > 500 ? ok : fail)("sitemap size", `${locs.length} URLs (${of("jobs").length} jobs, ${of("updates").length} updates)`);
  const foreign = locs.filter((u) => !u.startsWith(SITE + "/"));
  if (foreign.length) fail("sitemap hosts", `${foreign.length} URLs on another host, e.g. ${foreign[0]}`);
  const newestJobs = lastmods.filter(([u]) => u.startsWith(SITE + "/jobs/") && u !== SITE + "/jobs/").sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 10).map((x) => x[0]);
  const sample = [
    [SITE + "/", "home"], [SITE + "/latest/", "hub"], [SITE + "/jobs/", "hub"], [SITE + "/updates/", "hub"], [SITE + "/hi/", "hindi"],
    ...newestJobs.map((u) => [u, "job"]), ...spread(of("jobs"), 12).map((u) => [u, "job"]), ...spread(of("updates"), 7).map((u) => [u, "update"]),
    ...spread(of("state"), 5).map((u) => [u, "state"]), ...spread(of("organization"), 4).map((u) => [u, "org"]), ...spread(of("qualification"), 2).map((u) => [u, "qual"]),
    ...spread(of("exam"), 2).map((u) => [u, "exam"]), ...spread(of("tools"), 2).map((u) => [u, "tool"]), ...spread(of("guides"), 2).map((u) => [u, "guide"]),
    ...spread(of("quiz"), 1).map((u) => [u, "quiz"]), ...spread(of("salary"), 1).map((u) => [u, "salary"]), ...spread(of("news"), 1).map((u) => [u, "news"]),
  ].filter(([u], i, a) => locs.includes(u) || u === SITE + "/hi/" ? a.findIndex((x) => x[0] === u) === i : (warn("expected page not in the sitemap", u), false));
  await pool(sample, 5, ([u, kind]) => checkPage(u, kind, true));
  const badPages = pages.filter((p) => p.problems.length);
  (badPages.length ? fail : ok)("page sample", `${pages.length} pages checked, ${badPages.length} with problems`);
  const ms = pages.map((p) => p.ms).sort((a, b) => a - b);
  report.counts.medianPageMs = ms[Math.floor(ms.length / 2)]; report.counts.slowestPageMs = ms[ms.length - 1];
  report.counts.medianPageBytes = pages.map((p) => p.bytes).sort((a, b) => a - b)[Math.floor(pages.length / 2)];
  const expired = pages.filter((p) => p.expired);
  if (expired.length) warn("JobPosting validThrough in the past", `${expired.length} sampled pages in the sitemap, e.g. ${expired[0].url} (${expired[0].expired})`);

  // 7. 60 more sitemap URLs: only their status
  const seen = new Set(sample.map((x) => x[0]));
  const more = spread(locs.filter((u) => !seen.has(u)), 60);
  const st = await pool(more, 8, async (u) => { const r = await get(u, { manual: true }); return [u, r.status]; });
  const non200 = st.filter((x) => x[1] !== 200);
  (non200.length ? fail : ok)("sitemap URL statuses", non200.length ? `${non200.length} of ${st.length} not 200, e.g. ${non200.slice(0, 3).map((x) => x[0].replace(SITE, "") + " " + x[1]).join(", ")}` : `${st.length} more URLs: all 200`);

  // 8. Hindi detail page (served, but kept out of Google by robots.txt) and headers
  const hiJob = index && (index.jobs || []).find((j) => j.th);
  if (hiJob) {
    const r = await get(`${SITE}/hi/jobs/${hiJob.id}/`);
    (r.status === 200 && /lang="hi"/.test(r.body) ? ok : warn)("hindi job page", `status ${r.status}`);
  }
  const hh = byPath["/"].headers;
  (/(nosniff)/i.test(hh.get("x-content-type-options") || "") ? ok : warn)("header x-content-type-options", hh.get("x-content-type-options") || "missing");
  (hh.get("referrer-policy") ? ok : warn)("header referrer-policy", hh.get("referrer-policy") || "missing");
  (hh.get("strict-transport-security") ? ok : warn)("header strict-transport-security", hh.get("strict-transport-security") || "missing (Cloudflare > SSL/TLS > Edge Certificates > HSTS)");
  add("header cache-control (home)", "ok", hh.get("cache-control") || "missing");
  const enc = await get(SITE + "/", { headers: { "accept-encoding": "br, gzip" } });
  add("compression", "ok", `content-encoding as seen by fetch: ${enc.headers.get("content-encoding") || "(decoded or none)"}`);

  // 9. the relay must refuse anything that is not a government host
  const relay = async (q, want, id) => {
    const r = await get(`${SITE}/api/relay${q}`, { timeout: 35000 });
    (want.includes(r.status) ? ok : fail)("relay " + id, `status ${r.status} ${r.body.slice(0, 60).replace(/\s+/g, " ")}`);
    return r;
  };
  await relay("", [400], "no url");
  await relay("?url=" + encodeURIComponent("https://example.com/"), [403], "example.com");
  await relay("?url=" + encodeURIComponent("https://ssc.gov.in.example.com/"), [403], "look-alike host");
  await relay("?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data/"), [403], "metadata address");
  await relay("?url=" + encodeURIComponent("file:///etc/passwd"), [400, 403], "file scheme");
  const gov = await get(`${SITE}/api/relay?url=${encodeURIComponent("https://upsc.gov.in/")}`, { timeout: 40000 });
  add("relay upsc.gov.in", gov.status === 200 ? "ok" : "warn", `status ${gov.status}, ${gov.bytes} B, served as ${gov.headers.get("content-type")}, colo ${gov.headers.get("x-relay-colo") || "-"}`);
  if (gov.status === 200 && /text\/html/.test(gov.headers.get("content-type") || "")) fail("relay content type", "an official page is served as text/html from news-views.in");

  // 10. full mode (LIVE_FULL=1): every URL the site ever published (data/known-urls.json) must answer 200, or 301/308
  //     to a page that answers 200 — never 404. Takes a few minutes.
  if (process.env.LIVE_FULL === "1") {
    let known = []; try { known = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "known-urls.json"), "utf8")); } catch { warn("known-urls.json", "not readable"); }
    const tally = {}, broken = [];
    // 404 by design: a Hindi detail page outside its window answers with the page that forwards to the English address
    // (/hi/jobs/404.html), and a page the file budget archived (listed in /archived.json) with the "archived" page.
    let archived = { jobs: [], updates: [] };
    try { const a = JSON.parse((await get(`${SITE}/archived.json?t=${Date.now()}`)).body); archived = { jobs: a.jobs || [], updates: a.updates || [] }; } catch { /* a build before archived.json */ }
    const arch = { jobs: new Set(archived.jobs), updates: new Set(archived.updates) };
    const count = (k) => { tally[k] = (tally[k] || 0) + 1; };
    await pool(known, 12, async (u) => {
      let r = await get(SITE + u, { manual: true, timeout: 30000 });
      if (r.status === 0) r = await get(SITE + u, { manual: true, timeout: 30000 });   // one retry on a network error
      if (r.status === 200) return count("200");
      if ([301, 308].includes(r.status)) {
        const loc = r.headers.get("location") || "";
        const t = await get(new URL(loc, SITE).toString(), { manual: true, timeout: 30000 });
        count(`${r.status}->${t.status}`);
        if (t.status !== 200) broken.push(`${u} -> ${loc} (${t.status})`);
        return;
      }
      const m = u.match(/^\/(hi\/)?(jobs|updates)\/([^/]+)\/$/);
      if (r.status === 404 && m && arch[m[2]].has(m[3])) return count("404 archived by the file budget");
      if (r.status === 404 && m && m[1] && /id="en-link"/.test(r.body)) {
        const en = await get(`${SITE}/${m[2]}/${m[3]}/`, { manual: true, timeout: 30000 });
        if ([200, 301, 308].includes(en.status)) return count("404 hindi page, forwards to the English one");
        broken.push(`${u} (404, and the English page answers ${en.status})`); return count("404 hindi, English missing");
      }
      count(String(r.status));
      broken.push(`${u} (${r.status}${r.error ? " " + r.error : ""})`);
    });
    report.knownUrls = { total: known.length, byStatus: tally, broken: broken.length, examples: broken.sort().slice(0, 60) };
    (broken.length ? fail : ok)("every URL ever published", `${known.length} URLs: ${JSON.stringify(tally)}${broken.length ? `; ${broken.length} broken, e.g. ${broken.slice(0, 3).join(" | ")}` : ""}`);
  }

  const problems = checks.filter((c) => c.level !== "ok");
  report.summary = { ok: checks.filter((c) => c.level === "ok").length, warn: checks.filter((c) => c.level === "warn").length, fail: checks.filter((c) => c.level === "fail").length, pagesChecked: pages.length, pagesWithProblems: badPages.length };
  report.problems = [...problems.map((c) => `${c.level.toUpperCase()} ${c.id}: ${c.detail}`), ...badPages.map((p) => `PAGE ${p.url}: ${p.problems.join("; ")}`)];
  report.checks = checks;
  report.pages = pages.map((p) => ({ url: p.url, kind: p.kind, status: p.status, bytes: p.bytes, ms: p.ms, words: p.words, ld: p.ld, title: p.title, problems: p.problems.length ? p.problems : undefined }));
  fs.writeFileSync(path.join(ROOT, "data", "live-report.json"), JSON.stringify(report, null, 1) + "\n");
  console.log(`Live check of ${SITE}: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail; ${pages.length} pages, ${badPages.length} with problems.`);
  for (const p of report.problems) console.log("  " + p);
}

main().then(() => process.exit(0), (e) => { console.error("live-check failed: " + (e.stack || e.message)); process.exit(1); });
