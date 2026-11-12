#!/usr/bin/env node
/**
 * enrich-jobs.js — upgrades EXISTING data, a few entries per run, so the whole
 * archive improves over time without a big one-off API bill.
 *
 * Passes, each capped per run (config.json / env):
 *   0. facts    — jobs stored while the AI could not read the notice (only a
 *                 headline: no dates, posts or qualification) are read again.
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
const UPDATES = path.join(ROOT, "data", "updates.json");
const C = L.CONFIG;
const MAX_CONTENT = Number(process.env.ENRICH_MAX || C.maxEnrichPerRun || 5);
const MAX_LINKS = Number(process.env.ENRICH_LINKS || C.maxLinkFixPerRun || 25);
const MAX_UPD = Number(process.env.ENRICH_UPDATES || C.maxUpdateEnrichPerRun || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_URL = (C.url || "https://news-views.in").replace(/\/$/, "");

const badLink = (u) => !u || L.isBadOfficial(u);
function needsLinks(j) { return badLink(j.apply_link) && badLink(j.official_notification) && !j.links_checked; }
function needsContent(j) {
  return !(Array.isArray(j.overview) && j.overview.length >= 2) || !(Array.isArray(j.faq) && j.faq.length >= 3);
}
// "partial" = read once and no steps came back: one more reading within two weeks (then "partial-2", final). An update
// whose reading failed because the AI refused the call is not marked at all, so it stays due.
const daysOld = (d) => (Date.now() - new Date(String(d || "").slice(0, 10) + "T00:00:00Z").getTime()) / 86400000;
function needsUpdateEnrich(u) {
  if (Array.isArray(u.steps) && u.steps.length >= 3) return false;
  return !u.enriched || (u.enriched === "partial" && daysOld(u.date) <= 14);
}
/** A job read in pass 0 may be a re-post of a recruitment already listed: with the headline alone the twin check
    (lib.js isDuplicate, as fetch-jobs.js runs it on every new notice) had nothing to compare. A twin that was listed
    first, with the same last date or none, keeps its page; the healed copy is merged into it and redirected (8 pairs
    from the outage of 11 Nov). Different last dates may be a new cycle of the same posts: both stay. */
function mergeIfTwin(job, jobs, redirects) {
  const twin = L.isDuplicate(job, jobs.filter((x) => x !== job && String(x.published || "") <= String(job.published || "")));
  if (!twin || (twin.application_end && job.application_end && twin.application_end !== job.application_end)) return false;
  redirects.push(...L.mergeTwin(twin, job));
  jobs.splice(jobs.indexOf(job), 1);
  console.log(`  = the same recruitment as ${twin.id}: merged into it and redirected: ${job.title}`);
  return true;
}
/** Did the AI fail to answer since `mark` (L.aiHealth().failed before the call)? An empty result then says nothing about the notice. */
const aiFault = (mark) => !!L.AI && (L.aiHealth().failed > mark || !!L.aiDown());

/* ---- pass 0: the facts of jobs stored without them ------------------
   While the AI refuses calls (no credit, an outage) the fetcher still lists new jobs from the headline and the official
   links (lib.js factless). This reads their notice again — the same extraction as for a new job — and fills in the
   record. Returns "ok" | "empty" (read, nothing usable: counts as a try) | "ai" (the AI did not answer: not a try). */
const MAX_FACTS = Number(process.env.ENRICH_FACTS || C.maxFactsPerRun || 40);
async function readFacts(job) {
  const src = await F.readSource(job.source);
  const mark = L.aiHealth().failed;
  const extra = L.aiJobFields(await F.aiExtract({ title: job.title, summary: job.summary }, src));
  if (!Object.keys(extra).length) {
    if (aiFault(mark)) return "ai";
    job.facts_tries = (job.facts_tries || 0) + 1;
    return "empty";
  }
  const today = L.todayIST();
  const merged = { ...job, ...extra, id: job.id, title: job.title, published: job.published, source: job.source };
  // the extraction template "1–31 January" on a notice published later in the year is not a date (same rule as
  // fetch-jobs.js); any other last date is the notice's own — a past one shows the page as closed, which is the truth
  const template = /-01-31$/.test(String(merged.application_end || "")) && (!merged.application_start || /-01-(0\d|10)$/.test(String(merged.application_start)))
    && String(job.published || today).slice(5, 7) >= "04";
  if (template && merged.application_end < String(job.published || today)) { delete merged.application_end; delete merged.application_start; }
  // links: only real candidates from the page (never what the model typed), an upgraded apply link stays
  const picked = L.validateLinks(extra, src.cands), heur = L.pickLinksHeuristic(src.cands);
  merged.apply_link = job.apply_src ? job.apply_link
    : picked.apply_link || job.apply_link || heur.apply_link || picked.official_notification || job.official_notification || heur.official_notification;
  merged.official_notification = picked.official_notification || job.official_notification || heur.official_notification;
  merged.official_website = picked.official_website || job.official_website || heur.official_website;
  if (!merged.organization || merged.organization === merged.title) merged.organization = job.organization;
  if (!Array.isArray(merged.how_to_apply) || merged.how_to_apply.length < 3) merged.how_to_apply = job.how_to_apply || L.GENERIC_STEPS.slice();
  for (const k of Object.keys(merged)) if (merged[k] === null || merged[k] === undefined) delete merged[k];
  const clean = L.sanitizeJob(merged);
  // the notice names a private employer (lib.js NON_GOVT, as fetch-jobs.js checks after reading a new notice): the
  // build already leaves such a record out (its address redirects); it is stored as read but never announced
  const priv = L.isNonGovt(clean);
  delete clean.facts_tries;
  delete clean.hi;                                           // a translation of the headline-only record is out of date
  if (!job.apply_src) { delete clean.apply_checked; delete clean.apply_tries; }   // apply-links.js looks again, now with the real organisation and post
  if (L.factless(clean)) clean.facts_read = today;           // read; the notice itself names no date, post or qualification
  if (String(job.published || "") < today) clean.updated = today;
  for (const k of Object.keys(job)) delete job[k];
  Object.assign(job, clean);
  return priv ? "private" : "ok";
}

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
    about_organization: L.toText(o.about_organization, "about_organization") || undefined,
    eligibility_notes: L.toText(o.eligibility_notes, "eligibility_notes") || undefined,
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
    title: String(o.title).trim(), organization: L.toText(o.organization, "organization"), post_name: L.toText(o.post_name, "post_name"),
    qualification: L.toText(o.qualification, "qualification"), fee: L.toText(o.fee, "fee"), salary: L.toText(o.salary, "salary"),
    location: L.toText(o.location, "location"), summary: String(o.summary).trim(), overview: L.strArr(o.overview, 5),
    eligibility_notes: L.toText(o.eligibility_notes, "eligibility_notes"), about_organization: L.toText(o.about_organization, "about_organization"),
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
  const hi = { title: String(o.title).trim(), organization: L.toText(o.organization, "organization"), exam_name: String(o.exam_name || "").trim(),
    summary: String(o.summary).trim(), steps: L.strArr(o.steps, 8), details: L.strArr(o.details, 5), faq: L.faqArr(o.faq, 6), at: new Date().toISOString().slice(0, 10) };
  for (const k of Object.keys(hi)) if (hi[k] === "" || (Array.isArray(hi[k]) && !hi[k].length)) delete hi[k];
  return hi;
}


/* ---- pass 5: Search Console opportunities --------------------------------
   Pages Google already shows at positions 4–20 get FAQ answers written for the
   exact searches people used — answered ONLY from the page's own facts. */
const MAX_SEO = Number(process.env.SEO_MAX || C.maxSeoPerRun || 10);
async function searchFaq(entry, queries, kind) {
  const facts = kind === "job"
    ? { title: entry.title, organization: entry.organization, post: entry.post_name, vacancies: entry.total_vacancies, qualification: entry.qualification,
        age: entry.age_max ? `${entry.age_min || ""}-${entry.age_max}` : "", start: entry.application_start, last_date: entry.application_end, exam_date: entry.exam_date,
        fee: entry.fee, salary: entry.salary, location: entry.location, selection: entry.selection_process, how_to_apply: entry.how_to_apply, summary: entry.summary,
        official_website: entry.official_website || entry.apply_link }
    : { title: entry.title, organization: entry.organization, exam: entry.exam_name, date: entry.event_date || entry.date, summary: entry.summary, steps: entry.steps, details: entry.details, official: entry.official_link || entry.official_website };
  const prompt = `People reached this page on Google with the search queries listed below. For each query that can be answered from the FACTS, write one FAQ item: ` +
    `"q" = a natural question phrased the way the searcher meant it (in the same language as the query — Hindi queries get Hindi answers), "a" = a direct 1–3 sentence answer using ONLY the facts. ` +
    `If a fact needed for an answer is missing, say candidates should check the official notification — never guess numbers or dates. Skip queries that are unrelated to this page. ` +
    `Return ONLY JSON: {"faq":[{"q":"...","a":"..."}]} with at most 6 items.\n\nQUERIES:\n${queries.map((x) => "- " + x.q).join("\n")}\n\nFACTS:\n${JSON.stringify(facts)}`;
  const o = L.parseJson(await L.askAI(prompt, { maxTokens: 1500 }));
  return L.faqArr(o && o.faq, 6);
}

async function main() {
  let jobs = [], updates = [];
  try { jobs = L.loadJobs(); } catch (e) { console.log("Enrich: cannot read the jobs: " + e.message); return; }
  try { updates = JSON.parse(fs.readFileSync(UPDATES, "utf8")); } catch {}
  if (!Array.isArray(jobs)) return;
  const stats = { ai: L.AI_LABEL, factsRead: 0, factsPending: 0, linksFixed: 0, linksPending: 0, updatesEnriched: 0, updatesPending: 0, contentWritten: 0, contentPending: 0 };
  let jobsDirty = false;

  // Pass 0 — facts of jobs stored while the AI could not read the notice (newest first)
  if (L.AI) {
    const factJobs = jobs.filter((j) => j && j.id && j.title && L.factsPending(j)).sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));
    console.log(`Enrich/facts: ${factJobs.length} job(s) without the notice's facts | doing up to ${MAX_FACTS}`);
    let done = 0;
    const healed = [], redirects = [];
    for (const job of factJobs.slice(0, MAX_FACTS)) {
      const r = await readFacts(job);
      if (r === "ai") { console.log(`  - the AI is not answering: ${factJobs.length - done} job(s) wait for a later run`); break; }
      jobsDirty = true; done++;
      if (r === "private") { stats.factsPrivate = (stats.factsPrivate || 0) + 1; console.log(`  - the notice names a private employer (left out of the site): ${job.title}`); }
      else if (r === "ok" && mergeIfTwin(job, jobs, redirects)) { stats.factsTwins = (stats.factsTwins || 0) + 1; }
      else if (r === "ok") { if (!(job.application_end && job.application_end < L.todayIST())) healed.push(job.id); stats.factsRead++; console.log(`  ✓ facts: ${job.title}${job.application_end ? " (last date " + job.application_end + ")" : ""}`); }
      else console.log(`  - nothing usable read (try ${job.facts_tries}): ${job.title}`);
      await sleep(500);
    }
    stats.factsPending = jobs.filter((j) => j && L.factsPending(j)).length;
    if (redirects.length) L.addRedirects(redirects);
    // their pages now carry the facts and a JobPosting: announce them to the search engines like new pages
    if (healed.length) { try { fs.appendFileSync(path.join(ROOT, "data", "new-urls.txt"), healed.map((id) => `${SITE_URL}/jobs/${id}/`).join("\n") + "\n"); } catch { /* announcing is optional */ } }
  }

  // Pass 1 — official links (works even without an AI key: heuristic pick)
  for (const j of jobs) {   // purge any share/aggregator URLs that slipped in earlier
    for (const k of ["apply_link", "official_notification", "official_website"]) if (j[k] && L.isBadOfficial(j[k])) { delete j[k]; delete j.links_checked; }
  }
  for (const u of updates) for (const k of ["official_link", "official_website"]) if (u[k] && L.isBadOfficial(u[k])) { delete u[k]; if (u.link && L.isBadOfficial(u.link)) u.link = u.source || u.link; }
  const linkJobs = jobs.filter((j) => j && j.id && needsLinks(j));
  stats.linksPending = linkJobs.length;
  console.log(`Enrich/links: ${linkJobs.length} job(s) still link to the source blog | doing up to ${MAX_LINKS}`);
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
    const mark = L.aiHealth().failed;
    const ai = L.AI ? await F.aiUpdate({ title: u.title, summary: u.summary }, u.type, src) : {};
    // the AI did not answer: the update stays due (marking it "partial" here left result pages as one-liners for good)
    if (L.AI && !Object.keys(ai).length && aiFault(mark)) { console.log("  - the AI is not answering: thin updates wait for a later run"); break; }
    const second = u.enriched === "partial";
    const rich = F.finishUpdate({ ...u, link: u.source || u.link }, ai, src);
    if (!L.AI && !rich.official_link) { u.enriched = "no-ai"; updDirty = true; continue; }
    Object.assign(u, rich);
    if (Array.isArray(u.steps) && u.steps.length >= 3) u.enriched = new Date().toISOString().slice(0, 10); else u.enriched = second ? "partial-2" : "partial";
    updDirty = true; stats.updatesEnriched++;
    console.log(`  ✓ update: ${u.title}${u.official_link ? " -> " + L.hostOf(u.official_link) : ""}`);
    await sleep(600);
  }
  stats.updatesPending = updates.filter((u) => u && u.id && needsUpdateEnrich(u)).length;

  // Pass 3 — content (AI only)
  if (L.AI) {
    // not for a record still waiting for its facts (pass 0): prose written from "not stated" would stay for good
    const pending = jobs.filter((j) => j && j.id && j.title && needsContent(j) && !L.factsPending(j));
    console.log(`Enrich/content: ${pending.length} job(s) on template content | doing up to ${MAX_CONTENT}`);
    for (const job of pending.slice(0, MAX_CONTENT)) {
      if (L.aiDown()) { console.log("  - the AI is not answering: content waits for a later run"); break; }
      const rich = await enrichContent(job);
      if (!rich) { console.log(`  - skipped (quality gate): ${job.title}`); continue; }
      // the model's output gets the same shape checks as everything else (objects → text, arrays of strings, …)
      const clean = L.sanitizeJob({ ...job, ...rich });
      for (const k of Object.keys(job)) delete job[k];
      Object.assign(job, clean); jobsDirty = true; stats.contentWritten++;
      console.log(`  ✓ content: ${job.title}`);
      await sleep(800);
    }
    stats.contentPending = Math.max(0, pending.length - MAX_CONTENT);
  } else console.log("Enrich/content: no AI key — skipped.");

  // Pass 4 — Hindi edition (newest first; open jobs before closed ones)
  if (L.AI) {
    const isOpen = (j) => !j.application_end || new Date(j.application_end + "T23:59:59+05:30") >= new Date();
    const hj = jobs.filter((j) => j && j.id && j.title && !j.hi && Array.isArray(j.overview) && j.overview.length)
      .sort((a, b) => (isOpen(b) - isOpen(a)) || String(b.published || "").localeCompare(String(a.published || "")));
    stats.hindiJobsPending = hj.length;
    console.log(`Enrich/hindi: ${hj.length} job(s) without Hindi | doing up to ${MAX_HI_JOBS}`);
    for (const job of hj.slice(0, MAX_HI_JOBS)) {
      if (L.aiDown()) break;
      const hi = await hindiJob(job);
      if (!hi) { console.log(`  - hindi skipped (quality gate): ${job.title}`); continue; }
      job.hi = hi; jobsDirty = true; stats.hindiJobs = (stats.hindiJobs || 0) + 1;
      console.log(`  ✓ hindi: ${hi.title}`);
      await sleep(500);
    }
    const hu = updates.filter((u) => u && u.id && !u.hi && Array.isArray(u.steps) && u.steps.length).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    stats.hindiUpdatesPending = hu.length;
    for (const u of hu.slice(0, MAX_HI_UPD)) {
      if (L.aiDown()) break;
      const hi = await hindiUpdate(u);
      if (!hi) { console.log(`  - hindi update skipped: ${u.title}`); continue; }
      u.hi = hi; updDirty = true; stats.hindiUpdates = (stats.hindiUpdates || 0) + 1;
      console.log(`  ✓ hindi update: ${hi.title}`);
      await sleep(400);
    }
  }

  // Pass 5 — Search Console opportunities (only when gsc.json has data)
  if (L.AI) {
    let gsc = null; try { gsc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "gsc.json"), "utf8")); } catch {}
    const opp = (gsc && gsc.opportunities) || [];
    const fresh = (x) => x.faq_search_at && (Date.now() - new Date(x.faq_search_at).getTime()) < 14 * 86400000;
    let done = 0;
    for (const o of opp) {
      if (done >= MAX_SEO) break;
      const m = o.page.match(/^\/(jobs|updates)\/([^/]+)\/$/); if (!m || !(o.queries || []).length) continue;
      const entry = m[1] === "jobs" ? jobs.find((j) => j.id === m[2]) : updates.find((u) => u.id === m[2]);
      if (!entry || fresh(entry)) continue;
      if (L.aiDown()) break;
      const mark = L.aiHealth().failed;
      const faq = await searchFaq(entry, o.queries, m[1] === "jobs" ? "job" : "update");
      if (!faq.length && aiFault(mark)) continue;   // no answer from the AI: not stamped, tried again next run
      entry.faq_search_at = new Date().toISOString().slice(0, 10);
      if (faq.length) { entry.faq_search = faq; console.log(`  ✓ search FAQ (${faq.length}) for ${o.page} [pos ${o.position}, ${o.impressions} impr]`); }
      if (m[1] === "jobs") jobsDirty = true; else updDirty = true;
      done++; await sleep(400);
    }
    stats.searchFaqPages = done; stats.opportunities = opp.length;
  }

  if (jobsDirty) L.saveJobs(jobs);
  if (updDirty) fs.writeFileSync(UPDATES, JSON.stringify(updates, null, 2) + "\n");
  stats.aiStatus = L.aiStatus();
  L.logRun("enrich", stats);
  console.log("Enrich:", JSON.stringify(stats));
}
module.exports = { devanagariShare, needsUpdateEnrich, readFacts, mergeIfTwin };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
