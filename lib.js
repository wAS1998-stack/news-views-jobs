/* ==================================================================
   lib.js — shared helpers for the automation scripts (zero deps).
   - full HTML entity decoding (named + numeric)
   - page fetching with a polite retry
   - official-link discovery: find the real government / recruiter URLs
     inside a source article so our pages never send readers back to a
     middleman site
   - one AI helper (OpenAI or Claude) used by every script
   ================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONFIG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")); } catch { return {}; } })();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_ALT = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const HDRS = {
  "user-agent": UA,
  "accept": "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-IN,en;q=0.9,hi;q=0.8",
};

/* ---- text ------------------------------------------------------- */
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", rupee: "₹", copy: "©", reg: "®", trade: "™", bull: "•", middot: "·" };
function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] != null ? NAMED[n.toLowerCase()] : m))
    // second pass: feeds often double-encode ("&amp;#8211;")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] != null ? NAMED[n.toLowerCase()] : m));
}
const stripTags = (s) => decodeEntities(String(s || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Normalise a headline: decode entities, collapse spaces, unify dashes, trim trailing junk. */
function cleanTitle(t) {
  return decodeEntities(t).replace(/\s+/g, " ").replace(/\s*[–—]\s*/g, " – ").replace(/\s*\|\s*.*$/, "").trim();
}

/** Derive a sensible organisation name from a headline when the AI gave none. */
function orgFromTitle(title) {
  let t = cleanTitle(title);
  t = t.split(/\s*[–—:|(]\s*/)[0];
  t = t.replace(/\b(Recruitment|Notification|Vacancy|Vacancies|Jobs?|Bharti|Online Form|Apply Online|Admit Card|Hall Ticket|Result|Results|Answer Key|Merit List|Cut ?Off|Exam Date|Call Letter|Out|Released|Download|Check|Direct Link|20\d{2})\b.*$/i, "").trim();
  t = t.replace(/\b(for|of|the)\s*$/i, "").trim();
  return t.length >= 2 && t.length <= 80 ? t : "";
}

/* ---- fetching --------------------------------------------------- */
/* GitHub Actions runners are often blocked by the bot-protection on the
   source sites, so every fetch has a fallback chain: direct -> alternate UA
   -> public read-through proxies. The diagnostics in data/last-run.json say
   which route worked. */
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];
async function tryFetch(url, headers, ms) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const text = await r.text();
  if (!text || text.length < 200) throw new Error("empty body");
  if (/<title>\s*(Just a moment|Attention Required|Access denied|403 Forbidden)/i.test(text) || /cf-browser-verification|challenge-platform/i.test(text)) throw new Error("bot challenge");
  return { text, type: r.headers.get("content-type") || "", url: r.url || url };
}
async function fetchText(url, ms = 20000, { allowProxy = true } = {}) {
  const errors = [];
  try { return { ...(await tryFetch(url, HDRS, ms)), via: "direct" }; } catch (e) { errors.push("direct: " + e.message); }
  await new Promise((r) => setTimeout(r, 800));
  try { return { ...(await tryFetch(url, { ...HDRS, "user-agent": UA_ALT }, ms)), via: "alt-ua" }; } catch (e) { errors.push("alt-ua: " + e.message); }
  if (allowProxy) {
    for (const p of PROXIES) {
      try { const r = await tryFetch(p(url), { "user-agent": UA, accept: "*/*" }, ms + 10000); return { ...r, url, via: new URL(p(url)).host }; }
      catch (e) { errors.push(new URL(p(url)).host + ": " + e.message); }
    }
  }
  const err = new Error(errors.join(" | ")); err.chain = errors; throw err;
}

/* ---- minimal RSS + Atom parser (zero deps) ---------------------- */
function parseFeed(xml) {
  const items = [];
  const grab = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return m ? decodeEntities(m[1]).trim() : "";
  };
  for (const b of xml.match(/<item[\s\S]*?<\/item>/gi) || []) {
    items.push({
      title: cleanTitle(stripTags(grab(b, "title"))),
      link: grab(b, "link") || (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || ""),
      summary: stripTags(grab(b, "description") || grab(b, "content:encoded")),
      date: grab(b, "pubDate") || grab(b, "dc:date"),
      guid: grab(b, "guid"),
    });
  }
  for (const b of xml.match(/<entry[\s\S]*?<\/entry>/gi) || []) {
    items.push({
      title: cleanTitle(stripTags(grab(b, "title"))),
      link: b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || grab(b, "id"),
      summary: stripTags(grab(b, "summary") || grab(b, "content")),
      date: grab(b, "updated") || grab(b, "published"),
      guid: grab(b, "id"),
    });
  }
  return items.filter((i) => i.title && /^https?:\/\//i.test(i.link));
}
/** Fetch + parse a feed with every fallback, including an RSS-to-JSON bridge. */
async function fetchFeed(url) {
  let via = "", items = [], errs = [];
  try { const r = await fetchText(url, 20000); items = parseFeed(r.text); via = r.via; } catch (e) { errs = e.chain || [e.message]; }
  if (!items.length) {
    try {
      const r = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25000) });
      const j = r.ok ? await r.json() : null;
      if (j && j.status === "ok" && Array.isArray(j.items)) {
        items = j.items.map((i) => ({ title: cleanTitle(stripTags(i.title)), link: i.link, summary: stripTags(i.description || i.content || ""), date: i.pubDate, guid: i.guid }))
          .filter((i) => i.title && /^https?:\/\//i.test(i.link));
        via = "rss2json";
      } else errs.push("rss2json: " + (j ? j.message || j.status : "HTTP " + (r && r.status)));
    } catch (e) { errs.push("rss2json: " + e.message); }
  }
  return { items, via, errors: errs };
}

/** "… at appsc.gov.in" — many headlines name the official site. */
function hostFromTitle(title) {
  const m = String(title || "").match(/\b(?:at|on|from|via|@)\s+((?:[a-z0-9-]+\.)+(?:gov\.in|nic\.in|ac\.in|edu\.in|res\.in|org\.in|co\.in|gov|org|in|com|net))\b/i);
  if (!m) return "";
  const h = m[1].toLowerCase().replace(/^www\./, "");
  return isAggregator(h) || JUNK_HOST.test(h) ? "" : h;
}

/* ---- official-link discovery ------------------------------------ */
/** Hosts that are aggregators / middlemen — never acceptable as an "official" link. */
const AGGREGATOR_HOSTS = (CONFIG.feeds || []).map((f) => { try { return new URL(f).host.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean)
  .concat(["sarkariresult.com", "sarkariresult.com.cm", "freejobalert.com", "jagranjosh.com", "adda247.com", "testbook.com",
    "careerpower.in", "sarkariexam.com", "rojgarresult.com", "sarkarinaukri.com", "indgovtjobs.in", "employmentnews.gov.in",
    "naukri.com", "indeed.com", "linkedin.com", "shine.com", "monsterindia.com", "glassdoor.com"]);
const JUNK_HOST = /(^|\.)(facebook|twitter|x|instagram|youtube|telegram|t|whatsapp|wa|pinterest|linkedin|google|googleapis|gstatic|googletagmanager|doubleclick|blogger|wordpress|wp|gravatar|amazon|flipkart|play|apple|microsoft|bit|tinyurl|cloudflare|jsdelivr|unpkg|cdnjs|feedburner|disqus|sharethis|addthis|reddit|quora|medium)\.(com|net|org|in|me|ly|co|io|app|google)$/i;
const OFFICIAL_TLD = /\.(gov\.in|nic\.in|ac\.in|edu\.in|res\.in|org\.in|co\.in|gov|mil\.in|org|edu|in|com)$/i;
const STRONG_OFFICIAL = /\.(gov\.in|nic\.in|ac\.in|edu\.in|res\.in|mil\.in|gov)$/i;

function isAggregator(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  return AGGREGATOR_HOSTS.some((a) => h === a || h.endsWith("." + a));
}
function hostOf(u) { try { return new URL(u).host.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }

/**
 * Pull every outbound link from an article page and keep the plausibly-official
 * ones: not the source site itself, not social/ads/CDN, not another aggregator.
 * Returns [{url, text, host, pdf, score}] sorted best-first (max 25).
 */
function extractOfficialLinks(html, pageUrl) {
  const self = hostOf(pageUrl);
  const seen = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(href)) { try { href = new URL(href, pageUrl).href; } catch { continue; } }
    const host = hostOf(href);
    if (!host || host === self || host.endsWith("." + self) || self.endsWith("." + host)) continue;
    if (JUNK_HOST.test(host) || isAggregator(host)) continue;
    if (!OFFICIAL_TLD.test(host)) continue;
    const text = stripTags(m[2]).slice(0, 80);
    const pdf = /\.pdf(\?|$)/i.test(href);
    let score = 0;
    if (STRONG_OFFICIAL.test(host)) score += 5;
    if (/\.(org\.in|co\.in|res\.in)$/i.test(host)) score += 2;
    if (pdf) score += 3;
    if (/apply|registration|register|login|online form|official website|notification|download|result|admit card|hall ticket|answer key|click here/i.test(text)) score += 2;
    if (/apply|register|recruit|career|notification|result|admit|hall|answer|login|candidate|onlineapp|cdac/i.test(href)) score += 2;
    if (/\.(jpg|jpeg|png|gif|webp|svg|css|js)(\?|$)/i.test(href)) continue;
    const key = href.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (!seen.has(key) || seen.get(key).score < score) seen.set(key, { url: href, text, host, pdf, score });
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 25);
}

/** Pick apply / notification / website links by heuristic (no AI). */
function pickLinksHeuristic(cands) {
  const notif = cands.find((c) => c.pdf) || null;
  const apply = cands.find((c) => !c.pdf && /apply|regist|login|online|candidate|onlineapp|cdac/i.test(c.url + " " + c.text))
    || cands.find((c) => !c.pdf && STRONG_OFFICIAL.test(c.host)) || cands.find((c) => !c.pdf) || null;
  const site = (apply || notif) ? `https://${(apply || notif).host}/` : null;
  return { apply_link: apply ? apply.url : null, official_notification: notif ? notif.url : null, official_website: site };
}

/* ---- AI ---------------------------------------------------------- */
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || CONFIG.aiModel || "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const AI = OPENAI_KEY ? "OpenAI" : (ANTHROPIC_KEY ? "Claude" : "");
const AI_LABEL = AI ? `${AI} (${AI === "OpenAI" ? OPENAI_MODEL : ANTHROPIC_MODEL})` : "off";

async function askAI(prompt, { maxTokens = 3000, attempt = 1 } = {}) {
  if (!AI) return null;
  try {
    if (AI === "OpenAI") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) {
        if (attempt < 2 && res.status !== 401 && res.status !== 400) { await new Promise((r) => setTimeout(r, 2500)); return askAI(prompt, { maxTokens, attempt: attempt + 1 }); }
        console.log(`  (OpenAI HTTP ${res.status})`); return null;
      }
      const d = await res.json();
      return d.choices?.[0]?.message?.content || "";
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) { console.log(`  (Claude HTTP ${res.status})`); return null; }
    const d = await res.json();
    return (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  } catch (e) { console.log("  (AI error: " + e.message + ")"); return null; }
}
function parseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return null; }
}
const strArr = (x, n) => (Array.isArray(x) ? x : []).map((v) => String(v || "").trim()).filter(Boolean).slice(0, n);
const faqArr = (x, n = 6) => (Array.isArray(x) ? x : [])
  .map((f) => ({ q: String(f?.q || f?.question || "").trim(), a: String(f?.a || f?.answer || "").trim() }))
  .filter((f) => f.q && f.a).slice(0, n);

/**
 * Validate AI-chosen links: each must be one of the candidates we actually saw on
 * the page (prevents hallucinated URLs) and must not be an aggregator.
 */
function validateLinks(picked, cands) {
  const ok = (u) => {
    if (!u || typeof u !== "string") return null;
    const key = u.replace(/[?#].*$/, "").replace(/\/$/, "");
    const hit = cands.find((c) => c.url.replace(/[?#].*$/, "").replace(/\/$/, "") === key);
    return hit && !isAggregator(hit.host) ? hit.url : null;
  };
  const out = { apply_link: ok(picked?.apply_link), official_notification: ok(picked?.official_notification), official_website: null };
  const w = picked?.official_website;
  if (w && typeof w === "string") {
    const h = hostOf(w);
    if (h && !isAggregator(h) && (cands.some((c) => c.host === h) || STRONG_OFFICIAL.test(h))) out.official_website = `https://${h}/`;
  }
  if (!out.official_website && (out.apply_link || out.official_notification)) out.official_website = `https://${hostOf(out.apply_link || out.official_notification)}/`;
  return out;
}

/* ---- run summary (so a human — or a future bot run — can see what happened) */
const RUNLOG = path.join(ROOT, "data", "last-run.json");
function logRun(section, info) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(RUNLOG, "utf8")); } catch {}
  if (!cur.runs || cur.date !== new Date().toISOString().slice(0, 10)) cur = { date: new Date().toISOString().slice(0, 10), runs: {} };
  cur[section] = { at: new Date().toISOString(), ...info };
  cur.note = "Written by the automation after each step so run health can be checked without opening Actions logs.";
  fs.writeFileSync(RUNLOG, JSON.stringify(cur, null, 2) + "\n");
}

/** Headlines that are not real recruitments / updates (newspaper PDF dumps, roundups, ads). */
const JUNK_TITLE = /assignment abroad times|employment news(paper)? (pdf|this week)|rojgar samachar pdf|gulf times pdf|walk-?in (interview )?today|daily (job )?(update|digest)|top \d+ jobs|jobs? (alert|digest) (today|this week)|weekly (jobs?|round-?up)|latest jobs? (today|list)|\bpdf today\b|newspaper pdf/i;

module.exports = { CONFIG, ROOT, UA, HDRS, decodeEntities, stripTags, cleanTitle, orgFromTitle, fetchText, parseFeed, fetchFeed, hostOf, isAggregator,
  extractOfficialLinks, pickLinksHeuristic, validateLinks, hostFromTitle, AI, AI_LABEL, askAI, parseJson, strArr, faqArr, logRun, JUNK_TITLE, STRONG_OFFICIAL };
