#!/usr/bin/env node
/**
 * watch.js — the official-source watcher.
 *
 * Aggregator feeds lag the real sources. This script checks the official
 * websites of central recruiters and every state's PSC / staff selection /
 * police boards (data/sources-official.json) on every run, spots notice links
 * that were not there last time, and publishes them straight from the
 * official document:
 *
 *   new link → keep only recruitment / admit card / answer key / result notices
 *            → read the official page or PDF → AI extracts the facts (grounded)
 *            → de-duplicate against everything already on the site
 *            → new job page or update page, marked "verified from the official website"
 *
 * The first time a source is seen, its current links are recorded as a
 * baseline and nothing is published (no flood of old notices).
 * Per-source health is written to data/last-run.json → watch.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const L = require("./lib.js");
const F = require("./fetch-jobs.js");

const ROOT = __dirname;
const SRC = path.join(ROOT, "data", "sources-official.json");
const STATE = path.join(ROOT, "data", "watch-state.json");
const JOBS = path.join(ROOT, "data", "jobs.json");
// Job pages retired on purpose (merged duplicates, notices that were not recruitments) must not come back.
const RETIRED = new Set((() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8")).map((r) => (/^\/jobs\/([^/]+)\/$/.exec(r[0]) || [])[1]).filter(Boolean); } catch { return []; } })());
const UPDATES = path.join(ROOT, "data", "updates.json");
const NEWURLS = path.join(ROOT, "data", "new-urls.txt");
const SITE_URL = (L.CONFIG.url || "https://news-views.in").replace(/\/$/, "");
const MAX_PUBLISH = Number(process.env.WATCH_MAX || L.CONFIG.maxWatchPerRun || 25);
const CONCURRENCY = 8;
const today = () => new Date().toISOString().slice(0, 10);

const KEEP = /recruit|vacanc|advertis|\badvt\b|notification|\bnoti\b|category no|cat\.? ?no|\bposts?\b|engagement|walk[- ]?in|admit card|hall ?ticket|call letter|e-?admit|result|merit list|rank ?list|short ?list|select(ed|ion) list|provisional list|final list|score ?card|marks|cut[- ]?off|answer key|answer sheet|exam(ination)? (date|schedule|notice|calendar|city)|time ?table|interview|document verification|\bdv\b|written (test|exam)|\bcbt\b|online application|apply online|assistant|officer|teacher|lecturer|professor|constable|clerk|engineer|inspector|nurse|technician|driver|steno|typist|peon|guard|accountant|pharmacist|librarian|भर्ती|विज्ञापन|विज्ञप्ति|परिणाम|प्रवेश पत्र|उत्तर कुंजी|परीक्षा|रिक्ति|साक्षात्कार|मेरिट/i;
const DROP = /procedure|guideline|instruction|how to|steps to|user manual|\bhelp\b|scheme of exam|syllabus|exam pattern|calendar of|annual (exam )?calendar|citizen charter|organi[sz]ation chart|who.?s who|\bmission\b|\bvision\b|about us|act and rules|service rules|bye-?laws|office order|\bmeetings?\b|\bminutes\b|newsletter|magazine|tender|quotation|auction|e-?procurement|\brti\b|annual report|budget|press release|gallery|photo|video|holiday|transfer|posting order|promotion order|seniority|pension|salary slip|court case|judgment|archive|old (notices|results)|sitemap|log ?in|sign ?in|register here|contact|disclaimer|screen reader|skip to|privacy|copyright|feedback|grievance|faq|help ?desk|home ?page|click here$|^more$|^view all|^read more|^download$|^new$/i;

const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const norm = (u) => String(u || "").replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

/* ---- read a page or PDF (PDF text via pdf-parse when installed) ---- */
let pdfParse = null;
try { pdfParse = require("pdf-parse/lib/pdf-parse.js"); } catch { /* optional */ }
async function readDoc(url) {
  try {
    const r = await fetch(url, { headers: L.HDRS, signal: AbortSignal.timeout(25000), redirect: "follow" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const type = r.headers.get("content-type") || "";
    if (/pdf/i.test(type) || /\.pdf(\?|$)/i.test(url)) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (!pdfParse || buf.length > 15e6) return { text: "", cands: [], pdf: true };
      const d = await pdfParse(buf, { max: 6 }).catch(() => null);
      return { text: d ? String(d.text).replace(/\s+/g, " ").slice(0, 9000) : "", cands: [], pdf: true };
    }
    const html = await r.text();
    return { text: L.stripTags(html).slice(0, 8000), cands: anchors(html, r.url || url).slice(0, 30).map((a) => ({ url: a.url, text: a.text, pdf: /\.pdf(\?|$)/i.test(a.url) })), pdf: false };
  } catch (e) {
    const msg = (e.cause && (e.cause.code || e.cause.message)) || e.message;
    if (L.CHAIN_ERR.test(String(msg))) {   // incomplete certificate chain: fetch the issuer and retry, verified
      try {
        const r = await L.fetchWithAIA(url, 25000);
        if (/pdf/i.test(r.type) || /\.pdf(\?|$)/i.test(url)) {
          const d = pdfParse ? await pdfParse(r.buffer, { max: 6 }).catch(() => null) : null;
          return { text: d ? String(d.text).replace(/\s+/g, " ").slice(0, 9000) : "", cands: [], pdf: true };
        }
        const html = r.buffer.toString("utf8");
        return { text: L.stripTags(html).slice(0, 8000), cands: anchors(html, r.url).slice(0, 30).map((a) => ({ url: a.url, text: a.text, pdf: /\.pdf(\?|$)/i.test(a.url) })), pdf: false };
      } catch { /* fall through */ }
    }
    try { const { text, url: u } = await L.fetchText(url, 20000); return { text: L.stripTags(text).slice(0, 8000), cands: anchors(text, u).slice(0, 30), pdf: false }; }
    catch { return { text: "", cands: [], pdf: false, error: e.message }; }
  }
}

function anchors(html, base) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = L.decodeEntities(m[1]).trim();
    if (/^(javascript|mailto|tel):/i.test(href)) continue;
    try { href = new URL(href, base).href; } catch { continue; }
    let text = L.stripTags(m[2]).replace(/\s+/g, " ").trim();
    if (text.length < 8) { const t = m[0].match(/title\s*=\s*["']([^"']+)["']/i); if (t) text = L.decodeEntities(t[1]).trim(); }
    out.push({ url: href, text: text.slice(0, 250) });
  }
  return out;
}

/* A notice link points at ONE document: a file, or text that names something specific
   (a number, a year, an advertisement no., or a descriptive phrase). Section pages such as
   "Notifications", "Interviews", "Answer Keys" are navigation, never publish them. */
function isSpecific(a) {
  const text = a.text.trim(), words = text.split(/\s+/).length;
  const file = /\.(pdf|docx?|xlsx?|jpe?g|png)(\?|$)/i.test(a.url);
  let pathDigits = false; try { pathDigits = /\d/.test(new URL(a.url).pathname + new URL(a.url).search); } catch {}
  const textSpecific = /\d/.test(text) || words >= 6;
  if (file) return words >= 3 || /\d/.test(text);
  return textSpecific && (pathDigits || words >= 6);
}
function noticeLinks(html, base) {
  const seen = new Set(), out = [];
  for (const a of anchors(html, base)) {
    const blob = `${a.text} ${decodeURIComponent(a.url).replace(/[_\-/.]+/g, " ")}`;
    if (a.text.length < 8 || !KEEP.test(blob) || DROP.test(a.text) || L.OFF_TOPIC.test(a.text)) continue;
    if (!isSpecific(a)) continue;   // menu / section links ("Notifications", "Results") are not notices
    const k = hash(norm(a.url) + "|" + a.text.toLowerCase().slice(0, 80));
    if (seen.has(k)) continue; seen.add(k);
    out.push({ ...a, key: k });
  }
  return out;
}

async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}

/* ---- AI: turn one official notice into a job or an update ---- */
function candList(c) { return c.length ? c.map((x, i) => `${i + 1}. ${x.url}${x.text ? "  (" + x.text + ")" : ""}`).join("\n") : "(none)"; }
async function extractJob(src, link, doc) {
  const prompt = `This is an official recruitment notice published on the website of ${src.name} (${src.state}). Extract the facts to build a job page. ` +
    `Return ONLY a JSON object, null where unknown: headline (a clear English headline like "UPPSC Lecturer Recruitment 2026 – 120 Posts" — organisation short name, post, year, number of posts if stated), ` +
    `is_recruitment (true only if this notice invites applications for posts; false for results, admit cards, corrigenda, schedules, tenders), ` +
    `is_specific_notice (true only if the text is ONE specific notice/advertisement; false if it is a listing, index, menu or section page that lists many notices), ` +
    `advt_no (advertisement / notification number if stated), ` +
    `organization (full name), org_short, post_name, total_vacancies (number), qualification, age_min (number), age_max (number), ` +
    `application_start (YYYY-MM-DD), application_end (YYYY-MM-DD), exam_date (YYYY-MM-DD), fee, salary, location, ` +
    `apply_link (official online application page, chosen ONLY from CANDIDATE LINKS or null), ` +
    `summary (2-3 factual sentences), summary_hindi (same in natural Hindi), selection_process (array), how_to_apply (array of 4-6 steps), ` +
    `overview (array of 3 paragraphs, 160-220 words total, plain English for an Indian job seeker), about_organization (2-3 sentences), ` +
    `eligibility_notes (2-3 sentences), preparation_tips (array of 3-4), faq (array of 4-5 {q,a}). ` +
    `Use ONLY the notice text — never invent numbers, dates or fees.\n\nLINK TEXT: ${link.text}\nNOTICE URL: ${link.url}\n\nCANDIDATE LINKS:\n${candList(doc.cands)}\n\nNOTICE TEXT:\n${doc.text || "(text not readable — use the link text only and leave unknown fields null)"}`;
  return L.parseJson(await L.askAI(prompt, { maxTokens: 3500 }));
}
async function extractUpdate(src, link, doc, kind) {
  const label = { "admit-card": "admit card / hall ticket", result: "result / merit or selection list / cut-off", "answer-key": "answer key", "exam-date": "exam date / schedule / interview" }[kind];
  const prompt = `This is an official ${label} notice published on the website of ${src.name} (${src.state}). Use ONLY the notice text; never invent dates or numbers. ` +
    `Return ONLY a JSON object: is_specific_notice (true only if the text is ONE specific ${label} notice for a named exam or post; false for listing/index/section pages, procedures or general instructions), ` +
    `headline (clear English headline like "UPSSSC Junior Assistant Result 2026 Out" — organisation short name, exam/post, type, year), ` +
    `organization, org_short, exam_name, event_date (YYYY-MM-DD or null), summary (3-4 factual sentences: what was released, for which exam/post, where to check), ` +
    `summary_hi (same in Hindi), steps (array of 4-6 steps to download/check it on ${new URL(link.url).host}), details (array of 2-3 short paragraphs with what happens next), ` +
    `faq (array of 3-4 {q,a}).\n\nLINK TEXT: ${link.text}\nNOTICE URL: ${link.url}\n\nNOTICE TEXT:\n${doc.text || "(text not readable — use the link text only)"}`;
  return L.parseJson(await L.askAI(prompt, { maxTokens: 2200 }));
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SRC, "utf8")).sources || [];
  let state = {}; try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
  let jobs = [], updates = [];
  try { jobs = JSON.parse(fs.readFileSync(JOBS, "utf8")); } catch {}
  try { updates = JSON.parse(fs.readFileSync(UPDATES, "utf8")); } catch {}
  console.log(`Watch: ${sources.length} official sources | AI ${L.AI_LABEL} | pdf ${pdfParse ? "on" : "off"} | max publish ${MAX_PUBLISH}`);

  // 1) scan every source
  const health = {}, fresh = [];
  const runNo = (state._run = (state._run || 0) + 1);
  await pool(sources, CONCURRENCY, async (s) => {
    const st = state[s.id] || (state[s.id] = { seen: [], fails: 0 });
    // Sources failing for a long time are retried every 6th run only, so blocked sites don't slow every run.
    if ((st.fails || 0) >= 6 && runNo % 6) { health[s.id] = `paused (fails ${st.fails}${st.blocked ? ", geo-blocked" : ""})`; return; }
    try {
      const { text, url, via } = await L.fetchText(s.url, 12000, { skipDirect: !!st.blocked, proxyMs: 20000 });
      const prevVia = st.via; st.via = via;
      const links = noticeLinks(text, url);
      if (!links.length) { st.fails = (st.fails || 0) + 1; health[s.id] = `0 notice links (fails ${st.fails})`; return; }
      const seen = new Set(st.seen);
      let baseline = !st.seen.length;
      const nu = links.filter((l) => !seen.has(l.key));
      // A burst of "new" links means the page changed shape (redesign, different fetch route), not 15 new notices.
      // Record silently instead of publishing a flood of old items.
      const reason = !baseline && (nu.length > 10 || (prevVia && prevVia !== via && nu.length > 2) || (st.seen.length && nu.length > Math.max(4, st.seen.length * 0.6)))
        ? `re-baselined (${nu.length} new after ${prevVia && prevVia !== via ? "route change " + prevVia + "→" + via : "page change"})` : "";
      if (reason) baseline = true;
      st.seen = [...links.map((l) => l.key), ...st.seen.filter((k) => !links.some((l) => l.key === k))].slice(0, 600);
      st.fails = 0; st.lastOk = today();
      health[s.id] = (reason || (baseline ? `baseline ${links.length} links` : `${links.length} links, ${nu.length} new`)) + ` via ${via}`;
      if (!baseline) for (const l of nu) fresh.push({ src: s, link: l });
    } catch (e) {
      st.fails = (st.fails || 0) + 1;
      if (/^direct: .*(UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|ECONNRESET|timeout)/i.test(String(e.message))) st.blocked = true;   // drops non-Indian networks
      health[s.id] = `error: ${String(e.message).slice(0, 120)} (fails ${st.fails})`;
    }
  });
  fs.writeFileSync(STATE, JSON.stringify(state) + "\n");
  console.log(`Watch: ${fresh.length} new official notice link(s).`);

  // 2) publish the new ones
  const existingUrls = new Set([...jobs.flatMap((j) => [j.official_notification, j.apply_link, j.source]), ...updates.flatMap((u) => [u.official_link, u.link, u.source])].filter(Boolean).map(norm));
  const fps = new Set([...jobs.map((j) => F.fingerprint(j.title)), ...updates.map((u) => F.fingerprint(u.title))]);
  const added = { jobs: [], updates: [] }, skipped = [];
  let upgraded = 0;   // feed updates given their official notice link
  if (!L.AI) console.log("Watch: no AI key — new links recorded but not published.");
  const thisYear = new Date().getFullYear();
  for (const { src, link } of (L.AI ? fresh : []).slice(0, MAX_PUBLISH)) {
    if (existingUrls.has(norm(link.url))) { skipped.push("known url"); continue; }
    // Old notices re-surfacing on a homepage ("Cut-off Marks (01/2018)") are not news.
    const years = (link.text.match(/\b(20\d{2})\b/g) || []).map(Number).concat((link.text.match(/\/(\d{2})\b/g) || []).map((x) => 2000 + Number(x.slice(1))).filter((y) => y >= 2010 && y <= thisYear + 1));
    if (years.length && Math.max(...years) < thisYear - 1) { skipped.push("old notice: " + link.text.slice(0, 50)); continue; }
    const kind = F.classify(link.text);
    const doc = await readDoc(link.url);
    if (kind === "job") {
      const o = await extractJob(src, link, doc);
      if (!o || o.is_recruitment === false || o.is_specific_notice === false || !o.headline || !o.organization || !(o.summary && o.summary.length > 40)) { skipped.push("not a specific recruitment: " + link.text.slice(0, 50)); continue; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(o.application_end || "")) && o.application_end < today()) { skipped.push("already closed: " + o.headline); continue; }
      // A job page needs real substance: a post name AND (vacancies, a last date or an advertisement number).
      if (!o.post_name || !(Number(o.total_vacancies) > 0 || /^\d{4}-\d{2}-\d{2}$/.test(String(o.application_end || "")) || o.advt_no)) { skipped.push("too thin: " + link.text.slice(0, 50)); continue; }
      const title = L.cleanTitle(o.headline);
      const fp = F.fingerprint(title);
      if (fps.has(fp)) { skipped.push("duplicate: " + title); continue; }
      const id = F.cleanSlug(title);
      if (!id || jobs.some((j) => j.id === id) || RETIRED.has(id)) { skipped.push("id taken: " + id); continue; }
      const job = Object.fromEntries(Object.entries({ ...o, headline: undefined, is_recruitment: undefined, is_specific_notice: undefined }).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)));
      const sameHostCands = doc.cands.filter((c) => c.url);
      Object.assign(job, {
        id, title, published: today(), via: "official", source: link.url, state_hint: src.state,
        official_notification: doc.pdf ? link.url : (job.official_notification || link.url),
        official_website: `${new URL(src.url).origin}/`,
        apply_link: (job.apply_link && sameHostCands.some((c) => norm(c.url) === norm(job.apply_link))) ? job.apply_link : `${new URL(src.url).origin}/`,
      });
      if (!job.location && src.state !== "Central") job.location = src.state;
      jobs.unshift(job); fps.add(fp); existingUrls.add(norm(link.url)); added.jobs.push(job);
      console.log(`   + [${src.name}] ${title}`);
    } else {
      const o = await extractUpdate(src, link, doc, kind);
      if (!o || o.is_specific_notice === false || !o.headline || !(o.exam_name && String(o.exam_name).trim()) || !(o.summary && o.summary.length > 40)) { skipped.push("not a specific notice: " + link.text.slice(0, 50)); continue; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(o.event_date || "")) && (Date.now() - new Date(o.event_date).getTime()) > 45 * 86400000) { skipped.push("old update: " + o.headline); continue; }
      const title = L.cleanTitle(o.headline);
      const fp = F.fingerprint(title);
      if (fps.has(fp)) { skipped.push("duplicate: " + title); continue; }
      const twin = updates.find((x) => L.isDupUpdate({ title, type: kind, date: today() }, [x]));
      if (twin) {   // already on the site from a feed: give it the official link instead of a second page
        if (!twin.official_link || L.isBadOfficial(twin.link || "")) { twin.official_link = link.url; twin.link = link.url; upgraded++; }
        skipped.push("duplicate (same notice): " + title); continue;
      }
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      if (!id || updates.some((u) => u.id === id)) { skipped.push("id taken: " + id); continue; }
      const u = {
        id, type: kind, title, organization: String(o.organization || src.name).trim(), org_short: String(o.org_short || src.name).trim().slice(0, 30),
        exam_name: o.exam_name || undefined, event_date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.event_date || "")) ? o.event_date : undefined,
        date: today(), link: link.url, official_link: link.url, official_website: `${new URL(src.url).origin}/`, source: link.url, via: "official",
        summary: String(o.summary).trim(), summary_hi: o.summary_hi ? String(o.summary_hi).trim() : undefined,
        steps: L.strArr(o.steps, 7), details: L.strArr(o.details, 4), faq: L.faqArr(o.faq, 5), enriched: today(),
      };
      for (const k of Object.keys(u)) if (u[k] === undefined || (Array.isArray(u[k]) && !u[k].length)) delete u[k];
      updates.unshift(u); fps.add(fp); existingUrls.add(norm(link.url)); added.updates.push(u);
      console.log(`   * [${src.name}] ${title}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (added.jobs.length) fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 2) + "\n");
  if (added.updates.length || upgraded) fs.writeFileSync(UPDATES, JSON.stringify(updates.slice(0, 800), null, 2) + "\n");
  if (added.jobs.length || added.updates.length) {
    fs.appendFileSync(NEWURLS, [...added.jobs.map((j) => `${SITE_URL}/jobs/${j.id}/`), ...added.updates.map((u) => `${SITE_URL}/updates/${u.id}/`)].join("\n") + "\n");
  }
  const ok = Object.values(health).filter((h) => !/^error|^0 notice|^paused/.test(h)).length;
  L.logRun("watch", { sources: sources.length, healthy: ok, newLinks: fresh.length, publishedJobs: added.jobs.length, publishedUpdates: added.updates.length,
    skipped: skipped.slice(0, 30), sources_health: health, logLines: 40 });
  console.log(`Watch: ${ok}/${sources.length} sources healthy | published ${added.jobs.length} job(s), ${added.updates.length} update(s) | skipped ${skipped.length}`);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { noticeLinks, anchors };
