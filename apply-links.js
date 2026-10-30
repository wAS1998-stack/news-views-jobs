#!/usr/bin/env node
/**
 * apply-links.js — finds the real application page for open jobs whose "apply" link is only the department's homepage.
 *
 * Source sites often point "Apply Online" at an organisation's homepage, where a candidate then has to hunt for the
 * form. For each such job (at most APPLY_MAX per run, oldest check first) this looks, in order, at:
 *   1. the official notification itself (PDF text or notice page) — notices print the application URL;
 *   2. the official homepage — its "Recruitment / Careers / Apply online" links.
 * Precision over recall — a wrong "Apply" link is worse than an honest "Official website". A link is accepted only if:
 *   - it belongs to the same organisation, goes beyond the homepage (or is a dedicated portal), is not a PDF, answers;
 *   - it is tied to THIS recruitment: the notice prints it next to "apply / application / register / website", or the
 *     homepage link's text names this post or its advertisement number;
 *   - it is not an admissions / exam / result / student / journal / tender page;
 *   - and, when an AI key is set, the model confirms it is this recruitment's application or page (else only links
 *     printed in the notice itself are trusted).
 * Nothing is invented: every link comes from the official notice or site. The previous link is kept in
 * apply_link_prev; jobs without a better link are re-tried after 7 days, at most 3 times.
 * Run after watch.js (needs pdf-parse, installed by the workflow). Never fails the workflow.
 */
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");

const FILE = path.join(__dirname, "data", "jobs.json");
const MAX = Number(process.env.APPLY_MAX || 20);
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

const GENERIC = /^(recruitment|notification|apply|online|offline|posts?|vacanc\w*|govt|government|20\d\d|more|other|various|walkin|walk|interview|assistant|officer|professor|associate|senior|junior|project|technical|staff|research|fellow|manager|engineer|executive|consultant|clerk|grade|level|cum|and|the|for|with|contract|basis|temporary|regular|guest|faculty|india|national|state|district|university|institute)$/;
/** Phrases that tie a link to THIS recruitment: the post name, distinctive words, the advertisement number. */
function tiesOf(job) {
  const norm = (x) => String(x || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const orgWords = new Set(norm(`${job.organization || ""} ${job.org_short || ""}`).split(" "));
  const phrases = String(job.post_name || "").split(/,|\/|&| and | or /i).map(norm).filter((x) => x.split(" ").length >= 2).slice(0, 5);
  const words = [...new Set(norm(job.post_name || job.title).split(" ").filter((w) => w.length >= 6 && !GENERIC.test(w) && !orgWords.has(w)))];
  const advt = (String(`${job.title} ${job.summary || ""}`).match(/advt\.?\s*no\.?\s*[:.]?\s*([a-z0-9/_-]{2,20})/i) || [])[1];
  return { phrases, words, advt: advt ? advt.toLowerCase() : "" };
}
function tied(text, t) {
  const s = String(text || "").toLowerCase();
  return t.phrases.some((p) => s.includes(p)) || (t.advt && s.includes(t.advt)) || t.words.some((w) => s.includes(w));
}
const WRONG_KIND = /admission|student|\bstd\b|std[-_]|exam(?!ination)|result|journal|tender|alumni|hostel|syllabus|scholarship|fee[-_ ]?pay|convocation|library|press[-_ ]?release|newsletter|eligibility[-_ ]status|shortlist|interview[-_ ]schedule|answer[-_ ]key|admit/i;
const APPLY_CONTEXT = /apply|application|register|registration|online|submit|website|portal|link/i;
// the menu link to the organisation's list of current recruitments: exact, short link text and a matching address
const CAREERS_TEXT = /^\s*(recruitments?|careers?|vacanc(y|ies)|jobs?|job opportunities|current (openings|vacancies)|employment( notices?)?|work with us|join us|recruitment (notices?|cell)|advertisements?|भर्ती|रिक्तियाँ)\s*$/i;
const CAREERS_PATH = /recruit|career|vacanc|job|employment|advertis|opportunit/i;

async function aiConfirm(job, list) {
  if (!L.AI || !list.length) return null;
  const prompt = `An Indian government job notice: "${job.title}" by ${job.organization || job.org_short || "the recruiting body"}` +
    `${job.post_name ? `, post: ${job.post_name}` : ""}. Below are links found in its official notice or on the official website, each with the text around it.\n` +
    list.map((c, i) => `${i + 1}. ${c.url}\n   text: ${(c.context || c.text || "").slice(0, 240)}`).join("\n") +
    `\n\nWhich ONE link is where candidates apply for THIS recruitment (its online application form, registration or recruitment portal), or the official page for THIS specific recruitment? ` +
    `Not an admissions, exam, result, journal or general page, and not a different recruitment. ` +
    `Reply with JSON only: {"pick": <the number>} or {"pick": 0} if none clearly is.`;
  const ans = await L.askAI(prompt, { maxTokens: 30 }).catch(() => "");
  const obj = L.parseJson(ans) || {};
  const n = Number(obj.pick ?? (String(ans || "").match(/\d+/) || [])[0]);
  return n >= 1 && n <= list.length ? list[n - 1] : null;
}

const STATS = { cands: 0, passed: 0, jobsWithCands: 0 };
async function findFor(job) {
  const orgHosts = [job.official_website, job.apply_link, job.official_notification].map(L.hostOf).filter((h) => h && !CDN_HOST.test(h));
  const ties = tiesOf(job);
  const cands = [];
  // 1. links the official notice prints, with the words around them
  if (job.official_notification) {
    const n = await readNotice(job.official_notification);
    if (n) {
      const flat = n.text.replace(/\s+/g, " ");
      for (const u of urlsInText(flat)) {
        const raw = u.replace(/^https:\/\/(?=www\.)/, "");
        const i = Math.max(flat.indexOf(raw), flat.indexOf(u));
        const context = i >= 0 ? flat.slice(Math.max(0, i - 160), i + raw.length + 80) : "";
        cands.push({ url: u, text: "", context, from: "notice" });
      }
      for (const a of n.links) cands.push({ ...a, context: a.text, from: "notice" });
    }
  }
  // 2. homepage links whose text names this post / advertisement — and the site's own "Recruitment / Careers" page
  const home = L.linkKind(job.apply_link, job) === "home" ? job.apply_link : job.official_website;
  let careers = null;
  if (home) {
    const r = await getBuf(home, 20000);
    if (r && r.buf && !/pdf/i.test(r.type)) {
      for (const a of anchors(r.buf.toString("utf8"), r.url)) {
        if (RECRUIT_WORDS.test(`${a.text} ${a.url}`) && tied(a.text, ties)) cands.push({ ...a, context: a.text, from: "site" });
        if (!careers && CAREERS_TEXT.test(a.text) && CAREERS_PATH.test(decodeURIComponent(a.url)) && !WRONG_KIND.test(decodeURIComponent(a.url))
          && L.linkKind(a.url, job) === "deep" && related(L.hostOf(a.url), job, orgHosts)) careers = a.url;
      }
    }
  }
  if (careers && (await alive(careers)) !== false) job.careers_link = careers;
  const cur = String(job.apply_link || "").replace(/\/+$/, "").toLowerCase();
  const seen = new Set();
  const ok = cands.filter((c) => {
    const key = c.url.replace(/[#].*$/, "").replace(/\/+$/, "").toLowerCase();
    if (seen.has(key) || key === cur) return false;
    seen.add(key);
    const kind = L.linkKind(c.url, job);
    if (kind !== "deep" && kind !== "portal") return false;
    if (/\.(jpg|jpeg|png|gif|svg|css|js|zip|docx?|xlsx?|pdf)(\?|$)/i.test(c.url) || /mailto:|javascript:/i.test(c.url)) return false;
    if (WRONG_KIND.test(decodeURIComponent(c.url)) || WRONG_KIND.test(c.text || "")) return false;
    if (!related(L.hostOf(c.url), job, orgHosts)) return false;
    // tied to this recruitment: printed in the notice next to apply/register/website, or named after the post
    if (c.from === "notice") return APPLY_CONTEXT.test(c.context || "") || tied(c.context, ties);
    return tied(c.text, ties);
  });
  STATS.cands += cands.length; STATS.passed += ok.length; if (ok.length) STATS.jobsWithCands++;
  if (!ok.length) return null;
  let pick;
  if (L.AI) pick = await aiConfirm(job, ok.slice(0, 6));
  else pick = ok.find((c) => c.from === "notice" && APPLY_CONTEXT.test(c.context || "")) || null;
  if (!pick) return null;
  const live = await alive(pick.url);
  if (live === false || (live === null && pick.from !== "notice")) return null;
  return { ...pick, score: pick.from };
}

async function main() {
  let jobs; try { jobs = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { console.log("apply-links: no jobs.json"); return; }
  const open = (j) => !j.application_end || j.application_end >= TODAY;
  const due = (j) => !j.apply_checked || (j.apply_tries || 0) < 3 && (Date.parse(TODAY) - Date.parse(j.apply_checked)) >= 7 * 86400000;
  const todo = jobs.filter((j) => open(j) && ["website", "careers"].includes(L.applyInfo(j).cta) && due(j))
    .sort((a, b) => String(a.apply_checked || "").localeCompare(String(b.apply_checked || "")) || String(b.published || "").localeCompare(String(a.published || "")))
    .slice(0, MAX);
  const t0 = Date.now();
  let found = 0, checked = 0, careers0 = jobs.filter((j) => j.careers_link).length;
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
  console.log(`  candidates seen ${STATS.cands}, passed the rules ${STATS.passed} (in ${STATS.jobsWithCands} jobs); recruitment pages found: ${jobs.filter((j) => j.careers_link).length - careers0}`);
  STATS.careers = jobs.filter((j) => j.careers_link).length - careers0;
  L.logRun("apply", { ok: true, checked, found, due: todo.length, ...STATS, log: log.slice(0, 30) });
}
if (require.main === module) main().catch((e) => console.log("apply-links error (non-fatal): " + e.message));
module.exports = { urlsInText, related, baseOf, findFor, tiesOf, tied, WRONG_KIND };
