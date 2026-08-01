#!/usr/bin/env node
/**
 * fetch-news.js — builds the News & Views section.
 *
 * Two article types, BOTH grounded in real sources (never invented):
 *   1. current-affairs : a daily digest written from real PIB / government
 *                        press-release headlines fetched over RSS.
 *   2. analysis        : an explainer about a notable recruitment, written
 *                        from a real notification already in data/jobs.json.
 *
 * If no AI key is present, or no source items are found, nothing is written.
 * We never publish an article that isn't backed by fetched source material.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();
const SITE_URL = (CONFIG.url || "https://news-views.in").replace(/\/$/, "");
const NEWS = path.join(ROOT, "data", "news.json");
const JOBS = path.join(ROOT, "data", "jobs.json");
const NEWURLS = path.join(ROOT, "data", "new-urls.txt");

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || CONFIG.newsModel || CONFIG.aiModel || "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
const AI = OPENAI_KEY ? "OpenAI" : (ANTHROPIC_KEY ? "Claude" : "");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_ALT = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const HDRS = { "user-agent": UA, "accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8", "accept-language": "en-IN,en;q=0.9" };

const NEWS_FEEDS = Array.isArray(CONFIG.newsFeeds) && CONFIG.newsFeeds.length
  ? CONFIG.newsFeeds
  : ["https://www.pib.gov.in/ViewRss.aspx?reg=1&lang=1"];
const MAX_ANALYSIS = Number(CONFIG.maxAnalysisPerRun || 1);

const today = () => new Date().toISOString().slice(0, 10);
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
const safeSlug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 70).replace(/-+$/g, "");

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function parseFeed(xml) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const t = decode((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
    let link = decode((b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "").trim();
    if (!link) link = decode((b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || "").trim();
    const d = decode((b.match(/<(description|summary)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || "");
    if (t) out.push({ title: t, link, summary: stripTags(d).slice(0, 400) });
  }
  return out;
}
async function getFeed(url) {
  try {
    let r = await fetch(url, { headers: HDRS, signal: AbortSignal.timeout(20000) });
    if (r.status === 403 || r.status === 503 || r.status === 429) {
      await new Promise((res) => setTimeout(res, 1200));
      r = await fetch(url, { headers: { ...HDRS, "user-agent": UA_ALT }, signal: AbortSignal.timeout(20000) });
    }
    if (!r.ok) { console.log(`  news feed HTTP ${r.status}: ${url}`); return []; }
    return parseFeed(await r.text());
  } catch (e) { console.log(`  news feed error (${url}): ${e.message}`); return []; }
}

async function askAI(prompt, maxTokens = 3000, attempt = 1) {
  try {
    if (AI === "OpenAI") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: maxTokens }),
      });
      if (!res.ok) {
        console.log("  (OpenAI HTTP " + res.status + (attempt < 2 ? " — retrying once)" : ")"));
        if (attempt < 2 && res.status !== 401) { await new Promise((r) => setTimeout(r, 2000)); return askAI(prompt, maxTokens, attempt + 1); }
        return null;
      }
      const data = await res.json();
      const txt = data.choices?.[0]?.message?.content || "";
      if (!txt && attempt < 2) { await new Promise((r) => setTimeout(r, 1500)); return askAI(prompt, maxTokens, attempt + 1); }
      return txt;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) { console.log("  (AI skipped: Claude HTTP " + res.status + ")"); return null; }
    const data = await res.json();
    return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  } catch (e) { console.log("  (AI error: " + e.message + ")"); return null; }
}
function parseJson(raw) {
  if (!raw) return null;
  try {
    const j = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    return JSON.parse(j);
  } catch { return null; }
}
// Body blocks: [{ h?: string, p: [paragraph, ...] }]
function cleanBody(body) {
  if (!Array.isArray(body)) return [];
  return body.map((b) => ({
    h: typeof b?.h === "string" ? b.h.trim() : "",
    p: (Array.isArray(b?.p) ? b.p : [b?.p]).map((x) => String(x || "").trim()).filter(Boolean),
  })).filter((b) => b.p.length);
}
const MIN_WORDS = Number(CONFIG.minArticleWords || 350);
function words(article) {
  return (article.body || []).reduce((n, b) => n + b.p.join(" ").split(/\s+/).length, 0);
}

async function currentAffairs(existing) {
  const id = `current-affairs-${today()}`;
  if (existing.some((a) => a.id === id)) { console.log("  current affairs for today already exists."); return null; }
  let items = [];
  for (const f of NEWS_FEEDS) {
    items = items.concat(await getFeed(f));
    if (items.length >= 25) break;
  }
  items = items.filter((i) => i.title).slice(0, 20);
  if (items.length < 5) { console.log(`  not enough source headlines (${items.length}) — skipping current affairs.`); return null; }
  console.log(`  ${items.length} source headlines for today's digest`);

  const src = items.map((i, n) => `${n + 1}. ${i.title}${i.summary ? " — " + i.summary : ""}`).join("\n");
  const prompt = `You are writing the daily current affairs digest for an Indian government-exam preparation website. ` +
    `Below are REAL government press-release headlines from today. Use ONLY these — never add events that are not listed, and never invent numbers, names or dates.\n\n` +
    `Return ONLY a JSON object with keys: ` +
    `title (an informative title including today's date, e.g. "Current Affairs ${today()}: Key Government Updates for Exam Aspirants"), ` +
    `summary (2 sentences describing what today's digest covers), ` +
    `body (array of 5-8 blocks; each block is an object with "h" = a short heading naming the topic, and "p" = an array of 1-2 paragraphs explaining that item in plain English and noting why it matters for SSC, UPSC, Banking, Railway or State PSC exams), ` +
    `exam_pointers (array of 3-4 one-line takeaways an aspirant should remember for the exam).\n\n` +
    `Write clearly and factually for a candidate preparing for competitive exams. Total length 500-700 words.\n\nTODAY'S HEADLINES:\n${src}`;

  const obj = parseJson(await askAI(prompt, 3500));
  if (!obj || !obj.title) { console.log("  current affairs generation failed."); return null; }
  const body = cleanBody(obj.body);
  const draft = { body };
  if (body.length < 3 || words(draft) < MIN_WORDS) {
    console.log(`  current affairs below quality bar (${body.length} sections, ${words(draft)} words, need ${MIN_WORDS}) — not published.`);
    return null;
  }
  return {
    id, type: "current-affairs", title: String(obj.title).trim(), date: today(),
    summary: String(obj.summary || "").trim(),
    body,
    pointers: (Array.isArray(obj.exam_pointers) ? obj.exam_pointers : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5),
    sources: items.slice(0, 10).map((i) => ({ title: i.title, link: i.link })).filter((s) => s.link),
  };
}

async function analysis(existing, jobs) {
  const out = [];
  // Notable = newest notifications with a real vacancy count, not already covered.
  const candidates = jobs
    .filter((j) => j && j.id && j.title && Number(j.total_vacancies) > 0)
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .filter((j) => !existing.some((a) => a.job_id === j.id))
    .slice(0, MAX_ANALYSIS);
  for (const job of candidates) {
    const facts = [
      `Title: ${job.title}`, `Organisation: ${job.organization || ""}`,
      `Post: ${job.post_name || ""}`, `Vacancies: ${job.total_vacancies}`,
      `Qualification: ${job.qualification || ""}`, `Location: ${job.location || ""}`,
      `Application start: ${job.application_start || "not stated"}`,
      `Last date: ${job.application_end || "not stated"}`,
      `Exam date: ${job.exam_date || "not stated"}`,
      `Salary: ${job.salary || "not stated"}`,
      `Summary: ${job.summary || ""}`,
    ].join("\n");
    const prompt = `You are writing an explainer article for an Indian government-jobs news site about ONE real recruitment notification. ` +
      `Use ONLY the verified facts below. Never invent vacancy numbers, dates, fees or cut-offs. Where something is "not stated", say that candidates should check the official notification.\n\n` +
      `Return ONLY a JSON object with keys: ` +
      `title (a clear news-style headline about this recruitment, not clickbait), ` +
      `summary (2 sentences), ` +
      `body (array of 4-6 blocks; each block has "h" = section heading and "p" = array of 1-2 paragraphs). Cover: what has been announced, who is eligible and who it suits, how selection works or what candidates should expect, what this means in context for aspirants, and what to do next), ` +
      `exam_pointers (array of 3-4 practical one-line takeaways).\n\n` +
      `Write 450-650 words of useful original analysis in a neutral, informative tone.\n\nVERIFIED FACTS:\n${facts}`;

    const obj = parseJson(await askAI(prompt, 3000));
    if (!obj || !obj.title) { console.log(`  analysis failed for ${job.id}`); continue; }
    const body = cleanBody(obj.body);
    if (body.length < 3 || words({ body }) < MIN_WORDS) {
      console.log(`  analysis below quality bar for ${job.id} (${words({ body })} words, need ${MIN_WORDS}) — not published.`);
      continue;
    }
    const id = safeSlug(`${job.id}-explained`) || `analysis-${Date.now().toString(36)}`;
    if (existing.some((a) => a.id === id)) continue;
    out.push({
      id, type: "analysis", title: String(obj.title).trim(), date: today(),
      summary: String(obj.summary || "").trim(), body,
      pointers: (Array.isArray(obj.exam_pointers) ? obj.exam_pointers : []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5),
      job_id: job.id,
      sources: job.apply_link ? [{ title: `${job.organization || "Official"} — official notification`, link: job.apply_link }] : [],
    });
    console.log(`  + analysis: ${obj.title}`);
  }
  return out;
}

async function main() {
  if (!AI) { console.log("News: no AI key set — skipping (news is never generated without a source-grounded model call)."); return; }
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(NEWS, "utf8")); } catch { existing = []; }
  if (!Array.isArray(existing)) existing = [];
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(JOBS, "utf8")); } catch { jobs = []; }

  console.log(`News: AI ${AI} (${AI === "OpenAI" ? OPENAI_MODEL : ANTHROPIC_MODEL}) | feeds ${NEWS_FEEDS.length} | min words ${MIN_WORDS} | existing ${existing.length}`);
  const fresh = [];
  const ca = await currentAffairs(existing);
  if (ca) { fresh.push(ca); console.log(`  + digest: ${ca.title} (${words(ca)} words)`); }
  fresh.push(...await analysis(existing, jobs));

  if (!fresh.length) { console.log("News: nothing new to publish."); return; }
  const all = [...fresh, ...existing].slice(0, 400);
  fs.writeFileSync(NEWS, JSON.stringify(all, null, 2) + "\n");
  try {
    const urls = fresh.map((a) => `${SITE_URL}/news/${a.id}/`).join("\n") + "\n";
    fs.appendFileSync(NEWURLS, urls);
  } catch { /* non-fatal */ }
  console.log(`News: published ${fresh.length} article(s).`);
}
main();
