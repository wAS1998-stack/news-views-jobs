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
// a malformed numeric entity (&#9999999;) must not throw and lose every item of a feed
const cp = (n, m) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m);
function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => cp(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => cp(parseInt(d, 10), m))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] != null ? NAMED[n.toLowerCase()] : m))
    // second pass: feeds often double-encode ("&amp;#8211;")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => cp(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => cp(parseInt(d, 10), m))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED[n.toLowerCase()] != null ? NAMED[n.toLowerCase()] : m));
}
// Cloudflare hides e-mail addresses on many official sites: the page text says "[email protected]" and the real
// address sits in data-cfemail (hex, each byte XOR the first). Decode it before the tags go, so the address survives.
function cfEmail(hex) {
  try { const k = parseInt(hex.slice(0, 2), 16); let e = "";
    for (let i = 2; i + 1 < hex.length; i += 2) e += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
    return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e) ? e : ""; } catch { return ""; }
}
const unhideEmails = (h) => String(h || "")
  .replace(/<(a|span)\b[^>]*\bdata-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/\1>/gi, (m, t, hex) => cfEmail(hex) || m)
  .replace(/href="\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"/gi, (m, hex) => { const e = cfEmail(hex); return e ? `href="mailto:${e}"` : m; });
const stripTags = (s) => decodeEntities(unhideEmails(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// Text saved before that fix still says "[email protected]": say where the address really is instead.
const HIDDEN_EMAIL = /\[\s*email(?:&#160;|&nbsp;|\u00a0|\s)+protected\s*\]/gi;
const fixHiddenEmail = (s) => typeof s === "string" && /\[\s*email(?:&#160;|&nbsp;|\u00a0|\s)+protected\s*\]/i.test(s)
  ? s.replace(HIDDEN_EMAIL, /[\u0900-\u097F]/.test(s) ? "आधिकारिक नोटिस में दिए गए ईमेल पते" : "the e-mail address given in the official notice") : s;
const deepFixEmail = (v) => typeof v === "string" ? fixHiddenEmail(v) : Array.isArray(v) ? v.map(deepFixEmail)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepFixEmail(x)])) : v;

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
// An optional relay on a server in India (tools-dev/india-relay.js, same ?url= interface and allow-list as the site's
// relay): set INDIA_RELAY_URL (a GitHub secret / env) or config.json "indiaRelayUrl", e.g. "http://203.0.113.5:8787/relay".
// When set it is tried first, because many state sites refuse every foreign address, Cloudflare's US data centres included.
const INDIA_RELAY = String(process.env.INDIA_RELAY_URL || CONFIG.indiaRelayUrl || "").trim();
const PROXIES = [
  ...(/^https?:\/\//i.test(INDIA_RELAY) ? [(u) => `${INDIA_RELAY}${INDIA_RELAY.includes("?") ? "&" : "?"}url=${encodeURIComponent(u)}`] : []),
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
  // the relays serve pages as inert text/plain and pass the real type in x-relay-content-type
  return { text, type: r.headers.get("x-relay-content-type") || r.headers.get("content-type") || "", url: r.headers.get("x-relay-final-url") || r.url || url };
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
  if (!USAGE.calls && !USAGE_FB.calls) return;
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
    if (USAGE_FB.calls) {   // calls answered by the second provider while the first one refused (its own, higher price)
      const [fi, fo] = AI_PRICES[ANTHROPIC_MODEL] || [1.00, 5.00];
      const f = d.fallback || { model: ANTHROPIC_MODEL, calls: 0, in: 0, out: 0 };
      f.calls += USAGE_FB.calls; f.in += USAGE_FB.in; f.out += USAGE_FB.out; f.usd = +((f.in * fi + f.out * fo) / 1e6).toFixed(4);
      d.fallback = f;
    }
    u.days[day] = d;
    for (const k of Object.keys(u.days).sort().slice(0, -60)) delete u.days[k];
    u.note = "Token usage of the site automation's AI calls, per day (IST). usd = estimated cost at pricePerMillion.";
    fs.writeFileSync(file, JSON.stringify(u, null, 1) + "\n");
  } catch { /* metering must never break a run */ }
});
/* ---- AI health: why a call failed, and when to stop asking ----
   The provider's answer to a failed call says what is wrong ("insufficient_quota": the account has no credit left;
   "rate_limit_exceeded": too many requests this minute; "invalid_api_key"). It is logged with the status, kept for the
   run summary (data/last-run.json → aiStatus) and decides what happens next:
   - no credit / bad key: asking again cannot work — the provider is "down" for the rest of this process, later calls
     return at once (no waiting, no log noise), and callers keep their work for a later run (aiDown());
   - a rate limit: wait as long as the provider says (at most 20 s) and try again, twice;
   - a server error: one more try.
   Calls marked essential (reading the facts of a new notice) go to the second provider when the first one is down and
   both keys are set (config "aiFallback": false switches that off): a job page without dates is worse than a dearer call. */
const AI_HEALTH = { ok: 0, failed: 0, down: "", last: "", fallback: 0, streak: 0 };
const USAGE_FB = { calls: 0, in: 0, out: 0 };
// what a provider calls "this account cannot be used now": OpenAI insufficient_quota / credit_balance_exhausted /
// billing_hard_limit_reached / account_deactivated / invalid_api_key, Anthropic authentication_error / permission_error
// (and its "credit balance is too low" message, which errorCode() turns into no_credit)
const QUOTA_CODES = /insufficient_quota|credit|balance|exhausted|billing|deactivated|invalid_api_key|authentication|permission/i;
const aiDown = () => AI_HEALTH.down;
/** One line for the run summary: "ok (12 calls)" | "OpenAI refused: insufficient_quota (0 ok, 3 failed)". */
function aiStatus() {
  if (!AI) return "off";
  const n = `${AI_HEALTH.ok} ok, ${AI_HEALTH.failed} failed${AI_HEALTH.fallback ? `, ${AI_HEALTH.fallback} answered by the second provider` : ""}`;
  if (AI_HEALTH.down) return `${AI} refused: ${AI_HEALTH.down} (${n})`;
  return AI_HEALTH.failed ? `${AI} partly failing: ${AI_HEALTH.last} (${n})` : `ok (${AI_HEALTH.ok} calls)`;
}
const aiHealth = () => ({ ...AI_HEALTH, provider: AI });
function aiFailed(provider, status, code) {
  AI_HEALTH.failed++; AI_HEALTH.streak++;
  AI_HEALTH.last = `HTTP ${status}${code ? " " + code : ""}`;
  // no credit, a bad key, or six refusals in a row: stop asking in this process
  if (!AI_HEALTH.down && (QUOTA_CODES.test(code) || status === 401 || status === 403 || AI_HEALTH.streak >= 6)) {
    AI_HEALTH.down = code || `HTTP ${status}`;
    console.log(`  (${provider} is refusing calls: ${AI_HEALTH.down} — no more AI calls in this step; the work is kept for a later run)`);
  }
}
async function errorCode(res) {
  try {
    const d = await res.json(); const e = (d && d.error) || {};
    const code = String(e.code || e.type || "").slice(0, 40);
    return !QUOTA_CODES.test(code) && /credit balance|current quota|billing/i.test(String(e.message || "")) ? "no_credit" : code;
  } catch { return ""; }
}
async function callOpenAI(prompt, maxTokens) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(90000),
    });
    if (res.ok) {
      const d = await res.json();
      USAGE.calls++; USAGE.in += (d.usage && d.usage.prompt_tokens) || 0; USAGE.out += (d.usage && d.usage.completion_tokens) || 0;
      AI_HEALTH.ok++; AI_HEALTH.streak = 0;
      return d.choices?.[0]?.message?.content || "";
    }
    const code = await errorCode(res);
    const hopeless = res.status === 400 || res.status === 401 || res.status === 403 || QUOTA_CODES.test(code);
    if (!hopeless && attempt < (res.status === 429 ? 3 : 2)) {
      const wait = Math.min(20, Math.max(2.5, Number(res.headers.get("retry-after")) || 0));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    console.log(`  (OpenAI HTTP ${res.status}${code ? " " + code : ""})`);
    aiFailed("OpenAI", res.status, code);
    return null;
  }
}
async function callClaude(prompt, maxTokens, usage = USAGE) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const code = await errorCode(res);
    console.log(`  (Claude HTTP ${res.status}${code ? " " + code : ""})`);
    if (usage === USAGE) aiFailed("Claude", res.status, code);
    return null;
  }
  const d = await res.json();
  usage.calls++; usage.in += (d.usage && d.usage.input_tokens) || 0; usage.out += (d.usage && d.usage.output_tokens) || 0;
  if (usage === USAGE) { AI_HEALTH.ok++; AI_HEALTH.streak = 0; } else AI_HEALTH.fallback++;
  return (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}
let FALLBACK_DEAD = false;
async function askAI(prompt, { maxTokens = 3000, essential = false } = {}) {
  if (!AI) return null;
  try {
    if (AI !== "OpenAI") return AI_HEALTH.down ? null : await callClaude(prompt, maxTokens);
    if (!AI_HEALTH.down) { const out = await callOpenAI(prompt, maxTokens); if (out !== null || !AI_HEALTH.down) return out; }
    // OpenAI is refusing: the facts of a new notice may be read by the second provider
    if (essential && ANTHROPIC_KEY && CONFIG.aiFallback !== false && !FALLBACK_DEAD) {
      const out = await callClaude(prompt, maxTokens, USAGE_FB);
      if (out === null) FALLBACK_DEAD = true;
      return out;
    }
    return null;
  } catch (e) { console.log("  (AI error: " + e.message + ")"); AI_HEALTH.failed++; AI_HEALTH.last = "error: " + String(e.message).slice(0, 60); return null; }
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
const OFF_TOPIC_BASE = /\b(recruitment|jobs?) notifications? list\b|\bsyllabus\b|exam pattern|seat matrix|choice (filling|locking)|counsel+ing|\badmission\b|\bmerit list for admission\b|re-?valuation|\btime ?table\b|\bdate ?sheet\b|(?<!\b(ntpc|rrb|cbt|level|10\+2)[\s(-]*)\b(sem(ester)?|b\.?tech|m\.?tech|b\.?sc|m\.?sc|b\.?com|m\.?com|bams|bhms|mbbs|bds|bpt|b\.?ed|ph\.?d|llb|bca|mca|ug|pg|\d(st|nd|rd|th) prof(essional)?|professional)\b[^–—:]*\bresults?\b|\bresults?\b[^–—:]*\b(sem(ester)?|ug and pg|ug & pg|ph\.?d|mbbs|bams|b\.?sc|m\.?sc)\b|\b(university|vishwavidyalaya)\b(?![^–—:]*\b(recruitment|vacanc\w*|non[- ]?teaching|faculty|assistant professors?|posts?)\b)[^–—:]*\bresults?\b|\bresults?\b[^–—:]*\b(b\.e|b\.?pharm|m\.?pharm|bph|diploma|b\.?a\.?|m\.?a\.?|bba|mba|ug|pg)\b(?![^–—:]*\b(post|recruitment|vacanc|clerk|teacher|assistant|officer)\w*)|\b(gtu|aktu|rgpv|vtu|ccsu|ignou|rtmnu|sppu|cbse|icse)\b[^–—:]*\bresults?\b|\btime-table\b|\bmarks memo\b|\bph\.?d fellowship\b|\bcurrent affairs\b|\bjee main|\bnift\b(?![^–—:]*\b(recruitment|vacanc|posts?)\b)|\bneet\b(?![^–—:]*\b(recruitment|vacanc|posts?)\b)|\biit jam\b|\bjam 20\d\d\b|stray (vacancy )?round|\bboard exam(ination)?s?\b(?![^–—:]*\b(recruitment|vacanc|posts?)\b)|\b(matric|inter|10th|12th) (exam )?form\b|\bentrance (test|exam(ination)?)\b(?![^–—:]*\b(recruitment|vacanc|posts?)\b)|(?<!\b(ntpc|rrb|cbt|level|10\+2)[\s(-]*)\b(sem(ester)?|ug|pg|b\.?a|m\.?a|b\.?sc|m\.?sc|b\.?com|m\.?com|b\.?ed|ph\.?d|llb|bca|mca|bba|mba)\b(?![^–—:]*\b(teachers?|lecturers?|recruitment|vacanc\w*|posts?|tgt|pgt|assistant|officer)\b)[^–—:]*\b(admit card|hall ticket|exam (form|dates?))\b|\b(university|vishwavidyalaya)\b[^–—:]*\b(admit card|hall ticket|exam form)\b|\b(snap|xat|cmat|nmat|cuet|clat|ailet|gmat)\s*(20\d\d|ug|pg)\b|\bcat 20\d\d\b/i;   // + semester/university hall tickets and admission tests (CUET, CLAT, SNAP …)

// Board, school and professional-course exams are not government jobs: ICAI/ICSI/ICMAI (CA, CS, CMA) exams, NIOS,
// MSBTE, West Bengal Madhyamik / Uchcha Madhyamik, class 6/9/10/12 board exams and results, JNVST (Navodaya class 6/9
// admission) and more university result pages. Each keeps recruitment notices of the same bodies (ICAI, NIOS, Navodaya
// and universities hire staff too).
const NOT_RECRUIT = "(?![^–—:]*\\b(recruitment|vacanc\\w*|posts?|jobs?|bharti|non[- ]?teaching|faculty)\\b)";
// The whole headline is checked first: any recruitment word anywhere keeps it ("WBSSC Group D Recruitment – Madhyamik
// Pass", "Agniveer SSR (Class 12)", "Assistant Director Vacancy at NIOS", "Osmania University Assistant Professor Result").
const RECRUIT_ANY = "^(?![\\s\\S]*\\b(recruitment|vacanc\\w*|posts?|jobs?|bharti|non[- ]?teaching|faculty|slst|agniveer|constables?|teachers?|professors?|lecturers?|clerks?|officers?|engineers?|assistants?|apprentices?|directors?|staff|(madhyamik|matric|10th|12th|class[ -]?\\w+) pass(ed)?)\\b)[\\s\\S]*?";
const OFF_TOPIC_EXAMS = new RegExp(RECRUIT_ANY + "(?:" + [
  `\\b(icai|icsi|icmai)\\b${NOT_RECRUIT}`,
  `\\b(ca|cma|cs) (foundation|inter(mediate)?|final|executive|professional)\\b${NOT_RECRUIT}`,
  `\\b(nios|msbte)\\b${NOT_RECRUIT}`,
  `\\b(uchcha )?madhyamik\\b${NOT_RECRUIT}`,
  `\\bclass[ -]?(6|9|10|11|12|vi|ix|x|xi|xii)(th)?\\b(?![^–—:]*\\b(pass|passed|qualified|level|recruitment|vacanc\\w*|posts?|jobs?|bharti)\\b)`,
  `\\b(6th|9th|10th|11th|12th|matric|intermediate|inter|hsc|sslc|hslc|hse|puc|ii puc|plus two|\\+2) (board )?(annual |supplementary |compartment(al)? )?(exam(ination)? )?(results?|admit card|hall ticket|date ?sheet|time ?table|registration|exam form)\\b`,
  // student scholarships are not jobs ("ONGC Scholarship 2026-27: Students Can Get Rs. 48,000 Per Year")
  `\\bscholarships?\\b${NOT_RECRUIT}`,
  // course admissions: "KNRUHS BHMS Allotment List - Management Quota", "Ayurveda and Allied Courses Phase 3 Provisional
  // Allotment List", "AIIMS Fellowship Programme January 2027 - Apply Online for 93 Seats" (an allotment list of a
  // recruitment - "IBPS Clerk Provisional Allotment List" - names no course, quota or seats and stays)
  `\\ballotment\\b[^–—:]*\\b(quota|courses?|counsel+ing|seats?)\\b|\\b(courses?|quota|counsel+ing)\\b[^–—:]*\\ballotment\\b`,
  `\\b(programme|program|courses?)\\b[^–—:]*\\b\\d+ seats\\b|\\b\\d+ seats\\b[^–—:]*\\b(programme|program|courses?)\\b`,
  `\\bjnvst\\b|\\bnavodaya\\b[^–—:]*\\b(class (6|9|vi|ix)|selection test|admission)\\b`,
  `\\b(mdu|kuk|crsu|cdlu|lnmu|brabu|bnmu|tmbu|vksu|csjmu|dbrau|mgkvp|vbspu|rmlau|mjpru|davv|rdvv|apsu|sppu|du sol|osmania university|kakatiya university|anna university)\\b[^–—:]*\\b(results?|admit card|hall ticket|exam form)\\b`,
].join("|") + ")", "i");
const OFF_TOPIC = new RegExp(OFF_TOPIC_BASE.source + "|" + OFF_TOPIC_EXAMS.source, "i");
/** Guesswork headlines ("SSC GD 2027 Notification Expected Soon", "Result Release Date", "When will … come") are not
    announcements: kept only when the record carries an official deep link or PDF (lib.js noticeKey). */
const SPECULATIVE = /\b(expected|likely|release date|when will|kab (aayega|aaega|aaenge|jari hoga|hoga)|kab tak)\b|\b(coming|out|releas(e|ing)|declared?|announced?|available|notification|result|admit card|answer key|hall ticket|notice|dates?)\s*[-–—:]?\s*soon\b|(?<!(closing|ending|last date|apply) )\bsoon\s*$/i;
const isSpeculative = (rec = {}) => SPECULATIVE.test(String(rec.title || "")) &&
  ![rec.official_link, rec.official_notification, rec.apply_link].some((u) => noticeKey(u));

/** Headlines that are not real recruitments / updates (newspaper PDF dumps, roundups, ads). */
/** Not a government employer: private (deemed) universities, private-sector and urban co-operative banks, private
    companies and contractors, private school chains and NGOs. News-Views lists government jobs only (central, state and
    local government, PSUs, statutory bodies, government-funded institutions); these are skipped when fetched and kept
    off the site and the app. Tested on title + organisation. */
const NON_GOVT = new RegExp([
  "manipal institute of technology|\\bmit manipal\\b|\\bramaiah (medical|institute|university|college|memorial)|mahayogi gorakhnath university|\\bmgug\\b|amrita vishwa vidyapeetham|\\bamrita (university|school|institute)\\b|\\bbits pilani\\b|birla institute of technology (and|&) science|\\bchrist (university|\\(deemed)|^christ \\(|graphic era|nirma university|vinayaka mission|\\bvmrf\\b|manipal academy|\\bsrm (institute|university)\\b|vellore institute of technology|\\bvit (university|vellore|chennai|bhopal|ap)\\b|\\bamity (university|school|institute)\\b|lovely professional university|chandigarh university|sharda university|galgotias|symbiosis|\\bnmims\\b|shiv nadar|ashoka university|jindal global|thapar institute|\\bkiit\\b|kalinga institute of industrial|siksha ['‘’]?o['‘’]? anusandhan|sathyabama|saveetha|d\\.? ?y\\.? patil|bharati vidyapeeth|datta meghe|jain (deemed|university)|chitkara university|university of petroleum (and|&) energy studies|sri ramachandra|karunya|kalasalingam|hindustan institute of technology|koneru lakshmaiah|\\bgitam\\b|mit world peace|manav rachna|noida international university",
  "\\bmahesh (co-?operative )?(urban )?bank\\b|south indian bank|federal bank|karur vysya|city union bank|tamil ?nadu? mercantile|\\bcsb bank|catholic syrian bank|dhan(a)?la(x|k)shmi bank|karnataka bank|hdfc bank|icici bank|axis bank|kotak mahindra|indusind|\\byes bank|\\brbl bank|bandhan bank|idfc first|\\bau small finance|equitas|ujjivan|suryoday|jana small finance|utkarsh small finance|\\bdcb bank|urban co-?operative bank",
  "\\bpvt\\.? ?ltd\\b|\\bprivate limited\\b|\\(p\\) ?ltd\\b|\\bm\\/s\\.? |sbc exports|\\bdav (public school|college managing|cmc)|delhi public school|nilachal seva pratisthan|surjeet memorial college|muktisar institute of higher education|\\bngos?\\b|non[- ]governmental organi[sz]ation",
].join("|"), "i");
const isNonGovt = (job = {}) => NON_GOVT.test(`${job.title || ""} | ${job.organization || ""}`);
const JUNK_TITLE = /assignment abroad times|employment news(paper)? (pdf|this week)|rojgar samachar pdf|gulf times pdf|walk-?in (interview )?today|daily (job )?(update|digest)|\btop \d+ (\w+ ){0,3}(jobs?|vacanc\w*|recruitments?|notifications?|bharti)\b|jobs? (alert|digest) (today|this week)|weekly (jobs?|round-?up)|latest jobs? (today|list)|\bpdf today\b|newspaper pdf|latest (govt|government|sarkari) jobs? (on|for|of) \d|\b\d[\d,]*\+? (all india )?vacancies open\b|government jobs on \d{1,2}(st|nd|rd|th)? \w+ 20\d\d|\(\d[\d,]*\+ [^)]*vacanc|\b\d[\d,]*\+ vacancies\b|closing govt jobs|free ?job ?alert|latest (\w+ )?(vacancy )?notifications\s*$|^latest\b[^–—:]*\b(govt|government|sarkari|railway|bank)\b[^–—:]*\bjobs\b|^[\w&.,' -]{0,30}\bgovt jobs 20\d\d\b|\b(govt|government) jobs for (diploma|engineers|graduates|10th|12th|iti|women|females?)\b/i;

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

/* ---- numbers that tell recruitments apart: "TNPSC Group 2" ≠ "Group 4", "RRB NTPC CBT 1" ≠ "CBT 2", "CDS II" = "CDS 2" ---- */
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const STAGE_WORD = /^(group|grade|tier|phase|cbt|paper|level|cen|stage|post|category|class|batch|cycle)$/;
/** A roman numeral of two or more letters (ii … xii) as its arabic number; any other word unchanged. Single letters
    (i, v, x) are only read as numbers after a stage word, because "I"/"V"/"X" are also ordinary words or grades. */
const romanWord = (w) => (w.length > 1 && ROMAN[w] ? String(ROMAN[w]) : w);
/** "12", "04", "iv" → "12", "4", "4" (1–2 digits or a roman numeral up to xii); anything else → null. */
function stageNum(tok) {
  const t = String(tok || "").toLowerCase();
  if (/^\d{1,2}$/.test(t)) return Number(t) ? String(Number(t)) : null;
  return ROMAN[t] ? String(ROMAN[t]) : null;
}
/** Lower-case word list → the same list with a stage word and its number joined: ["tnpsc","group","iv"] →
    ["tnpsc","group-4"]; "Grade A" / "Group D" keep their letter too ("grade-a"). */
function joinStageNumbers(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i], nx = words[i + 1];
    if (nx != null && STAGE_WORD.test(w)) {
      const n = stageNum(nx);
      if (n) { out.push(w + "-" + n); i++; continue; }
      if (/^(group|grade|class|category)$/.test(w) && /^[a-d]$/.test(nx)) { out.push(w + "-" + nx); i++; continue; }
    }
    out.push(w);
  }
  return out;
}
/** A link that identifies ONE notice: a PDF, or a deep page with something specific in its address — never a
    homepage or a generic "Careers" / "Recruitment" / "Notifications" / "Results" list page. Returns a comparable key or "". */
const GENERIC_PAGE = /^(careers?|recruitments?|jobs?|vacanc(y|ies)|notifications?|notices?|advertisements?|advt|whats-?new|what-is-new|latest(-news|-updates)?|news|announcements?|employment|opportunit(y|ies)|current-?openings?|openings?|results?|admit-?cards?|downloads?|index|default|home|main|en|hi|page|list|all|recruitment-notices?|career-opportunities|job-opportunities)(\.(php|html?|aspx?|jsp|cfm))?$/i;
function noticeKey(u) {
  if (!u) return "";
  let x; try { x = new URL(String(u)); } catch { return ""; }
  const host = x.host.toLowerCase().replace(/^www\./, "");
  let pth = x.pathname; try { pth = decodeURIComponent(pth); } catch { /* malformed %-escape: compare as written */ }
  pth = pth.replace(/\/+$/, "");
  const key = host + pth.toLowerCase() + (x.search || "").toLowerCase();
  if (/\.pdf$/i.test(pth)) return key;
  const segs = pth.split("/").filter(Boolean);
  if (!segs.length) return "";
  const last = segs[segs.length - 1];
  if (GENERIC_PAGE.test(last) && !x.search) return "";
  if (x.search && !/\d/.test(x.search) && GENERIC_PAGE.test(last)) return "";
  // something specific: a number in the address (an advertisement id, a year) or a long descriptive slug
  return /\d/.test(pth + x.search) || last.replace(/\.\w+$/, "").length >= 15 ? key : "";
}

/** Same announcement from two feeds ("HPSC HCS Final Result 2026 Out - Check…" vs
 *  "HPSC HCS and Allied Services Final Result 2026"): compare the subject words before the
 *  event keyword, plus the event itself (final result ≠ pre result ≠ exam city). */
const EVENT_RE = /\b((?:final|pre|prelims?|mains?|revised|provisional|phase[- ]?\w+|tier[- ]?\w+|cbt[- ]?\w+)\s+)?(result|admit card|hall ticket|call letter|answer key|exam city|exam date|exam schedule|interview|merit list|cut[- ]?off|score ?card|marks|document verification)\b/i;
const CORE_STOP = new Set("the a an and of for to in on at out released release declared check download link online pdf new notice details date 2024 2025 2026 2027 exam recruitment posts post various".split(" "));
function updateKey(title) {
  const t = String(title || "").toLowerCase().replace(/[–—]/g, "-");
  const m = t.match(EVENT_RE);
  if (!m) return null;
  // "CDS II" = "CDS 2": roman numerals count as the same number as arabic ones
  const words = t.slice(0, m.index + (m[1] || "").length).replace(/[^a-z0-9/ ]/g, " ").split(/\s+/).filter(Boolean).map(romanWord);
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
  const t = new Date(u.date || Date.now()).getTime();
  // the same official notice (a PDF or a specific page, never a generic "Results" list page) is the same update
  // Only a PDF counts (one login page serves an exam's admit card, answer key and result), and only for the same kind
  // of update about the same stage (review: GSSSB answer key vs its admit card were merged).
  const nk = noticeKey(u.official_link);
  if (nk && /\.pdf($|\?)/i.test(nk) && list.some((x) => {
    if (x === u || x.id === u.id || noticeKey(x.official_link) !== nk) return false;
    if (u.type && x.type && u.type !== x.type) return false;
    const b = updateKey(x.title);
    if (a && b && a.ev !== b.ev) return false;
    return Math.abs(new Date(x.date || 0).getTime() - t) <= 30 * 86400000;
  })) return true;
  if (!a || a.core.length < 2) return false;
  return list.some((x) => {
    if (x === u || x.id === u.id) return false;
    if (Math.abs(new Date(x.date || 0).getTime() - t) > days * 86400000) return false;
    const b = updateKey(x.title);
    if (!b || b.core.length < 2 || b.ev !== a.ev) return false;
    const [s, l] = a.core.length <= b.core.length ? [a.core, b.core] : [b.core, a.core];
    return s.every((w) => l.includes(w));
  });
}

/* ---- the same recruitment twice (two feeds, a corrigendum, a short notice then the full one) ---- */
// Organisation identity: the FULL normalised name (a 14-character prefix made every "Indian Institute of ..." look like
// one body), plus a long short-form. Prefix match tolerates "Railway Recruitment Board" vs "Railway Recruitment Boards
// (RRBs), Ministry of Railways".
const orgNorm = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "").replace(/s$/, "");
const orgKeys = (x) => [orgNorm(x.organization), orgNorm(x.org_short)].filter((k, i) => k.length >= (i === 0 ? 4 : 6));
const sameOrg = (a, b) => orgKeys(a).some((k1) => orgKeys(b).some((k2) => k1 === k2 ||
  (Math.min(k1.length, k2.length) >= 12 && (k1.startsWith(k2) || k2.startsWith(k1)))));
/** Organisation family: "RRB Ahmedabad" and "RRB" (Railway Recruitment Boards), "SSC" and "SSC (Central Region)". */
const orgFamily = (x) => { const m = String(x.org_short || "").toLowerCase().match(/^[a-z]{3,}/); return m && !/^(the|govt|government|dept|department|office|india|indian|state|district|national)$/.test(m[0]) ? m[0] : ""; };
// One side must be the bare family name ("RRB" vs "RRB Ahmedabad"): "AIIMS Patna" and "AIIMS Bhopal" are different
// institutes with the same first word.
const bareOrg = (x) => String(x.org_short || "").toLowerCase().replace(/[^a-z]/g, "");
const sameFamily = (a, b) => sameOrg(a, b) || (!!orgFamily(a) && orgFamily(a) === orgFamily(b) && (bareOrg(a) === orgFamily(a) || bareOrg(b) === orgFamily(b)));
const normPost = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).map(romanWord).join(" ")
  .replace(/\b(posts?|vacanc(y|ies)|recruitment|and|of|the|for)\b/g, " ").replace(/\s+/g, " ").trim();
/** "Advt. No. 05/2026" → "05/2026" style key for comparing advertisement numbers. */
const advtKey = (s) => String(s || "").toLowerCase().replace(/\b(advt|advertisement|notification|no|number|employment notice|cen)\b\.?/g, " ").replace(/[^a-z0-9]+/g, "").replace(/^0+(?=\d)/, "");
/** Do two post names describe the same posts? Unknown counts as "maybe" (true); otherwise at least half of the shorter
    name's distinctive words must appear in the other ("Assistant", "Officer", "Junior" alone prove nothing). */
const POST_GENERIC = new Set("assistant officer junior senior grade other staff cum level class group multiple more".split(" "));
// "Various Posts" names nothing: unknown. Plurals count as the singular ("Trainees" = "Trainee").
const postWords = (s) => /\bvarious\b/i.test(String(s || "")) ? [] : [...new Set(normPost(s).split(" ").map((w) => (w.length > 4 ? w.replace(/s$/, "") : w)).filter((w) => w.length > 2 && !POST_GENERIC.has(w)))];
/** `any`: one shared distinctive word is enough (for records already known to share one notice PDF). */
const postsOverlap = (a, b, { any = false } = {}) => {
  const A = postWords(a), B = postWords(b);
  if (!A.length || !B.length) return true;
  const [s, l] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
  const shared = s.filter((w) => l.has(w)).length;
  return any ? shared > 0 : shared * 2 >= s.length;
};
const DAY = 86400000;
/** Is `job` a twin of one of `list`? Returns the existing record or null. `onExtend(hit, newEnd)` is called when an
    extension notice carries a later last date for the existing listing. */
function isDuplicate(job, list, { onExtend } = {}) {
  const v = Number(job.total_vacancies) || 0;
  const t = new Date(job.published || Date.now()).getTime();
  const post = normPost(job.post_name), end = job.application_end, start = job.application_start;
  const nk = noticeKey(job.official_notification);
  const hit = (list || []).find((x) => {
    if (x === job || (x.id && x.id === job.id)) return false;
    const dt = Math.abs(new Date(x.published || 0).getTime() - t);
    if (dt >= 60 * DAY) return false;
    const xv = Number(x.total_vacancies) || 0;
    // Different advertisement numbers are different recruitments, whatever else matches.
    const an = advtKey(job.advt_no), xn = advtKey(x.advt_no);
    if (an && xn && an !== xn) return false;
    // The same official notice: one PDF (or one specific page on the official site) is one recruitment.
    // (A PDF only — OPSC serves several recruitments from one view_content page — of the same body, with overlapping
    // posts: one combined district PDF can announce unrelated posts.)
    if (nk && /\.pdf($|\?)/i.test(nk) && noticeKey(x.official_notification) === nk && sameFamily(job, x) && postsOverlap(job.post_name, x.post_name, { any: true })) return true;
    if (!sameOrg(job, x)) {
      // The same organisation family ("RRB" / "RRB Ahmedabad"), the same last date and a real recruitment (20+ posts)
      // published within 45 days: one notice reported by two sources under different names.
      return v >= 20 && xv >= 20 && end && x.application_end === end && dt < 45 * DAY && sameFamily(job, x) && postsOverlap(job.post_name, x.post_name);
    }
    if (v >= 10 && xv === v) return true;              // same body, same (distinctive) count — "Assam" vs "All India" spellings of one notice
    // District-wise drives of one department (UP ECCE Educator: Meerut 98, Kushinagar 29, same dates) are separate
    // recruitments: small notices for different places never count as twins.
    const place = (l) => String(l || "").toLowerCase().split(/[,(]/)[0].replace(/[^a-z]/g, "");
    const pj = place(job.location), px = place(x.location);
    if (v < 500 && xv < 500 && pj && px && pj !== px && !String(x.location).toLowerCase().includes(pj) && !String(job.location).toLowerCase().includes(px)) return false;
    if (v >= 10 && xv === v) return true;                                             // same body, same (distinctive) vacancy count
    // The same recruitment announced again — "last date extended", a corrigendum — often with a slightly different
    // count from another source (BPSC TRE 4.0: 32,388 vs 33,320, both opening 25 Sep): same body, same opening date.
    if (start && x.application_start === start && v >= 100 && xv >= 100 && Math.abs(v - xv) / Math.max(v, xv) <= 0.05) return true;
    // A real recruitment (20+ posts) with the same last date, published within 45 days, by the same body: twins,
    // unless the posts plainly differ.
    if (v >= 20 && xv >= 20 && end && x.application_end === end && dt < 45 * DAY && postsOverlap(job.post_name, x.post_name)) return true;
    // Same body and same post, with the same last date or the same count: one recruitment reported twice, or
    // re-reported with a corrected count (RRB Station Master: 1215 -> 1265 after a corrigendum; ~1250 short notice).
    if (!post || normPost(x.post_name) !== post) return false;
    if ((end && x.application_end === end) || (v >= 2 && xv === v)) return true;
    // A big national recruitment announced first as a short notice (no last date yet, approximate count) and then in
    // full: same body and post, 500+ posts each within 6% of each other, within 30 days (RRB Station Master: short
    // notice ~1200, full notice 1265). District-wise drives with similar counts stay separate (they are smaller).
    return (!end || !x.application_end) && v >= 500 && xv >= 500 && Math.abs(v - xv) / Math.max(v, xv) <= 0.06 && dt < 30 * DAY;
  });
  // An extension notice carries the new last date: move the existing listing's deadline instead of adding a twin.
  if (hit && end && onExtend && /\b(extend(ed|s)?|extension)\b|last date (extended|revised|increased)/i.test(String(job.title)) && (!hit.application_end || String(end) > String(hit.application_end))) onExtend(hit, end);
  return hit || null;
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

/* ---- the Apply button: what kind of link we really have, and how to label it honestly ---- */
const PORTAL_HOST = /(recruit|career|apply|online|regist|exam|jobs|portal|onlineapp|candidate|ibpsonline|digialm|cbt|admission|vacanc)/i;
/** "deep" (a page beyond the homepage), "portal" (the homepage of an application portal, e.g. becilregistration.in),
    "pdf", "home" (the organisation's main homepage — not where anyone applies) or "none". */
function linkKind(u, job = {}) {
  if (!u) return "none";
  let x; try { x = new URL(u); } catch { return "none"; }
  const path = x.pathname.replace(/\/+$/, "");
  if (/\.pdf$/i.test(path)) return "pdf";
  if ((path && !/^\/(index|default|home)(\.(php|html?|aspx?|jsp))?$/i.test(path)) || x.search) return "deep";
  const host = x.host.toLowerCase().replace(/^www\./, "");
  const site = hostOf(job.official_website || "");
  if (PORTAL_HOST.test(host) && host !== site) return "portal";
  if (PORTAL_HOST.test(host.split(".")[0])) return "portal";
  return "home";
}
/** walkin | offline | email | online | unknown. The notice's own wording (summary / steps, written from the notice)
    beats the headline: aggregator titles say "Apply Online" for email and postal applications too. */
const ONLINE_RE = /apply online|online (application|form|registration|mode)|register online|registration portal|online portal|(submit|fill)[^.]{0,30} online|apply through the (official )?(website|portal)/i;
const OFFLINE_RE = /apply offline|offline (application|form|mode)|by (registered |speed )?post|through (registered |speed )?post|hard ?copy|send (the|your) (filled|completed|duly)|in person at|submitted? (by hand|in person)/i;
const EMAIL_RE = /(apply|send|submit|forward)[^.]{0,60}\b(by|via|through|to) e-?mail|e-?mail (your|the) ([\w-]+ ){0,3}(application|form|cv|resume|bio-?data)|applications? ((process|form) )?((is|are|must be|should be|will be) )?(sent |accepted |received |submitted )?(via|by|through) e-?mail|e-?mailed to|(send|submit|forward)[^.]{0,60}\bto [^\s@]+@[^\s@]+\.[a-z]{2,}|\bto \[\s*email(\s|&#160;|\u00a0)+protected\s*\]/i;
function applyMode(job = {}) {
  const t = String(job.title || "");
  const body = [job.post_name, ...(job.how_to_apply || []), ...(job.selection_process || []), job.summary, job.eligibility_notes].join(" ");
  const on = ONLINE_RE.test(body), off = OFFLINE_RE.test(body), mail = EMAIL_RE.test(body);
  if (/walk[- ]?in/i.test(t)) return "walkin";
  if (mail && !on) return "email";
  if (/apply offline|offline (application|form|mode)/i.test(t) || (off && !on)) return "offline";
  if (/apply online|online (application|form|registration)/i.test(t) || on) return "online";
  if (/walk[- ]?in/i.test(body)) return "walkin";
  if (mail) return "email";
  return "unknown";
}
/** Does a deep link look like the application itself (form, login, registration, portal) rather than an information page? */
const APPLY_PATH = /apply|regist|online|login|signin|sign-in|candidate|application|onlineapp|portal/i;
const APPLY_SUB = /^(recruit\w*|careers?|jobs?|apply|online\w*|regist\w*)\./i;
const isApplyUrl = (u) => { try { const x = new URL(u); return APPLY_SUB.test(x.host.replace(/^www\./i, "")) || APPLY_PATH.test(x.pathname + x.search); } catch { return false; } };
/** The primary call to action for a job page and the app: { cta, url, mode, applyKind }.
    cta: apply (a real application page or portal) | page (this recruitment's page on the official site) |
         form (offline: notice + form) | walkin (interview notice) | email (apply by email: the notice has the address) |
         notice (the official notification) | website (only the homepage is known — labelled as such, never "Apply"). */
function applyInfo(job = {}) {
  const mode = applyMode(job);
  const apply = job.apply_link || "";
  const notif = job.official_notification || "";
  const site = job.official_website || "";
  const ak = linkKind(apply, job), nk = linkKind(notif, job);
  // a "notification" that is only a homepage is not a notice (16 jobs had indiapost.gov.in/ there)
  const notice = (notif && nk !== "home" ? notif : "") || (ak === "pdf" ? apply : "");
  if (mode === "walkin" && (notice || ak === "deep")) return { cta: "walkin", url: notice || apply, mode, applyKind: ak };
  if (mode === "offline" && notice) return { cta: "form", url: notice, mode, applyKind: ak };
  if (mode === "email" && (notice || ak === "deep")) return { cta: "email", url: notice || apply, mode, applyKind: ak };
  if (ak === "portal" || (ak === "deep" && isApplyUrl(apply))) return { cta: "apply", url: apply, mode, applyKind: ak };
  if (ak === "deep") return { cta: "page", url: apply, mode, applyKind: ak };
  if (notice && (ak === "pdf" || ak === "none" || mode !== "online")) return { cta: "notice", url: notice, mode, applyKind: ak };
  if (job.careers_link) return { cta: "careers", url: job.careers_link, mode, applyKind: ak };
  const home = (ak === "home" ? apply : "") || site || (nk === "deep" ? notif : "");
  if (home) return { cta: "website", url: home, mode, applyKind: ak };
  if (notice) return { cta: "notice", url: notice, mode, applyKind: ak };
  return { cta: "", url: "", mode, applyKind: ak };
}

/* ---- record hygiene: what the AI returns is not trusted to have the right shape ---- */
const JOB_TEXT = ["title", "organization", "org_short", "post_name", "qualification", "fee", "salary", "location", "summary", "summary_hindi",
  "eligibility_notes", "about_organization", "advt_no", "status_note", "status_update"];
const JOB_ARR = ["how_to_apply", "selection_process", "overview", "preparation_tips"];
const JOB_DATE = ["application_start", "application_end", "exam_date", "published", "updated", "status_date"];
const JOB_LINK = ["apply_link", "official_notification", "official_website", "source", "careers_link", "status_link"];
/** notice_status: set only by matchNoticeStatus below (never by the AI) — a cancellation / postponement notice of this recruitment. */
const NOTICE_STATUS = new Set(["cancelled", "postponed"]);
/** The fields an AI extraction may set on a job (never via, id, careers_link or anything else). */
const NOT_AI = new Set(["title", "status_note", "status_update", "published", "updated", "status_date"]);
const AI_JOB_FIELDS = new Set([...JOB_TEXT.filter((k) => !NOT_AI.has(k)), ...JOB_ARR, ...JOB_DATE.filter((k) => !NOT_AI.has(k)),
  "total_vacancies", "age_min", "age_max", "faq", "apply_link", "official_notification", "official_website"]);
const human = (k) => { const t = String(k).replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return /^(sc|st|obc|ews|ur|pwd|pwbd|ph|bc|mbc|sebc|esm|xsm|gen|sc\/st|obc\/ews)$/i.test(t) ? t.toUpperCase() : t.replace(/^./, (c) => c.toUpperCase()); };
/** Any value as display text: objects become "Key: value; …" (a location object becomes "City, State"). */
function toText(v, key = "") {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => toText(x)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    if (key === "location") {
      const parts = ["city", "district", "town", "state"].map((k) => toText(v[k])).filter(Boolean);
      if (parts.length) return [...new Set(parts)].join(", ");
    }
    return Object.entries(v).map(([k, x]) => { const t = toText(x); return t ? `${human(k)}: ${t}` : ""; }).filter(Boolean).join("; ");
  }
  return String(v);
}
const isoDate = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m && !isNaN(Date.parse(m[0])) ? m[0] : null; };
const toNum = (v) => { if (typeof v === "number" && isFinite(v)) return v; const m = String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
/** An FAQ answer that guesses ("the notice does not mention a fee, so it is assumed to be free"): the site states only
    what the notice states, so the guess is cut and the fact kept ("The notice does not mention a fee. Please confirm
    in the official notification."); an answer that is nothing but a guess is dropped. "The fee is nil for SC/ST" is a fact. */
const FAQ_GUESS = /\b(assumed to be|it is (likely|assumed|presumed|probable) that|presumably|most likely|may be (null|nil|free)\b|is null\b)/i;
function faqFacts(list) {
  return (Array.isArray(list) ? list : []).map((f) => {
    if (!f || !FAQ_GUESS.test(String(f.a))) return f;
    const fact = String(f.a).split(/[,;]\s*(?:so|hence|thus|therefore|suggesting|indicating|which suggests|and so)\b/i)[0].trim().replace(/[.,;]+$/, "");
    return /\b(does not|doesn't|no\b[^.]*\bis) (mention|specify|state|mentioned|specified|stated)/i.test(fact) && !FAQ_GUESS.test(fact)
      ? { ...f, a: `${fact}. Please confirm in the official notification.` } : null;
  }).filter(Boolean);
}
const daysBetween = (a, b) => (new Date(String(b).slice(0, 10) + "T00:00:00Z") - new Date(String(a).slice(0, 10) + "T00:00:00Z")) / 86400000;
/** Age given per post ({"Scientist": 45, "YP II": 35}): the widest range across the posts. */
function ageNum(v, pick) {
  if (v && typeof v === "object" && !Array.isArray(v)) { const ns = Object.values(v).map(toNum).filter((n) => n && n > 0); return ns.length ? pick(...ns) : null; }
  const n = toNum(v); return n && n > 0 && n < 100 ? n : null;
}
/* ---- a job stored without the notice's facts ----
   When the AI cannot read a notice (no credit, an outage), the fetcher still lists the job from its headline and the
   official links: no dates, posts, vacancies or qualification, and an organisation guessed from the headline.
   - factless(): such a record (facts_read marks one that was read and whose notice names none of them). Its page
     carries no JobPosting data (the employer name is a guess).
   - factsPending(): …and it is still worth reading again: enrich-jobs.js (pass 0) re-reads the newest ones each run
     until the facts are in (3 failed readings at most, 30 days).
   - GENERIC_STEPS: the "how to apply" text of such a record. It must be true for every way of applying, so it names
     none (an earlier version told people to "complete the one-time registration" on walk-in and postal jobs), and it
     must not contain words applyMode() reads as a mode. sanitizeJob() swaps the old text for this one. */
const FACT_KEYS = ["application_end", "application_start", "total_vacancies", "qualification", "post_name", "exam_date"];
const factless = (j) => !!j && !j.facts_read && !FACT_KEYS.some((k) => j[k]);
function factsPending(j, today = todayIST()) {
  return factless(j) && /^https?:\/\//i.test(String(j.source || "")) && (j.facts_tries || 0) < 3 && daysBetween(j.published || today, today) <= 30;
}
const GENERIC_STEPS = [
  "Open the official notification linked on this page and read the eligibility, the important dates and the application fee.",
  "Check that you meet the age limit and the qualification before you apply.",
  "Apply only in the way the official notification describes, with the documents it lists.",
  "Pay the application fee where the notification asks for one, and submit your application before the last date.",
  "Keep a copy of your application and of the fee receipt for the later stages.",
];
const GENERIC_STEPS_HI = [
  "इस पेज पर दिया गया आधिकारिक नोटिफिकेशन खोलें और पात्रता, महत्वपूर्ण तिथियाँ और आवेदन शुल्क ध्यान से पढ़ें।",
  "आवेदन करने से पहले जाँच लें कि आप आयु सीमा और शैक्षणिक योग्यता पूरी करते हैं।",
  "आवेदन केवल उसी तरीके से करें जो आधिकारिक नोटिफिकेशन में बताया गया है, और उसमें बताए गए दस्तावेज़ साथ लगाएँ।",
  "जहाँ नोटिफिकेशन में आवेदन शुल्क माँगा गया हो वहाँ शुल्क जमा करें और अंतिम तिथि से पहले आवेदन जमा कर दें।",
  "आगे की प्रक्रिया के लिए अपने आवेदन और शुल्क रसीद की एक प्रति संभालकर रखें।",
];
const OLD_GENERIC_STEP = "Complete the one-time registration with a valid email and mobile number.";
const isGenericSteps = (list) => Array.isArray(list) && (list.includes(OLD_GENERIC_STEP) || list[0] === GENERIC_STEPS[0]);

/** Cleans a job record in place-safe fashion and returns it: text fields are strings, numbers are numbers, dates are
    YYYY-MM-DD, links are http(s), list fields are arrays of strings, FAQ entries have q and a. Unknown shapes are dropped. */
function sanitizeJob(j) {
  const o = deepFixEmail({ ...j });
  for (const k of JOB_TEXT) if (o[k] != null && typeof o[k] !== "string") o[k] = toText(o[k], k);
  for (const k of JOB_ARR) if (o[k] != null) o[k] = (Array.isArray(o[k]) ? o[k] : [o[k]]).map((x) => toText(x)).filter(Boolean);
  // the stand-in "how to apply" text: the old one named online registration on every job (see GENERIC_STEPS)
  if (isGenericSteps(o.how_to_apply) && o.how_to_apply.includes(OLD_GENERIC_STEP)) {
    o.how_to_apply = GENERIC_STEPS.slice();
    if (o.hi && typeof o.hi === "object" && Array.isArray(o.hi.how_to_apply)) o.hi = { ...o.hi, how_to_apply: GENERIC_STEPS_HI.slice() };
  }
  for (const k of JOB_DATE) if (o[k] != null) { const d = isoDate(o[k]); if (d) o[k] = d; else delete o[k]; }
  for (const k of JOB_LINK) if (o[k] != null && !/^https?:\/\/[^\s]+$/i.test(String(o[k]))) delete o[k];
  if (o.total_vacancies != null) { const n = toNum(o.total_vacancies); if (n) o.total_vacancies = Math.round(n); else delete o.total_vacancies; }
  if (o.age_min != null) { const n = ageNum(o.age_min, Math.min); if (n) o.age_min = n; else delete o.age_min; }
  if (o.age_max != null) { const n = ageNum(o.age_max, Math.max); if (n) o.age_max = n; else delete o.age_max; }
  // An age limit nobody sets is an extraction slip (a pay level or "10 years' experience" read as an age: pages showed
  // "Age limit 10–56 years"): no government post starts under 14 (the Apprentices Act minimum) or ends over 70.
  if (o.age_min != null && (o.age_min < 14 || o.age_min > 65)) delete o.age_min;
  if (o.age_max != null && (o.age_max < 15 || o.age_max > 70)) delete o.age_max;
  if (o.age_min != null && o.age_max != null && o.age_min > o.age_max) { delete o.age_min; delete o.age_max; }
  // A last date more than a year after publication is a standing scheme or a misread year, not a deadline to show.
  if (o.application_end && o.published && daysBetween(o.published, o.application_end) > 366) delete o.application_end;
  if (o.faq != null) o.faq = (Array.isArray(o.faq) ? o.faq : []).filter((f) => f && f.q && f.a).map((f) => ({ q: toText(f.q), a: toText(f.a) }));
  if (o.faq != null) o.faq = faqFacts(o.faq);
  if (o.notice_status != null && !NOTICE_STATUS.has(String(o.notice_status))) { delete o.notice_status; delete o.status_note; delete o.status_link; delete o.status_date; delete o.status_update; }
  for (const k of Object.keys(o)) if (o[k] === "" || o[k] === null || o[k] === undefined) delete o[k];
  return o;
}
/** Only the fields an AI extraction is allowed to set, sanitised. */
function aiJobFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (AI_JOB_FIELDS.has(k) && v !== null && v !== undefined && v !== "") out[k] = v;
  return sanitizeJob(out);
}
/* ---- cancelled / withdrawn / postponed recruitments ----
   A notice that cancels or postpones a recruitment already listed marks that job (notice_status, status_note,
   status_link, status_date, status_update): its page stays, with a red banner and the official notice, and it is no
   longer "live" (no Apply button, no alerts). Only an unambiguous match is marked. */
const CANCEL_RE = /\b(cancel+ed|cancel+ation|withdrawn|withdrawal|rescinded|scrapped|annulled)\b|रद्द|निरस्त/i;
const POSTPONE_RE = /\b(postponed|deferred|kept in abeyance|put on hold|on hold)\b|स्थगित/i;
// an exam, interview or stage being cancelled / postponed is not the recruitment itself
const STAGE_CTX = /\b(exam(ination)?s?|cbt|paper|shifts?|interviews?|admit card|hall ticket|answer key|results?|skill test|typing test|physical|pet|pst|dv|document verification|cent(re|er)s?|phase|tier|round)\b|परीक्षा|साक्षात्कार/i;
const RECRUIT_CTX = /recruit|\badvt\b|advertisement|vacanc|notification|bharti|भर्ती|\bposts?\b|rally|application process|engagement/i;
/** "cancelled" | "postponed" | "" for a notice headline. */
function noticeStatusOf(title) {
  const t = String(title || "");
  if (!RECRUIT_CTX.test(t) || STAGE_CTX.test(t)) return "";
  if (CANCEL_RE.test(t)) return "cancelled";
  if (POSTPONE_RE.test(t)) return "postponed";
  return "";
}
const NOTICE_STOP = new Set(("cancelled canceled cancellation cancelation withdrawn withdrawal rescinded scrapped annulled postponed deferred abeyance hold " +
  "notice official pdf fresh notification awaited out download check regarding of the for and in to due reason reasons administrative kept on till further " +
  "order orders rally recruitment advertisement advt vacancy vacancies post posts bharti update news latest now released issued link apply online offline").split(" "));
const noticeWords = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).map(romanWord)
  .filter((w) => w.length > 1 && !NOTICE_STOP.has(w) && !/^20\d\d$/.test(w));
/** "Army Public School Bareilly" → ["aps", "apsb"]: initials, so "APS Bareilly" finds it. */
const initialsOf = (s) => { const i = String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z]+/).filter((w) => w && !/^(of|and|the|for|in)$/.test(w)).map((w) => w[0]).join(""); return i.length >= 3 ? [...new Set([i.slice(0, 3), i])] : []; };
/** The one listed job a cancellation / postponement notice is about, or null (none, or more than one candidate). */
function matchNoticeStatus(notice, jobs) {
  const status = noticeStatusOf(notice.title);
  if (!status) return null;
  const day = isoDate(notice.date) || todayIST();
  const nw = [...new Set(noticeWords(notice.title))];
  if (nw.length < 2) return null;
  const yrs = String(notice.title).match(/\b20\d{2}\b/g) || [];
  const hits = (jobs || []).filter((j) => {
    if (!j || !j.title || String(j.published || "") > day) return false;                   // the job came first
    // "Bihar Police Constable Recruitment 2019 Cancelled" must not cancel the 2026 recruitment
    if (yrs.length && !yrs.some((y) => `${j.title} ${j.advt_no || ""} ${String(j.published || "").slice(0, 4)}`.includes(y))) return false;
    if ((Date.parse(day) - Date.parse(j.published || day)) > 180 * 86400000) return false;
    const jw = new Set([...noticeWords(`${j.title} ${j.organization || ""} ${j.org_short || ""} ${j.post_name || ""}`), ...initialsOf(j.organization), ...initialsOf(j.org_short)]);
    return nw.every((w) => jw.has(w));
  });
  return hits.length === 1 ? { job: hits[0], status } : null;
}
/** Mark a job with the notice (title, date, official link, our update page id). Returns true when something changed. */
function applyNoticeStatus(job, status, notice) {
  const link = notice.link && /^https?:\/\//i.test(notice.link) && !isAggregator(hostOf(notice.link)) ? notice.link : "";
  const before = JSON.stringify([job.notice_status, job.status_note, job.status_link, job.status_update]);
  job.notice_status = status;
  job.status_note = cleanTitle(notice.title).replace(/\s*[–—:|-]\s*((official )?notice( pdf)?|pdf|download\b.*|check\b.*)$/i, "").slice(0, 200);
  if (link) job.status_link = link;
  job.status_date = isoDate(notice.date) || todayIST();
  if (notice.id) job.status_update = notice.id;
  job.updated = job.status_date;
  return JSON.stringify([job.notice_status, job.status_note, job.status_link, job.status_update]) !== before;
}

/* ---- updates: the newest 800 in data/updates.json, older ones in data/updates-archive.json ----
   The fetchers once cut updates.json to 800 and the build then 301'd every dropped page. Now the overflow moves to the
   archive (appended, one entry per id): its pages stay live (exam hubs, organisation pages and the sitemap still use
   them), while the app feed, search and home stay on the recent window. */
const UPDATES_FILE = path.join(ROOT, "data", "updates.json");
const ARCHIVE_FILE = path.join(ROOT, "data", "updates-archive.json");
const UPDATES_KEEP = 800;
function readUpdatesArchive(file = ARCHIVE_FILE) { try { const a = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(a) ? a : []; } catch { return []; } }
/** Write updates.json with the newest `keep` entries (file order = newest first) and append the rest to the archive. */
function saveUpdates(updates, { file = UPDATES_FILE, archiveFile = ARCHIVE_FILE, keep = UPDATES_KEEP } = {}) {
  const recent = updates.slice(0, keep), over = updates.slice(keep);
  fs.writeFileSync(file, JSON.stringify(recent, null, 2) + "\n");
  if (!over.length) return { kept: recent.length, archived: 0 };
  const arch = readUpdatesArchive(archiveFile);
  const recentIds = new Set(recent.map((u) => u && u.id));
  const byId = new Map(arch.filter((u) => u && u.id && !recentIds.has(u.id)).map((u) => [u.id, u]));
  for (const u of over) if (u && u.id && !recentIds.has(u.id)) byId.set(u.id, u);   // the newer copy of an id wins
  const out = [...byId.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  fs.writeFileSync(archiveFile, JSON.stringify(out, null, 2) + "\n");
  return { kept: recent.length, archived: over.length };
}
/* ---- jobs: one file per day of publication, data/jobs/<YYYY-MM>/<YYYY-MM-DD>.json ---------------------------------
   data/jobs.json was one pretty-printed array: 37 MB after four weeks and growing 1.4 MB a day (the Hindi text is
   most of it), on course for GitHub's 100 MB per-file limit — pushes refused, the automation stopped — before the end
   of December 2026. Jobs now live in one file per day of publication (about 1.3 MB; "undated.json" for the few without
   a date), one record per line: a run rewrites only the days it touched, past days never change, a changed record is
   a one-line diff, and no file can come near a limit.
   Every script reads with loadJobs() and writes with saveJobs(); nothing else opens these files. */
const JOBS_DIR = path.join(ROOT, "data", "jobs"), JOBS_LEGACY = path.join(ROOT, "data", "jobs.json");
const jobShard = (j) => { const d = (String((j && j.published) || "").match(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/) || [])[0]; return d ? `${d.slice(0, 7)}/${d}` : "undated"; };
const shardText = (list) => "[\n" + list.map((j) => JSON.stringify(j)).join(",\n") + "\n]\n";
/** The day files that exist, as shard keys ("2026-11/2026-11-12", "undated"), newest first. */
function jobShards(dir = JOBS_DIR) {
  const keys = [];
  let top = []; try { top = fs.readdirSync(dir, { withFileTypes: true }); } catch { return keys; }   // no day files yet
  for (const e of top) {
    if (e.isFile() && e.name === "undated.json") keys.push("undated");
    else if (e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name)) for (const f of fs.readdirSync(path.join(dir, e.name))) if (new RegExp(`^${e.name}-\\d{2}\\.json$`).test(f)) keys.push(`${e.name}/${f.slice(0, -5)}`);
  }
  return keys.sort((a, b) => (a === "undated") - (b === "undated") || b.localeCompare(a));
}
/** Job ids that were retired on purpose (data/redirects.json): never published again. */
function retiredJobIds() {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8")).map((r) => (/^\/jobs\/([^/]+)\/$/.exec(r[0]) || [])[1]).filter(Boolean)); }
  catch { return new Set(); }
}
/** All job records: newest day first, in stored order within a day (new jobs sit at the top). Throws if a file does
    not parse (callers treat that as "cannot read" and change nothing). */
function loadJobs({ dir = JOBS_DIR, legacy = JOBS_LEGACY } = {}) {
  const keys = jobShards(dir), jobs = [];
  for (const k of keys) { const a = JSON.parse(fs.readFileSync(path.join(dir, k + ".json"), "utf8")); if (!Array.isArray(a)) throw new Error(`${k}.json: not an array`); jobs.push(...a); }
  if (!fs.existsSync(legacy)) return jobs;
  // data/jobs.json next to the day files was written by a run that started before the move to day files: its records
  // win (it held the whole list), newer records it does not know are kept, and ids retired meanwhile stay retired.
  const old = JSON.parse(fs.readFileSync(legacy, "utf8")); const list = Array.isArray(old) ? old : [];
  if (!keys.length) return list;
  const retired = retiredJobIds(), ids = new Set(list.map((j) => j && j.id));
  return [...jobs.filter((j) => j && !ids.has(j.id)), ...list.filter((j) => j && !retired.has(j.id))];
}
/** Writes the records to their day files (only files whose content changed are touched), removes day files that no
    longer hold a record and a leftover data/jobs.json. Refuses a list that would drop more than half of what is
    stored — that is a bug, not an update. */
function saveJobs(jobs, { dir = JOBS_DIR, legacy = JOBS_LEGACY, force = false } = {}) {
  if (!Array.isArray(jobs)) throw new Error("saveJobs: not an array");
  const list = jobs.filter((j) => j && typeof j === "object" && j.id);
  if (!force) {
    // Never write over a store that cannot be read (a damaged day file): the caller's list would then be whatever it
    // managed to load — perhaps nothing — and saving it would delete every other day.
    let stored;
    try { stored = loadJobs({ dir, legacy }).length; } catch (e) { throw new Error(`saveJobs: the stored jobs cannot be read (${e.message}) — refused`); }
    if (stored >= 200 && list.length < stored / 2) throw new Error(`saveJobs: ${list.length} records would replace ${stored} — refused`);
  }
  const groups = new Map();
  for (const j of list) { const k = jobShard(j); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(j); }
  let written = 0;
  for (const [k, part] of groups) {
    const file = path.join(dir, k + ".json"), text = shardText(part);
    let cur = null; try { cur = fs.readFileSync(file, "utf8"); } catch { /* a new day */ }
    if (cur === text) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + ".tmp", text); fs.renameSync(file + ".tmp", file); written++;
  }
  for (const k of jobShards(dir)) if (!groups.has(k)) { fs.rmSync(path.join(dir, k + ".json")); written++; }
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !fs.readdirSync(path.join(dir, e.name)).length) fs.rmdirSync(path.join(dir, e.name)); } catch { /* tidy-up only */ }
  if (fs.existsSync(legacy)) fs.rmSync(legacy);
  return { records: list.length, files: groups.size, written };
}
/** Update ids that were retired on purpose (merged, off-topic): never published again. */
function retiredUpdateIds() {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8")).map((r) => (/^\/updates\/([^/]+)\/$/.exec(r[0]) || [])[1]).filter(Boolean)); }
  catch { return new Set(); }
}

/** Today's date in India (the automation runs on UTC machines; between 00:00 and 05:30 IST UTC is still yesterday). */
function todayIST() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

module.exports = { sanitizeJob, aiJobFields, toText, unhideEmails, fixHiddenEmail, todayIST, linkKind, applyMode, applyInfo, isGenericList, GENERIC_LIST, fetchWithAIA, CHAIN_ERR, CONFIG, ROOT, UA, HDRS, decodeEntities, stripTags, cleanTitle, orgFromTitle, fetchText, parseFeed, fetchFeed, hostOf, isAggregator,
  extractOfficialLinks, pickLinksHeuristic, validateLinks, hostFromTitle, isBadOfficial, hostMatches, articleRegion, AI, AI_LABEL, askAI, aiDown, aiStatus, aiHealth, factless, factsPending, GENERIC_STEPS, GENERIC_STEPS_HI, isGenericSteps, parseJson, strArr, faqArr, logRun, logTail, OFF_TOPIC, NON_GOVT, isNonGovt, JUNK_TITLE, STRONG_OFFICIAL, updateKey, isDupUpdate, officialHomeFor, OFF_TOPIC_EXAMS, SPECULATIVE, isSpeculative, noticeStatusOf, matchNoticeStatus, applyNoticeStatus, saveUpdates, readUpdatesArchive, retiredUpdateIds, UPDATES_KEEP, loadJobs, saveJobs, retiredJobIds, jobShard,
  isDuplicate, sameOrg, normPost, postsOverlap, advtKey, noticeKey, joinStageNumbers, stageNum, romanWord, ROMAN, STAGE_WORD };
