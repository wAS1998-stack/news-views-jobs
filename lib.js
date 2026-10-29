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


/* ---- incomplete certificate chains ---------------------------------------
   Several government servers (IBPS, BPSC, state boards) send only their own
   certificate and omit the intermediate. Browsers fetch the missing intermediate
   from the "CA Issuers" address inside the certificate (AIA); Node does not.
   This does the same: read the server's certificate (nothing is sent or trusted),
   download the issuer certificate(s), then make a FULLY VERIFIED request with
   them added to the trust chain. Verification is never switched off for content. */
const AIA_CACHE = new Map();
function getRaw(url, ms = 15000) {
  return new Promise((res, rej) => {
    const mod = url.startsWith("https:") ? require("https") : require("http");
    const req = mod.get(url, { timeout: ms }, (r) => { const b = []; r.on("data", (c) => b.push(c)); r.on("end", () => res(Buffer.concat(b))); });
    req.on("error", rej); req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}
function derToPem(der) { return "-----BEGIN CERTIFICATE-----\n" + der.toString("base64").match(/.{1,64}/g).join("\n") + "\n-----END CERTIFICATE-----\n"; }
function issuerUrl(x509) { const m = String(x509.infoAccess || "").match(/CA Issuers - URI:(\S+)/); return m ? m[1] : null; }
async function intermediatesFor(host, port = 443) {
  const ck = host + ":" + port;
  if (AIA_CACHE.has(ck)) return AIA_CACHE.get(ck);
  const crypto = require("crypto"), tls = require("tls");
  const leafDer = await new Promise((res, rej) => {
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 15000 }, () => { const c = s.getPeerCertificate(false); s.end(); res(c && c.raw); });
    s.on("error", rej); s.on("timeout", () => s.destroy(new Error("timeout")));
  });
  const pems = [];
  let cert = new crypto.X509Certificate(leafDer);
  for (let i = 0; i < 3; i++) {
    const u = issuerUrl(cert); if (!u) break;
    let der = await getRaw(u);
    if (/^-----BEGIN/.test(der.toString("latin1", 0, 11))) { pems.push(der.toString()); cert = new crypto.X509Certificate(der); }
    else { try { cert = new crypto.X509Certificate(der); } catch { break; } pems.push(derToPem(der)); }
    if (cert.issuer === cert.subject) break;   // reached a root
  }
  AIA_CACHE.set(ck, pems);
  return pems;
}
async function fetchWithAIA(url, ms = 20000, redirects = 3) {
  const tls = require("tls"), https = require("https"), fs = require("fs");
  const u = new URL(url);
  const extra = process.env.NODE_EXTRA_CA_CERTS && fs.existsSync(process.env.NODE_EXTRA_CA_CERTS) ? [fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, "utf8")] : [];
  const ca = [...tls.rootCertificates, ...extra, ...(await intermediatesFor(u.hostname, Number(u.port) || 443))];
  return new Promise((res, rej) => {
    const req = https.get(url, { ca, servername: u.hostname, headers: HDRS, timeout: ms }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) { r.resume(); return res(fetchWithAIA(new URL(r.headers.location, url).href, ms, redirects - 1)); }
      if (r.statusCode >= 400) { r.resume(); return rej(new Error("HTTP " + r.statusCode)); }
      const b = []; r.on("data", (c) => b.push(c)); r.on("end", () => res({ buffer: Buffer.concat(b), type: r.headers["content-type"] || "", url }));
    });
    req.on("error", rej); req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}
const CHAIN_ERR = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|unable to verify the first certificate/i;

/* ---- fetching --------------------------------------------------- */
/* GitHub Actions runners are often blocked by the bot-protection on the
   source sites, so every fetch has a fallback chain: direct -> alternate UA
   -> public read-through proxies. The diagnostics in data/last-run.json say
   which route worked. */
const PROXIES = [
  // The site's own relay (functions/api/relay.js on Cloudflare, government hosts only). Tested 29 Oct: it reads 5
  // official sites the runners cannot (certificate-chain errors, a 403, a timeout) but, running in US data centres,
  // not the ones that block every foreign address.
  (u) => `${(CONFIG.url || "https://news-views.in").replace(/\/$/, "")}/api/relay?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];
async function tryFetch(url, headers, ms) {
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), redirect: "follow" }); }
  catch (e) { const c = e.cause && (e.cause.code || e.cause.message); throw new Error(c ? `${e.message} (${c})` : e.message); }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const text = await r.text();
  if (!text || text.length < 200) throw new Error("empty body");
  if (/<title>\s*(Just a moment|Attention Required|Access denied|403 Forbidden)/i.test(text) || /cf-browser-verification|challenge-platform/i.test(text)) throw new Error("bot challenge");
  return { text, type: r.headers.get("content-type") || "", url: r.url || url };
}
async function fetchText(url, ms = 20000, { allowProxy = true, skipDirect = false, proxyMs } = {}) {
  const errors = [];
  if (!skipDirect) {
    try { return { ...(await tryFetch(url, HDRS, ms)), via: "direct" }; } catch (e) { errors.push("direct: " + e.message); }
    if (CHAIN_ERR.test(errors[0])) {
      try { const r = await fetchWithAIA(url, ms); const text = r.buffer.toString("utf8"); if (text.length > 200) return { text, type: r.type, url: r.url, via: "direct+aia" }; }
      catch (e) { errors.push("aia: " + e.message); }
    }
    // A connect timeout means the host drops our network (geo-block) — a second UA won't help.
    if (!/timeout|aborted/i.test(errors[0])) {
      await new Promise((r) => setTimeout(r, 800));
      try { return { ...(await tryFetch(url, { ...HDRS, "user-agent": UA_ALT }, ms)), via: "alt-ua" }; } catch (e) { errors.push("alt-ua: " + e.message); }
    }
  }
  if (allowProxy) {
    for (const p of PROXIES) {
      try { const r = await tryFetch(p(url), { "user-agent": UA, accept: "*/*" }, proxyMs || ms + 10000); return { ...r, url, via: new URL(p(url)).host }; }
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
      html: (grab(b, "content:encoded") || grab(b, "description")).replace(/^<!\[CDATA\[|\]\]>$/g, "").slice(0, 60000),
      date: grab(b, "pubDate") || grab(b, "dc:date"),
      guid: grab(b, "guid"),
    });
  }
  for (const b of xml.match(/<entry[\s\S]*?<\/entry>/gi) || []) {
    items.push({
      title: cleanTitle(stripTags(grab(b, "title"))),
      link: b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || grab(b, "id"),
      summary: stripTags(grab(b, "summary") || grab(b, "content")),
      html: (grab(b, "content") || grab(b, "summary")).slice(0, 60000),
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
    "jobsearchindia.org", "naukri.com", "indeed.com", "linkedin.com", "shine.com", "monsterindia.com", "glassdoor.com"]);
const JUNK_HOST = /(^|\.)(facebook|twitter|x|instagram|youtube|telegram|t|whatsapp|wa|pinterest|linkedin|google|googleapis|gstatic|googletagmanager|doubleclick|blogger|wordpress|wp|gravatar|amazon|flipkart|play|apple|microsoft|bit|tinyurl|cloudflare|jsdelivr|unpkg|cdnjs|feedburner|disqus|sharethis|addthis|reddit|quora|medium)\.(com|net|org|in|me|ly|co|io|app|google)$/i;
const SHARE_HOST = /(^|\.)(addtoany|sharethis|addthis|shareaholic|api\.whatsapp|web\.whatsapp|telegram|t\.me|bit\.ly|tinyurl|goo\.gl|cutt\.ly|rb\.gy|shorturl|is\.gd|ow\.ly|buff\.ly|dlvr\.it|feedburner|translate\.google|webcache|archive\.org|web\.archive\.org|wa\.me|m\.me|pinterest|reddit|tumblr|flipboard|mix\.com|digg|vk\.com|ok\.ru|line\.me|snapchat|threads\.net|mastodon)(\.[a-z.]+)?$/i;
const OFFICIAL_TLD = /\.(gov\.in|nic\.in|ac\.in|edu\.in|res\.in|org\.in|co\.in|gov|mil\.in|org|edu|in|com)$/i;
const STRONG_OFFICIAL = /\.(gov\.in|nic\.in|ac\.in|edu\.in|res\.in|mil\.in|gov)$/i;

function isBadOfficial(u) {
  const h = hostOf(u);
  return !h || isAggregator(h) || JUNK_HOST.test(h) || SHARE_HOST.test(h) || /[?&](url|u|linkurl|link|redirect|redir|target|dest|q)=https?/i.test(u);
}
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
function articleRegion(html) {
  // Keep only the article body: drop header/nav before the headline and sidebar/footer/related after it.
  let h = String(html || "");
  const start = Math.max(h.search(/<article\b/i), h.search(/<h1\b/i), h.search(/class="[^"]*entry-content[^"]*"/i));
  if (start > 0) h = h.slice(start);
  const endMarks = [/<\/article>/i, /<aside\b/i, /class="[^"]*(sidebar|widget-area|related-posts|post-navigation|comments-area|site-footer)[^"]*"/i, /<footer\b/i, /id="(comments|sidebar|secondary|footer)"/i];
  let end = h.length;
  for (const re of endMarks) { const i = h.search(re); if (i > 2000 && i < end) end = i; }
  return h.slice(0, end);
}
function extractOfficialLinks(html, pageUrl) {
  const self = hostOf(pageUrl);
  html = articleRegion(html);
  const seen = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(href)) { try { href = new URL(href, pageUrl).href; } catch { continue; } }
    const host = hostOf(href);
    if (!host || host === self || host.endsWith("." + self) || self.endsWith("." + host)) continue;
    if (JUNK_HOST.test(host) || isAggregator(host) || SHARE_HOST.test(host)) continue;
    if (/[?&](url|u|linkurl|link|redirect|redir|target|dest|q)=https?/i.test(href) || /https?:\/\/[^/]+\/.*https?(%3A|:)/i.test(href)) continue;
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

/** Does the host plausibly belong to the body named in the title/org? (soft check) */
function hostMatches(host, ...names) {
  const h = String(host || "").toLowerCase();
  const toks = new Set();
  for (const n of names) for (const w of String(n || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) if (w.length >= 3 && !/^(the|and|for|of|recruitment|notification|apply|online|posts?|jobs?|vacanc|govt|government|india|indian|limited|ltd|corporation|board|commission|department|university|institute|national|state|central|bank|public|service|services)$/.test(w)) toks.add(w);
  for (const t of toks) if (h.includes(t)) return true;
  // common abbreviation: initials of the organisation name
  const initials = String(names[0] || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(and|of|the|for)$/.test(w)).map((w) => w[0]).join("");
  if (initials.length >= 3 && h.includes(initials)) return true;
  return false;
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

/* ---- AI cost meter: every call's token usage is added to data/ai-usage.json (per IST day, last 60 days) when the
   process exits, so the real daily cost is known instead of guessed. Prices are USD per 1M tokens. */
const AI_PRICES = { "gpt-4o-mini": [0.15, 0.60], "claude-haiku-4-5-20251001": [1.00, 5.00] };
const USAGE = { calls: 0, in: 0, out: 0 };
process.on("exit", () => {
  if (!USAGE.calls) return;
  try {
    const file = path.join(ROOT, "data", "ai-usage.json");
    let u = {}; try { u = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    const model = AI === "OpenAI" ? OPENAI_MODEL : ANTHROPIC_MODEL;
    const [pi, po] = (CONFIG.aiPricePerM && [CONFIG.aiPricePerM.in, CONFIG.aiPricePerM.out]) || AI_PRICES[model] || [0.15, 0.60];
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    u.model = model; u.pricePerMillion = { in: pi, out: po }; u.days = u.days || {};
    const d = u.days[day] || { calls: 0, in: 0, out: 0 };
    d.calls += USAGE.calls; d.in += USAGE.in; d.out += USAGE.out;
    d.usd = +((d.in * pi + d.out * po) / 1e6).toFixed(4);
    u.days[day] = d;
    for (const k of Object.keys(u.days).sort().slice(0, -60)) delete u.days[k];
    u.note = "Token usage of the site automation's AI calls, per day (IST). usd = estimated cost at pricePerMillion.";
    fs.writeFileSync(file, JSON.stringify(u, null, 1) + "\n");
  } catch { /* metering must never break a run */ }
});
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
      USAGE.calls++; USAGE.in += (d.usage && d.usage.prompt_tokens) || 0; USAGE.out += (d.usage && d.usage.completion_tokens) || 0;
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
    USAGE.calls++; USAGE.in += (d.usage && d.usage.input_tokens) || 0; USAGE.out += (d.usage && d.usage.output_tokens) || 0;
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

/* ---- capture console output so the run log can include the tail of it ---- */
const LOG_LINES = [];
{ const orig = console.log.bind(console); console.log = (...a) => { const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "); LOG_LINES.push(line.slice(0, 300)); if (LOG_LINES.length > 400) LOG_LINES.shift(); orig(...a); }; }
function logTail(n = 25) { return LOG_LINES.slice(-n); }

/* ---- run summary (so a human — or a future bot run — can see what happened) */
const RUNLOG = path.join(ROOT, "data", "last-run.json");
function logRun(section, info) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(RUNLOG, "utf8")); } catch {}
  if (!cur.runs || cur.date !== new Date().toISOString().slice(0, 10)) cur = { date: new Date().toISOString().slice(0, 10), runs: {} };
  cur[section] = { at: new Date().toISOString(), ...info, log: logTail(info && info.logLines || 25) };
  delete cur[section].logLines;
  cur.note = "Written by the automation after each step so run health can be checked without opening Actions logs.";
  fs.writeFileSync(RUNLOG, JSON.stringify(cur, null, 2) + "\n");
}

/** Not government-job content at all: syllabus/exam-pattern explainers, admissions & counselling, university semester results. */
const OFF_TOPIC = /\bsyllabus\b|exam pattern|seat matrix|choice (filling|locking)|counsel+ing|\badmission\b|\bmerit list for admission\b|re-?valuation|\btime ?table\b|\bdate ?sheet\b|\b(sem(ester)?|b\.?tech|m\.?tech|b\.?sc|m\.?sc|b\.?com|m\.?com|bams|bhms|mbbs|bds|bpt|b\.?ed|ph\.?d|llb|bca|mca|ug|pg|\d(st|nd|rd|th) prof(essional)?|professional)\b[^–—:]*\bresult\b|\bresult\b[^–—:]*\b(sem(ester)?|ug and pg|ug & pg|ph\.?d|mbbs|bams|b\.?sc|m\.?sc)\b|\b(university|vishwavidyalaya)\b[^–—:]*\bresult\b|\bresult\b[^–—:]*\b(b\.e|b\.?pharm|m\.?pharm|bph|diploma|b\.?a\.?|m\.?a\.?|bba|mba|ug|pg)\b(?![^–—:]*\b(post|recruitment|vacanc|clerk|teacher|assistant|officer)\w*)|\b(gtu|aktu|rgpv|vtu|ccsu|ignou|rtmnu|sppu|cbse|icse)\b[^–—:]*\bresult\b|\btime-table\b|\bmarks memo\b|\bph\.?d fellowship\b|\bcurrent affairs\b|\bjee main|\bnift\b(?![^–—:]*\b(recruitment|vacanc|posts?)\b)|\bneet\b(?![^–—:]*\b(recruitment|vacanc|posts?)\b)/i;

/** Headlines that are not real recruitments / updates (newspaper PDF dumps, roundups, ads). */
const JUNK_TITLE = /assignment abroad times|employment news(paper)? (pdf|this week)|rojgar samachar pdf|gulf times pdf|walk-?in (interview )?today|daily (job )?(update|digest)|top \d+ jobs|jobs? (alert|digest) (today|this week)|weekly (jobs?|round-?up)|latest jobs? (today|list)|\bpdf today\b|newspaper pdf|latest (govt|government|sarkari) jobs? (on|for|of) \d|\b\d[\d,]*\+? (all india )?vacancies open\b|government jobs on \d{1,2}(st|nd|rd|th)? \w+ 20\d\d|\(\d[\d,]*\+ [^)]*vacanc|\b\d[\d,]*\+ vacancies\b|closing govt jobs|free ?job ?alert|latest (\w+ )?(vacancy )?notifications\s*$|^latest\b[^–—:]*\b(govt|government|sarkari|railway|bank)\b[^–—:]*\bjobs\b|^[\w&.,' -]{0,30}\bgovt jobs 20\d\d\b|\b(govt|government) jobs for (diploma|engineers|graduates|10th|12th|iti|women|females?)\b/i;

/** Evergreen listicles, not a notification ("Latest High Court Jobs 2026 – Court Vacancies in India",
 *  "Government Jobs Without Exam", "Earn Money Online…"). Only rejected when the title names no post count. */
const GENERIC_LIST = /\blatest\b.*\b(jobs?|vacancies)\b|\bjobs? without exam\b|\bjob opportunities in\b|\bearn money\b|\bwork from home\b|\b(govt|government|sarkari) jobs list\b/i;
// Evergreen explainers ("NABARD Grade A Eligibility Criteria 2026 - Check Age Limit…") are articles, not notifications.
const EVERGREEN = /\b(eligibility criteria|syllabus|exam pattern|salary (structure|details|slip)|previous year (question )?papers?|preparation (tips|strategy)|how to prepare|books? list|selection process explained)\b/i;
const isGenericList = (title) => {
  const t = String(title || "");
  const counted = /\b\d[\d,]*\+?\s*(posts?|vacanc\w*|seats?|openings?)\b/i.test(t);
  if (GENERIC_LIST.test(t) && !counted) return true;
  return EVERGREEN.test(t) && !counted && !/recruit|vacanc|apply|online form|notification|bharti|भर्ती|walk[- ]?in/i.test(t);
};

/** Same announcement from two feeds ("HPSC HCS Final Result 2026 Out - Check…" vs
 *  "HPSC HCS and Allied Services Final Result 2026"): compare the subject words before the
 *  event keyword, plus the event itself (final result ≠ pre result ≠ exam city). */
const EVENT_RE = /\b((?:final|pre|prelims?|mains?|revised|provisional|phase[- ]?\w+|tier[- ]?\w+|cbt[- ]?\w+)\s+)?(result|admit card|hall ticket|call letter|answer key|exam city|exam date|exam schedule|interview|merit list|cut[- ]?off|score ?card|marks|document verification)\b/i;
const CORE_STOP = new Set("the a an and of for to in on at out released release declared check download link online pdf new notice details date 2024 2025 2026 2027 exam recruitment posts post various".split(" "));
function updateKey(title) {
  const t = String(title || "").toLowerCase().replace(/[–—]/g, "-");
  const m = t.match(EVENT_RE);
  if (!m) return null;
  const words = t.slice(0, m.index + (m[1] || "").length).replace(/[^a-z0-9/ ]/g, " ").split(/\s+/).filter(Boolean);
  const stages = [], core = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^(final|pre|prelims?|mains?|revised|provisional)$/.test(w)) stages.push(w.replace(/s$/, "").replace(/^prelim$/, "pre"));
    else if (/^(phase|tier|cbt|stage|round)$/.test(w) && words[i + 1]) stages.push(w + words[++i]);
    else if (!CORE_STOP.has(w)) core.push(w);
  }
  return { core, ev: [...new Set(stages)].sort().join("+") + "|" + m[2].replace(/hall ticket|call letter/, "admit card") };
}
function isDupUpdate(u, list, days = 7) {
  const a = updateKey(u.title);
  if (!a || a.core.length < 2) return false;
  const t = new Date(u.date || Date.now()).getTime();
  return list.some((x) => {
    if (x === u || x.id === u.id) return false;
    if (Math.abs(new Date(x.date || 0).getTime() - t) > days * 86400000) return false;
    const b = updateKey(x.title);
    if (!b || b.core.length < 2 || b.ev !== a.ev) return false;
    const [s, l] = a.core.length <= b.core.length ? [a.core, b.core] : [b.core, a.core];
    return s.every((w) => l.includes(w));
  });
}

/** Official homepage for a well-known recruiting body named in a title — used only when no
 *  official link could be read from the source page, so the button never points at a blog. */
const OFFICIAL_HOMES = [
  [/\bupsssc\b/i, "https://upsssc.gov.in/"], [/\buksssc\b/i, "https://sssc.uk.gov.in/"], [/\bdsssb\b/i, "https://dsssb.delhi.gov.in/"],
  [/\bupsc\b/i, "https://upsc.gov.in/"], [/\bssc\b(?!.*\b(board|class|10th|12th)\b)/i, "https://ssc.gov.in/"], [/\bibps\b/i, "https://www.ibps.in/"],
  [/\brrb\b/i, "https://www.rrbapply.gov.in/"], [/\bsbi\b/i, "https://sbi.co.in/web/careers/"], [/\brbi\b/i, "https://opportunities.rbi.org.in/Scripts/Vacancies.aspx"],
  [/\buppsc\b/i, "https://uppsc.up.nic.in/"], [/\bbpsc\b/i, "https://bpsc.bihar.gov.in/"], [/\brpsc\b/i, "https://rpsc.rajasthan.gov.in/"],
  [/\bmppsc\b/i, "https://mppsc.mp.gov.in/"], [/\bhpsc\b/i, "https://hpsc.gov.in/"], [/\bhssc\b/i, "https://hssc.gov.in/"],
  [/\bbssc\b/i, "https://bssc.bihar.gov.in/"], [/\bjssc\b/i, "https://jssc.jharkhand.gov.in/"], [/\bgsssb\b/i, "https://gsssb.gujarat.gov.in/"],
  [/\bcsbc\b/i, "https://csbc.bihar.gov.in/"], [/\bbpssc\b/i, "https://bpssc.bihar.gov.in/"], [/\bkvs\b/i, "https://kvsangathan.nic.in/"],
  [/\bctet\b/i, "https://ctet.nic.in/"], [/\btnpsc\b/i, "https://www.tnpsc.gov.in/"], [/\bmpsc\b/i, "https://mpsc.gov.in/"],
  [/\bupessc\b/i, "https://upessc.up.gov.in/"], [/\b(mpesb|mp ?esb)\b/i, "https://esb.mp.gov.in/"], [/\bnta\b/i, "https://nta.ac.in/"],
  [/\bsupreme court\b|\bsci court\b/i, "https://www.sci.gov.in/"], [/\bisro\b/i, "https://www.isro.gov.in/"], [/\baai\b/i, "https://www.aai.aero/"],
  [/\bassam rifles\b/i, "https://www.assamrifles.gov.in/"], [/\bindian army\b/i, "https://joinindianarmy.nic.in/"], [/\bbsf\b/i, "https://rectt.bsf.gov.in/"],
  [/\bup police\b|\buppbpb\b|\buprpb\b/i, "https://uppbpb.gov.in/"], [/\bssb\b/i, "https://ssbrectt.gov.in/"], [/\buiic\b|\buiicl\b/i, "https://uiic.co.in/"],
  [/\bcanara bank\b/i, "https://canarabank.bank.in/"], [/\bcci\b.*\bcotton\b|\bcotcorp\b|\bcotton corporation\b/i, "https://cotcorp.org.in/"],
  [/\bmp police\b|\bmadhya pradesh police\b/i, "https://esb.mp.gov.in/"], [/\bbank of baroda\b|\bbob\b/i, "https://www.bankofbaroda.in/career"],
  [/\bindian overseas bank\b|\biob\b/i, "https://www.iob.in/"], [/\bnicl\b|\bnational insurance\b/i, "https://nationalinsurance.nic.co.in/"],
  [/\buco bank\b/i, "https://www.ucobank.com/"], [/\bntpc\b/i, "https://careers.ntpc.co.in/"], [/\bnhb\b|\bnational housing bank\b/i, "https://www.nhb.org.in/"],
  [/\bdgqa\b/i, "https://www.dgqadefence.gov.in/"], [/\bup anganwadi\b|\bbal vikas\b/i, "https://balvikasup.gov.in/"], [/\bsouth indian bank\b/i, "https://www.southindianbank.com/"],
  [/\bupcisb\b|\bup cooperative\b/i, "https://upsevamandal.org/"], [/\bbihar stet\b/i, "https://bsebstet.org/"], [/\becce educator\b/i, "https://basiceducation.up.gov.in/"],
];
function officialHomeFor(title) {
  for (const [re, url] of OFFICIAL_HOMES) if (re.test(String(title || ""))) return url;
  return null;
}

module.exports = { isGenericList, GENERIC_LIST, fetchWithAIA, CHAIN_ERR, CONFIG, ROOT, UA, HDRS, decodeEntities, stripTags, cleanTitle, orgFromTitle, fetchText, parseFeed, fetchFeed, hostOf, isAggregator,
  extractOfficialLinks, pickLinksHeuristic, validateLinks, hostFromTitle, isBadOfficial, hostMatches, articleRegion, AI, AI_LABEL, askAI, parseJson, strArr, faqArr, logRun, logTail, OFF_TOPIC, JUNK_TITLE, STRONG_OFFICIAL, updateKey, isDupUpdate, officialHomeFor };
