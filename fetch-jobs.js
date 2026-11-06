/* ==================================================================
   fetch-jobs.js  —  the AUTOMATION step (zero daily input)
   Runs on a schedule from GitHub Actions.

   What it does, fully hands-off:
   1. Reads one or more RSS/Atom feeds you configure once (data/sources.json
      or the JOBS_FEEDS env var).
   2. For every NEW notification it hasn't seen before, creates a job entry.
   3. If an OPENAI_API_KEY (or ANTHROPIC_API_KEY) is provided, it reads the
      linked notification page and uses a cheap model (GPT-4.1 Nano by default)
      to fill in vacancies, dates, eligibility, fee, salary and a summary —
      so each page is rich, not thin. Cost is about a few rupees a month.
      (Without a key it still publishes, using the feed's title + summary.)
   4. De-duplicates and writes data/jobs.json. The Action commits it and
      Cloudflare redeploys. You touch nothing.

   ONE-TIME SETUP (then never again):
   - Put your feed URL(s) in data/sources.json  ->  { "feeds": ["https://..."] }
     (Use official / authorised sources. Re-publishing another site's content
      verbatim is both a copyright and an SEO problem — see README.)
   - Optional but recommended: add repo secret OPENAI_API_KEY for rich pages
     (gpt-4o-mini by default; change "aiModel" in config.json or set OPENAI_MODEL).
   ================================================================== */

const fs = require("fs");
const path = require("path");
const L = require("./lib.js");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data", "jobs.json");
const SOURCES = path.join(ROOT, "data", "sources.json");
const UPDATES = path.join(ROOT, "data", "updates.json");
function classify(title) {
  const s = String(title || "");
  if (/answer key|उत्तर कुंजी|आंसर की|उत्तर-कुंजी/i.test(s)) return "answer-key";
  if (/प्रवेश ?पत्र|एडमिट कार्ड|हॉल टिकट/i.test(s)) return "admit-card";
  if (/परिणाम|रिजल्ट|मेरिट सूची|चयन सूची|कट ?ऑफ/i.test(s)) return "result";
  if (/परीक्षा (तिथि|कार्यक्रम)|साक्षात्कार (कार्यक्रम|तिथि)/i.test(s)) return "exam-date";
  if (/admit card|call letter|hall ticket|city intimation|exam city|application status|mock test/i.test(s)) return "admit-card";
  if (/date (change|extended|postponed)|postpone|reschedul|revised (exam )?(date|schedule)|exam.{0,20}date/i.test(s) && !/recruit|advt|advertisement|vacanc/i.test(s)) return "exam-date";
  if (/result|merit list|rank list|cut[- ]?off|short ?list|marks (obtained|of)|score ?card|marks? list|provisional marks|\bfinal marks\b|\bmarks\b.{0,12}\b(out|released|list|pdf)\b|reserve list|select(ion)? list|final selection|waiting list/i.test(s)) return "result";
  if (/exam date|exam schedule|exam from|interview schedule|interview date|dv schedule|document verification|\bdv date|walk-?in date|exam city/i.test(s)) return "exam-date";
  // notices about a recruitment that is already listed, even when the title names it ("… Recruitment 2026 Correction Form")
  if (/correction (form|window|facility|link|date)|application (form )?correction|edit (form|window)|\b(cancel+ed|cancel+ation|postponed|deferred|withdrawn)\b/i.test(s)) return "exam-date";
  // later stages of a recruitment that is already listed (skill/typing/physical tests, document upload, correction window)
  if (/(skill|typing|physical|stenography|shorthand|trade) test|\bpet\b|\bpst\b|documents? upload|correction window|exam cent(re|er)s?/i.test(s) &&
      !/recruit|advt|advertisement|vacanc|online form|apply online/i.test(s)) return "exam-date";
  return "job";
}

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();
const SITE_URL = (CONFIG.url || "https://news-views.in").replace(/\/$/, "");
const MAX_NEW = Number(process.env.MAX_NEW || CONFIG.maxNewPerRun || 8);   // cap new jobs per run
const MAX_UPDATES = Number(process.env.MAX_UPDATES || CONFIG.maxUpdatesPerRun || 15);   // cap new updates per run
const OPENAI_MODEL = process.env.OPENAI_MODEL || CONFIG.aiModel || "gpt-4o-mini";   // set "aiModel" in config.json to change
const ANTHROPIC_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const AI_PROVIDER = OPENAI_KEY ? "OpenAI" : ANTHROPIC_KEY ? "Claude" : "";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_ALT = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const HDRS = {
  "user-agent": UA,
  "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
  "accept-language": "en-IN,en;q=0.9,hi;q=0.8",
};

/* ---- feeds: from config.json (single source) + fallbacks -------- */
function loadFeeds() {
  let feeds = Array.isArray(CONFIG.feeds) ? CONFIG.feeds.slice() : [];
  if (!feeds.length && fs.existsSync(SOURCES)) {
    try { feeds = JSON.parse(fs.readFileSync(SOURCES, "utf8")).feeds || []; } catch {}
  }
  const env = (process.env.JOBS_FEEDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([...feeds, ...env])].filter((u) => /^https?:\/\//.test(u));
}

/* ---- helpers ---------------------------------------------------- */
const slug = (s) => String(s || "").toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
// Cleaner slug for auto-fetched jobs: drop filler/noise words and vacancy counts,
// keep it short and readable (e.g. "NTPC Jobs 2026 – Apply Online for 08 Senior
// Manager Engineer" -> "ntpc-senior-manager-engineer-2026").
// Numbers that tell recruitments apart are kept, joined to their stage word: "TNPSC Group 2" -> "tnpsc-group-2-…",
// "Group IV" -> "group-4", "RRB NTPC CBT 1" -> "rrb-ntpc-cbt-1" (lib.js joinStageNumbers). Ids already published
// never change: this only names NEW jobs (legacySlug is the old rule, kept to recognise re-fetched old listings).
function cleanSlug(title, { legacy = false } = {}) {
  // URL-safe normalizer used everywhere below: lowercase, ASCII a-z0-9, hyphens only.
  const safe = (x) => String(x || "").toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 60).replace(/-+$/g, "");
  const raw = safe(title);                 // safe baseline (may include noise words)
  const noise = new Set(("jobs job apply online offline for the a an of to and or with without last date " +
    "recruitment notification vacancy vacancies post posts opening openings career careers " +
    "download link form registration eligibility procedure www com in gov nic org").split(" "));
  let year = "";
  const toks = String(title || "").toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const words = (legacy ? toks : L.joinStageNumbers(toks))
    .filter((w) => {
      if (w.includes("-")) return true;   // "group-4", "cbt-2", "grade-a"
      if (/^(20\d{2})$/.test(w)) { year = w; return false; }
      if (/^\d+$/.test(w)) return false;
      if (noise.has(w)) return false;
      return true;
    });
  let s = safe(words.slice(0, 6).join("-"));
  const room = 60 - (year ? year.length + 1 : 0);
  if (s.length > room) s = s.slice(0, room).replace(/-[^-]*$/, "");   // cut at a whole word, keep the year whole
  if (year && s) s += "-" + year;
  s = safe(s);   // guarantee URL-safe even after joining
  // The cleaned slug must have real letters beyond a bare year; otherwise fall back
  // to the safe raw slug, and finally to a unique id — but ALWAYS URL-safe.
  const meaningful = s.replace(/-?20\d{2}$/, "").replace(/-/g, "");
  if (!s || meaningful.length < 3) {
    const rawMeaningful = raw.replace(/-?20\d{2}$/, "").replace(/-/g, "");
    if (raw && rawMeaningful.length >= 3) return raw;
    return "job-" + Date.now().toString(36);
  }
  return s;
}
const stripTags = L.stripTags;
const today = () => L.todayIST();   // dates are Indian dates (UTC is still "yesterday" until 05:30 IST)
/* Feed items rejected AFTER the AI read them (duplicates under a new headline, closed, speculative, private): remembered
   for 14 days by source link, so the same item isn't read and paid for again on every run (~every 40 minutes). */
const SKIPPED_FILE = path.join(ROOT, "data", "fetch-skipped.json");
let SKIPPED = {}, SKIPPED_CHANGED = false;
const skipKey = (link) => String(link || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
function loadSkipped() {
  try { SKIPPED = JSON.parse(fs.readFileSync(SKIPPED_FILE, "utf8")) || {}; } catch { SKIPPED = {}; }
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  for (const k of Object.keys(SKIPPED)) if (!(SKIPPED[k] >= cutoff)) { delete SKIPPED[k]; SKIPPED_CHANGED = true; }
}
const wasRejected = (link) => { const k = skipKey(link); return !!k && !!SKIPPED[k]; };
function rejectAfterRead(link) { const k = skipKey(link); if (k) { SKIPPED[k] = today(); SKIPPED_CHANGED = true; } return null; }
function saveSkipped() { if (SKIPPED_CHANGED) try { fs.writeFileSync(SKIPPED_FILE, JSON.stringify(SKIPPED) + "\n"); } catch (e) { console.log("fetch-skipped: " + e.message); } }
const istDate = (d) => { const t = new Date(d); return isNaN(t) ? today() : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(t); };

const decodeEntities = L.decodeEntities;

const parseFeed = L.parseFeed;

/* ---- read the source page once: text + candidate official links --------- */
async function readSource(link, item) {
  // The article page is best; when it can't be read (blocked, challenge page) or has no official
  // links, fall back to the full post HTML many feeds ship in <content:encoded>.
  let out = { text: "", cands: [] };
  try {
    const { text, type, url } = await L.fetchText(link, 15000);
    // the article only (not the menu, sidebar and footer around it), so the AI reads the notice details
    if (/html/i.test(type)) out = { text: L.stripTags(L.articleRegion(text)).slice(0, 14000), cands: L.extractOfficialLinks(text, url) };
    else out.err = `not html (${type})`;
  } catch (e) { out.err = String(e && e.message || e).slice(0, 80); }
  const html = item && item.html;
  if (html && !out.cands.length) {
    const cands = L.extractOfficialLinks(html, link);
    if (cands.length) out.cands = cands;
    if (!out.text) out.text = L.stripTags(html).slice(0, 14000);
    out.viaFeed = true;
  }
  return out;
}
function candList(cands) {
  return cands.length ? cands.map((c, i) => `${i + 1}. ${c.url}${c.text ? "  (link text: " + c.text + ")" : ""}${c.pdf ? "  [PDF]" : ""}`).join("\n") : "(none found)";
}

/* ---- optional: extract structured fields with AI ----------------- */
async function aiExtract(item, src) {
  if (!AI_PROVIDER) return {};
  const pageText = src.text || item.summary || "";
  const prompt = `You are extracting facts from an Indian government job notification to build a complete, useful job page. ` +
    `Return ONLY a JSON object (no prose, no markdown) with these keys, using null when genuinely unknown: ` +
    `organization (full official name of the recruiting body — NOT the headline), org_short (its common abbreviation, e.g. SSC, UPSC, RRB, IBPS), advt_no (the advertisement / notification number exactly as printed, e.g. "CEN 05/2026", or null), post_name, total_vacancies (number), qualification, age_min (number), age_max (number), ` +
    `application_start (YYYY-MM-DD), application_end (YYYY-MM-DD), exam_date (YYYY-MM-DD), fee, salary, location, ` +
    `apply_link, official_notification, official_website (see rules below), ` +
    `summary (2-3 clear factual sentences describing the recruitment), summary_hindi (the same summary written naturally in Hindi — Devanagari only, never mix Latin letters into Hindi words), ` +
    `selection_process (array of the selection stages if mentioned), ` +
    `how_to_apply (array of 4-6 clear step-by-step instructions to apply online), ` +
    `overview (3 well-written paragraphs, 160-220 words total, as an array of paragraph strings, explaining this recruitment in plain English for an Indian job seeker: what the post involves, who it suits, why it matters, and what applicants should check before applying), ` +
    `about_organization (2-3 sentences, 50-70 words, describing the recruiting body and the kind of work it does), ` +
    `eligibility_notes (2-3 sentences explaining the eligibility in plain language, including any relaxations or conditions worth flagging), ` +
    `preparation_tips (array of 3-4 specific, practical preparation pointers tailored to THIS exam and post — mention the actual subjects or test stages where known), ` +
    `faq (array of 4-5 objects with keys q and a, answering the questions a real candidate would ask about this specific recruitment; each answer 1-3 sentences). ` +
    `LINK RULES: choose apply_link (the official online application / registration page), official_notification (the official notification PDF or notice page) and official_website (the recruiting body's own site homepage) ONLY from the CANDIDATE LINKS list below — copy the URL exactly; if no suitable candidate exists use null. The links must belong to the recruiting body in the TITLE (its own domain or its application portal); a link for a different organisation or exam is wrong — prefer null. Never choose a news/blog/aggregator site. ` +
    `Write overview, about_organization, eligibility_notes, preparation_tips and faq as genuinely useful original prose in a clear, neutral, informative style — never filler, never repeated boilerplate. ` +
    `Do not invent specific numbers, dates or fees; use null for those if not clearly stated, and phrase guidance generally where the notification is silent.\n\n` +
    `TITLE: ${item.title}\n\nCANDIDATE LINKS:\n${candList(src.cands)}\n\nTEXT:\n${pageText}`;
  const obj = L.parseJson(await L.askAI(prompt, { maxTokens: 3200 }));
  if (!obj) { console.log("  (AI extract failed)"); return {}; }
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
}

/* ---- updates (results / admit cards / answer keys): rich entries ---------- */
async function aiUpdate(it, kind, src) {
  if (!AI_PROVIDER) return {};
  const label = { "admit-card": "admit card / hall ticket", result: "result / merit list / cut-off", "answer-key": "answer key", "exam-date": "exam date / schedule" }[kind] || kind;
  const prompt = `You are writing a helpful page about a ${label} announcement for an Indian government exam. Use ONLY the source text; never invent dates, cut-offs or numbers.\n` +
    `Return ONLY a JSON object with keys: ` +
    `organization (full official name of the exam body), org_short (common abbreviation), exam_name (the exam / post this is for), ` +
    `event_date (YYYY-MM-DD of the release/exam date if stated, else null), ` +
    `summary (3-4 factual sentences: what was released, for which exam/post, when, and where to check), ` +
    `summary_hi (the same summary in natural Hindi, Devanagari only), ` +
    `steps (array of 4-6 numbered steps telling the candidate exactly how to download/check it on the official website — mention the real site name and the credentials needed, e.g. registration number and date of birth), ` +
    `details (array of 2-3 paragraphs, 120-180 words total, with the useful context: what happens next, documents to carry, how cut-offs or the next stage work for THIS exam, common problems and fixes), ` +
    `faq (array of 3-4 objects with keys q and a that a candidate would ask about this specific ${label}), ` +
    `official_link (the single best official URL to check/download this, chosen ONLY from the CANDIDATE LINKS list, copied exactly; it must belong to the exam body in the title — null if none fits), ` +
    `official_website (the exam body's own homepage, from the candidate list or null).\n` +
    `Never pick a news/blog/aggregator site as official. Write clear, original, neutral English.\n\n` +
    `TITLE: ${it.title}\n\nCANDIDATE LINKS:\n${candList(src.cands)}\n\nSOURCE TEXT:\n${(src.text || it.summary || "").slice(0, 6000)}`;
  const obj = L.parseJson(await L.askAI(prompt, { maxTokens: 2000 }));
  return obj || {};
}
function finishUpdate(base, ai, src) {
  const cands = src.cands || [];
  const picked = L.validateLinks({ apply_link: ai.official_link, official_notification: ai.official_link, official_website: ai.official_website }, cands);
  const heur = L.pickLinksHeuristic(cands);
  const titleHost = L.hostFromTitle(base.title);
  const officialSite = picked.official_website || heur.official_website || (titleHost ? `https://${titleHost}/` : null) || L.officialHomeFor(base.title);
  // Source page unreadable or without links: the body's own homepage beats sending readers to a blog.
  const official = picked.apply_link || picked.official_notification || heur.apply_link || heur.official_notification || L.officialHomeFor(base.title) || officialSite;
  const u = {
    ...base,
    organization: String(ai.organization || base.organization || "").trim().slice(0, 90) || base.organization,
    org_short: String(ai.org_short || base.org_short || "").trim().slice(0, 30) || base.org_short,
    exam_name: ai.exam_name ? String(ai.exam_name).trim().slice(0, 120) : undefined,
    event_date: /^\d{4}-\d{2}-\d{2}$/.test(String(ai.event_date || "")) ? ai.event_date : undefined,
    summary: String(ai.summary || base.summary || "").trim() || base.summary,
    summary_hi: ai.summary_hi ? String(ai.summary_hi).trim() : undefined,
    steps: L.strArr(ai.steps, 7),
    details: L.strArr(ai.details, 4),
    faq: L.faqArr(ai.faq, 5),
    official_link: official || undefined,
    official_website: officialSite || undefined,
    source: base.link,
  };
  // The outbound button must never point at the middleman when we found an official page.
  if (official) u.link = official;
  for (const k of Object.keys(u)) if (u[k] === undefined || (Array.isArray(u[k]) && !u[k].length)) delete u[k];
  return u;
}

/* ---- build a job entry from a feed item ------------------------- */
// Build a "fingerprint" of a job so near-duplicates (same job, different wording)
// are caught even when the exact title/slug differs.
// Stage numbers are part of it ("group-2" vs "group-4", "cbt-1" vs "cbt-2"), and roman numerals of two or more letters
// read as arabic ("CDS II" -> "cds 2").
function fingerprint(title) {
  const stop = new Set("recruitment notification apply online form last date vacancy vacancies post posts jobs job 2025 2026 2027 the a an for of to and or online offline".split(" "));
  const toks = String(title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const words = [];
  for (const w of L.joinStageNumbers(toks)) {
    const r = L.romanWord(w);
    if (r !== w) words.push(r);                                  // "ii" -> "2" (kept although one character)
    else if (w.length > 1 && !stop.has(w)) words.push(w);
  }
  return words.sort().join(" ");
}
const legacySlug = (title) => cleanSlug(title, { legacy: true });
/** Same recruitment? Different advertisement numbers, posts or vacancy counts mean two recruitments whose headlines
    happen to give the same id ("… Recruitment 2026" twice from one body). */
function sameRecruitment(a, b) {
  const an = L.advtKey(a.advt_no), bn = L.advtKey(b.advt_no);
  if (an && bn) return an === bn;
  const na = L.noticeKey(a.official_notification), nb = L.noticeKey(b.official_notification);
  if (na && nb && na === nb) return true;
  const pa = L.normPost(a.post_name), pb = L.normPost(b.post_name);
  if (pa && pb && pa !== pb && !pa.includes(pb) && !pb.includes(pa)) return false;
  const va = Number(a.total_vacancies) || 0, vb = Number(b.total_vacancies) || 0;
  if (va && vb && va !== vb) return false;
  return true;
}
/** A free id for a different recruitment whose headline gives a taken id: add the advertisement number, the post,
    the vacancy count or finally a counter — "tnpsc-group-4-2026" -> "tnpsc-group-4-advt-11-2026". Never reuses a
    taken or retired id. */
function distinctId(base, job, taken) {
  const year = (base.match(/-(20\d{2})$/) || [])[1];
  const stem = year ? base.slice(0, -5) : base;
  const s = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const adv = String(job.advt_no || "").replace(/\b20\d{2}\b/g, " ").match(/\d+/g);
  const postW = s(job.post_name).split("-").filter((w) => w.length > 2 && !stem.split("-").includes(w) && !/^(posts?|and|the|for|various)$/.test(w)).slice(0, 2).join("-");
  const tries = [adv ? "advt-" + adv.slice(0, 2).map(Number).join("-") : "", postW, Number(job.total_vacancies) > 0 ? `${Math.round(job.total_vacancies)}-posts` : ""]
    .filter(Boolean).concat(["2", "3", "4", "5", "6", "7", "8", "9"]);
  for (const d of tries) {
    let id = `${stem}-${d}`;
    if (id.length > 64) id = id.slice(0, 64).replace(/-[^-]*$/, "");
    if (year) id += "-" + year;
    if (id && id !== base && !taken.has(id)) return id;
  }
  return "";
}
let EXISTING_FOR_DUPES = [];
let EXTENDED = 0;   // existing jobs whose last date was moved by an extension notice this run
let MARKED = 0;     // existing jobs marked cancelled / postponed by a notice this run
// The twin rules live in lib.js (L.isDuplicate) so watch.js applies the same ones.
function isDuplicate(job) {
  return !!L.isDuplicate(job, EXISTING_FOR_DUPES, { onExtend: (hit, end) => {
    console.log(`   ~ last date extended: ${hit.id} ${hit.application_end || "?"} -> ${end}`);
    hit.application_end = end; hit.updated = today(); EXTENDED++;
  } });
}
/** A cancellation / postponement notice of a listed recruitment marks that job (lib.js matchNoticeStatus). */
function markNoticeStatus(notice) {
  const m = L.matchNoticeStatus(notice, EXISTING_FOR_DUPES);
  if (m && L.applyNoticeStatus(m.job, m.status, notice)) { MARKED++; console.log(`   ! ${m.job.id} marked ${m.status}: ${notice.title}`); }
}
const sameHeadline = (a, b) => String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
async function toJob(item, existingIds, fingerprints) {
  let id = cleanSlug(item.title);
  if (!id) return null;
  const fp = fingerprint(item.title);
  if (fp && fingerprints && fingerprints.has(fp)) { console.log(`   = near-duplicate headline, skipped: ${item.title}`); return null; }
  // An id that is taken: the same listing again is skipped; a retired id stays retired; a DIFFERENT recruitment whose
  // headline gives the same id gets a distinguisher once its facts are known (below), instead of being dropped.
  let holder = null;
  if (existingIds.has(id)) {
    holder = EXISTING_FOR_DUPES.find((j) => j.id === id) || null;
    if (!holder) { console.log(`   = id ${id} is retired (redirected), skipped: ${item.title}`); return null; }
    if (sameHeadline(holder.title, item.title)) { console.log(`   = already listed as ${id}, skipped: ${item.title}`); return null; }
  }
  // Listings named before stage numbers were kept ("tnpsc-group-2026" for "TNPSC Group 2"): the same headline again
  // is the same listing.
  const old = legacySlug(item.title);
  if (old !== id && existingIds.has(old)) {
    const h = EXISTING_FOR_DUPES.find((j) => j.id === old);
    if (!h) { console.log(`   = old-style id ${old} is retired (redirected), skipped: ${item.title}`); return null; }
    if (sameHeadline(h.title, item.title) || fingerprint(h.title) === fp) { console.log(`   = already listed as ${old}, skipped: ${item.title}`); return null; }
  }
  if (wasRejected(item.link)) { console.log(`   = rejected after reading on an earlier run, skipped: ${item.title}`); return null; }
  const src = await readSource(item.link, item);
  const base = {
    id,
    title: item.title,
    organization: L.orgFromTitle(item.title) || "Government of India",
    summary: item.summary ? item.summary.slice(0, 240) : item.title,
    apply_link: null,
    official_notification: null,
    source: item.link,
    published: item.date ? istDate(item.date) : today(),
  };
  // only the fields an extraction may set, with the right shapes (objects → text, numbers, YYYY-MM-DD, http links)
  const extra = L.aiJobFields(await aiExtract(item, src));
  const merged = { ...base, ...extra, id, title: item.title };
  // government jobs only: the extraction may reveal a private employer the headline didn't name
  if (L.isNonGovt(merged)) { console.log(`   - not a government employer, skipped: ${item.title}`); return rejectAfterRead(item.link); }
  // a last date before the notice was even published is not real (extraction picked another year / a template
  // "1–31 January"): treat the dates as unknown rather than show a wrong deadline
  const ext = /\b(extend(ed|s)?|extension)\b|last date (extended|revised)/i.test(item.title);
  if (merged.application_end && merged.application_end < today() && !ext) {
    // the template "1 – 31 January" on a notice published months later is an extraction error: dates unknown
    const template = /-01-31$/.test(merged.application_end) && (!merged.application_start || /-01-(0\d|10)$/.test(merged.application_start)) && String(merged.published).slice(5, 7) >= "04";
    if (template) { console.log(`   ? template dates dropped (${merged.application_start || "?"}–${merged.application_end}): ${item.title}`); delete merged.application_end; delete merged.application_start; }
    else { console.log(`   - already closed, skipped: ${item.title}`); return rejectAfterRead(item.link); }
  }
  // Links: AI's choice must be a real candidate from the page; otherwise heuristic; never the aggregator.
  const picked = L.validateLinks(extra, src.cands);
  const heur = L.pickLinksHeuristic(src.cands);
  merged.apply_link = picked.apply_link || heur.apply_link || picked.official_notification || heur.official_notification || null;
  merged.official_notification = picked.official_notification || heur.official_notification || null;
  merged.official_website = picked.official_website || heur.official_website || null;
  if (!merged.official_website) {   // no official link readable: the body's own homepage still beats the blog
    const th = L.hostFromTitle(item.title);
    merged.official_website = L.officialHomeFor(item.title) || (th ? `https://${th}/` : null);
  }
  if (L.isSpeculative(merged)) { console.log(`   - speculative headline without an official notice, skipped: ${item.title}`); return rejectAfterRead(item.link); }
  if (!merged.apply_link) console.log(`   ! no official link on source (${src.err || (src.cands.length ? "no fit" : "0 candidates")}${src.viaFeed ? ", feed html tried" : ""}): ${item.title}`);
  if (!merged.organization || merged.organization === merged.title) merged.organization = L.orgFromTitle(item.title) || "Government of India";
  // Quality floor: ensure every page has substantial content even if extraction was sparse.
  if (!Array.isArray(merged.how_to_apply) || merged.how_to_apply.length < 3) {
    merged.how_to_apply = [
      "Visit the official website linked on this page and open the recruitment/registration link.",
      "Complete the one-time registration with a valid email and mobile number.",
      "Fill in your personal, educational and category details exactly as in your documents.",
      "Upload a recent photograph and signature in the required format.",
      "Pay the application fee online where applicable and submit the form.",
      "Download and save the confirmation page for future reference.",
    ];
  }
  if (!merged.summary || merged.summary.length < 40) {
    merged.summary = `${merged.organization} has released a notification for ${merged.title}. ` +
      `Check the eligibility, important dates and application details below, and apply through the official website before the last date.`;
  }
  for (const k of Object.keys(merged)) if (merged[k] === null || merged[k] === undefined) delete merged[k];
  Object.assign(merged, L.sanitizeJob(merged));
  if (isDuplicate(merged)) { console.log(`   = duplicate of an existing recruitment, skipped: ${merged.title}`); return rejectAfterRead(item.link); }
  if (holder) {
    if (sameRecruitment(merged, holder)) { console.log(`   = same recruitment as ${id}, skipped: ${merged.title}`); return rejectAfterRead(item.link); }
    const nid = distinctId(id, merged, existingIds);
    if (!nid) { console.log(`   - id ${id} taken by another recruitment and no free variant, skipped: ${merged.title}`); return rejectAfterRead(item.link); }
    console.log(`   ~ id ${id} belongs to another recruitment (${holder.title}); saved as ${nid}`);
    merged.id = nid;
  }
  return merged;
}

/* ---- main ------------------------------------------------------- */
async function main() {
  const existing = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const ids = new Set(existing.map((j) => j.id));
  // Job pages that were retired on purpose (merged duplicates, notices that were not recruitments) stay retired.
  try { for (const [from] of JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8"))) { const m = /^\/jobs\/([^/]+)\/$/.exec(from); if (m) ids.add(m[1]); } } catch {}
  EXISTING_FOR_DUPES = existing;
  loadSkipped();
  const fps = new Set(existing.map((j) => fingerprint(j.title)));
  const feeds = loadFeeds();

  if (!feeds.length) {
    console.log("No feeds configured. Add a feed URL to config.json under 'feeds'. Nothing to fetch.");
    return;
  }
  console.log(`Feeds: ${feeds.length} | AI: ${AI_PROVIDER ? AI_PROVIDER + " (" + (AI_PROVIDER === "OpenAI" ? OPENAI_MODEL : ANTHROPIC_MODEL) + ")" : "off"} | max jobs: ${MAX_NEW} | max updates: ${MAX_UPDATES}`);

  const fresh = [];
  let updates = [];
  try { updates = JSON.parse(fs.readFileSync(UPDATES, "utf8")); } catch {}
  // older updates live in data/updates-archive.json and retired ones in redirects.json: neither comes back as new
  const archived = L.readUpdatesArchive();
  const knownUpdIds = new Set([...archived.map((u) => u.id), ...L.retiredUpdateIds()]);
  let updatesAdded = 0;
  const newUpdateIds = [];
  const feedStatus = {};
  // 1) Read every feed first (so health is recorded for all of them), then
  // 2) process items newest-first across feeds — big, fresh notifications win.
  const pool = [];
  for (const url of feeds) {
    try {
      const fr = await L.fetchFeed(url);
      const items = fr.items;
      const newest = items.map((i) => i.date && new Date(i.date)).filter((d) => d && !isNaN(d)).sort((a, b) => b - a)[0];
      feedStatus[url] = items.length ? `${items.length} items via ${fr.via}; newest ${newest ? newest.toISOString().slice(0, 10) : "?"}; ${items.filter((i) => classify(i.title) === "job").filter((i) => ids.has(cleanSlug(i.title)) || fps.has(fingerprint(i.title))).length} already known` : "0 items: " + fr.errors.join(" | ");
      console.log(`  ${items.length} items from ${url}${fr.via ? " (" + fr.via + ")" : ""}${fr.errors.length && !items.length ? " — " + fr.errors.join(" | ") : ""}`);
      for (const it of items) pool.push({ ...it, feed: url, ts: it.date && !isNaN(new Date(it.date)) ? new Date(it.date).getTime() : 0 });
    } catch (e) { console.log(`  feed error (${url}): ${e.message}`); feedStatus[url] = "error: " + e.message; }
  }
  // Drop items older than staleDays (a dead feed re-serving 2025 posts must not fill the site).
  const cutoff = Date.now() - Number(CONFIG.staleDays || 45) * 86400000;
  const seenLinks = new Set();
  const queue = pool
    .filter((it) => !(it.ts && it.ts < cutoff))
    .filter((it) => { const k = it.link.replace(/[?#].*$/, ""); if (seenLinks.has(k)) return false; seenLinks.add(k); return true; })
    .sort((a, b) => b.ts - a.ts);
  console.log(`  ${queue.length} candidate item(s) across feeds (newest first)`);

  for (const it of queue) {
    try {
      // Stop only when BOTH caps are hit (jobs and updates are independent).
      if (fresh.length >= MAX_NEW && updatesAdded >= MAX_UPDATES) break;
      if (L.JUNK_TITLE.test(it.title) || L.OFF_TOPIC.test(it.title) || L.NON_GOVT.test(it.title)) continue;   // PDF dumps, syllabus, admissions, university results, private employers
      if (L.isGenericList(it.title)) continue;                                    // evergreen "Latest X Jobs" listicles, not a notification
      const kind = classify(it.title);
      if (kind !== "job") {
        if (updatesAdded >= MAX_UPDATES) continue;
        const uid = slug(it.title).slice(0, 80);
        if (uid && !updates.some((u) => u.id === uid) && !knownUpdIds.has(uid) && !L.isDupUpdate({ title: it.title, date: today() }, updates.concat(archived))) {
          const base = { id: uid, type: kind, title: String(it.title).trim(),
            organization: L.orgFromTitle(it.title) || "Recruitment Board",
            org_short: String(it.title).split(/\s+/).slice(0, 2).join(" "),
            date: new Date().toISOString().slice(0, 10), link: it.link,
            summary: (String(it.summary || it.title).replace(/<[^>]+>/g, "").trim().slice(0, 300)) +
              " Check the official website for the direct link and full details." };
          if (wasRejected(it.link)) { console.log(`   = rejected after reading on an earlier run, skipped: ${it.title}`); continue; }
          const src = await readSource(it.link, it);
          const ai = await aiUpdate(it, kind, src);
          const upd = finishUpdate(base, ai, src);
          // The AI names the real body ("Symbiosis International (Deemed University)"): re-check it, and the exam.
          if (L.isNonGovt(upd) || L.OFF_TOPIC.test(`${upd.exam_name || ""} | ${upd.organization || ""}`)) { console.log(`   - not a government recruitment update, skipped: ${it.title}`); rejectAfterRead(it.link); continue; }
          // "… Expected Soon", "Release Date", "When will …": guesswork, unless an official notice (PDF / deep link) backs it
          if (L.isSpeculative(upd)) { console.log(`   - speculative headline without an official notice, skipped: ${it.title}`); rejectAfterRead(it.link); continue; }
          // the same official notice (PDF / specific page) already has an update page, under another headline
          if (L.isDupUpdate({ ...upd, date: today() }, updates.concat(archived))) { console.log(`   = same official notice as an existing update, skipped: ${it.title}`); rejectAfterRead(it.link); continue; }
          updates.unshift(upd);
          newUpdateIds.push(uid);
          markNoticeStatus({ title: upd.title, date: today(), link: upd.official_link, id: uid });
          updatesAdded++;
          console.log(`   * update: ${it.title}`);
        }
        continue;
      }
      if (fresh.length >= MAX_NEW) continue;
      const srcKey = String(it.link || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
      if (srcKey && existing.some((j) => String(j.source || "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase() === srcKey)) { console.log(`   = same source page as an existing job, skipped: ${it.title}`); continue; }
      const job = await toJob(it, ids, fps);
      if (job) { fresh.push(job); ids.add(job.id); fps.add(fingerprint(job.title)); console.log(`   + ${job.title}`); }
    } catch (e) { console.log(`  item error (${it.title}): ${e.message}`); }
  }

  if (updatesAdded) {
    // the newest 800 stay in updates.json; older ones move to data/updates-archive.json (pages kept) — never dropped
    const r = L.saveUpdates(updates);
    if (r.archived) console.log(`Moved ${r.archived} older update(s) to data/updates-archive.json.`);
    console.log(`Added ${updatesAdded} update(s) (results/admit cards/answer keys).`);
  }
  saveSkipped();
  const integrations = { ai: L.AI_LABEL, googleIndexing: process.env.HAS_GOOGLE === "true", telegram: process.env.HAS_TELEGRAM === "true", cloudflarePurge: process.env.HAS_CLOUDFLARE === "true" };
  L.logRun("fetch", { integrations, feeds: feeds.length, ai: L.AI_LABEL, newJobs: fresh.length, newUpdates: updatesAdded, feedStatus });
  // Record exactly which job URLs are new this run, so the Indexing API pings
  // only those (fast + quota-efficient) instead of re-submitting everything.
  try {
    const base = (SITE_URL || "https://news-views.in").replace(/\/$/, "");
    const newUrls = fresh.filter((j) => j && j.id).map((j) => `${base}/jobs/${j.id}/`).concat(newUpdateIds.map((id) => `${base}/updates/${id}/`));
    fs.writeFileSync(path.join(ROOT, "data", "new-urls.txt"), newUrls.join("\n") + "\n");
    console.log(`Recorded ${newUrls.length} new URL(s) for indexing.`);
  } catch {}

  if (!fresh.length && !EXTENDED && !MARKED) { console.log("No new jobs found. jobs.json unchanged."); return; }
  const merged = [...fresh, ...existing]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  fs.writeFileSync(DATA, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Added ${fresh.length} new job(s). Total: ${merged.length}.`);
}

module.exports = { readSource, aiExtract, aiUpdate, finishUpdate, classify, cleanSlug, legacySlug, fingerprint, sameRecruitment, distinctId, selfTest };
/** node fetch-jobs.js --self-test : the id / fingerprint rules on pairs that must stay apart (and spellings that must not). */
function selfTest() {
  const assert = require("assert");
  const apart = [["TNPSC Group 2 Recruitment 2026", "TNPSC Group 4 Recruitment 2026"], ["RRB NTPC CBT 1 Result 2026", "RRB NTPC CBT 2 Result 2026"],
    ["SSC CGL Tier 1 Admit Card 2026", "SSC CGL Tier 2 Admit Card 2026"], ["NABARD Grade A Recruitment 2026", "NABARD Grade B Recruitment 2026"]];
  for (const [a, b] of apart) {
    assert.notStrictEqual(cleanSlug(a), cleanSlug(b), `ids must differ: ${a} / ${b}`);
    assert.notStrictEqual(fingerprint(a), fingerprint(b), `fingerprints must differ: ${a} / ${b}`);
  }
  assert.strictEqual(cleanSlug("TNPSC Group IV Recruitment 2026"), cleanSlug("TNPSC Group 4 Recruitment 2026"));
  assert.strictEqual(cleanSlug("SSC CGL Tier-I Admit Card 2026"), "ssc-cgl-tier-1-admit-card-2026");
  assert.strictEqual(fingerprint("UPSC CDS II Notification 2026"), fingerprint("UPSC CDS-II Notification 2026"));
  assert.strictEqual(cleanSlug("NTPC Jobs 2026 – Apply Online for 08 Senior Manager Engineer"), "ntpc-senior-manager-engineer-2026");   // vacancy counts still dropped
  assert.strictEqual(legacySlug("TNPSC Group 2 Recruitment 2026"), "tnpsc-group-2026");
  const taken = new Set(["tnpsc-group-4-2026"]);
  assert.strictEqual(distinctId("tnpsc-group-4-2026", { advt_no: "No. 11/2026" }, taken), "tnpsc-group-4-advt-11-2026");
  assert.strictEqual(sameRecruitment({ advt_no: "11/2026" }, { advt_no: "12/2026" }), false);
  assert.strictEqual(sameRecruitment({ post_name: "Group 4 Services", total_vacancies: 6574 }, { post_name: "Group 4 Services", total_vacancies: 6574 }), true);
  assert.strictEqual(sameRecruitment({ post_name: "Junior Engineer", total_vacancies: 40 }, { post_name: "Junior Engineer", total_vacancies: 12 }), false);
  console.log("fetch-jobs self-test: OK");
}
if (require.main === module) {
  if (process.argv.includes("--self-test")) selfTest();
  else main().catch((e) => { console.error(e); process.exit(1); });
}
