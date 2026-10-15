#!/usr/bin/env node
/**
 * enrich-jobs.js — upgrades EXISTING data, a few entries per run, so the whole
 * archive improves over time without a big one-off API bill.
 *
 * Three passes, each capped per run (config.json / env):
 *   1. links    — jobs whose "official" links still point at the source blog
 *                 (a middleman) get the real government / recruiter URLs,
 *                 discovered on the source page and confirmed by the model.
 *   2. updates  — results / admit-card / answer-key entries that are still
 *                 one-liners get download steps, context, FAQ and official link.
 *   3. content  — jobs still on template prose get the full written page.
 *
 * Grounded: it writes ONLY from facts already stored on the entry or read from
 * its source page. It never invents vacancy counts, dates or fees.
 */
const fs = require("fs");
const path = require("path");
const L = require("./lib.js");
const F = require("./fetch-jobs.js");

const ROOT = __dirname;
const JOBS = path.join(ROOT, "data", "jobs.json");
const UPDATES = path.join(ROOT, "data", "updates.json");
const C = L.CONFIG;
const MAX_CONTENT = Number(process.env.ENRICH_MAX || C.maxEnrichPerRun || 5);
const MAX_LINKS = Number(process.env.ENRICH_LINKS || C.maxLinkFixPerRun || 25);
const MAX_UPD = Number(process.env.ENRICH_UPDATES || C.maxUpdateEnrichPerRun || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const badLink = (u) => !u || L.isBadOfficial(u);
function needsLinks(j) { return badLink(j.apply_link) && badLink(j.official_notification) && !j.links_checked; }
function needsContent(j) {
  return !(Array.isArray(j.overview) && j.overview.length >= 2) || !(Array.isArray(j.faq) && j.faq.length >= 3);
}
function needsUpdateEnrich(u) { return !(Array.isArray(u.steps) && u.steps.length >= 3) && !u.enriched; }

/* ---- pass 1: official links ------------------------------------- */
async function fixLinks(job) {
  const srcUrl = job.source || job.official_notification || job.apply_link;
  if (!srcUrl) return false;
  const src = await F.readSource(srcUrl);
  if (!src.cands.length) { job.links_checked = new Date().toISOString().slice(0, 10); return false; }
  let picked = { apply_link: null, official_notification: null, official_website: null };
  if (L.AI) {
    const prompt = `From the candidate links below (all found on a page about "${job.title}"), choose: ` +
      `apply_link = the official online application / registration page; official_notification = the official notification PDF or notice page; ` +
      `official_website = the recruiting body's own homepage. Copy URLs exactly from the list; use null when no candidate fits. ` +
      `The links MUST belong to the recruiting body named in the title (its own domain or its application portal) — if a candidate is for a different organisation or an unrelated exam, do not pick it; prefer null over a wrong link. ` +
      `Never pick a news/blog/aggregator site. Return ONLY a JSON object with those three keys.\n\nCANDIDATES:\n` +
      src.cands.map((c, i) => `${i + 1}. ${c.url}${c.text ? "  (link text: " + c.text + ")" : ""}${c.pdf ? "  [PDF]" : ""}`).join("\n");
    picked = L.validateLinks(L.parseJson(await L.askAI(prompt, { maxTokens: 400 })) || {}, src.cands);
  }
  const heur = L.pickLinksHeuristic(src.cands);
  const apply = picked.apply_link || heur.apply_link || picked.official_notification || heur.official_notification;
  const notif = picked.official_notification || heur.official_notification;
  if (!apply && !notif) { job.links_checked = new Date().toISOString().slice(0, 10); return false; }
  if (!job.source) job.source = srcUrl;
  if (apply) job.apply_link = apply;
  if (notif) job.official_notification = notif; else delete job.official_notification;
  job.official_website = picked.official_website || heur.official_website || `https://${L.hostOf(apply || notif)}/`;
  delete job.links_checked;
  return true;
}

/* ---- pass 3: written content ------------------------------------ */
async function enrichContent(job) {
  const facts = [
    `Title: ${job.title}`, `Organisation: ${job.organization || ""}`, `Post: ${job.post_name || ""}`,
    `Vacancies: ${job.total_vacancies ?? "not stated"}`, `Qualification: ${job.qualification || "not stated"}`,
    `Location: ${job.location || "not stated"}`, `Application start: ${job.application_start || "not stated"}`,
    `Last date: ${job.application_end || "not stated"}`, `Exam date: ${job.exam_date || "not stated"}`,
    `Fee: ${job.fee || "not stated"}`, `Salary: ${job.salary || "not stated"}`,
    `Existing summary: ${job.summary || ""}`,
  ].join("\n");
  const prompt = `You are writing the content for one recruitment page on an Indian government-jobs website. ` +
    `Use ONLY the verified facts below. Never invent vacancy numbers, dates, fees, salaries or cut-offs. ` +
    `Where a fact is "not stated", tell the reader to check the official notification instead of guessing.\n\n` +
    `Return ONLY a JSON object with keys: ` +
    `overview (array of 3 paragraphs, 160-220 words total, explaining this recruitment in plain English: what the post involves, who it suits, and what applicants should check before applying), ` +
    `about_organization (2-3 sentences, 50-70 words, on the recruiting body and the work it does), ` +
    `eligibility_notes (2-3 sentences explaining the eligibility in plain language, flagging any conditions worth noting), ` +
    `preparation_tips (array of 3-4 practical pointers tailored to THIS exam and post, naming the actual subjects or stages where known), ` +
    `faq (array of 4-5 objects with keys q and a, answering what a real candidate would ask about this specific recruitment; each answer 1-3 sentences).\n\n` +
    `Write genuinely useful original prose in a clear, neutral, informative style — never filler, never repeated boilerplate.\n\nVERIFIED FACTS:\n${facts}`;
  const o = L.parseJson(await L.askAI(prompt));
  if (!o) return null;
  const overview = L.strArr(o.overview, 4);
  const faq = L.faqArr(o.faq, 6);
  if (overview.length < 2 || overview.join(" ").split(/\s+/).length < 100 || faq.length < 3) return null;
  return {
    overview,
    about_organization: String(o.about_organization || "").trim() || undefined,
    eligibility_notes: String(o.eligibility_notes || "").trim() || undefined,
    preparation_tips: L.strArr(o.preparation_tips, 5),
    faq,
  };
}


/* ---- pass 4: Hindi edition (grounded translation, never new facts) ----- */
const MAX_HI_JOBS = Number(process.env.HINDI_JOBS || C.maxHindiJobsPerRun || 25);
const MAX_HI_UPD = Number(process.env.HINDI_UPDATES || C.maxHindiUpdatesPerRun || 25);
// Share of letters that are Devanagari. (Must not use \W — in JS regex that matches every non-ASCII letter, Hindi included.)
const devanagariShare = (s) => {
  const str = String(s || "");
  const deva = (str.match(/[ऀ-ॿ]/g) || []).length, latin = (str.match(/[A-Za-z]/g) || []).length;
  return deva + latin ? deva / (deva + latin) : 0;
};
const HI_RULES = `Translate into natural, simple Hindi (Devanagari) the way leading Indian government-job portals write — clear and conversational, not literary. ` +
  `Keep exam and organisation abbreviations in Latin letters (SSC, UPSC, RRB, IBPS, CGL, NTPC, PwBD, OBC, PDF, KB). Keep every number, date, rupee amount, website address and age exactly as given. ` +
  `Do not add, drop or change any fact. If a field is empty, return an empty string or empty array for it.`;
async function hindiJob(job) {
  const src = {
    title: job.title, organization: job.organization, post_name: job.post_name || "", qualification: job.qualification || "",
    fee: job.fee || "", salary: job.salary || "", location: job.location || "", summary: job.summary || "",
    overview: job.overview || [], eligibility_notes: job.eligibility_notes || "", about_organization: job.about_organization || "",
    how_to_apply: job.how_to_apply || [], selection_process: job.selection_process || [], preparation_tips: job.preparation_tips || [],
    faq: (job.faq || []).slice(0, 5),
  };
  const prompt = `${HI_RULES}\nReturn ONLY a JSON object with exactly the same keys and structure as the input (faq items keep keys q and a), every value translated to Hindi. ` +
    `For "title", write a Hindi headline in the usual style, e.g. "SSC CGL भर्ती 2026: 14582 पदों के लिए ऑनलाइन आवेदन".\n\nINPUT:\n${JSON.stringify(src)}`;
  const o = L.parseJson(await L.askAI(prompt, { maxTokens: 4000 }));
  if (!o || !o.title || !o.summary || devanagariShare(o.title + o.summary) < 0.5) return null;
  const hi = {
    title: String(o.title).trim(), organization: String(o.organization || "").trim(), post_name: String(o.post_name || "").trim(),
    qualification: String(o.qualification || "").trim(), fee: String(o.fee || "").trim(), salary: String(o.salary || "").trim(),
    location: String(o.location || "").trim(), summary: String(o.summary).trim(), overview: L.strArr(o.overview, 5),
    eligibility_notes: String(o.eligibility_notes || "").trim(), about_organization: String(o.about_organization || "").trim(),
    how_to_apply: L.strArr(o.how_to_apply, 8), selection_process: L.strArr(o.selection_process, 8),
    preparation_tips: L.strArr(o.preparation_tips, 6), faq: L.faqArr(o.faq, 6),
    at: new Date().toISOString().slice(0, 10),
  };
  for (const k of Object.keys(hi)) if (hi[k] === "" || (Array.isArray(hi[k]) && !hi[k].length)) delete hi[k];
  return hi;
}
async function hindiUpdate(u) {
  const src = { title: u.title, organization: u.organization || "", exam_name: u.exam_name || "", summary: u.summary || "",
    steps: u.steps || [], details: u.details || [], faq: (u.faq || []).slice(0, 5) };
  const prompt = `${HI_RULES}\nReturn ONLY a JSON object with exactly the same keys and structure as the input (faq items keep keys q and a), every value translated to Hindi. ` +
    `For "title", write a Hindi headline in the usual style, e.g. "SSC GD कांस्टेबल रिजल्ट 2026 जारी – ऐसे करें चेक".\n\nINPUT:\n${JSON.stringify(src)}`;
  const o = L.parseJson(await L.askAI(prompt, { maxTokens: 3000 }));
  if (!o || !o.title || !o.summary || devanagariShare(o.title + o.summary) < 0.5) return null;
  const hi = { title: String(o.title).trim(), organization: String(o.organization || "").trim(), exam_name: String(o.exam_name || "").trim(),
    summary: String(o.summary).trim(), steps: L.strArr(o.steps, 8), details: L.strArr(o.details, 5), faq: L.faqArr(o.faq, 6), at: new Date().toISOString().slice(0, 10) };
  for (const k of Object.keys(hi)) if (hi[k] === "" || (Array.isArray(hi[k]) && !hi[k].length)) delete hi[k];
  return hi;
}

async function main() {
  let jobs = [], updates = [];
  try { jobs = JSON.parse(fs.readFileSync(JOBS, "utf8")); } catch { console.log("Enrich: cannot read jobs.json"); return; }
  try { updates = JSON.parse(fs.readFileSync(UPDATES, "utf8")); } catch {}
  if (!Array.isArray(jobs)) return;
  const stats = { ai: L.AI_LABEL, linksFixed: 0, linksPending: 0, updatesEnriched: 0, updatesPending: 0, contentWritten: 0, contentPending: 0 };

  // Pass 1 — official links (works even without an AI key: heuristic pick)
  for (const j of jobs) {   // purge any share/aggregator URLs that slipped in earlier
    for (const k of ["apply_link", "official_notification", "official_website"]) if (j[k] && L.isBadOfficial(j[k])) { delete j[k]; delete j.links_checked; }
  }
  for (const u of updates) for (const k of ["official_link", "official_website"]) if (u[k] && L.isBadOfficial(u[k])) { delete u[k]; if (u.link && L.isBadOfficial(u.link)) u.link = u.source || u.link; }
  const linkJobs = jobs.filter((j) => j && j.id && needsLinks(j));
  stats.linksPending = linkJobs.length;
  console.log(`Enrich/links: ${linkJobs.length} job(s) still link to the source blog | doing up to ${MAX_LINKS}`);
  let jobsDirty = false;
  for (const job of linkJobs.slice(0, MAX_LINKS)) {
    const ok = await fixLinks(job);
    jobsDirty = true;   // links_checked marker or new links
    if (ok) { stats.linksFixed++; console.log(`  ✓ official links: ${job.title} -> ${L.hostOf(job.apply_link)}`); }
    else console.log(`  - no official link found on source: ${job.title}`);
    await sleep(400);
  }
  stats.linksPending = Math.max(0, linkJobs.length - MAX_LINKS);

  // Pass 2 — updates
  const pendUpd = updates.filter((u) => u && u.id && needsUpdateEnrich(u));
  console.log(`Enrich/updates: ${pendUpd.length} thin update(s) | doing up to ${MAX_UPD}`);
  let updDirty = false;
  for (const u of pendUpd.slice(0, MAX_UPD)) {
    const src = await F.readSource(u.source || u.link);
    const ai = L.AI ? await F.aiUpdate({ title: u.title, summary: u.summary }, u.type, src) : {};
    const rich = F.finishUpdate({ ...u, link: u.source || u.link }, ai, src);
    if (!L.AI && !rich.official_link) { u.enriched = "no-ai"; updDirty = true; continue; }
    Object.assign(u, rich);
    if (Array.isArray(u.steps) && u.steps.length >= 3) u.enriched = new Date().toISOString().slice(0, 10); else u.enriched = "partial";
    updDirty = true; stats.updatesEnriched++;
    console.log(`  ✓ update: ${u.title}${u.official_link ? " -> " + L.hostOf(u.official_link) : ""}`);
    await sleep(600);
  }
  stats.updatesPending = Math.max(0, pendUpd.length - MAX_UPD);

  // Pass 3 — content (AI only)
  if (L.AI) {
    const pending = jobs.filter((j) => j && j.id && j.title && needsContent(j));
    console.log(`Enrich/content: ${pending.length} job(s) on template content | doing up to ${MAX_CONTENT}`);
    for (const job of pending.slice(0, MAX_CONTENT)) {
      const rich = await enrichContent(job);
      if (!rich) { console.log(`  - skipped (quality gate): ${job.title}`); continue; }
      Object.assign(job, rich); jobsDirty = true; stats.contentWritten++;
      console.log(`  ✓ content: ${job.title}`);
      await sleep(800);
    }
    stats.contentPending = Math.max(0, pending.length - MAX_CONTENT);
  } else console.log("Enrich/content: no AI key — skipped.");

  // Pass 4 — Hindi edition (newest first; open jobs before closed ones)
  if (L.AI) {
    const isOpen = (j) => !j.application_end || new Date(j.application_end + "T23:59:59") >= new Date();
    const hj = jobs.filter((j) => j && j.id && j.title && !j.hi && Array.isArray(j.overview) && j.overview.length)
      .sort((a, b) => (isOpen(b) - isOpen(a)) || String(b.published || "").localeCompare(String(a.published || "")));
    stats.hindiJobsPending = hj.length;
    console.log(`Enrich/hindi: ${hj.length} job(s) without Hindi | doing up to ${MAX_HI_JOBS}`);
    for (const job of hj.slice(0, MAX_HI_JOBS)) {
      const hi = await hindiJob(job);
      if (!hi) { console.log(`  - hindi skipped (quality gate): ${job.title}`); continue; }
      job.hi = hi; jobsDirty = true; stats.hindiJobs = (stats.hindiJobs || 0) + 1;
      console.log(`  ✓ hindi: ${hi.title}`);
      await sleep(500);
    }
    const hu = updates.filter((u) => u && u.id && !u.hi && Array.isArray(u.steps) && u.steps.length).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    stats.hindiUpdatesPending = hu.length;
    for (const u of hu.slice(0, MAX_HI_UPD)) {
      const hi = await hindiUpdate(u);
      if (!hi) { console.log(`  - hindi update skipped: ${u.title}`); continue; }
      u.hi = hi; updDirty = true; stats.hindiUpdates = (stats.hindiUpdates || 0) + 1;
      console.log(`  ✓ hindi update: ${hi.title}`);
      await sleep(400);
    }
  }

  if (jobsDirty) fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 2) + "\n");
  if (updDirty) fs.writeFileSync(UPDATES, JSON.stringify(updates, null, 2) + "\n");
  L.logRun("enrich", stats);
  console.log("Enrich:", JSON.stringify(stats));
}
module.exports = { devanagariShare };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
