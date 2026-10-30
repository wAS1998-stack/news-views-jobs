#!/usr/bin/env node
/**
 * apply-links.js — finds the real application page for open jobs whose "apply" link is only the department's homepage.
 *
 * Source sites often point "Apply Online" at an organisation's homepage, where a candidate then has to hunt for the
 * form. For each such job (at most APPLY_MAX per run, oldest check first) this looks, in order, at:
 *   1. the official notification itself (PDF text or notice page) — notices print the application URL;
 *   2. the official homepage — its "Recruitment / Careers / Apply online" links.
 * A link is accepted only if it belongs to the same organisation (its domain, a sub-domain, or a host that matches
 * the organisation's name), goes beyond the homepage (or is a dedicated application portal), is not a PDF, and does
 * not answer 404. Nothing is invented: every link comes from the official notice or site. The previous link is kept
 * in apply_link_prev; jobs without a better link are re-tried after 7 days, at most 3 times.
 * Run after watch.js (needs pdf-parse, installed by the workflow). Never fails the workflow.
 */
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");

const FILE = path.join(__dirname, "data", "jobs.json");
const MAX = Number(process.env.APPLY_MAX || 30);
const BUDGET_MS = Number(process.env.APPLY_BUDGET_MS || 5 * 60 * 1000);
const TODAY = new Date().toISOString().slice(0, 10);
let pdfParse = null;
try { pdfParse = require("pdf-parse/lib/pdf-parse.js"); } catch { /* optional: notices then read as pages only */ }

const RELAY = (u) => `${(L.CONFIG.url || "https://news-views.in").replace(/\/$/, "")}/api/relay?url=${encodeURIComponent(u)}`;
const CDN_HOST = /(^|\.)(s3waas\.gov\.in|cdnbbsr\.s3waas\.gov\.in|amazonaws\.com|cloudfront\.net|googleusercontent\.com|drive\.google\.com|docs\.google\.com)$/i;
const APPLY_WORDS = /apply|online|regist|candidate|login|application|onlineapp|recruitment portal/i;
const RECRUIT_WORDS = /recruit|career|vacanc|advt|advertisement|employment|jobs?\b|notification|walk-?in/i;

/** The organisation's own domain, for "same organisation" checks (state portals share uk.gov.in etc., so .gov.in/.nic.in keep the full host). */
function baseOf(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const p = h.split(".");
  if (/\.(gov|nic)\.in$/.test(h)) return h;
  if (/\.(ac|co|org|edu|res|net|gen|firm|ind)\.in$/.test(h)) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}
function related(host, job, orgHosts) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!h || L.isAggregator(h) || CDN_HOST.test(h)) return false;
  for (const o of orgHosts) { const b = baseOf(o); if (h === b || h.endsWith("." + b) || baseOf(h) === b) return true; }
  return L.hostMatches(h, job.organization, job.title, job.org_short);
}
function cleanUrl(u) {
  let x = String(u || "").trim().replace(/[)\].,;:'"»>]+$/, "");
  if (/^www\./i.test(x)) x = "https://" + x;
  try { const url = new URL(x); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; }
}
function urlsInText(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"'(){}|\\^`[\]]{4,200}/gi)) { const u = cleanUrl(m[0]); if (u) out.add(u); }
  return [...out];
}
function anchors(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(L.decodeEntities(m[1]), base).href; } catch { continue; }
    if (!/^https?:/i.test(u)) continue;
    out.push({ url: u, text: L.stripTags(m[2]).replace(/\s+/g, " ").trim().slice(0, 100) });
  }
  return out;
}

async function getBuf(url, ms = 20000) {
  for (const target of [url, RELAY(url)]) {
    try {
      const r = await fetch(target, { headers: L.HDRS, signal: AbortSignal.timeout(ms), redirect: "follow" });
      if (!r.ok) { if (r.status === 404 || r.status === 410) return { status: r.status }; continue; }
      return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "", url: target === url ? (r.url || url) : url };
    } catch { /* try the relay */ }
  }
  return null;
}
async function readNotice(url) {
  const r = await getBuf(url, 25000);
  if (!r || !r.buf) return null;
  if (/pdf/i.test(r.type) || /\.pdf(\?|$)/i.test(url)) {
    if (!pdfParse || r.buf.length > 15e6) return null;
    const d = await pdfParse(r.buf, { max: 8 }).catch(() => null);
    return d ? { text: String(d.text || ""), links: [] } : null;
  }
  const html = r.buf.toString("utf8");
  return { text: L.stripTags(html), links: anchors(html, r.url) };
}
/** Is the page there? 404/410 = no; a network failure (geo-blocked runner) = unknown. */
async function alive(url) {
  try {
    const r = await fetch(url, { headers: L.HDRS, signal: AbortSignal.timeout(12000), redirect: "follow" });
    if (r.status === 404 || r.status === 410) return false;
    return r.status < 500 ? true : null;
  } catch { return null; }
}

function keywords(job) {
  return [...new Set(String(`${job.post_name || ""} ${job.title || ""}`).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 4 && !/^(recruitment|notification|apply|online|offline|posts?|vacanc\w*|govt|2026|2027|more|other|various|walkin)$/.test(w)))];
}
function score(c, job, kws) {
  const s = `${c.url} ${c.text || ""}`.toLowerCase();
  let n = c.from === "notice" ? 2 : 0;
  if (APPLY_WORDS.test(s)) n += 3;
  if (RECRUIT_WORDS.test(s)) n += 2;
  if (kws.some((k) => s.includes(k))) n += 2;
  if (/20(26|27)/.test(s)) n += 1;
  if (L.linkKind(c.url, job) === "portal") n += 1;
  return n;
}

async function findFor(job) {
  const orgHosts = [job.official_website, job.apply_link, job.official_notification].map(L.hostOf).filter((h) => h && !CDN_HOST.test(h));
  const kws = keywords(job);
  const cands = [];
  // 1. the official notification
  if (job.official_notification) {
    const n = await readNotice(job.official_notification);
    if (n) {
      for (const u of urlsInText(n.text)) cands.push({ url: u, text: "", from: "notice" });
      for (const a of n.links) cands.push({ ...a, from: "notice" });
    }
  }
  // 2. the official homepage
  const home = L.linkKind(job.apply_link, job) === "home" ? job.apply_link : job.official_website;
  if (home) {
    const r = await getBuf(home, 20000);
    if (r && r.buf && !/pdf/i.test(r.type)) {
      for (const a of anchors(r.buf.toString("utf8"), r.url)) if (RECRUIT_WORDS.test(`${a.text} ${a.url}`) || APPLY_WORDS.test(a.text)) cands.push({ ...a, from: "site" });
    }
  }
  const cur = String(job.apply_link || "").replace(/\/+$/, "").toLowerCase();
  const seen = new Set();
  const ok = cands.filter((c) => {
    const key = c.url.replace(/[#].*$/, "").replace(/\/+$/, "").toLowerCase();
    if (seen.has(key) || key === cur) return false;
    seen.add(key);
    const kind = L.linkKind(c.url, job);
    if (kind !== "deep" && kind !== "portal") return false;
    if (/\.(jpg|jpeg|png|gif|svg|css|js|zip|docx?|xlsx?)(\?|$)/i.test(c.url) || /mailto:|javascript:/i.test(c.url)) return false;
    if (/(tender|rti|gallery|photo|press|news|circular|holiday|contact|feedback|grievance|sitemap|disclaimer|privacy|faq|result|admit|answer)/i.test(c.url + " " + c.text) && !APPLY_WORDS.test(c.url + " " + c.text)) return false;
    return related(L.hostOf(c.url), job, orgHosts);
  }).map((c) => ({ ...c, score: score(c, job, kws) })).filter((c) => c.score >= (c.from === "notice" ? 4 : 5)).sort((a, b) => b.score - a.score);
  for (const c of ok.slice(0, 3)) {
    const live = await alive(c.url);
    if (live === false) continue;
    if (live === null && c.from !== "notice") continue;   // unverifiable homepage scrape: not good enough
    return c;
  }
  return null;
}

async function main() {
  let jobs; try { jobs = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { console.log("apply-links: no jobs.json"); return; }
  const open = (j) => !j.application_end || j.application_end >= TODAY;
  const due = (j) => !j.apply_checked || (j.apply_tries || 0) < 3 && (Date.parse(TODAY) - Date.parse(j.apply_checked)) >= 7 * 86400000;
  const todo = jobs.filter((j) => open(j) && L.applyInfo(j).cta === "website" && due(j))
    .sort((a, b) => String(a.apply_checked || "").localeCompare(String(b.apply_checked || "")) || String(b.published || "").localeCompare(String(a.published || "")))
    .slice(0, MAX);
  const t0 = Date.now();
  let found = 0, checked = 0;
  const log = [];
  for (const job of todo) {
    if (Date.now() - t0 > BUDGET_MS) break;
    checked++;
    let hit = null;
    try { hit = await findFor(job); } catch (e) { log.push(`${job.id}: error ${e.message}`); }
    job.apply_checked = TODAY;
    if (hit) {
      job.apply_link_prev = job.apply_link || null;
      job.apply_link = hit.url;
      job.apply_src = hit.from;
      found++;
      log.push(`${job.id}: ${hit.url} (${hit.from}, score ${hit.score})`);
    } else {
      job.apply_tries = (job.apply_tries || 0) + 1;
    }
  }
  if (checked) fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2) + "\n");
  console.log(`apply-links: checked ${checked}, found ${found} real application pages (${todo.length} due, pdf reader ${pdfParse ? "on" : "off"})`);
  for (const l of log) console.log("  " + l);
  L.logRun("apply", { ok: true, checked, found, due: todo.length, log: log.slice(0, 30) });
}
if (require.main === module) main().catch((e) => console.log("apply-links error (non-fatal): " + e.message));
module.exports = { urlsInText, related, baseOf, findFor };
