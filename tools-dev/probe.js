#!/usr/bin/env node
/**
 * probe.js — look inside official websites from a GitHub runner (diagnostics; writes data/probe.json).
 *
 * Some recruiters' sites (SSC, NCS, MPSC …) are JavaScript apps: their HTML has no notice links, the list is
 * loaded from a JSON API. For each URL this records how the page was reached (direct / India relay / proxy),
 * its title, links and notice links, RSS feeds, and — from the page's own scripts — the API addresses the app
 * calls, so a source can be pointed at the API instead.
 *
 * URLs: PROBE_URLS (comma-separated; the inspect workflow's "urls" box). Default: the sources whose last
 * watch result was "0 notice links".
 */
const fs = require("fs");
const path = require("path");
const L = require("../lib.js");
const { noticeLinks } = require("../watch.js");

const ROOT = path.join(__dirname, "..");
function defaults() {
  try {
    const health = (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "last-run.json"), "utf8")).watch || {}).sources_health || {};
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources-official.json"), "utf8")).sources;
    return src.filter((s) => /^0 notice links/.test(health[s.id] || "")).map((s) => s.url).slice(0, 12);
  } catch { return []; }
}
const args = String(process.env.PROBE_URLS || "").split(/[\s,]+/).filter(Boolean);
const urls = args.filter((u) => /^https?:\/\//i.test(u));
const grepArg = (args.find((t) => /^grep=/i.test(t)) || "").slice(5);   // "grep=REGEX" in the urls box
const API_RE = /["'`]((?:https?:\/\/[^"'`\s<>]{3,120})?\/(?:api|apis|rest|services?|backend|ws|webapi|portal|graphql|json|cms|wp-json)\b[^"'`\s<>]{0,140})["'`]/gi;
// PROBE_GREP (optional regex): also keep ±160 characters around each match in the page and its scripts.
const GREP = (process.env.PROBE_GREP || grepArg) ? new RegExp(process.env.PROBE_GREP || grepArg, "gi") : null;
const BASE_RE = /\b(?:baseURL|baseUrl|BASE_URL|apiUrl|API_URL|apiBase|API_BASE|serverUrl|SERVER_URL|endpoint)\s*[:=]\s*["'`]([^"'`]{4,160})["'`]/g;

async function get(url, ms = 20000) {
  try { const r = await L.fetchText(url, ms, { proxyMs: 25000 }); return { ok: true, ...r }; }
  catch (e) { return { ok: false, error: String(e.message).slice(0, 300) }; }
}

async function probe(url) {
  const page = await get(url);
  if (!page.ok) return { url, ok: false, error: page.error };
  const html = page.text || "";
  // A JSON API: show its shape (top-level keys, the first array found and its first two items).
  try {
    const j = JSON.parse(html);
    const arrays = [];
    const walk = (o, p, d) => { if (d > 4 || !o || typeof o !== "object") return; if (Array.isArray(o)) { arrays.push({ path: p, length: o.length, first: o.slice(0, 2) }); return; } for (const k of Object.keys(o)) walk(o[k], p ? p + "." + k : k, d + 1); };
    walk(j, "", 0);
    return { url, ok: true, via: page.via, final: page.url, bytes: html.length, json: true, keys: Object.keys(j || {}).slice(0, 30), arrays: arrays.slice(0, 4).map((a) => ({ ...a, first: JSON.stringify(a.first).slice(0, 1500) })) };
  } catch { /* not JSON */ }
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const anchors = (html.match(/<a\s[^>]*href=/gi) || []).length;
  const notices = noticeLinks(html, page.url || url);
  const feeds = [...html.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => (m[0].match(/href=["']([^"']+)/i) || [])[1]).filter(Boolean);
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(L.decodeEntities(m[1]), page.url || url).href; } catch { return null; } }).filter(Boolean);
  const origin = new URL(page.url || url).origin;
  const own = scripts.filter((s) => s.startsWith(origin) && !/jquery|bootstrap|analytics|gtag|recaptcha|polyfill/i.test(s)).slice(0, 8);
  const apis = new Set(), bases = new Set(), grep = [];
  const scan = (txt, where) => {
    for (const m of txt.matchAll(API_RE)) apis.add(m[1]);
    for (const m of txt.matchAll(BASE_RE)) bases.add(m[1]);
    if (GREP) for (const m of txt.matchAll(GREP)) { if (grep.length >= 60) break; grep.push(`[${where}] ` + txt.slice(Math.max(0, m.index - 160), m.index + m[0].length + 160).replace(/\s+/g, " ")); }
  };
  scan(html, "page");
  const scriptInfo = [];
  for (const s of own) {
    const r = await get(s, 25000);
    scriptInfo.push({ src: s, ok: r.ok, bytes: r.ok ? r.text.length : 0, via: r.via, error: r.ok ? undefined : r.error.slice(0, 120) });
    if (r.ok) scan(r.text.slice(0, 6e6), s.split("/").pop().slice(0, 40));
  }
  return {
    url, ok: true, via: page.via, final: page.url, bytes: html.length, title: title ? L.stripTags(title).trim().slice(0, 120) : undefined,
    anchors, noticeLinks: notices.length, sampleNotices: notices.slice(0, 6).map((n) => ({ text: n.text.slice(0, 100), url: n.url })),
    feeds, scripts: scripts.slice(0, 20), scriptInfo, apis: [...apis].slice(0, 80), bases: [...bases].slice(0, 20), grep,
    textSample: L.stripTags(html).replace(/\s+/g, " ").slice(0, 400),
  };
}

async function main() {
  const list = urls.length ? urls : defaults();
  const out = { at: new Date().toISOString(), indiaRelay: L.hasIndiaRelay(), results: [] };
  for (const u of list) { const r = await probe(u); out.results.push(r); console.log(`probe: ${u} → ${!r.ok ? "ERROR " + r.error.slice(0, 120) : r.json ? `${r.via}, JSON keys ${r.keys.join(",")}` : `${r.via}, ${r.anchors} links, ${r.noticeLinks} notices, ${r.apis.length} api strings`}`); }
  fs.writeFileSync(path.join(ROOT, "data", "probe.json"), JSON.stringify(out, null, 2) + "\n");
}
main().catch((e) => { console.log("probe error: " + e.message); process.exit(0); });
