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
     (GPT-4.1 Nano is used by default; override with OPENAI_MODEL).
   ================================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data", "jobs.json");
const SOURCES = path.join(ROOT, "data", "sources.json");
const UPDATES = path.join(ROOT, "data", "updates.json");
function classify(title) {
  const s = String(title || "");
  if (/answer key/i.test(s)) return "answer-key";
  if (/admit card|call letter|hall ticket|city intimation|exam city/i.test(s)) return "admit-card";
  if (/result|merit list|cut ?off|shortlist/i.test(s)) return "result";
  if (/exam date|exam schedule|exam from/i.test(s)) return "exam-date";
  return "job";
}

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();
const MAX_NEW = Number(process.env.MAX_NEW || CONFIG.maxNewPerRun || 8);   // cap new jobs per run
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-nano";          // cheapest, ideal for extraction
const ANTHROPIC_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const AI_PROVIDER = OPENAI_KEY ? "OpenAI" : ANTHROPIC_KEY ? "Claude" : "";
const UA = "Mozilla/5.0 (compatible; NewsViewsJobsBot/1.0; +https://news-views.in)";
const HDRS = { "user-agent": UA, "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8" };

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
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
const today = () => new Date().toISOString().slice(0, 10);

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x27;/g, "'");
}

/* ---- minimal RSS + Atom parser (zero deps) ---------------------- */
function parseFeed(xml) {
  const items = [];
  const grab = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? decodeEntities(m[1]).trim() : "";
  };
  // RSS <item>
  const rss = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const b of rss) {
    items.push({
      title: stripTags(grab(b, "title")),
      link: grab(b, "link") || (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || ""),
      summary: stripTags(grab(b, "description") || grab(b, "content:encoded")),
      date: grab(b, "pubDate") || grab(b, "dc:date"),
      guid: grab(b, "guid"),
    });
  }
  // Atom <entry>
  const atom = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const b of atom) {
    items.push({
      title: stripTags(grab(b, "title")),
      link: b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || grab(b, "id"),
      summary: stripTags(grab(b, "summary") || grab(b, "content")),
      date: grab(b, "updated") || grab(b, "published"),
      guid: grab(b, "id"),
    });
  }
  return items.filter((i) => i.title && i.link);
}

/* ---- optional: extract structured fields with Claude ------------ */
async function aiExtract(item) {
  if (!AI_PROVIDER) return {};
  let pageText = item.summary || "";
  try {
    const r = await fetch(item.link, { headers: HDRS, signal: AbortSignal.timeout(15000) });
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.includes("html")) pageText = (stripTags(await r.text()) || pageText).slice(0, 7000);
  } catch { /* fall back to summary */ }

  const prompt = `You are extracting facts from an Indian government job notification to build a complete, useful job page. ` +
    `Return ONLY a JSON object (no prose, no markdown) with these keys, using null when genuinely unknown: ` +
    `organization, org_short, post_name, total_vacancies (number), qualification, age_min (number), age_max (number), ` +
    `application_start (YYYY-MM-DD), application_end (YYYY-MM-DD), exam_date (YYYY-MM-DD), fee, salary, location, ` +
    `summary (2-3 clear factual sentences describing the recruitment), summary_hindi (the same summary written naturally in Hindi), ` +
    `selection_process (array of the selection stages if mentioned), ` +
    `how_to_apply (array of 4-6 clear step-by-step instructions to apply online). ` +
    `Write summary and how_to_apply as complete, helpful text even if you must phrase the standard online application process generally. ` +
    `Do not invent specific numbers, dates or fees; use null for those if not clearly stated.\n\nTITLE: ${item.title}\n\nTEXT:\n${pageText}`;

  let raw = "";
  try {
    if (AI_PROVIDER === "OpenAI") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: 1024,
        }),
      });
      if (!res.ok) { console.log("  (AI skipped: OpenAI HTTP " + res.status + ")"); return {}; }
      const data = await res.json();
      raw = data.choices?.[0]?.message?.content || "";
    } else {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
      });
      if (!res.ok) { console.log("  (AI skipped: Claude HTTP " + res.status + ")"); return {}; }
      const data = await res.json();
      raw = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    }
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const obj = JSON.parse(json);
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
  } catch (e) { console.log("  (AI extract failed: " + e.message + ")"); return {}; }
}

/* ---- build a job entry from a feed item ------------------------- */
async function toJob(item, existingIds) {
  let id = slug(item.title);
  if (!id || existingIds.has(id)) return null;        // skip seen / empty
  const base = {
    id,
    title: item.title,
    organization: item.title.split(/[-–|,(]/)[0].trim() || "Government of India",
    summary: item.summary ? item.summary.slice(0, 240) : item.title,
    apply_link: item.link,
    official_notification: item.link,
    published: item.date ? new Date(item.date).toISOString().slice(0, 10) : today(),
  };
  const extra = await aiExtract(item);
  const merged = { ...base, ...extra, id, title: item.title, apply_link: extra.apply_link || base.apply_link };
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
  return merged;
}

/* ---- main ------------------------------------------------------- */
async function main() {
  const existing = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const ids = new Set(existing.map((j) => j.id));
  const feeds = loadFeeds();

  if (!feeds.length) {
    console.log("No feeds configured. Add a feed URL to config.json under 'feeds'. Nothing to fetch.");
    return;
  }
  console.log(`Feeds: ${feeds.length} | AI extraction: ${AI_PROVIDER || "off"} | max new this run: ${MAX_NEW}`);

  const fresh = [];
  let updates = [];
  try { updates = JSON.parse(fs.readFileSync(UPDATES, "utf8")); } catch {}
  let updatesAdded = 0;
  for (const url of feeds) {
    try {
      const r = await fetch(url, { headers: HDRS, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { console.log(`  feed HTTP ${r.status}: ${url}`); continue; }
      const items = parseFeed(await r.text());
      console.log(`  ${items.length} items from ${url}`);
      for (const it of items) {
        if (fresh.length >= MAX_NEW) break;
        const kind = classify(it.title);
        if (kind !== "job") {
          const uid = slug(it.title).slice(0, 80);
          if (uid && !updates.some((u) => u.id === uid)) {
            updates.unshift({ id: uid, type: kind, title: String(it.title).trim(),
              organization: String(it.title).split(/[—:\-]/)[0].trim().slice(0, 60) || "Recruitment Board",
              org_short: String(it.title).split(/\s+/).slice(0, 2).join(" "),
              date: new Date().toISOString().slice(0, 10), link: it.link,
              summary: (String(it.summary || it.title).replace(/<[^>]+>/g, "").trim().slice(0, 300)) +
                " Check the official website for the direct link and full details." });
            updatesAdded++;
            console.log(`   * update: ${it.title}`);
          }
          continue;
        }
        const job = await toJob(it, ids);
        if (job) { fresh.push(job); ids.add(job.id); console.log(`   + ${job.title}`); }
      }
    } catch (e) { console.log(`  feed error (${url}): ${e.message}`); }
    if (fresh.length >= MAX_NEW) break;
  }

  if (updatesAdded) {
    updates = updates.slice(0, 60);
    fs.writeFileSync(UPDATES, JSON.stringify(updates, null, 2) + "\n");
    console.log(`Added ${updatesAdded} update(s) (results/admit cards/answer keys).`);
  }
  if (!fresh.length) { console.log("No new jobs found. jobs.json unchanged."); return; }

  const merged = [...fresh, ...existing]
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  fs.writeFileSync(DATA, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Added ${fresh.length} new job(s). Total: ${merged.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
