/* ==================================================================
   build.js  —  news-views.in · Government Jobs
   Reads data/jobs.json and generates a complete static site to dist/.
   No framework, zero runtime dependencies.  Cloudflare runs: node build.js
   ================================================================== */

const fs = require("fs");
const path = require("path");

/* ---- Site config ------------------------------------------------ */
const SITE = {
  url: "https://news-views.in",          // your live domain, no trailing slash
  name: "News-Views",
  brand: "News-Views.in",
  section: "Government Jobs",
  tagline:
    "Latest Sarkari Naukri notifications — vacancies, eligibility and last dates, explained simply.",
  locale: "en_IN",
  email: "contact@news-views.in",        // shown on Contact/Privacy pages — change to yours
  publisher: "News-Views.in Editorial Team",
  adsenseId: "",                         // e.g. "ca-pub-1234567890123456" — paste after AdSense approval
  adsenseSlot: "",                       // optional in-article ad unit ID ("1234567890"); without it Auto ads place the ads
  admob: {},                             // Android app ads: { appId, banner, inline, interstitial } — also read by android/app/build.gradle.kts
  appAds: {},                            // app ad switches sent in the feed: { on, banner, inline, interstitial, every, gap }
};

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "data", "jobs.json");
const BUILT = new Date();
// Content fingerprints for static assets: a changed file gets a new URL, so no browser or CDN keeps an old copy.
const ASSET_V = Object.fromEntries(["styles.css", "site.js"].map((f) => {
  try { return [f, require("crypto").createHash("md5").update(require("fs").readFileSync(require("path").join(__dirname, "src", f))).digest("hex").slice(0, 8)]; }
  catch { return [f, "1"]; }
}));
// Visitors are in India: show the build date/time in IST, not UTC (a build at 02:00 IST used to show yesterday's date).
const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(BUILT);   // YYYY-MM-DD
const IST_TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(BUILT).replace(/\s?(am|pm)$/i, (m) => " " + m.trim().toUpperCase());
const BUILD_ID = `${(process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || "local").slice(0, 7)} ${BUILT.toISOString().slice(0, 16)}Z`;

// Load the single user config file (config.json) and apply it.
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  for (const k of ["url", "email", "adsenseId", "adsenseSlot", "admob", "appAds", "brand", "name", "tagline", "staleDays",
    "adsTxtExtra", "webAdsHead", "crawlHindiDetail", "minOrgIndex", "minComboJobs", "androidCertSha256", "trackingSince", "sitemapHindi", "sitemapClosedDays", "homeMax"]) {
    if (cfg[k] !== undefined && cfg[k] !== "") SITE[k] = cfg[k];
  }
  if (SITE.url) SITE.url = SITE.url.replace(/\/$/, "");
} catch (e) { /* fall back to defaults in SITE */ }

/* ---- Helpers ---------------------------------------------------- */
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const slug = (s) =>
  String(s || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const LIB = require("./lib.js");
/* ---- Organisation key: a clean short name, never a headline ---- */
const ORG_JUNK = /recruitment|apply|vacanc|notification|\bjobs?\b|walk-?in|careers?|\[|\]|\||admit|result|\d{3,}|online|offline|interview/i;
function orgKey(job) {
  const clean = (x) => String(x || "").replace(/\s+/g, " ").trim();
  const a = clean(job.org_short);
  if (a && a.length <= 22 && !ORG_JUNK.test(a)) return a;
  const b = clean(job.organization).replace(/\s*\(.*?\)\s*/g, " ").trim();
  if (b && b.length <= 45 && !ORG_JUNK.test(b)) return b;
  const c = clean(LIB.orgFromTitle(job.title));
  if (c && c.length <= 30 && !ORG_JUNK.test(c)) return c;
  return "";
}
function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } }
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/* ---- SEO title: short, specific, no empty placeholders (Google shows ~60 chars) ---- */
function seoTitle(job) {
  const year = (String(job.title).match(/\b20\d{2}\b/) || [String(BUILT.getFullYear())])[0];
  const org = String(job.org_short || "").trim() && String(job.org_short).length <= 18 ? job.org_short.trim() : "";
  let base = String(job.title)
    .replace(/\s*[–—:|-]\s*(apply|notification|last date|walk[- ]?in|online form|download|check|out\b).*$/i, "")
    .replace(/\s+(apply online|apply offline|notification out|vacancy|vacancies)\b.*$/i, "")
    .replace(/\s+/g, " ").trim();
  if (base.length > 48 || base.length < 12) {
    const post = String(job.post_name || "").split(/[,(/]| and | & /i)[0].trim();
    base = [org || String(job.organization || "").split(/[(,]/)[0].trim(), post && post.length <= 30 ? post : "", "Recruitment", year].filter(Boolean).join(" ");
  }
  if (!/\b20\d{2}\b/.test(base)) base += " " + year;
  const v = Number(job.total_vacancies);
  const bits = [];
  if (v > 0 && !new RegExp("\\b" + v.toLocaleString("en-IN").replace(/,/g, ",?") + "\\b").test(base) && !new RegExp("\\b" + v + "\\b").test(base)) bits.push(`${inr(v)} Post${v === 1 ? "" : "s"}`);
  const dl = daysLeft(job.application_end);
  if (job.application_end && dl !== null && dl >= 0) { const d = new Date(job.application_end + "T00:00:00"); bits.push(`Last Date ${d.getDate()} ${MONTHS[d.getMonth()]}`); }
  else if (dl !== null && dl < 0) bits.push("Closed");
  let t = base + (bits.length ? ` – ${bits.join(", ")}` : "");
  if (t.length > 70) t = base + (bits[0] ? ` – ${bits[0]}` : "");
  if (t.length > 70) t = base.slice(0, 68).replace(/\s+\S*$/, "") ;
  return (t + ` | ${SITE.name}`).length <= 72 ? `${t} | ${SITE.name}` : t;
}
function seoDesc(job) {
  const parts = [];
  const v = Number(job.total_vacancies);
  parts.push(`${job.organization}${job.post_name ? " " + job.post_name : ""} recruitment${v > 0 ? ` for ${inr(v)} post${v === 1 ? "" : "s"}` : ""}.`);
  if (job.qualification) parts.push(`Qualification: ${String(job.qualification).slice(0, 60)}.`);
  if (job.application_end) parts.push(`Last date ${fmtDate(job.application_end)}.`);
  parts.push("Eligibility, salary, selection process & official apply link.");
  let d = parts.join(" ");
  if (d.length > 160) d = d.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return d;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return esc(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
// Deadlines are Indian dates: count whole calendar days from today in IST (0 = last day today, -1 = closed yesterday).
// (The old "ceil of hours left in server time" kept a job "live" until 05:30 IST the next day and showed "Last day"
// for a whole day after it had closed.)
const TODAY_IST_MS = Date.parse(IST_DATE + "T00:00:00Z");
function daysLeft(endIso) {
  if (!endIso) return null;
  const end = Date.parse(String(endIso).slice(0, 10) + "T00:00:00Z");
  if (isNaN(end)) return null;
  return Math.round((end - TODAY_IST_MS) / 86400000);
}
function ageDays(iso) { if (!iso) return null; const t = new Date(String(iso).slice(0, 10) + "T00:00:00+05:30"); return isNaN(t) ? null : (BUILT - t) / 86400000; }
function statusOf(job) {
  const d = daysLeft(job.application_end);
  // No last date known: treat as open only while the notice is recent; an undated 2025 notice is not "open" forever.
  if (d === null) { const a = ageDays(job.published); return a !== null && a > STALE_DAYS ? { cls: "closed", label: "Closed", live: false } : { cls: "open", label: "Open", live: true }; }
  if (d < 0) return { cls: "closed", label: "Closed", live: false };
  if (d <= 7) return { cls: "soon", label: d === 0 ? "Last day today" : d === 1 ? "Closes tomorrow" : `${d} days left`, live: true };
  return { cls: "open", label: "Open", live: true };
}
// A job is "stale" once its deadline passed more than STALE_DAYS ago.
// Stale jobs keep their own page (SEO) but drop out of active listings/counts.
const STALE_DAYS = Number(SITE.staleDays || 45);
function isStale(job) {
  const d = daysLeft(job.application_end);
  if (d === null) { const a = ageDays(job.published); return a !== null && a > STALE_DAYS * 2; }
  return d < -STALE_DAYS;
}
// Listing order: jobs still accepting applications first (newest first), recently closed ones after them.
const liveFirst = (a, b) => (statusOf(a).cls === "closed") - (statusOf(b).cls === "closed") || (b.published || "").localeCompare(a.published || "");
function windowPct(job) {
  if (!job.application_start || !job.application_end) return null;
  const s = new Date(job.application_start + "T00:00:00+05:30");
  const e = new Date(job.application_end + "T23:59:59+05:30");
  if (isNaN(s) || isNaN(e) || e <= s) return null;
  const p = ((BUILT - s) / (e - s)) * 100;
  return Math.max(0, Math.min(100, p));
}
const inr = (n) => (n === 0 || n) ? Number(n).toLocaleString("en-IN") : "—";
function isNew(iso) {
  if (!iso) return false;
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00+05:30");
  if (isNaN(d)) return false;
  const days = (BUILT - d) / 86400000;
  return days >= 0 && days <= 3;
}

/* qualification level(s) for category pages */
const LEVELS = [
  [/post.?grad|master|\bpg\b|m\.?(a|sc|com|tech|e)\b/i, "Post Graduate"],
  [/grad|bachelor|degree|b\.?(a|sc|com|tech|e|ed)\b/i, "Graduate"],
  [/diploma|polytechnic/i, "Diploma"],
  [/\biti\b|industrial training/i, "ITI"],
  [/12th|inter|higher secondary|10\+2|hsc/i, "12th Pass"],
  [/10th|matric|sslc|secondary/i, "10th Pass"],
];
/* ---- Fixed education categories (canonical landing pages) ------- */
const QUALS = [
  { slug: "10th-pass", name: "10th Pass", h1: "Government Jobs for 10th Pass",
    re: /\b10th\b|matric|sslc/i,
    desc: "Latest government job notifications for 10th pass candidates in India — railways, defence, police and state posts, with eligibility, dates and how to apply.",
    intro: [
      "Passing 10th class is a genuine entry point into government service. The railways, defence and paramilitary forces, state police and various state boards all recruit at the matriculation level for posts that offer real security, allowances and a career that can grow through promotions and further study.",
      "Most 10th-level exams test a common core — basic mathematics, reasoning, general awareness and a language — so one steady preparation effort keeps several doors open. Uniformed posts add physical standards, so start fitness work early. Every listing below links to the official notification; always verify the details there before applying." ],
    guideSlugs: ["government-jobs-after-10th", "railway-ntpc-vs-group-d", "government-job-eligibility-india"] },
  { slug: "12th-pass", name: "12th Pass", h1: "Government Jobs for 12th Pass",
    re: /\b12th\b|intermediate|higher secondary|hsc|\+2/i,
    desc: "Latest government job notifications for 12th pass candidates — SSC CHSL, railways, defence, police and state recruitment, with eligibility, dates and how to apply.",
    intro: [
      "Completing 12th opens some of the most popular doors in government recruitment: SSC CHSL for central clerical posts, railway NTPC undergraduate categories, defence entries designed for school-leavers, police constable posts and a wide range of state jobs. These are secure careers you can begin right away — many candidates also complete a degree alongside and step up to graduate-level exams later.",
      "The exams at this level share a familiar core of reasoning, quantitative aptitude, English and general awareness, with skill tests such as typing for some posts. Check each notification's exact eligibility and cut-off dates below, and confirm everything on the official website before you apply." ],
    guideSlugs: ["government-jobs-after-12th", "how-to-join-defence-forces-after-12th", "ssc-cgl-vs-chsl-difference"] },
  { slug: "graduate", name: "Graduate", h1: "Government Jobs for Graduates",
    re: /graduat|bachelor|\bdegree\b|b\.?\s?a\b|b\.?sc|b\.?com/i,
    desc: "Latest government job notifications for graduates — SSC CGL, banking (IBPS/SBI), UPSC, railways, state PSC and PSU recruitment, with eligibility, dates and how to apply.",
    intro: [
      "A graduate degree in any discipline unlocks the widest and best-paying range of government jobs in India: SSC CGL for central ministries, Probationary Officer and Clerk posts in public sector banks, graduate-level railway categories, state PSC services and, for the most ambitious, the UPSC Civil Services. Responsibility, pay and long-term growth are all a step above the school-level entries.",
      "Because most graduate exams test the same core subjects, a single foundation of preparation lets you attempt several of them from one effort. Browse the live notifications below — each page summarises vacancies, eligibility, dates and fees, and links to the official notification for verification." ],
    guideSlugs: ["government-jobs-after-graduation", "ssc-vs-banking-vs-railway-jobs", "how-to-prepare-ssc-cgl"] },
  { slug: "engineering-diploma", name: "Engineering / Diploma", h1: "Government Jobs for Engineers & Diploma Holders",
    re: /engineer|b\.?e\b|b\.?tech|diploma|\biti\b|polytechnic/i,
    desc: "Latest government job notifications for engineering graduates, diploma and ITI holders — technical posts in railways, PSUs, defence research and state departments.",
    intro: [
      "Technical qualifications open a distinct, well-paid track in government recruitment. Engineering graduates are sought by PSUs, railway technical cadres, defence research organisations and junior-engineer posts across departments, while diploma and ITI holders qualify for a large base of technician, apprentice and skilled trade positions.",
      "Technical exams typically combine your discipline's core subjects with general aptitude, so keep both sharp. Eligibility clauses are stricter here — the exact branch, and whether a diploma is accepted where a degree is specified, matter — so read each notification's qualification clause carefully and verify on the official site before applying." ],
    guideSlugs: ["government-jobs-after-graduation", "government-job-eligibility-india", "how-to-read-government-job-notification"] },
  { slug: "post-graduate", name: "Post Graduate", h1: "Government Jobs for Post Graduates",
    re: /post\s?-?graduat|master|m\.?sc|m\.?tech|\bmba\b|ph\.?d/i,
    desc: "Latest government job notifications for post graduates — specialist officer, research, teaching and senior administrative recruitment across central and state government.",
    intro: [
      "A master's degree qualifies you for the specialist end of government recruitment: specialist officer posts in banks, research and scientific positions, assistant professor and teaching roles, and senior administrative services where a post-graduate qualification is required or gives an edge in the selection.",
      "Post-graduate recruitment is less frequent but more targeted, so track the bodies relevant to your subject closely and keep your documents ready to move quickly when notifications appear. Every listing below carries the key facts and a link to the official notification — always confirm the final eligibility there." ],
    guideSlugs: ["state-psc-vs-upsc-differences", "government-jobs-after-graduation", "interview-tips-government-job-selection"] },
];
function qualsOf(job) {
  const t = `${job.qualification || ""} ${job.title || ""}`;
  const out = QUALS.filter((q) => q.re.test(t));
  return out.length ? out : QUALS.filter((q) => q.slug === "graduate");
}
function levelsOf(job) { return qualsOf(job).map((q) => q.name); }

/* ---- States: landing pages + location matcher ------------------- */
// name, slug, and keywords (state name + major cities/abbr) to match location text.
const STATES = [
  { slug: "all-india", name: "All India / Central", kw: ["all india", "central", "pan india", "nationwide", "anywhere in india"] },
  { slug: "andhra-pradesh", name: "Andhra Pradesh", kw: ["andhra", "vijayawada", "visakhapatnam", "guntur", "tirupati", "amaravati", "nellore"] },
  { slug: "arunachal-pradesh", name: "Arunachal Pradesh", kw: ["arunachal", "itanagar"] },
  { slug: "assam", name: "Assam", kw: ["assam", "guwahati", "dispur", "namrup", "dibrugarh", "silchar"] },
  { slug: "bihar", name: "Bihar", kw: ["bihar", "patna", "gaya", "muzaffarpur", "bhagalpur"] },
  { slug: "chhattisgarh", name: "Chhattisgarh", kw: ["chhattisgarh", "raipur", "bhilai", "bilaspur"] },
  { slug: "delhi", name: "Delhi (NCR)", kw: ["delhi", "new delhi", "ncr", "nct"] },
  { slug: "goa", name: "Goa", kw: ["goa", "panaji", "vasco", "margao"] },
  { slug: "gujarat", name: "Gujarat", kw: ["gujarat", "ahmedabad", "surat", "vadodara", "gandhinagar", "rajkot"] },
  { slug: "haryana", name: "Haryana", kw: ["haryana", "gurugram", "gurgaon", "faridabad", "panchkula", "hisar", "rohtak"] },
  { slug: "himachal-pradesh", name: "Himachal Pradesh", kw: ["himachal", "shimla", "dharamshala", "mandi", "solan"] },
  { slug: "jharkhand", name: "Jharkhand", kw: ["jharkhand", "ranchi", "dhanbad", "jamshedpur", "bokaro"] },
  { slug: "karnataka", name: "Karnataka", kw: ["karnataka", "bengaluru", "bangalore", "mysuru", "mysore", "hubli", "mangalore", "belgaum"] },
  { slug: "kerala", name: "Kerala", kw: ["kerala", "thiruvananthapuram", "kochi", "cochin", "kozhikode", "thrissur"] },
  { slug: "madhya-pradesh", name: "Madhya Pradesh", kw: ["madhya pradesh", "bhopal", "indore", "jabalpur", "gwalior", "ujjain"] },
  { slug: "maharashtra", name: "Maharashtra", kw: ["maharashtra", "mumbai", "pune", "nagpur", "nashik", "aurangabad", "thane", "navi mumbai"] },
  { slug: "manipur", name: "Manipur", kw: ["manipur", "imphal"] },
  { slug: "meghalaya", name: "Meghalaya", kw: ["meghalaya", "shillong"] },
  { slug: "mizoram", name: "Mizoram", kw: ["mizoram", "aizawl"] },
  { slug: "nagaland", name: "Nagaland", kw: ["nagaland", "kohima", "dimapur"] },
  { slug: "odisha", name: "Odisha", kw: ["odisha", "orissa", "bhubaneswar", "cuttack", "rourkela"] },
  { slug: "punjab", name: "Punjab", kw: ["punjab", "ludhiana", "amritsar", "jalandhar", "patiala", "mohali", "bathinda"] },
  { slug: "rajasthan", name: "Rajasthan", kw: ["rajasthan", "jaipur", "jodhpur", "udaipur", "kota", "ajmer", "bikaner"] },
  { slug: "sikkim", name: "Sikkim", kw: ["sikkim", "gangtok"] },
  { slug: "tamil-nadu", name: "Tamil Nadu", kw: ["tamil nadu", "chennai", "coimbatore", "madurai", "tiruchirappalli", "trichy", "salem"] },
  { slug: "telangana", name: "Telangana", kw: ["telangana", "hyderabad", "warangal", "nizamabad", "secunderabad"] },
  { slug: "tripura", name: "Tripura", kw: ["tripura", "agartala"] },
  { slug: "uttar-pradesh", name: "Uttar Pradesh", kw: ["uttar pradesh", "lucknow", "kanpur", "noida", "greater noida", "ghaziabad", "varanasi", "agra", "prayagraj", "allahabad", "meerut"] },
  { slug: "uttarakhand", name: "Uttarakhand", kw: ["uttarakhand", "dehradun", "haridwar", "roorkee", "nainital", "haldwani"] },
  { slug: "west-bengal", name: "West Bengal", kw: ["west bengal", "kolkata", "calcutta", "howrah", "durgapur", "siliguri", "asansol"] },
  { slug: "jammu-kashmir", name: "Jammu & Kashmir", kw: ["jammu", "kashmir", "srinagar"] },
];
/* ---- Gulf / overseas: country landing pages ---------------------- */
const GULF = [
  { slug: "uae", name: "UAE", kw: ["uae", "united arab emirates", "dubai", "abu dhabi", "sharjah", "ajman", "ras al khaimah", "fujairah"] },
  { slug: "saudi-arabia", name: "Saudi Arabia", kw: ["saudi", "ksa", "riyadh", "jeddah", "dammam", "jubail", "mecca", "medina", "yanbu"] },
  { slug: "qatar", name: "Qatar", kw: ["qatar", "doha"] },
  { slug: "kuwait", name: "Kuwait", kw: ["kuwait"] },
  { slug: "oman", name: "Oman", kw: ["oman", "muscat", "sohar", "salalah"] },
  { slug: "bahrain", name: "Bahrain", kw: ["bahrain", "manama"] },
];
function gulfOf(job) {
  const t = `${job.location || ""} ${job.title || ""} ${job.organization || ""}`.toLowerCase();
  return GULF.find((g) => g.kw.some((k) => new RegExp(`\\b${k}\\b`).test(t))) || null;
}
function isGulf(job) { return !!gulfOf(job); }
// State recruiting bodies, for notices that carry no location ("RPSC", "UPESSC", "OUSSSC" …).
const STATE_BODIES = {
  "uttar-pradesh": /\b(UPSSSC|UPPSC|UPESSC|UPPRPB|UPPCL|UPRVUNL|UPSRTC|UPHESC|UPSESSB|UPBEB|UPNHM)\b/,
  "bihar": /\b(BPSC|BSSC|CSBC|BPSSC|BCECEB|BSPHCL|BTSC|BSEB|SHSB)\b/,
  "jharkhand": /\b(JSSC|JPSC|JUVNL)\b/,
  "rajasthan": /\b(RPSC|RSMSSB|RSSB|RVUNL|RRVUNL|JVVNL|AVVNL|RAJUVAS)\b/,
  "madhya-pradesh": /\b(MPPSC|MPESB|MPPEB|MPPKVVCL|MPSOS)\b/,
  "haryana": /\b(HPSC|HSSC|HVPNL|DHBVN|UHBVN)\b/,
  "punjab": /\b(PPSC|PSSSB|PSPCL|PSTCL)\b/,
  "himachal-pradesh": /\b(HPPSC|HPRCA|HPSSC|HPSEBL)\b/,
  "uttarakhand": /\b(UKPSC|UKSSSC|UKMSSB|UJVNL)\b/,
  "gujarat": /\b(GPSC|GSSSB|GPRB|GSECL|GUVNL|OJAS|GSRTC)\b/,
  "maharashtra": /\b(MPSC|MAHAGENCO|MAHATRANSCO|MSRTC|MHADA)\b/,
  "karnataka": /\b(KPSC|KEA|KPTCL|BESCOM)\b/,
  "tamil-nadu": /\b(TNPSC|TNUSRB|TNMRB|TANGEDCO|TNSTC)\b/,
  "andhra-pradesh": /\b(APPSC|APSLPRB|APTRANSCO)\b/,
  "telangana": /\b(TSPSC|TGPSC|TSLPRB|TGLPRB|TSGENCO|TSNPDCL|TSSPDCL)\b/,
  "odisha": /\b(OPSC|OSSC|OSSSC|OUSSSC|OSEPA|OPTCL|OHPC|OPRB)\b/,
  "west-bengal": /\b(WBPSC|WBSSC|WBPRB|WBSEDCL|WBHRB)\b/,
  "assam": /\b(ADRE|APDCL|SEBA)\b|\bAPSC\b(?!.*andhra)/,
  "chhattisgarh": /\b(CGPSC|CSPDCL|VYAPAM)\b/i,
  "jammu-kashmir": /\b(JKSSB|JKPSC)\b/,
  "delhi": /\b(DSSSB|DSEU|DMRC|DJB|NDMC)\b/,
  "tripura": /\b(TPSC|JRBT)\b/,
};
// National banks named after a state still recruit for all of India.
const NATIONAL_NAMES = /punjab (national|& sind|and sind) bank|bank of maharashtra|central bank|indian (overseas )?bank|state bank|bank of india/i;
function inferState(job) {
  const text = `${job.organization || ""} ${job.org_short || ""} ${job.title || ""}`;
  if (NATIONAL_NAMES.test(text)) return [];
  const byBody = STATES.filter((s) => STATE_BODIES[s.slug] && STATE_BODIES[s.slug].test(text));
  if (byBody.length === 1) return byBody;
  const low = text.toLowerCase();
  const byName = STATES.filter((s) => s.slug !== "all-india" && new RegExp(`\\b${s.kw[0]}\\b`).test(low));
  if (byName.length === 1) return byName;
  if (byName.length > 1) return [];
  const byCity = STATES.filter((s) => s.slug !== "all-india" && s.kw.slice(1).some((k) => new RegExp(`\\b${k}\\b`).test(low)));
  return byCity.length === 1 ? byCity : [];
}
function statesOf(job) {
  // Overseas roles must never fall into the Indian state buckets.
  if (isGulf(job)) return [];
  const loc = String(job.location || "").toLowerCase();
  // All-India jobs go under the central bucket (anyone can apply regardless of state).
  if (loc && STATES[0].kw.some((k) => loc.includes(k))) return [STATES[0]];
  const matched = loc ? STATES.filter((s) => s.slug !== "all-india" && s.kw.some((k) => loc.includes(k))) : [];
  if (matched.length) return matched;
  // Union territories without a page of their own stay in the central bucket (a Kochi employer hiring in Andaman is not a Kerala job).
  if (/andaman|nicobar|lakshadweep|puducherry|pondicherry|ladakh|chandigarh|dadra|daman|\bdiu\b/.test(loc)) return [STATES[0]];
  // No location, or one that names no state: the recruiting body usually tells us (a state PSC, a state department).
  const inferred = inferState(job);
  return inferred.length ? inferred : [STATES[0]];
}


/* parse "Rs 25,500 - 1,51,100 per month" -> {min,max,unit} for structured salary */
function parseSalary(s) {
  if (s == null) return null;
  // Accept numbers or objects the AI may return, not just strings.
  if (typeof s === "number") return s > 99 ? { min: s, max: s, unit: "MONTH" } : null;
  if (typeof s !== "string") { try { s = String(s); } catch { return null; } }
  const nums = (s.match(/[\d,]+/g) || []).map((x) => Number(x.replace(/,/g, ""))).filter((n) => n > 99);
  if (!nums.length) return null;
  const unit = /year|annum|p\.?a\.?|lpa/i.test(s) ? "YEAR" : /hour/i.test(s) ? "HOUR" : "MONTH";
  return { min: nums[0], max: nums.length > 1 ? nums[nums.length - 1] : nums[0], unit };
}

/* ---- Shared chrome ---------------------------------------------- */
const FONTS =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,700;12..96,800&family=Public+Sans:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap';

function head(o) {
  const ldJson = (x) =>
    JSON.stringify(x)
      .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const ldBlocks = (o.ld || [])
    .map((x) => `<script type="application/ld+json">${ldJson(x)}</script>`)
    .join("");
  const adsense = SITE.adsenseId
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${SITE.adsenseId}" crossorigin="anonymous"></script>`
    : "";
  return `<!doctype html>
<html lang="${o.lang || "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="nv-build" content="${BUILD_ID}">
${SITE.adsenseId ? `<meta name="google-adsense-account" content="${esc(SITE.adsenseId)}">\n` : ""}<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${esc(o.canonical)}">
${(o.alternates || []).map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}">`).join("\n")}
<meta name="theme-color" content="#14213D">
<meta name="robots" content="${o.noindex ? "noindex, follow" : "index, follow, max-image-preview:large"}">
<meta property="og:type" content="${o.ogType || "website"}">
${o.published ? `<meta property="article:published_time" content="${o.published}">` : ""}
${o.modified || o.published ? `<meta property="article:modified_time" content="${o.modified || o.published}">` : ""}
<meta property="og:site_name" content="${esc(SITE.brand)}">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:image" content="${o.image || SITE.url + "/og.png"}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${o.image || SITE.url + "/og.png"}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.brand)} Jobs" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${FONTS}"></noscript>
${o.lang === "hi" ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" media="print" onload="this.media='all'">` : ""}
<link rel="stylesheet" href="/styles.css?v=${ASSET_V["styles.css"]}">
${adsense}
${SITE.webAdsHead || ""}
${ldBlocks}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
  <a class="brand" href="/" aria-label="${esc(SITE.brand)} home">
    <span class="mark" aria-hidden="true">N<span class="dot">.</span></span>
    News-Views<span class="dot">.</span>
  </a>
  <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>
  <nav class="nav" aria-label="Primary">
${o.lang === "hi" ? `    <a href="/hi/">नौकरी</a>
    <a href="/hi/updates/result/">रिजल्ट</a>
    <a href="/hi/updates/admit-card/">एडमिट कार्ड</a>
    <a href="/hi/updates/answer-key/">आंसर की</a>
    <a href="/hi/exam/">परीक्षाएँ</a>
    <a href="/hi/tools/photo-resizer/">फोटो रिसाइज़</a>
    <a href="/quiz/">क्विज़</a>` : `    <a href="/">Jobs</a>
    <a href="/latest/">Latest</a>
    <a href="/updates/result/">Results</a>
    <a href="/updates/admit-card/">Admit Card</a>
    <a href="/tools/">Tools</a>
    <a href="/news/">Current Affairs</a>
    <a href="/exam/">Exams</a>
    <a href="/state/">States</a>`}
    <a class="lang-switch" href="${esc(o.langSwitch || (o.lang === "hi" ? "/" : "/hi/"))}" lang="${o.lang === "hi" ? "en" : "hi"}">${o.lang === "hi" ? "English" : "हिंदी"}</a>
  </nav>
</div></header>`;
}

/* Share images (og.js): rendered only in the Cloudflare Pages build (CF_PAGES) or with OG=1, never in GitHub Actions.
   Pages point at their own image only if it was actually produced; otherwise the generic /og.png. */
let OG_SET = new Set();
const ogImage = (file) => OG_SET.has(file) ? `${SITE.url}/${file}` : undefined;
function makeShareImages(jobs, updates) {
  if (process.env.GITHUB_ACTIONS || !(process.env.CF_PAGES || process.env.OG === "1")) return;
  const fact = (n, w) => n ? `${inr(n)} ${w}` : "";
  const items = [
    ...jobs.filter((j) => !isStale(j)).map((j) => ({ file: `og/jobs/${j.id}.png`, kicker: `${orgKey(j) || "Govt job"} · Recruitment`, title: j.title,
      facts: [fact(Number(j.total_vacancies), Number(j.total_vacancies) === 1 ? "post" : "posts"), j.application_end ? `Last date ${fmtDate(j.application_end)}` : "", levelsOf(j)[0] || ""] })),
    ...updates.filter((u) => UPDATE_TYPES[u.type]).slice(0, 400).map((u) => ({ file: `og/updates/${u.id}.png`, kicker: `${u.org_short || "Update"} · ${UPDATE_TYPES[u.type].label}`,
      title: u.title, facts: [UPDATE_TYPES[u.type].label, u.date ? fmtDate(String(u.date).slice(0, 10)) : ""] })),
  ];
  const manifest = path.join(require("os").tmpdir(), `nv-og-${process.pid}.json`);
  try {
    fs.writeFileSync(manifest, JSON.stringify(items));
    require("child_process").execFileSync(process.execPath, [path.join(ROOT, "og.js"), manifest, DIST], { stdio: "inherit", timeout: 12 * 60 * 1000 });
  } catch (e) { console.log("Share images skipped: " + e.message); }
  OG_SET = new Set(items.map((it) => it.file).filter((f) => fs.existsSync(path.join(DIST, f))));
}
// Telegram channel (data/telegram.json, refreshed by tools-dev/telegram-info.js). The "Join" buttons appear only
// once the channel is really reachable by the bot, so nothing broken is ever shown.
let TG = null;
function readTelegram() { try { const t = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "telegram.json"), "utf8")); return t && t.link ? t : null; } catch { return null; } }
const tgCta = (what) => TG ? `<p class="tg-cta"><a href="${esc(TG.link)}" target="_blank" rel="noopener">📢 Get ${what} first on Telegram — join ${esc(TG.username ? "@" + TG.username : (TG.title || "our channel"))}${TG.members >= 100 ? ` (${inr(TG.members)} members)` : ""} &rarr;</a></p>` : "";
// Newest pages, linked from the footer of every page. Googlebot spends most of its visits re-reading pages it already
// knows; this way each of those visits also passes it the newest jobs and results (set once per build in main()).
let FOOT_LATEST = "";
function footLatest(jobs, updates) {
  const J = jobs.filter((j) => statusOf(j).live).sort((a, b) => String(b.published || "").localeCompare(String(a.published || ""))).slice(0, 8);
  const U = updates.slice(0, 6);
  return `<nav class="foot-latest" aria-label="Latest notifications">
    <div><h2>Latest jobs</h2><ul>${J.map((j) => `<li><a href="/jobs/${esc(j.id)}/">${esc(j.title)}</a></li>`).join("")}</ul></div>
    <div><h2>Latest results &amp; admit cards</h2><ul>${U.map((u) => `<li><a href="/updates/${esc(u.id)}/">${esc(u.title)}</a></li>`).join("")}</ul></div>
  </nav>`;
}
function foot() {
  return `<footer class="site-foot"><div class="wrap">
  ${FOOT_LATEST}
  <span>&copy; ${BUILT.getFullYear()} ${esc(SITE.brand)} &middot; Updated <time datetime="${BUILT.toISOString()}">${fmtDate(IST_DATE)}, ${IST_TIME} IST</time></span>
  <span class="links">
    <a href="/about/">About</a>
    <a href="/editorial-policy/">How we verify</a>
    <a href="/contact/">Contact</a>
    <a href="/privacy-policy/">Privacy</a>
    <a href="/disclaimer/">Disclaimer</a>
    <a href="/terms/">Terms</a>
    <a href="/gulf/">Gulf jobs</a>
    <a href="/guides/">Guides</a>
    <a href="/exam/">All exams</a>
    <a href="/jobs/">All jobs</a>
    <a href="/tools/photo-resizer/">Photo resizer</a>
    <a href="/tools/income-tax-calculator/">Income tax calculator</a>
    <a href="/salary/">7th pay matrix</a>
    <a href="/tools/age-calculator/">Age calculator</a>
    <a href="/tools/kruti-dev-to-unicode/">Kruti Dev to Unicode</a>
    <a href="/tools/hindi-typing-test/">Hindi typing test</a>
    <a href="/quiz/">Daily quiz</a>
    <a href="/latest/">Latest jobs</a>
    <a href="/closing-soon/">Closing soon</a>
    <a href="/walk-in-interview/">Walk-in interviews</a>
    <a href="/jobs-without-exam/">Jobs without exam</a>
    <a href="/apprentice/">Apprentice jobs</a>
    <a href="/vacancy-tracker/">Vacancy tracker</a>
    <a href="/updates/">Updates</a>
    <a href="/updates/answer-key/">Answer keys</a>
    <a href="/feed.xml">RSS</a>${TG ? `\n    <a href="${esc(TG.link)}" target="_blank" rel="noopener">Telegram</a>` : ""}
  </span>
  <p class="foot-edu">${QUALS.map((q) => `<a href="/qualification/${q.slug}/">${esc(q.name)} jobs</a>`).join(" &middot; ")}</p>
</div></footer>
<script src="/site.js?v=${ASSET_V["site.js"]}" defer></script>
</body></html>`;
}

function breadcrumbLd(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem", position: i + 1, name: t.name,
      ...(t.url ? { item: t.url } : {}),
    })),
  };
}

/* ---- Components -------------------------------------------------- */
/* Long listings: rich cards for the first `rich` jobs, then one compact line per job. Every job stays linked from the
   hub (Googlebot re-crawls hubs daily and finds new pages there) while hub pages drop from ~1 MB to ~150 KB, which
   matters on Indian mobile networks and for Core Web Vitals. Search runs on /search.json, not on page markup. */
function jobLine(job) {
  const st = statusOf(job);
  const meta = [job.total_vacancies ? `${inr(job.total_vacancies)} posts` : "", st.cls === "closed" ? "closed" : job.application_end ? `last date ${fmtDate(job.application_end)}` : ""].filter(Boolean).join(" &middot; ");
  return `<li><a href="/jobs/${esc(job.id)}/">${esc(job.title)}</a>${meta ? ` <span class="jl-meta${st.cls === "soon" ? " soon" : ""}">${meta}</span>` : ""}</li>`;
}
function jobList(list, { rich = 40, id = "", moreTitle = "More jobs" } = {}) {
  const cards = list.slice(0, rich), rest = list.slice(rich);
  return `<ul class="jobs"${id ? ` id="${id}"` : ""}>${cards.map(jobCard).join("\n")}</ul>` +
    (rest.length ? `<h2 class="section-h more-h">${esc(moreTitle)} <span class="grp-count">${rest.length}</span></h2><ul class="joblines">${rest.map(jobLine).join("")}</ul>` : "");
}
function jobCard(job) {
  const st = statusOf(job);
  return `<li><a class="job" href="/jobs/${esc(job.id)}/">
    <div class="job-top">
      <span class="org-tag">${esc(orgKey(job) || job.organization)}</span>
      ${qualsOf(job).slice(0,2).map((q)=>`<span class="qual-tag">${esc(q.name)}</span>`).join("")}
      ${st.live && isNew(job.published) ? `<span class="new-badge">NEW</span>` : ""}
      <span class="status ${st.cls}">${esc(st.label)}</span>
    </div>
    <h2>${esc(job.title)}</h2>
    <p class="post">${esc(job.post_name || "")}</p>
    <div class="meta">
      <span class="stat"><span class="n">${inr(job.total_vacancies)}</span><span class="l">Posts</span></span>
      <span class="stat"><span class="n">${job.age_max ? (job.age_min ? job.age_min + "&ndash;" : "up to ") + job.age_max : "&mdash;"}</span><span class="l">Age</span></span>
      <span class="deadline${st.cls === "soon" ? " soon" : ""}">${st.cls === "closed" && job.application_end ? "Closed on" : "Last date"} <b>${fmtDate(job.application_end)}</b></span>
    </div>
  </a></li>`;
}

function chips(levels, orgs) {
  const org = orgs.slice(0, 8).map((o) =>
    `<a class="chip chip-org" href="/organization/${slug(o.short)}/">${esc(o.short)}</a>`).join("");
  return `<nav class="chips" aria-label="Browse jobs">
    <span class="chips-label">By department</span>${org}
  </nav>`;
}

function eduSection(qualCounts) {
  const card = (q) => {
    const n = qualCounts.get(q.slug) || 0;
    return `<li><a class="edu-card" href="/qualification/${q.slug}/">
      <span class="edu-count">${n}</span>
      <span class="edu-name">${esc(q.name)}</span>
      <span class="edu-sub">${n === 1 ? "live notification" : "live notifications"}</span>
      <span class="readmore">View jobs &rarr;</span>
    </a></li>`;
  };
  return `<section class="edu-browse">
    <h2 class="section-h">Find jobs by your education</h2>
    <ul class="edu-grid">${QUALS.map(card).join("\n")}</ul>
  </section>`;
}


/* ---- Results / Admit Cards / Answer Keys / Exam Dates ------------ */
const UPDATE_TYPES = {
  "result":     { label: "Result",     plural: "Results" },
  "admit-card": { label: "Admit Card", plural: "Admit Cards" },
  "answer-key": { label: "Answer Key", plural: "Answer Keys" },
  "exam-date":  { label: "Exam Date",  plural: "Exam Dates" },
};
function readUpdates() {
  try {
    const u = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "updates.json"), "utf8"));
    return u.filter((x) => UPDATE_TYPES[x.type]).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } catch { return []; }
}
/* ---- News & Views: current affairs + notification analysis ------- */
const NEWS_TYPES = { "current-affairs": "Current Affairs", analysis: "Analysis" };
function readNews() {
  try {
    const n = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "news.json"), "utf8"));
    return (Array.isArray(n) ? n : [])
      .filter((a) => a && a.id && a.title && Array.isArray(a.body) && a.body.length)
      .map((a) => ({ ...a, id: String(a.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") }))
      .filter((a) => a.id.length >= 2)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  } catch { return []; }
}
function newsCard(a) {
  return `<li><a class="update" href="/news/${esc(a.id)}/">
    <span class="upd-type upd-${a.type === "analysis" ? "answer-key" : "result"}">${esc(NEWS_TYPES[a.type] || "News")}</span>
    <span class="upd-title">${esc(a.title)}${isNew(a.date) ? ` <span class="new-badge">NEW</span>` : ""}</span>
    <span class="upd-meta">${a.date ? fmtDate(a.date) : ""}</span>
  </a></li>`;
}
function newsBody(a) {
  return (a.body || []).map((b) =>
    `${b.h ? `<h2 class="section-h">${esc(b.h)}</h2>` : ""}${(b.p || []).map((p) => `<p>${esc(p)}</p>`).join("")}`).join("");
}
/* ---- Daily current-affairs quiz ---------------------------------- */
function readQuiz() { try { const q = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "quiz.json"), "utf8")); return Array.isArray(q) ? q : []; } catch { return []; } }
function buildQuizPage(z, all) {
  const canonical = `${SITE.url}/quiz/${z.id}/`;
  const L = "ABCD";
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Quiz", url: SITE.url + "/quiz/" }, { name: z.title, url: canonical }]),
    { "@context": "https://schema.org", "@type": "Quiz", name: z.title, url: canonical, datePublished: z.date, educationalLevel: "Competitive exams",
      about: { "@type": "Thing", name: "Current affairs" },
      hasPart: z.questions.map((q) => ({ "@type": "Question", eduQuestionType: "Multiple choice", text: q.q,
        acceptedAnswer: { "@type": "Answer", text: q.options[q.answer] },
        suggestedAnswer: q.options.filter((_, i) => i !== q.answer).map((o) => ({ "@type": "Answer", text: o })) })) },
  ];
  const more = all.filter((x) => x.id !== z.id).slice(0, 6);
  return head({ title: `${z.title} – ${z.questions.length} MCQs with Answers | ${SITE.name}`.length <= 72 ? `${z.title} – ${z.questions.length} MCQs with Answers | ${SITE.name}` : `${z.title} – MCQs with Answers`,
    desc: `Daily current affairs quiz for ${fmtDate(z.date)}: ${z.questions.length} MCQs with answers and explanations for SSC, UPSC, Banking, Railway and State PSC exams.`, canonical, ld, ogType: "article", published: z.date }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/quiz/">Quiz</a></p>
  <article>
    <p class="eyebrow">Daily quiz &middot; ${fmtDate(z.date)}</p>
    <h1>${esc(z.title)}</h1>
    <p class="lede">${z.questions.length} questions from today's news, with answers. Tap an option to check it — then read the <a href="/news/${esc(z.digest_id)}/">full current affairs digest</a>.</p>
    <ol class="quiz" id="quiz">${z.questions.map((q, i) => `<li data-a="${q.answer}"><p>${esc(q.q)}</p><div class="opts">${q.options.map((o, j) =>
      `<button class="opt" type="button" data-i="${j}">${L[j]}. ${esc(o)}</button>`).join("")}</div>
      <details class="why"><summary>Show answer</summary>Answer: <b>${L[q.answer]}. ${esc(q.options[q.answer])}</b>${q.why ? ` — ${esc(q.why)}` : ""}</details></li>`).join("")}</ol>
    <p><span class="quiz-score" id="qs" hidden></span></p>
    ${adSlot("quiz-end")}
    ${more.length ? `<section class="related"><h2 class="section-h">Previous quizzes</h2><ul class="updates">${more.map(quizCard).join("")}</ul></section>` : ""}
  </article>
</main>
<script>
(function(){var done=0,right=0,n=${z.questions.length},s=document.getElementById("qs");
document.querySelectorAll("#quiz > li").forEach(function(li){var a=+li.dataset.a;
  li.querySelectorAll(".opt").forEach(function(b){b.addEventListener("click",function(){if(li.dataset.done)return;li.dataset.done=1;done++;
    var i=+b.dataset.i;if(i===a)right++;else b.classList.add("wrong");li.querySelectorAll(".opt")[a].classList.add("right");
    li.querySelector("details").open=true;s.hidden=false;s.textContent="Score: "+right+" / "+done+(done===n?" — finished!":"");});});});})();
</script>` + foot();
}
function quizCard(z) {
  return `<li><a class="update" href="/quiz/${esc(z.id)}/"><span class="upd-type upd-exam-date">Quiz</span><span class="upd-title">${esc(z.title)}${isNew(z.date) ? ` <span class="new-badge">NEW</span>` : ""}</span><span class="upd-meta">${z.questions.length} MCQs &middot; ${fmtDate(z.date)}</span></a></li>`;
}
function buildQuizIndex(all) {
  const canonical = `${SITE.url}/quiz/`;
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Quiz", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "Daily Current Affairs Quiz", url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: all.slice(0, 60).map((z, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/quiz/${z.id}/`, name: z.title })) } }];
  return head({ title: `Daily Current Affairs Quiz ${BUILT.getFullYear()} – MCQs with Answers | ${SITE.name}`,
    desc: "Free daily current affairs quiz with answers and explanations, built from the day's government news — practice for SSC, UPSC, Banking, Railway and State PSC exams.", canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Quiz</p>
  <section class="cat-head"><p class="eyebrow">New every day</p><h1>Daily current affairs quiz</h1>
  <p class="lede">Ten questions a day from the day's government news, with answers and short explanations. Pair each quiz with its <a href="/news/">current affairs digest</a>.</p></section>
  ${all.length ? `<ul class="updates">${all.map(quizCard).join("")}</ul>` : `<p class="empty">The first quiz will appear with the next daily digest.</p>`}
</main>` + foot();
}
function buildNewsPage(a, all) {
  const canonical = `${SITE.url}/news/${a.id}/`;
  const related = all.filter((x) => x.id !== a.id).slice(0, 4);
  const job = a.job_id ? (ALL_JOBS || []).find((j) => j.id === a.job_id) : null;
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "News", url: SITE.url + "/news/" }, { name: a.title, url: canonical }]),
    { "@context": "https://schema.org", "@type": "NewsArticle", headline: a.title, url: canonical,
      datePublished: a.date, dateModified: a.date, description: a.summary || a.title,
      author: { "@type": "Organization", name: SITE.publisher },
      publisher: { "@type": "Organization", name: SITE.brand, logo: { "@type": "ImageObject", url: SITE.url + "/icon-512.png" } },
      mainEntityOfPage: canonical,
      // Top Stories and Discover need an image of at least 1200px: the related job's share card, else the site card
      image: (job && ogImage(`og/jobs/${job.id}.png`)) || SITE.url + "/og.png" },
  ];
  return head({ title: `${a.title} | ${SITE.name}`, desc: (a.summary || a.title).slice(0, 155), canonical, ld, image: job && ogImage(`og/jobs/${job.id}.png`) }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/news/">News</a></p>
  <article class="prose">
    <p class="eyebrow">${esc(NEWS_TYPES[a.type] || "News")}${a.date ? " &middot; " + fmtDate(a.date) : ""}</p>
    <h1>${esc(a.title)}</h1>
    ${a.summary ? `<p class="lede">${esc(a.summary)}</p>` : ""}
    ${newsBody(a)}
    ${(ALL_QUIZ.find((z) => z.digest_id === a.id)) ? `<p class="cta-row"><a class="btn btn-primary" href="/quiz/${esc(ALL_QUIZ.find((z) => z.digest_id === a.id).id)}/">Take today's 10-question quiz &rarr;</a></p>` : ""}
    ${(a.pointers || []).length ? `<h2 class="section-h">Key takeaways for aspirants</h2><ul>${a.pointers.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${job ? `<p class="tagrow">Related notification: <a href="/jobs/${esc(job.id)}/">${esc(job.title)}</a></p>` : ""}
    ${(a.sources || []).length ? `<h2 class="section-h">Sources</h2><ul>${a.sources.map((s) =>
      `<li><a href="${esc(s.link)}" rel="nofollow noopener" target="_blank">${esc(s.title)}</a></li>`).join("")}</ul>` : ""}
  </article>
  ${related.length ? `<section class="related"><h2 class="section-h">More from News &amp; Views</h2><ul class="updates">${related.map(newsCard).join("")}</ul></section>` : ""}
</main>` + foot();
}
function buildNewsIndex(news) {
  const canonical = `${SITE.url}/news/`;
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "News", url: canonical }])];
  return head({ title: `Exam News & Current Affairs ${BUILT.getFullYear()} | ${SITE.name}`,
    desc: "Daily current affairs for government exam aspirants, plus plain-English analysis of the latest Sarkari recruitment notifications.", canonical, ld }) + `
<main class="wrap" id="main">
  <section class="cat-head">
    <p class="eyebrow">News &amp; Views</p>
    <h1>Exam News &amp; Current Affairs</h1>
    <p class="lede">Daily current affairs drawn from official government press releases, and plain-English analysis of the recruitment notifications that matter — written for candidates preparing for SSC, UPSC, Banking, Railway and State PSC exams.</p>
  </section>
  ${news.length ? `<ul class="updates">${news.map(newsCard).join("")}</ul>`
    : `<p class="empty">The first articles are being prepared and will appear here shortly. Meanwhile, browse the <a href="/guides/">preparation guides</a> or the <a href="/updates/">latest results and admit cards</a>.</p>`}
</main>` + foot();
}
function updateCard(u) {
  return `<li><a class="update" href="/updates/${esc(u.id)}/">
    <span class="upd-type upd-${u.type}">${UPDATE_TYPES[u.type].label}</span>
    <span class="upd-title">${esc(u.title)}${isNew(u.date) ? ` <span class="new-badge">NEW</span>` : ""}</span>
    <span class="upd-meta">${esc(u.org_short || u.organization)}${u.date ? " &middot; " + fmtDate(u.date) : ""}</span>
  </a></li>`;
}
function updateGenericSteps(u) {
  const site = u.__site || "the official website";
  const what = (UPDATE_TYPES[u.type] || {}).label || "update";
  return [
    `Open the official website (${site}) and go to the Recruitment, Examination or Results section.`,
    `Find the link titled "${u.exam_name || u.org_short || u.organization} ${what}" — it is usually under Latest Updates or What's New.`,
    `Enter your registration number / roll number and date of birth or password exactly as used while applying.`,
    `Download the ${what.toLowerCase()} PDF and check that your name, roll number and other details are correct.`,
    `Save a copy and take a printout; keep it with your ID proof for any exam, document verification or interview.`,
  ];
}
function buildUpdatePage(u, all) {
  const canonical = `${SITE.url}/updates/${u.id}/`;
  const typeLabel = (UPDATE_TYPES[u.type] || {}).label || "Update";
  const rel = all.filter((x) => x.id !== u.id && (x.org_short === u.org_short || x.type === u.type)).slice(0, 4);
  const relJobs = (typeof ALL_JOBS !== "undefined" ? ALL_JOBS : []).filter((j) => (j.org_short || j.organization) === (u.org_short || u.organization)).slice(0, 2);
  const details = Array.isArray(u.details) ? u.details.filter(Boolean) : [];
  const faqs = [...(Array.isArray(u.faq_search) ? u.faq_search : []), ...(Array.isArray(u.faq) ? u.faq : [])].filter((f) => f && f.q && f.a).slice(0, 10);
  const AGG = /(rajsarkariresult|govtjobsblog|govtjobsdiary|sarkarifeed|gulfjobvacancy|gulfwalkin|gccwalkins|sarkariresult|freejobalert)\./i;
  const titleHost = (String(u.title).match(/\b(?:at|on|from|via)\s+((?:[a-z0-9-]+\.)+(?:gov\.in|nic\.in|ac\.in|edu\.in|res\.in|org\.in|co\.in|gov|org|in|com|net))\b/i) || [])[1];
  // Outbound links go to the exam body only — never to the blog/aggregator the item was first seen on.
  const notAgg = (x) => x && !AGG.test(x) && !LIB.isAggregator(hostOf(x));
  const official = notAgg(u.official_link) ? u.official_link
    : notAgg(u.official_website) ? u.official_website
    : titleHost ? `https://${titleHost.toLowerCase()}/`
    : LIB.officialHomeFor(u.title) || (notAgg(u.link) ? u.link : "");
  const officialHost = official ? hostOf(official) : "";
  const steps = Array.isArray(u.steps) && u.steps.length >= 3 ? u.steps : updateGenericSteps({ ...u, __site: officialHost || "the official website" });
  const desc = (u.summary || "").slice(0, 158);
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Updates", url: SITE.url + "/updates/" }, { name: u.title, url: canonical }]),
    { "@context": "https://schema.org", "@type": "NewsArticle", headline: u.title, datePublished: u.date,
      dateModified: u.enriched && /^\d{4}/.test(u.enriched) ? u.enriched : u.date, description: desc,
      author: { "@type": "Organization", name: SITE.publisher },
      publisher: { "@type": "Organization", name: SITE.brand, logo: { "@type": "ImageObject", url: SITE.url + "/icon-512.png" } },
      mainEntityOfPage: canonical, image: ogImage(`og/updates/${u.id}.png`) || SITE.url + "/og.png" },
    { "@context": "https://schema.org", "@type": "HowTo", name: `How to download the ${u.org_short || u.organization} ${typeLabel}`,
      step: steps.map((t, i) => ({ "@type": "HowToStep", position: i + 1, text: t })) },
  ];
  if (faqs.length) ld.push(faqLd(faqs));
  let shortT = String(u.title).replace(/\s*\(?out\)?\s*$/i, "").replace(/[\s–—:|-]+$/, "");
  if (shortT.length > 60) shortT = shortT.split(/\s+[–—:|-]\s+/)[0];
  if (shortT.length > 60) shortT = shortT.slice(0, 58).replace(/\s+\S*$/, "");
  if (!/download|check|out\b/i.test(shortT) && shortT.length < 44) shortT += u.type === "result" ? " – Check Now" : u.type === "admit-card" ? " – Download Link" : u.type === "answer-key" ? " – Download PDF" : "";
  const pageTitle = (shortT + ` | ${SITE.name}`).length <= 72 ? `${shortT} | ${SITE.name}` : shortT;
  const hiAltU = u.hi && u.hi.title ? { ...(SITE.crawlHindiDetail ? { alternates: [{ hreflang: "en", href: canonical }, { hreflang: "hi", href: `${SITE.url}/hi/updates/${u.id}/` }, { hreflang: "x-default", href: canonical }] } : {}), langSwitch: `/hi/updates/${u.id}/` } : {};
  return head({ title: pageTitle, desc, canonical, ld, ogType: "article", published: u.date, modified: u.date, image: ogImage(`og/updates/${u.id}.png`), ...hiAltU }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/updates/">Updates</a> &nbsp;&rsaquo;&nbsp; <a href="/updates/${esc(u.type)}/">${esc((UPDATE_TYPES[u.type] || {}).plural || typeLabel)}</a></p>
  <article>
    <p class="eyebrow"><span class="upd-type upd-${u.type}">${typeLabel}</span> &middot; ${esc(u.org_short || u.organization)} &middot; ${fmtDate(u.date)}${isNew(u.date) ? ` <span class="new-badge">NEW</span>` : ""}</p>
    <h1>${esc(u.title)}</h1>
    ${u.via === "official" ? `<p class="verified">✓ Verified from the official website — <a href="${esc(u.official_link || u.link)}" rel="nofollow noopener" target="_blank">${esc(hostOf(u.official_link || u.link))}</a></p>` : ""}
    <div class="prose">
      <p class="lede">${esc(u.summary)}</p>
      ${u.summary_hi ? `<p class="hindi" lang="hi">${esc(u.summary_hi)}</p>` : ""}
    </div>
    <div class="spec"><dl>
      ${row("Organisation", esc(u.organization))}
      ${row("Exam / post", esc(u.exam_name))}
      ${row("Type of update", esc(typeLabel))}
      ${row("Released on", fmtDate(u.date))}
      ${u.event_date && u.event_date !== u.date ? row(u.type === "exam-date" ? "Exam / event date" : "Date in the notice", fmtDate(u.event_date)) : ""}
      ${row("Official website", officialHost ? `<a href="${esc(official)}" rel="nofollow noopener" target="_blank">${esc(officialHost)}</a>` : "")}
    </dl></div>
    <p class="cta-row">${official ? `<a class="btn btn-primary" href="${esc(official)}" rel="nofollow noopener" target="_blank">${{ pdf: "Download the PDF from", home: "Go to the official website,", none: "Go to" }[LIB.linkKind(official, u)] || "Download / check on"} ${esc(officialHost)} &rarr;</a>` : ""}${u.official_website && u.official_link && hostOf(u.official_website) !== officialHost ? ` <a class="btn btn-ghost" href="${esc(u.official_website)}" rel="nofollow noopener" target="_blank">Official website</a>` : ""}</p>
    ${adSlot("update-mid")}
    <h2 class="section-h">How to download the ${esc(u.org_short || u.organization)} ${esc(typeLabel.toLowerCase())}</h2>
    <ol class="steps">${steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
    ${details.length ? `<div class="prose"><h2 class="section-h">What candidates should know</h2>${details.map((d) => `<p>${esc(d)}</p>`).join("")}</div>` : ""}
    ${(() => { const ex = require("./exams.js").examOf(u.title); return ex ? `<p class="cta-row"><a class="btn btn-ghost" href="/exam/${ex.slug}/">All ${esc(ex.name)} updates &rarr;</a></p>` : ""; })()}
    ${tgCta("results and admit cards")}
    ${faqSection(faqs)}
    <p class="smallprint">Always verify on the official website — ${esc(SITE.brand)} summarises publicly announced updates and is not a government body.</p>
    ${relJobs.length ? `<section class="related"><h2 class="section-h">Related jobs</h2><ul class="jobs">${relJobs.map(jobCard).join("")}</ul></section>` : ""}
    ${rel.length ? `<section class="related"><h2 class="section-h">More updates</h2><ul class="updates">${rel.map(updateCard).join("")}</ul></section>` : ""}
  </article>
</main>` + foot();
}
const UPDATE_TYPE_SEO = {
  "result":     { h1: "Sarkari Result", title: `Sarkari Result ${new Date().getFullYear()} — Latest Government Exam Results, Merit Lists & Cut-offs`,
    intro: "Every newly declared government exam result in one place — SSC, UPSC, Railway, Banking, state PSCs, police and teaching results — with step-by-step instructions to check your score and a link to the official website." },
  "admit-card": { h1: "Admit Cards", title: `Admit Card ${new Date().getFullYear()} — Download Latest Sarkari Exam Hall Tickets`,
    intro: "Newly released admit cards and hall tickets for central and state government exams, with the exact steps and credentials you need to download yours from the official website." },
  "answer-key": { h1: "Answer Keys", title: `Answer Key ${new Date().getFullYear()} — Latest Government Exam Answer Keys & Objections`,
    intro: "Official and provisional answer keys for sarkari exams as they are released, with how to download them, calculate your expected score and raise objections before the deadline." },
  "exam-date":  { h1: "Exam Dates", title: `Exam Dates ${new Date().getFullYear()} — Upcoming Government Exam Schedules`,
    intro: "Announced exam dates and schedules for upcoming government recruitment exams so you can plan your preparation and travel." },
};
function buildUpdateTypeIndex(type, list) {
  const t = UPDATE_TYPES[type], seo = UPDATE_TYPE_SEO[type];
  const canonical = `${SITE.url}/updates/${type}/`;
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Updates", url: SITE.url + "/updates/" }, { name: t.plural, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: seo.title, url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: list.slice(0, 50).map((u, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/updates/${u.id}/`, name: u.title })) } },
  ];
  const others = Object.keys(UPDATE_TYPES).filter((k) => k !== type).map((k) => `<a class="chip" href="/updates/${k}/">${UPDATE_TYPES[k].plural}</a>`).join("");
  return head({ title: seo.title.length > 62 ? seo.title.replace(/ — .*$/, ` — Latest ${t.plural} | ${SITE.name}`) : `${seo.title} | ${SITE.name}`, desc: seo.intro.slice(0, 158), canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/updates/">Updates</a></p>
  <section class="cat-head">
    <p class="eyebrow">${esc(t.plural)} &middot; ${list.length} recent</p>
    <h1>${esc(seo.h1)} &mdash; latest ${esc(t.plural.toLowerCase())}</h1>
    <p class="lede">${esc(seo.intro)}</p>
    <p class="tagrow">Also see: ${others}</p>
  </section>
  ${list.length ? `<ul class="updates">${list.map(updateCard).join("\n")}</ul>` : `<p class="empty">No ${esc(t.plural.toLowerCase())} listed yet — new ones are added automatically several times a day.</p>`}
  <div class="prose">
    <h2 class="section-h">How ${esc(t.plural.toLowerCase())} are handled here</h2>
    <p>Each entry above is written from the official announcement and links straight to the board's own website, so you can download the ${esc(t.label.toLowerCase())} from the source. We never host candidate data, and we never ask for your roll number or password — always enter those only on the official portal.</p>
    <p>New ${esc(t.plural.toLowerCase())} are added automatically through the day. Bookmark this page, or check the <a href="/updates/">all updates</a> page and the <a href="/">latest government jobs</a>.</p>
  </div>
</main>` + foot();
}
function buildLatestPage(jobs) {
  const canonical = `${SITE.url}/latest/`;
  const week = jobs.filter((j) => j.published && (BUILT - new Date(j.published + "T00:00:00+05:30")) / 86400000 <= 7);
  const list = (week.length >= 10 ? week : jobs.slice(0, 30)).filter((j) => statusOf(j).cls !== "closed");
  const todayStr = fmtDate(IST_DATE);
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Latest jobs", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: `Latest Government Jobs — ${todayStr}`, url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: list.slice(0, 50).map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title: `Sarkari Naukri Today — New Government Jobs This Week (${todayStr}) | ${SITE.name}`,
    desc: `All new government job notifications released this week, updated ${todayStr}: vacancies, eligibility, last dates and official apply links.`, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Latest jobs</p>
  <section class="cat-head">
    <p class="eyebrow">Updated ${todayStr} &middot; ${list.length} new</p>
    <h1>Latest government jobs &mdash; this week's new notifications</h1>
    <p class="lede">Every recruitment notification published in the last few days, newest first. Each page has the vacancies, eligibility, important dates and a link to apply on the official website.</p>
  </section>
  ${list.length ? jobList(list, { moreTitle: "More new jobs this week" }) : `<p class="empty">No new notifications this week yet — check the <a href="/">homepage</a> for all open jobs.</p>`}
  <div class="prose">
    <h2 class="section-h">How to use this page</h2>
    <p>Check it daily or subscribe to the <a href="/feed.xml">RSS feed</a> to catch notifications on day one — many recruitments have short application windows, and early applicants avoid last-day server problems. Jobs that are about to close are listed on the <a href="/closing-soon/">closing soon</a> page.</p>
  </div>
</main>` + foot();
}
function buildAllJobsPage(jobs) {
  const canonical = `${SITE.url}/jobs/`;
  const list = jobs.filter((j) => statusOf(j).cls !== "closed");
  const vac = list.reduce((n, j) => n + (Number(j.total_vacancies) || 0), 0);
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "All jobs", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "All open government jobs", url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: list.slice(0, 100).map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } }];
  return head({ title: `All Government Jobs ${BUILT.getFullYear()} — ${list.length} Open Sarkari Naukri Notifications | ${SITE.name}`,
    desc: `Every currently open government job notification in India — ${inr(vac)} vacancies across ${list.length} recruitments, with eligibility, last dates and official apply links.`, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; All jobs</p>
  <section class="cat-head">
    <p class="eyebrow">${list.length} open recruitments &middot; ${inr(vac)} vacancies</p>
    <h1>All open government jobs</h1>
    <p class="lede">Every recruitment that is still accepting applications, newest first. Narrow it down by <a href="/qualification/graduate/">qualification</a>, <a href="/state/">state</a> or department, or see only <a href="/latest/">this week's new jobs</a> and the ones <a href="/closing-soon/">closing soon</a>.</p>
  </section>
  ${list.length ? jobList(list, { moreTitle: "More open jobs" }) : `<p class="empty">New job notifications are being added automatically and will appear here shortly.</p>`}
</main>` + foot();
}
function buildClosingSoonPage(jobs) {
  const canonical = `${SITE.url}/closing-soon/`;
  const list = jobs.filter((j) => daysLeft(j.application_end) !== null && daysLeft(j.application_end) >= 0 && daysLeft(j.application_end) <= 10)
    .sort((a, b) => daysLeft(a.application_end) - daysLeft(b.application_end));
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Closing soon", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "Government jobs closing soon", url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: list.slice(0, 50).map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } }];
  return head({ title: `Government Jobs Closing Soon — Last Date This Week | ${SITE.name}`,
    desc: "Sarkari job notifications whose last date to apply is within the next 10 days, sorted by deadline so you don't miss one.", canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Closing soon</p>
  <section class="cat-head">
    <p class="eyebrow">Deadline within 10 days &middot; ${list.length} jobs</p>
    <h1>Government jobs closing soon</h1>
    <p class="lede">Recruitments whose last date is in the next ten days, nearest deadline first. Apply early — official portals slow down on the final day.</p>
  </section>
  ${list.length ? jobList(list, { moreTitle: "Also closing soon" }) : `<p class="empty">Nothing is closing in the next ten days. See <a href="/latest/">this week's new jobs</a>.</p>`}
</main>` + foot();
}
/* ---- Topic hubs built from the data: big searches ("walk in interview", "govt job without exam", "apprentice
   vacancy") answered with every matching open job. Matching uses each notice's own title and selection process. */
const selText = (j) => (Array.isArray(j.selection_process) ? j.selection_process.join(" ") : String(j.selection_process || "")).toLowerCase();
const TOPIC_HUBS = [
  { slug: "walk-in-interview", short: "Walk-in interviews", h1: "Walk-in Interview Government Jobs",
    test: (j) => /walk[- ]?in/i.test(`${j.title} ${j.post_name || ""}`) || /walk[- ]?in/.test(selText(j)),
    title: (n, y) => `Walk-in Interview Govt Jobs ${y} — ${n} Openings, Dates & Venues`,
    desc: (n) => `${n} government walk-in interviews open now — hospitals, AIIMS, universities, research institutes and PSUs. Interview dates, venues, eligibility and official notices.`,
    lede: "Recruitments where you attend an interview on the given date instead of applying online first — common at AIIMS and other hospitals, universities, research institutes and PSUs. Each listing links to the official notice with the date, reporting time, venue and documents to carry.",
    faq: [
      ["What is a walk-in interview?", "In a walk-in recruitment you go to the venue on the date and time given in the notification, with your documents and usually a filled application form, and are interviewed the same day. There is normally no online application, although some notices ask you to register or email your details first — always follow the notice."],
      ["What should I carry to a walk-in interview?", "Carry the documents the notification lists — typically your certificates and mark sheets, a photo ID, passport-size photographs, caste or category certificate if applicable, experience certificates and the application form. Take originals and a set of self-attested copies."],
      ["Are walk-in government jobs permanent?", "Many walk-in posts are for a fixed term, project or contract, but not all. The notification states the nature and tenure of the post, so check it before you go."],
    ] },
  { slug: "jobs-without-exam", short: "Jobs without written exam", h1: "Government Jobs Without a Written Exam",
    test: (j) => { const s = selText(j); return !!s && !/written|exam|test|cbt|computer[- ]based|prelim|mains|objective|typing|skill/.test(s) && /interview|merit|shortlist|document|walk/.test(s); },
    title: (n, y) => `Govt Jobs Without Exam ${y} — ${n} Openings (Interview / Merit Based)`,
    desc: (n) => `${n} open government jobs where selection is by interview, merit or document verification — no written exam, as stated in the official notification.`,
    lede: "Open recruitments whose official notification lists no written exam: selection is by interview, by merit in the qualifying examination, or by shortlisting and document verification. Many are fixed-term, project or contract posts; the selection process shown on each page comes from the notice itself.",
    faq: [
      ["How are candidates selected without an exam?", "Depending on the notification, selection is by interview, by merit (marks in the qualifying examination), or by shortlisting followed by document verification. Each job page shows the selection process stated in its official notice."],
      ["Are jobs without exams permanent?", "Some are, but many interview- or merit-based posts are contractual, project-based or for a fixed tenure. The notification states the nature of the post."],
      ["Can the selection process change?", "Yes. If there are many applicants, a recruiting body may add a screening test. Always read the latest notice or corrigendum on the official website."],
    ] },
  { slug: "apprentice", short: "Apprentice jobs", h1: "Apprentice Vacancies in Government & PSUs",
    test: (j) => /apprentice/i.test(`${j.title} ${j.post_name || ""}`),
    title: (n, y) => `Apprentice Vacancy ${y} — ${n} Govt & PSU Apprenticeships`,
    desc: (n) => `${n} open apprenticeships in railways, PSUs, banks and government bodies — trade, technician and graduate apprentices, with stipend, eligibility and how to apply.`,
    lede: "Trade, technician (diploma) and graduate apprenticeships in railways, public-sector companies, banks and government bodies. An apprenticeship is paid training under the Apprentices Act, 1961 — not a permanent job — and usually needs registration on the official apprenticeship portal.",
    faq: [
      ["Is an apprenticeship a permanent government job?", "No. An apprenticeship is training for a fixed period with a monthly stipend, under the Apprentices Act, 1961. It gives valuable experience, and some recruiters give weightage to their own apprentices in later recruitment, as stated in their rules."],
      ["Where do I register for apprenticeships?", "Trade apprentices usually register on the Apprenticeship India portal (apprenticeshipindia.gov.in), and graduate and technician (diploma) apprentices on the NATS portal (nats.education.gov.in). Each notification says which portal to use."],
      ["Who can apply for apprentice posts?", "It depends on the category: ITI holders for trade apprentices, diploma holders for technician apprentices and graduates for graduate apprentices, usually within an age limit and often only for those who passed recently. Check the notification for the exact eligibility."],
    ] },
];
function buildTopicHub(t, jobs) {
  const canonical = `${SITE.url}/${t.slug}/`;
  const list = jobs.filter((j) => statusOf(j).live && t.test(j)).sort(liveFirst);
  const y = BUILT.getFullYear();
  const faqs = t.faq.map(([q, a]) => ({ q, a }));
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: t.short, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: t.h1, url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: list.slice(0, 50).map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
    faqLd(faqs)];
  const others = TOPIC_HUBS.filter((x) => x.slug !== t.slug).map((x) => `<a class="chip" href="/${x.slug}/">${esc(x.short)}</a>`).join("");
  return head({ title: `${t.title(list.length, y)} | ${SITE.name}`, desc: t.desc(list.length), canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; ${esc(t.short)}</p>
  <section class="cat-head">
    <p class="eyebrow">Updated ${fmtDate(IST_DATE)} &middot; ${list.length} open</p>
    <h1>${esc(t.h1)} ${y}</h1>
    <p class="lede">${esc(t.lede)}</p>
    <p class="tagrow">Also see: ${others} <a class="chip" href="/closing-soon/">Closing soon</a> <a class="chip" href="/latest/">This week's new jobs</a></p>
  </section>
  ${list.length ? jobList(list, { moreTitle: "More openings" }) : `<p class="empty">No openings right now — new notifications are added automatically every hour. See <a href="/latest/">this week's new jobs</a>.</p>`}
  ${faqSection(faqs)}
</main>` + foot();
}
/* ---- Vacancy tracker: live statistics compiled from every notification the site tracks — figures nobody else
   publishes, so other sites and journalists have a reason to cite (and link to) news-views.in. */
function buildVacancyTracker(jobs, updates) {
  const canonical = `${SITE.url}/vacancy-tracker/`;
  const month = IST_DATE.slice(0, 7);
  const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T00:00:00Z"));
  const day = (x) => String(x || "").slice(0, 10);
  const ago = (x) => { const d = daysLeft(day(x)); return d === null ? 9999 : -d; };
  const posts = (j) => (Number(j.total_vacancies) > 0 ? Number(j.total_vacancies) : 0);
  // Only genuine new recruitment notices count: not results or marks lists filed as jobs, not notices whose last date
  // had already passed before the month began, and one entry per recruitment when the same big drive was reported
  // twice with slightly different counts (same body, within 5%, 1,000+ posts).
  const RESULTISH = /\b(result|marks|merit list|admit card|answer key|cut ?off|score ?card|reserve list|selection list)\b/i;
  const genuine = (arr, from) => {
    const ok = arr.filter((j) => !RESULTISH.test(j.title) && !(j.application_end && day(j.application_end) < from));
    const kept = [];
    for (const j of [...ok].sort((a, b) => String(b.published).localeCompare(String(a.published)))) {
      const dup = posts(j) >= 1000 && kept.some((k) => (orgKey(k) || k.organization) === (orgKey(j) || j.organization) && posts(k) >= 1000 &&
        Math.abs(posts(k) - posts(j)) / Math.max(posts(k), posts(j)) <= 0.05);
      if (!dup) kept.push(j);
    }
    return kept;
  };
  // When a notice came out: its application start date if that is earlier than the day the site first saw it (notices
  // already open when tracking began), otherwise the day it was first seen. A September notice still open in October
  // is not counted as an October notification.
  const released = (j) => { const p = day(j.published), s = day(j.application_start); return /^\d{4}-\d{2}-\d{2}$/.test(s) && s < p ? s : p; };
  const weekAgo = new Date(Date.parse(IST_DATE + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10);
  const M = genuine(jobs.filter((j) => released(j).startsWith(month)), month + "-01");
  const W = genuine(jobs.filter((j) => released(j) >= weekAgo && released(j) <= IST_DATE), weekAgo);
  const sum = (arr) => arr.reduce((n, j) => n + posts(j), 0);
  const tally = (arr, keysOf) => {
    const m = new Map();
    for (const j of arr) for (const k of keysOf(j)) { const v = m.get(k) || { n: 0, p: 0 }; v.n++; v.p += posts(j); m.set(k, v); }
    return [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.p - a.p || b.n - a.n);
  };
  const byState = tally(M, (j) => statesOf(j).map((s) => s.name));
  const byDept = tally(M, (j) => [orgKey(j) || j.organization || "Other"]).slice(0, 15);
  const byQual = tally(M, (j) => qualsOf(j).map((q) => q.name));
  const top = [...M].sort((a, b) => posts(b) - posts(a)).filter((j) => posts(j) > 0).slice(0, 10);
  // last 8 weeks (Monday to Sunday, IST)
  const today = new Date(IST_DATE + "T00:00:00Z"), dow = (today.getUTCDay() + 6) % 7;
  const since = SITE.trackingSince || "2026-10-14";   // the day the site began tracking notifications
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(today.getTime() - (dow + 7 * i) * 86400000), end = new Date(start.getTime() + 6 * 86400000);
    const a = start.toISOString().slice(0, 10), b = end.toISOString().slice(0, 10);
    if (b < since) continue;
    const inW = genuine(jobs.filter((j) => released(j) >= a && released(j) <= b), a);
    weeks.push({ label: `${fmtDate(a).replace(/ \d{4}$/, "")}${a < since ? " (partial)" : ""}`, n: inW.length, p: sum(inW) });
  }
  const updM = updates.filter((u) => day(u.date).startsWith(month));
  const updBy = Object.keys(UPDATE_TYPES).map((k) => ({ k: UPDATE_TYPES[k].plural, n: updM.filter((u) => u.type === k).length }));
  const bars = (rows, val, fmt) => { const max = Math.max(1, ...rows.map(val)); return `<ul class="bars">${rows.map((r) => `<li><span class="bar-l">${esc(r.k || r.label)}</span><span class="bar-t"><span class="bar-f" style="width:${(val(r) / max * 100).toFixed(1)}%"></span></span><span class="bar-v">${fmt(r)}</span></li>`).join("")}</ul>`; };
  const fmtNP = (r) => `${inr(r.p)} posts · ${r.n}`;
  const title = `Govt Job Vacancy Tracker ${monthName}: ${inr(sum(M))} Posts in ${inr(M.length)} Notifications`;
  const desc = `Live statistics of Indian government job notifications in ${monthName}: ${inr(M.length)} notifications and ${inr(sum(M))} posts so far — by state, department and qualification, with the biggest recruitments. Updated hourly.`;
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Vacancy tracker", url: canonical }]),
    { "@context": "https://schema.org", "@type": "Dataset", name: `Indian government job vacancy statistics — ${monthName}`, description: desc, url: canonical,
      creator: { "@type": "Organization", name: SITE.brand, url: SITE.url + "/" }, temporalCoverage: `${month}-01/${IST_DATE}`, spatialCoverage: "India",
      variableMeasured: ["Number of recruitment notifications", "Number of posts (vacancies)"], isAccessibleForFree: true, dateModified: BUILT.toISOString() }];
  return head({ title: `${title} | ${SITE.name}`, desc, canonical, ld }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Vacancy tracker</p>
  <h1>Government Job Vacancy Tracker — ${esc(monthName)}</h1>
  <p class="lede">Every central and state government recruitment notification tracked by ${esc(SITE.brand)} this month, added up. Updated ${fmtDate(IST_DATE)}, ${IST_TIME} IST.</p>
  <div class="stats" aria-label="This month">
    <div class="stat-box"><span class="n">${inr(M.length)}</span><span class="l">New notifications in ${esc(monthName.split(" ")[0])}</span></div>
    <div class="stat-box"><span class="n">${inr(sum(M))}</span><span class="l">Posts in ${esc(monthName.split(" ")[0])}</span></div>
    <div class="stat-box"><span class="n">${inr(W.length)}</span><span class="l">New notifications, last 7 days</span></div>
    <div class="stat-box"><span class="n">${inr(updM.length)}</span><span class="l">Results, admit cards &amp; keys</span></div>
  </div>
  <h2 class="section-h">Biggest recruitments this month</h2>
  <ol class="top-list">${top.map((j) => `<li><a href="/jobs/${esc(j.id)}/">${esc(j.title)}</a> <span class="jl-meta">${inr(posts(j))} posts${j.application_end ? ` &middot; last date ${fmtDate(j.application_end)}` : ""}</span></li>`).join("")}</ol>
  <h2 class="section-h">Posts by state</h2>
  ${bars(byState.slice(0, 20), (r) => r.p, fmtNP)}
  <h2 class="section-h">Top recruiting departments</h2>
  ${bars(byDept, (r) => r.p, fmtNP)}
  <h2 class="section-h">By qualification</h2>
  ${bars(byQual, (r) => r.p, fmtNP)}
  <h2 class="section-h">Notifications per week</h2>
  ${bars(weeks, (r) => r.n, (r) => `${r.n} · ${inr(r.p)} posts`)}
  <h2 class="section-h">Results, admit cards and answer keys this month</h2>
  ${bars(updBy, (r) => r.n, (r) => String(r.n))}
  <div class="prose">
    <h2 class="section-h">How these numbers are counted</h2>
    <p>Figures cover the recruitment notifications ${esc(SITE.brand)} tracked from official websites and job-news sources since the start of the month (dates in IST; tracking began on ${fmtDate(since)}). A notice counts in the month (or week) it came out — its application start date when known — so a notification from September that is still open is not counted again in October. Results, marks lists and notices whose last date had already passed are not counted, and a big recruitment reported twice is counted once. Weeks before tracking began are incomplete and marked “partial”. "Posts" is the number of vacancies stated in each notice; notices that do not state a number are counted as notifications but add no posts. A recruitment open to candidates from several states is counted in each of them, so the state rows add up to more than the total. Duplicate reports of the same recruitment are merged. See <a href="/editorial-policy/">how we verify notifications</a>.</p>
    <p>You are welcome to quote these figures — please link to this page as the source.</p>
  </div>
</main>` + foot();
}
function buildUpdatesIndex(updates) {
  const canonical = SITE.url + "/updates/";
  const groups = Object.keys(UPDATE_TYPES).map((k) => {
    const list = updates.filter((u) => u.type === k);
    return list.length ? `<section class="upd-group">
      <h2 class="section-h"><a href="/updates/${k}/">${UPDATE_TYPES[k].plural}</a> <span class="grp-count">${list.length}</span></h2>
      <ul class="updates">${list.slice(0, 20).map(updateCard).join("\n")}</ul>${list.length > 20 ? `<p class="backlink"><a href="/updates/${k}/">All ${list.length} ${UPDATE_TYPES[k].plural.toLowerCase()} &rarr;</a></p>` : ""}</section>` : "";
  }).join("\n");
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Updates", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "Sarkari Results, Admit Cards & Answer Keys", url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: updates.slice(0, 50).map((u, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/updates/${u.id}/`, name: u.title })) } },
  ];
  return head({ title: `Sarkari Result, Admit Card & Answer Key ${BUILT.getFullYear()} — Latest Updates | ${SITE.name}`,
    desc: "Latest sarkari results, admit cards, answer keys and exam dates in one place — updated automatically with links to the official websites.", canonical, ld }) + `
<main class="wrap" id="main">
  <section class="cat-head">
    <p class="eyebrow">Updates &middot; ${updates.length} recent</p>
    <h1>Results, Admit Cards &amp; Answer Keys</h1>
    <p class="lede">The latest sarkari results, admit cards, answer keys and exam dates — each linking straight to the official website so you can verify and download.</p>
  </section>
  ${groups || '<p class="empty">New updates are added automatically and will appear here shortly.</p>'}
</main>` + foot();
}

let HI_BROWSE = new Set();   // English browse paths with an indexable Hindi twin (set by the Hindi build)
const hiAltFor = (en) => HI_BROWSE.has(en) ? { alternates: [{ hreflang: "en", href: SITE.url + en }, { hreflang: "hi", href: SITE.url + "/hi" + en }, { hreflang: "x-default", href: SITE.url + en }], langSwitch: "/hi" + en } : {};
function buildQualPage(q, list) {
  const canonical = `${SITE.url}/qualification/${q.slug}/`;
  const live = list.filter((j) => statusOf(j).cls !== "closed");
  const sorted = [...list].sort(liveFirst);
  const guides = (ALL_GUIDES || []).filter((g) => q.guideSlugs.includes(g.slug));
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: q.name, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: q.h1, url: canonical, description: q.desc,
      mainEntity: { "@type": "ItemList", itemListElement: sorted.slice(0, 50).map((j, i) => ({
        "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title: `${q.h1} ${BUILT.getFullYear()} — Latest Notifications | ${SITE.name}`, desc: q.desc, canonical, ld, ...hiAltFor(`/qualification/${q.slug}/`) }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; ${esc(q.name)}</p>
  <section class="cat-head">
    <p class="eyebrow">Browse by education &middot; ${live.length} live</p>
    <h1>${esc(q.h1)}</h1>
    <div class="prose qual-intro">${q.intro.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
  </section>
  ${sorted.length ? jobList(sorted)
    : `<p class="empty">No live notifications in this category right now — new jobs are added automatically several times a day, so check back soon or <a href="/">browse all current jobs</a>.</p>`}
  ${guides.length ? `<section class="related">
    <h2 class="section-h">Guides for ${esc(q.name)} candidates</h2>
    <ul class="guides">${guides.map((g) => `<li><a class="guide-card" href="/guides/${g.slug}/"><h3>${esc(g.meta.title)}</h3><p>${esc(g.meta.description || "")}</p><span class="readmore">Read guide &rarr;</span></a></li>`).join("")}</ul>
  </section>` : ""}
</main>` + foot();
}

/* ---- Home ------------------------------------------------------- */
function buildStatePage(st, list) {
  const canonical = `${SITE.url}/state/${st.slug}/`;
  const sorted = [...list].sort(liveFirst);
  const live = list.filter((j) => statusOf(j).cls !== "closed");
  const h1 = st.slug === "all-india" ? "All India & Central Government Jobs" : `${st.name} Government Jobs`;
  const desc = st.slug === "all-india"
    ? "Latest all-India and central government job notifications — open to candidates from every state, with eligibility, dates and how to apply."
    : `Latest ${st.name} government job notifications — state and central vacancies open to ${st.name} candidates, with eligibility, last dates and how to apply.`;
  const intro = st.slug === "all-india"
    ? `These are central government and all-India recruitments that anyone across the country can apply for, regardless of home state. Each listing links to the official notification so you can verify the details before applying.`
    : `This page brings together government job notifications relevant to ${st.name} — both state-level recruitments and all-India posts open to candidates from ${st.name}. Every listing shows the key facts and links to the official notification. New jobs are added automatically several times a day.`;
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: st.name, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: h1, url: canonical, description: desc,
      mainEntity: { "@type": "ItemList", itemListElement: sorted.slice(0, 50).map((j, i) => ({
        "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title: `${h1} ${BUILT.getFullYear()} — Latest Notifications | ${SITE.name}`, desc, canonical, ld, ...hiAltFor(`/state/${st.slug}/`) }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/state/">States</a> &nbsp;&rsaquo;&nbsp; ${esc(st.name)}</p>
  <section class="cat-head">
    <p class="eyebrow">Browse by state &middot; ${live.length} live</p>
    <h1>${esc(h1)}</h1>
    <p class="lede">${esc(intro)}</p>
  </section>
  ${(() => {
    const min = Number(SITE.minComboJobs || 3);
    const avail = QUALS.filter((q) => list.filter((j) => qualsOf(j).some((x) => x.slug === q.slug) && statusOf(j).cls !== "closed").length >= min);
    return avail.length ? `<nav class="chips" aria-label="By qualification">${avail.map((q) =>
      `<a class="chip" href="/state/${st.slug}/${q.slug}/">${esc(st.name)} jobs for ${esc(q.name)}</a>`).join("")}</nav>` : "";
  })()}
  ${sorted.length ? jobList(sorted)
    : `<p class="empty">No live notifications for ${esc(st.name)} right now — new jobs are added automatically several times a day. Meanwhile, <a href="/state/all-india/">browse all-India jobs</a> open to everyone, or <a href="/">see all current jobs</a>.</p>`}
</main>` + foot();
}
/* Long-tail landing pages: "<State> government jobs for <qualification>".
   Generated only where enough live jobs exist, so no page is thin. */
function buildStateQualPage(st, q, list) {
  const canonical = `${SITE.url}/state/${st.slug}/${q.slug}/`;
  const sorted = [...list].sort(liveFirst);
  const live = list.filter((j) => statusOf(j).cls !== "closed");
  const place = st.slug === "all-india" ? "All India" : st.name;
  const h1 = `${place} Government Jobs for ${q.name}`;
  const desc = `Latest ${place} government job notifications for ${q.name} candidates — ${live.length} live vacancies with eligibility, last dates, salary and how to apply.`;
  const intro = st.slug === "all-india"
    ? `This page lists central and all-India government recruitments open to ${q.name} candidates from anywhere in the country. Each notification below shows the vacancies, eligibility and last date, and links to the official source.`
    : `This page brings together government job notifications open to ${q.name} candidates in ${st.name} — both ${st.name} state recruitments and all-India posts that ${st.name} candidates can apply for. New notifications are added automatically several times a day.`;
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: st.name, url: `${SITE.url}/state/${st.slug}/` }, { name: q.name, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: h1, url: canonical, description: desc,
      mainEntity: { "@type": "ItemList", itemListElement: sorted.slice(0, 50).map((j, i) => ({
        "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title: `${h1} ${BUILT.getFullYear()} — ${live.length} Live Vacancies | ${SITE.name}`, desc, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/state/${st.slug}/">${esc(st.name)}</a> &nbsp;&rsaquo;&nbsp; ${esc(q.name)}</p>
  <section class="cat-head">
    <p class="eyebrow">${esc(place)} &middot; ${esc(q.name)} &middot; ${live.length} live</p>
    <h1>${esc(h1)}</h1>
    <p class="lede">${esc(intro)}</p>
  </section>
  ${jobList(sorted)}
  <p class="tagrow">Also see: <a href="/state/${st.slug}/">all ${esc(st.name)} jobs</a> &middot; <a href="/qualification/${q.slug}/">all ${esc(q.name)} jobs</a></p>
</main>` + foot();
}
function buildGulfPage(g, list) {
  const canonical = `${SITE.url}/gulf/${g.slug}/`;
  const sorted = [...list].sort(liveFirst);
  const live = list.filter((j) => statusOf(j).cls !== "closed");
  const h1 = `${g.name} Jobs for Indians`;
  const desc = `Latest ${g.name} job vacancies for Indian candidates — ${live.length} openings with salary, requirements and how to apply. Updated daily.`;
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Gulf Jobs", url: SITE.url + "/gulf/" }, { name: g.name, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: h1, url: canonical, description: desc,
      mainEntity: { "@type": "ItemList", itemListElement: sorted.slice(0, 50).map((j, i) => ({
        "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title: `${h1} ${BUILT.getFullYear()} — ${live.length} Live Vacancies | ${SITE.name}`, desc, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/gulf/">Gulf Jobs</a> &nbsp;&rsaquo;&nbsp; ${esc(g.name)}</p>
  <section class="cat-head">
    <p class="eyebrow">Overseas &middot; ${live.length} live</p>
    <h1>${esc(h1)}</h1>
    <p class="lede">Current job vacancies in ${esc(g.name)} open to Indian candidates, including walk-in interviews and direct recruitment. Each listing shows the role, requirements and how to apply, and links to the original source so you can verify the details before applying.</p>
  </section>
  ${sorted.length ? jobList(sorted)
    : `<p class="empty">No ${esc(g.name)} vacancies listed right now — new overseas jobs are added automatically several times a day. Meanwhile, <a href="/gulf/">browse all Gulf jobs</a>.</p>`}
  <div class="prose"><h2 class="section-h">Before you apply for a job in ${esc(g.name)}</h2>
    <p>Always verify the recruiting agency and the employer before paying any fee. Registered recruitment agents in India are licensed by the Ministry of External Affairs, and genuine employers do not ask candidates for large upfront payments. Check the offer letter, the contract terms and the visa type carefully, and keep copies of everything you sign.</p>
    <p>Listings on this page are collected from public recruitment sources and are provided for information only. ${esc(SITE.brand)} is not a recruitment agency and does not process applications or charge candidates.</p>
  </div>
</main>` + foot();
}
function buildGulfIndex(counts) {
  const canonical = `${SITE.url}/gulf/`;
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Gulf Jobs", url: canonical }])];
  const card = (g) => {
    const n = counts.get(g.slug) || 0;
    return `<li><a class="edu-card" href="/gulf/${g.slug}/"><span class="edu-count">${n}</span><span class="edu-name">${esc(g.name)}</span><span class="edu-sub">${n === 1 ? "live job" : "live jobs"}</span></a></li>`;
  };
  return head({ title: `Gulf Jobs for Indians ${BUILT.getFullYear()} — UAE, Saudi, Qatar, Kuwait, Oman | ${SITE.name}`,
    desc: "Latest Gulf job vacancies for Indian candidates in UAE, Saudi Arabia, Qatar, Kuwait, Oman and Bahrain — walk-in interviews and direct recruitment, updated daily.", canonical, ld }) + `
<main class="wrap" id="main">
  <section class="cat-head">
    <p class="eyebrow">Overseas jobs</p>
    <h1>Gulf Jobs for Indians</h1>
    <p class="lede">Job vacancies across the Gulf — UAE, Saudi Arabia, Qatar, Kuwait, Oman and Bahrain — open to Indian candidates, including walk-in interviews and direct company recruitment. New openings are added automatically every day.</p>
  </section>
  <ul class="edu-grid states-grid">${GULF.map(card).join("")}</ul>
</main>` + foot();
}
function buildStatesIndex(stateCounts) {
  const canonical = `${SITE.url}/state/`;
  const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "States", url: canonical }])];
  const card = (s) => {
    const n = stateCounts.get(s.slug) || 0;
    return `<li><a class="edu-card" href="/state/${s.slug}/">
      <span class="edu-count">${n}</span>
      <span class="edu-name">${esc(s.name)}</span>
      <span class="edu-sub">${n === 1 ? "live job" : "live jobs"}</span>
    </a></li>`;
  };
  return head({ title: `Government Jobs by State ${BUILT.getFullYear()} — Statewise Sarkari Naukri | ${SITE.name}`,
    desc: "Browse the latest government job notifications by state — Uttar Pradesh, Bihar, Maharashtra, Rajasthan and every other state, plus all-India central jobs.", canonical, ld, ...hiAltFor("/state/") }) + `
<main class="wrap" id="main">
  <section class="cat-head">
    <p class="eyebrow">Browse by state</p>
    <h1>Government Jobs by State</h1>
    <p class="lede">Find the latest Sarkari Naukri notifications for your state, plus all-India central government jobs open to everyone.</p>
  </section>
  <ul class="edu-grid states-grid">${STATES.map(card).join("\n")}</ul>
</main>` + foot();
}
function stateSection(stateCounts) {
  // top states by live count, then a link to the full states index
  const ranked = STATES.filter((s) => (stateCounts.get(s.slug) || 0) > 0)
    .sort((a, b) => (stateCounts.get(b.slug) || 0) - (stateCounts.get(a.slug) || 0));
  const show = ranked.slice(0, 11);
  if (!show.length) return "";
  return `<section class="state-browse">
    <div class="hu-head"><h2 class="section-h">Jobs by state</h2><a class="backlink" href="/state/">All states &rarr;</a></div>
    <nav class="chips" aria-label="Browse jobs by state">
      ${show.map((s) => `<a class="chip" href="/state/${s.slug}/">${esc(s.name)} <span class="chip-n">${stateCounts.get(s.slug)}</span></a>`).join("")}
    </nav>
  </section>`;
}
function buildHome(jobs, levels, orgs, guides, qualCounts, updates, stateCounts, news) {
  const sorted = [...jobs].sort(liveFirst);
  const title = `Latest Government Jobs ${BUILT.getFullYear()} — Sarkari Naukri Notifications | ${SITE.name}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "Organization", name: SITE.brand,
      url: SITE.url + "/", logo: SITE.url + "/icon-512.png",
      description: `${SITE.brand} is an independent platform that publishes the latest Indian government job notifications and in-depth, fact-checked preparation guides. It is not a government body and never charges candidates a fee.`,
      ...(TG && TG.username ? { sameAs: [`https://t.me/${TG.username}`] } : {}) },
    { "@context": "https://schema.org", "@type": "WebSite", name: SITE.brand, url: SITE.url + "/",
      potentialAction: { "@type": "SearchAction", target: `${SITE.url}/?q={search_term_string}`, "query-input": "required name=search_term_string" } },
    { "@context": "https://schema.org", "@type": "CollectionPage",
      name: title, url: SITE.url + "/",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: sorted.slice(0, 50).map((j, i) => ({
          "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title,
        })),
      } },
    breadcrumbLd([{ name: "Jobs", url: SITE.url + "/" }]),
  ];
  const live = sorted.filter((j) => statusOf(j).cls !== "closed");
  const closingSoon = sorted.filter((j) => statusOf(j).cls === "soon");
  const totalPosts = live.reduce((s, j) => s + (Number(j.total_vacancies) || 0), 0);   // open jobs only, like /jobs/
  const homeDesc = `Sarkari Naukri ${BUILT.getFullYear()}: ${live.length} live government job notifications, ${totalPosts ? inr(totalPosts) + "+ vacancies" : "all vacancies"}, results, admit cards, answer keys, daily current affairs quiz and free exam tools.`;
  const glanceCol = (t, href, items) => `<section class="glance-col"><h2><a href="${href}">${t}</a></h2><ul>${items.join("")}</ul><a class="glance-more" href="${href}">View all &rarr;</a></section>`;
  const byType = (t) => (updates || []).filter((u) => u.type === t).slice(0, 10).map((u) => `<li><a href="/updates/${esc(u.id)}/">${esc(u.title)}</a>${isNew(u.date) ? ` <span class="new-badge">NEW</span>` : ""}</li>`);
  const glance = `<div class="glance" aria-label="Latest at a glance">
    ${glanceCol("Latest Jobs", "/latest/", live.slice(0, 10).map((j) => `<li><a href="/jobs/${esc(j.id)}/">${esc(j.title)}</a>${isNew(j.published) ? ` <span class="new-badge">NEW</span>` : ""}</li>`))}
    ${glanceCol("Results", "/updates/result/", byType("result"))}
    ${glanceCol("Admit Cards", "/updates/admit-card/", byType("admit-card"))}
  </div>`;
  return head({ title, desc: homeDesc, canonical: SITE.url + "/", ld,
    alternates: jobs.filter((j) => j.hi && j.hi.title).length < 5 ? [] : [{ hreflang: "en", href: SITE.url + "/" }, { hreflang: "hi", href: SITE.url + "/hi/" }, { hreflang: "x-default", href: SITE.url + "/" }] }) + `
<main class="wrap" id="main">
  <section class="hero">
    <p class="eyebrow">${esc(SITE.section)} &middot; Updated <time datetime="${BUILT.toISOString()}">${fmtDate(IST_DATE)}, ${IST_TIME} IST</time></p>
    <h1>Government jobs, without the clutter.</h1>
    <p>${esc(SITE.tagline)}</p>
    <div class="search-row">
      <input class="search" id="q" type="search" placeholder="Search all jobs, results &amp; admit cards — post, department, exam…" aria-label="Search jobs, results and admit cards" autocomplete="off">
    </div>
    <p class="count" id="count" data-total="${live.length}">${live.length} open jobs</p>
    <nav class="hero-quick" aria-label="Browse by education">
      <span class="hq-label">Browse:</span>
      ${QUALS.map((q) => `<a class="hq-pill" href="/qualification/${q.slug}/">${esc(q.name)}</a>`).join("")}
      ${TOPIC_HUBS.map((t) => `<a class="hq-pill" href="/${t.slug}/">${esc(t.short)}</a>`).join("")}
    </nav>
    ${tgCta("every new notification")}
  </section>

  <div class="stats" aria-label="At a glance">
    <div class="stat-box"><span class="n">${live.length}</span><span class="l">Live notifications</span></div>
    <a class="stat-box" href="/vacancy-tracker/"><span class="n">${totalPosts ? inr(totalPosts) + "+" : "—"}</span><span class="l">Total vacancies &rarr;</span></a>
    <div class="stat-box"><span class="n">${orgs.length}</span><span class="l">Departments</span></div>
    <div class="stat-box"><span class="n">Daily</span><span class="l">Updated &amp; free</span></div>
  </div>

  ${glance}
  <nav class="tagrow" aria-label="Popular exams"><b>Popular exams:</b> ${require("./exams.js").EXAMS.slice(0, 22).map((e) => `<a class="chip" href="/exam/${e.slug}/">${esc(e.name)}</a>`).join("")} <a class="chip" href="/exam/">All exams &rarr;</a></nav>

  ${(updates && updates.length) ? `<section class="home-updates">
    <div class="hu-head"><h2 class="section-h">📢 Latest updates</h2><a class="backlink" href="/updates/">All updates &rarr;</a></div>
    <ul class="updates">${updates.slice(0,6).map(updateCard).join("")}</ul>
  </section>` : ""}

  ${(news && news.length) ? `<section class="home-news">
    <div class="hu-head"><h2 class="section-h">📰 News &amp; Views</h2><a class="backlink" href="/news/">All news &rarr;</a></div>
    <ul class="updates">${news.slice(0,4).map(newsCard).join("")}</ul>
  </section>` : ""}

  ${eduSection(qualCounts)}

  ${stateSection(stateCounts)}

  ${chips(levels, orgs)}

  ${closingSoon.length ? `<section class="closing" id="closing-sec">
    <h2 class="section-h">⏳ Closing soon</h2>
    <ul class="jobs">${closingSoon.slice(0,3).map(jobCard).join("\n")}</ul>
  </section>` : ""}

  <h2 class="section-h list-h" id="list-h">Latest government jobs</h2>
  <div id="results" hidden></div>
  ${live.length ? `<div id="home-list">${jobList(live.slice(0, Number(SITE.homeMax || 300)), { id: "list", moreTitle: "More open jobs" })}
    <p class="cta-row"><a class="btn btn-ghost" href="/jobs/">See all ${live.length} open jobs &rarr;</a> <a class="btn btn-ghost" href="/updates/">Results &amp; admit cards &rarr;</a></p>
  </div>
  <p class="empty" id="empty" hidden>No jobs match your search — try a department (SSC, RRB), a post, or a qualification.</p>` :
  `<p class="empty">New job notifications are being added automatically and will appear here shortly.</p>`}

  ${TOOL_DEFS.length ? `<section class="home-tools">
    <h2 class="section-h">🧰 Free tools</h2>
    <ul class="tool-list">${["photo-resizer", "hindi-typing-test", "kruti-dev-to-unicode", "age-calculator", "income-tax-calculator", "7th-pay-commission-salary-calculator"]
      .map((sl) => TOOL_DEFS.find((d) => d.slug === sl)).filter(Boolean)
      .map((d) => `<li><a class="tool-card" href="/tools/${d.slug}/"><b>${esc(d.h1)}</b><span>${esc(d.desc.slice(0, 96))}…</span></a></li>`).join("")}</ul>
    <p class="backlink"><a href="/tools/">All tools &rarr;</a> &nbsp; <a href="/salary/">Salary by pay level &rarr;</a></p>
  </section>` : ""}

  ${(guides && guides.length) ? `<section class="home-guides">
    <h2 class="section-h">Preparation guides</h2>
    <ul class="guides">${guides.slice(0,2).map((g)=>`<li><a class="guide-card" href="/guides/${g.slug}/"><h2>${esc(g.meta.title)}</h2><p>${esc(g.meta.description||"")}</p><span class="readmore">Read guide &rarr;</span></a></li>`).join("")}</ul>
    <p class="backlink"><a href="/guides/">All guides &rarr;</a></p>
  </section>` : ""}

  <section class="home-about prose">
    <h2 class="section-h">About ${esc(SITE.brand)}</h2>
    <p>${esc(SITE.brand)} brings together the latest central and state government job notifications in India in one clean, simple place. For every recruitment we list the number of vacancies, who is eligible, the important dates, the application fee and a clear step-by-step guide to applying — and we link straight to the official notification so you can verify every detail and apply with confidence.</p>
    <p>Our goal is to save you time. Government notifications are long and hard to read; we turn them into pages you can scan in seconds. We also publish in-depth <a href="/guides/">preparation guides</a> to help you crack Sarkari exams. We are an independent platform, not a government body, and we never charge candidates any fee. Always confirm the final details on the official website before applying.</p>
  </section>
</main>` + foot();
}

/* ---- Category pages (qualification / organization) -------------- */
function buildCategory(kind, label, slugVal, jobs, opts = {}) {
  const sorted = [...jobs].sort(liveFirst);
  const isQ = kind === "qualification";
  const title = isQ
    ? `${label} Government Jobs ${BUILT.getFullYear()} — Sarkari Naukri for ${label} | ${SITE.name}`
    : (`${label} Recruitment ${BUILT.getFullYear()} — Latest ${label} Vacancies`.length <= 58 ? `${label} Recruitment ${BUILT.getFullYear()} — Latest ${label} Vacancies | ${SITE.name}` : `${label} Recruitment ${BUILT.getFullYear()} — Latest Vacancies | ${SITE.name}`);
  const desc = isQ
    ? `All latest government job notifications for ${label} candidates — vacancies, eligibility and last dates, updated regularly.`
    : `Latest ${label} recruitment notifications — vacancies, eligibility and application dates in one place.`;
  const canonical = `${SITE.url}/${kind}/${slugVal}/`;
  const ld = [
    breadcrumbLd([
      { name: "Jobs", url: SITE.url + "/" },
      { name: isQ ? "Qualification" : "Department", url: canonical },
      { name: label, url: canonical },
    ]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: title, url: canonical,
      mainEntity: { "@type": "ItemList",
        itemListElement: sorted.slice(0, 50).map((j, i) => ({
          "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title, desc, canonical, ld, noindex: !!opts.noindex }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Jobs</a> &nbsp;&rsaquo;&nbsp; ${esc(isQ ? "Qualification" : "Department")}</p>
  <section class="cat-head">
    <p class="eyebrow">${esc(isQ ? "Eligibility" : "Department")}</p>
    <h1>${esc(label)} ${isQ ? "government jobs" : "recruitment"}</h1>
    <p class="lede">${esc(desc)}</p>
  </section>
  <p class="count static">${sorted.length} ${sorted.length === 1 ? "job" : "jobs"}</p>
  ${jobList(sorted)}
  <p class="backlink"><a href="/">&larr; All government jobs</a></p>
</main>` + foot();
}

/* ---- Job detail ------------------------------------------------- */
function row(dt, dd, mono) {
  if (dd === undefined || dd === null || dd === "") return "";
  return `<dt>${esc(dt)}</dt><dd${mono ? ' class="mono"' : ""}>${dd}</dd>`;
}
// Google for Jobs fields: employment type from the post, and the state when the job is in one state.
function employmentTypeOf(job) {
  const t = `${job.title} ${job.post_name || ""}`.toLowerCase();
  if (/\bapprentice|\btrainee\b|\binternship\b|\bintern\b/.test(t)) return "INTERN";
  if (/\bwalk-?in\b|\bproject\b|\bcontract(ual)?\b|\bconsultant\b|\bresearch (fellow|associate|assistant)\b|\bjrf\b|\bsrf\b|\bguest\b|\bad[- ]?hoc\b|\btemporary\b|\bpart[- ]time\b/.test(t)) return /\bpart[- ]time\b/.test(t) ? "PART_TIME" : "TEMPORARY";
  return "FULL_TIME";
}
function regionOf(job) {
  const s = statesOf(job).filter((x) => x.slug !== "all-india");
  return s.length === 1 ? { addressRegion: s[0].name } : {};
}
function jobLd(job) {
  const sal = parseSalary(job.salary);
  const descHtml =
    `<p>${esc(job.summary || job.title)}</p>` +
    (job.qualification ? `<p><b>Qualification:</b> ${esc(job.qualification)}</p>` : "") +
    (job.age_max ? `<p><b>Age limit:</b> ${job.age_min ? job.age_min + "-" : "up to "}${job.age_max} years</p>` : "") +
    (job.fee ? `<p><b>Application fee:</b> ${esc(job.fee)}</p>` : "") +
    ((job.how_to_apply||[]).length
      ? `<p><b>How to apply:</b></p><ol>${job.how_to_apply.map((s)=>`<li>${esc(s)}</li>`).join("")}</ol>` : "");
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: ldJobTitle(job),
    description: descHtml,
    datePosted: job.published,
    employmentType: employmentTypeOf(job),
    directApply: false,
    identifier: { "@type": "PropertyValue", name: job.organization, value: job.id },
    hiringOrganization: { "@type": "Organization", name: job.organization, ...(job.official_website || job.apply_link ? { sameAs: job.official_website || job.apply_link } : {}) },
    jobLocation: { "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: job.location || "India", ...regionOf(job), addressCountry: "IN" } },
    applicantLocationRequirements: { "@type": "Country", name: "India" },
  };
  // without a printed last date the listing is treated as closed STALE_DAYS after publication — tell Google the same
  ld.validThrough = (job.application_end || addDays(job.published, Number(SITE.staleDays || 45))) + "T23:59:59+05:30";
  // Google accepts only these credential categories; the lowest level the job asks for is what a candidate needs.
  const cred = { "10th-pass": "high school", "12th-pass": "high school", "iti": "professional certificate", "engineering-diploma": "professional certificate",
    "diploma": "professional certificate", "graduate": "bachelor degree", "post-graduate": "postgraduate degree" };
  const lvl = qualsOf(job).map((q) => cred[q.slug]).find(Boolean);
  if (lvl) ld.educationRequirements = { "@type": "EducationalOccupationalCredential", credentialCategory: lvl };
  if (sal) ld.baseSalary = { "@type": "MonetaryAmount", currency: "INR",
    value: { "@type": "QuantitativeValue", minValue: sal.min, maxValue: sal.max, unitText: sal.unit } };
  return ld;
}
function relatedList(job, all) {
  const lvls = new Set(levelsOf(job));
  const pool = all.filter((j) => j.id !== job.id);
  const ok = slug(orgKey(job));
  const sameOrg = ok ? pool.filter((j) => slug(orgKey(j)) === ok) : [];
  const sameLvl = pool.filter((j) => !sameOrg.includes(j) && levelsOf(j).some((l) => lvls.has(l)));
  const picks = [...sameOrg, ...sameLvl].slice(0, 3);
  if (!picks.length) return "";
  return `<section class="related">
    <h2 class="section-h">Related jobs</h2>
    <ul class="jobs">${picks.map(jobCard).join("\n")}</ul>
  </section>`;
}
function helpfulGuidesForJob(job) {
  if (!ALL_GUIDES || !ALL_GUIDES.length) return "";
  const stop = new Set("a an the to of for in on and or how what which your you guide government job jobs exam exams india 2026 vacancy notification recruitment".split(" "));
  const toks = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
  const jt = toks(`${job.title} ${job.organization} ${job.org_short || ""} ${job.qualification || ""} ${job.post_name || ""}`);
  const scored = ALL_GUIDES.map((g) => {
    const gt = toks(`${g.meta.title} ${g.slug.replace(/-/g, " ")}`);
    let s = 0; gt.forEach((w) => { if (jt.has(w)) s++; });
    return { g, s };
  }).sort((a, b) => b.s - a.s);
  // always-useful application guides as a baseline/fallback
  const universal = ["how-to-read-government-job-notification", "documents-required-government-job-application",
    "fill-online-government-job-form-without-mistakes", "government-job-eligibility-india"];
  let picks = scored.filter((x) => x.s > 0).slice(0, 3).map((x) => x.g);
  for (const u of universal) {
    if (picks.length >= 4) break;
    const g = ALL_GUIDES.find((x) => x.slug === u);
    if (g && !picks.includes(g)) picks.push(g);
  }
  picks = picks.slice(0, 4);
  if (!picks.length) return "";
  return `<section class="related">
    <h2 class="section-h">Helpful guides for this job</h2>
    <ul class="guides">${picks.map((g) => `<li><a class="guide-card" href="/guides/${g.slug}/"><h3>${esc(g.meta.title)}</h3><p>${esc(g.meta.description || "")}</p><span class="readmore">Read guide &rarr;</span></a></li>`).join("")}</ul>
  </section>`;
}
function prepTips(job) {
  const t = `${job.title} ${job.organization} ${job.org_short || ""} ${job.qualification || ""}`.toLowerCase();
  const generic = [
    `Read the official notification end to end before applying — eligibility, exam pattern, syllabus and the fee are all defined there, and small details often decide selection.`,
    `Build your preparation around previous years' question papers; they reveal the real difficulty level and the topics that repeat most often.`,
    `Keep a simple weekly routine that covers the whole syllabus and leaves time for revision and full-length mock tests, which build both speed and accuracy.`,
  ];
  const extra = [];
  if (/ssc|cgl|chsl|mts/.test(t)) extra.push(`For SSC exams, quantitative aptitude and reasoning reward daily practice, while general awareness and English can be improved steadily with short, consistent study.`);
  if (/bank|ibps|sbi|rbi/.test(t)) extra.push(`For banking exams, focus on speed in the quantitative and reasoning sections, and stay current with banking awareness and recent economic news.`);
  if (/rrb|railway|technician|loco|group d|ntpc/.test(t)) extra.push(`For railway exams, mathematics, general science and general awareness carry significant weight, so revise NCERT-level science and practise arithmetic regularly.`);
  if (/police|constable|si|defence|army|navy|air force|agniveer/.test(t)) extra.push(`For uniformed posts, start physical preparation early — the physical efficiency and endurance tests are as decisive as the written exam.`);
  if (/upsc|pcs|psc|civil/.test(t)) extra.push(`For civil-services-style exams, build a strong foundation in current affairs and standard reference books, and practise structured answer writing.`);
  if (/engineer|je|technical|diploma|iti|drdo|isro|psu/.test(t)) extra.push(`For technical posts, revise your core branch subjects thoroughly, since the technical section usually carries the highest weight.`);
  const aiTips = Array.isArray(job.preparation_tips)
    ? job.preparation_tips.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const all = aiTips.length >= 3 ? aiTips.slice(0, 5) : [...extra, ...generic].slice(0, 4);
  return `<div class="prose"><h2 class="section-h">How to prepare for ${esc(orgKey(job) || job.organization)} ${esc(job.post_name || "this exam")}</h2>
    <p>Preparation for ${esc(job.title)} is most effective when it is planned and consistent. A few practical pointers:</p>
    <ul>${all.map((x) => `<li>${x}</li>`).join("")}</ul>
    <p>For a fuller, step-by-step plan, see the helpful guides linked below — they cover exam strategy, subject-wise tips and common mistakes in detail.</p>
  </div>`;
}
/* In-content ad unit. Renders only when adsenseId is set, so the site stays
   clean (and policy-safe) until AdSense is approved. In-article placements
   earn far more than relying on Auto Ads alone. */
function adSlot(label) {
  // A manual unit needs its ad-unit ID (config.json "adsenseSlot"); until then Auto ads (switched on in AdSense) place the ads.
  if (!SITE.adsenseId || !SITE.adsenseSlot) return "";
  return `<aside class="ad-slot" aria-label="Advertisement" data-slot="${esc(label || "")}">
    <span class="ad-label">Advertisement</span>
    <ins class="adsbygoogle" style="display:block;text-align:center" data-ad-client="${esc(SITE.adsenseId)}" data-ad-slot="${esc(SITE.adsenseSlot)}" data-ad-format="fluid" data-ad-layout="in-article"></ins>
    <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  </aside>`;
}
/* The ad networks that may serve ads in the Android app through AdMob mediation (config.json "admob.mediation"). */
const AD_NETWORKS = {
  meta: "Meta Audience Network",
  applovin: "AppLovin",
  inmobi: "InMobi",
  liftoff: "Liftoff Monetize (Vungle)",
  unity: "Unity Ads",
  mintegral: "Mintegral",
  ironsource: "ironSource",
  dtexchange: "Digital Turbine DT Exchange",
  moloco: "Moloco",
  pangle: "Pangle",
  pubmatic: "PubMatic",
  bigo: "Bigo Ads",
  chartboost: "Chartboost",
};
function mediationPolicy() {
  const list = [].concat((SITE.admob || {}).mediation || []).map((k) => AD_NETWORKS[String(k).toLowerCase()]).filter(Boolean);
  if (!list.length) return "";
  return `\n\nGoogle AdMob may also fill ad spaces with ads from these partner networks, chosen by an automatic auction: ${list.join(", ")}. They may collect the same kinds of information described above, under their own privacy policies.`;
}
/* The job page's call to action, labelled for what the link really is (lib.js applyInfo): never "Apply" for a
   homepage. Also used by the Hindi pages (lang "hi") and, as cta/cta_url, by the app. */
const CTA_TEXT = {
  en: { apply: "Apply online", page: "Recruitment page", form: "Download notice &amp; form", walkin: "Walk-in notice", email: "Notice (apply by email)", notice: "Read official notification", website: "Official website",
    hintPage: "Opens this recruitment’s page on the official site — the notice and application details are there.",
    hintEmail: "Apply by email: the address, format and documents are given in the notice.",
    careers: "Official recruitment page", hintCareers: "Opens the organisation’s official Recruitment / Careers page, where this notice and its application link are listed.",
    hintApply: "Opens the official application page.",
    hintForm: "Offline application: download the notice and form, fill it in and send it as the notice says.",
    hintWalkin: "Walk-in interview: go to the venue on the date in the notice, with the documents it lists.",
    hintNotice: "The official notification explains how to apply.",
    hintWebsite: "The official notice gives no direct application page — open the official website’s Recruitment / Careers section. The steps are below.",
    notif: "Notification PDF", site: "Official website", modes: { online: "Online", offline: "Offline (by post / in person)", walkin: "Walk-in interview", email: "By email", unknown: "" } },
  hi: { apply: "ऑनलाइन आवेदन करें", page: "भर्ती पेज", form: "नोटिस और फ़ॉर्म डाउनलोड करें", walkin: "वॉक-इन नोटिस", email: "नोटिस (ईमेल से आवेदन)", notice: "ऑफिशियल नोटिफिकेशन पढ़ें", website: "ऑफिशियल वेबसाइट",
    hintPage: "ऑफिशियल साइट पर इस भर्ती का पेज खुलेगा — नोटिस और आवेदन की जानकारी वहीं है।",
    hintEmail: "ईमेल से आवेदन: पता, फ़ॉर्मेट और दस्तावेज़ नोटिस में दिए हैं।",
    careers: "ऑफिशियल भर्ती पेज", hintCareers: "संस्था का ऑफिशियल Recruitment / Careers पेज खुलेगा — यह नोटिस और उसका आवेदन लिंक वहीं मिलेगा।",
    hintApply: "ऑफिशियल आवेदन पेज खुलेगा।",
    hintForm: "ऑफलाइन आवेदन: नोटिस और फ़ॉर्म डाउनलोड करें, भरें और नोटिस में दिए तरीके से भेजें।",
    hintWalkin: "वॉक-इन इंटरव्यू: नोटिस में दी गई तारीख पर, बताए गए दस्तावेज़ों के साथ पहुँचें।",
    hintNotice: "आवेदन का तरीका ऑफिशियल नोटिफिकेशन में दिया है।",
    hintWebsite: "नोटिस में सीधा आवेदन पेज नहीं है — ऑफिशियल वेबसाइट के Recruitment / Careers सेक्शन में देखें। तरीका नीचे दिया है।",
    notif: "नोटिफिकेशन PDF", site: "ऑफिशियल वेबसाइट", modes: { online: "ऑनलाइन", offline: "ऑफलाइन (डाक / स्वयं)", walkin: "वॉक-इन इंटरव्यू", email: "ईमेल से", unknown: "" } },
};
function ctaOf(job) {
  const a = LIB.applyInfo(job);
  if (a.cta) return a;
  // no official link stored: the body's homepage from its name, or the non-aggregator source page
  const home = LIB.hostFromTitle(job.title) ? `https://${LIB.hostFromTitle(job.title)}/` : LIB.officialHomeFor(job.title);
  if (home) return { ...a, cta: "website", url: home };
  if (job.source && !LIB.isAggregator(hostOf(job.source))) return { ...a, cta: "notice", url: job.source };
  return a;
}
function ctaHtml(job, lang = "en", { hint = true } = {}) {
  const T = CTA_TEXT[lang], c = ctaOf(job);
  if (!c.cta) return "";
  const ext = `target="_blank" rel="noopener nofollow"`;
  const same = (u) => u && c.url && u.replace(/\/+$/, "") === c.url.replace(/\/+$/, "");
  const notif = job.official_notification && !same(job.official_notification) ? `<a class="btn btn-ghost" href="${esc(job.official_notification)}" ${ext}>${T.notif}</a>` : "";
  const site = job.official_website && c.cta !== "website" && hostOf(job.official_website) !== hostOf(c.url) ? `<a class="btn btn-ghost" href="${esc(job.official_website)}" ${ext}>${T.site}</a>` : "";
  const hintText = { apply: T.hintApply, page: T.hintPage, form: T.hintForm, walkin: T.hintWalkin, email: T.hintEmail, careers: T.hintCareers, notice: T.hintNotice, website: T.hintWebsite }[c.cta];
  return `<div class="cta-row"><a class="btn btn-primary btn-cta" href="${esc(c.url)}" ${ext}>${T[c.cta]} &#8599;</a>${notif}${site}</div>${hint && hintText ? `<p class="cta-hint">${hintText}</p>` : ""}`;
}
function keyFacts(job, lang = "en", { cta = true } = {}) {
  const hi = lang === "hi", T = CTA_TEXT[lang];
  const d = daysLeft(job.application_end);
  const left = d === null ? "" : d < 0 ? (hi ? "बंद" : "closed") : d === 0 ? (hi ? "आज अंतिम दिन" : "last day today") : (hi ? `${d} दिन बाकी` : `${d} day${d === 1 ? "" : "s"} left`);
  const date = (x) => (hi ? hiDateKF(x) : fmtDate(x));
  const facts = [
    job.total_vacancies ? [hi ? "कुल पद" : "Posts", inr(job.total_vacancies)] : null,
    job.application_end ? [hi ? "अंतिम तिथि" : "Last date", `${date(job.application_end)}${left ? `<small class="kf-left ${d !== null && d <= 7 ? "soon" : ""}">${left}</small>` : ""}`] : null,
    job.age_max ? [hi ? "आयु सीमा" : "Age limit", `${job.age_min ? job.age_min + "–" : (hi ? "" : "Up to ")}${job.age_max}${hi ? " वर्ष" : " years"}`] : null,
    qualsOf(job).length ? [hi ? "योग्यता" : "Qualification", esc(qualsOf(job).map((q) => (hi ? QUAL_HI_KF[q.slug] : "") || q.name).slice(0, 2).join(" / "))] : null,
    T.modes[LIB.applyMode(job)] ? [hi ? "आवेदन का तरीका" : "How to apply", T.modes[LIB.applyMode(job)]] : null,
  ].filter(Boolean);
  if (!facts.length && !(cta && ctaOf(job).cta)) return "";
  return `<section class="keyfacts" aria-label="${hi ? "मुख्य जानकारी" : "Key facts"}">
    ${facts.length ? `<dl class="kf-grid">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
    ${cta ? ctaHtml(job, lang) : ""}
  </section>`;
}
const QUAL_HI_KF = { "10th-pass": "10वीं पास", "12th-pass": "12वीं पास", graduate: "स्नातक", "engineering-diploma": "इंजीनियरिंग / डिप्लोमा", "post-graduate": "स्नातकोत्तर" };
const HI_MONTHS_KF = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
function hiDateKF(iso) { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[3])} ${HI_MONTHS_KF[Number(m[2]) - 1]} ${m[1]}` : ""; }

/* JobPosting "title" is the job (the post), not the headline: Google asks for the role without company or "Apply Online". */
function ldJobTitle(job) {
  const p = String(job.post_name || "").replace(/\s+/g, " ").trim();
  if (p && p.length <= 110 && !/^(various|more|other|multiple|different)( posts?)?$/i.test(p)) return p;
  return shortTitle(job.title).replace(/\s*\b(recruitment|notification|vacancy|bharti)\s*20\d\d\s*$/i, "").trim() || job.title;
}
function addDays(iso, n) { const t = Date.parse(String(iso || "").slice(0, 10)); return isNaN(t) ? new Date(BUILT.getTime() + n * 86400000).toISOString().slice(0, 10) : new Date(t + n * 86400000).toISOString().slice(0, 10); }

function buildJob(job, all) {
  const st = statusOf(job);
  const canonical = `${SITE.url}/jobs/${job.id}/`;
  const title = seoTitle(job);
  const desc = seoDesc(job);
  const steps = (job.how_to_apply || []).map((s) => `<li>${esc(s)}</li>`).join("\n");
  const pct = windowPct(job);
  const faqs = faqsFor(job);
  const ld = [jobLd(job), breadcrumbLd([
    { name: "Jobs", url: SITE.url + "/" },
    ...(ORG_PAGES.has(slug(orgKey(job))) ? [{ name: orgKey(job), url: `${SITE.url}/organization/${slug(orgKey(job))}/` }] : []),
    { name: job.title, url: canonical },
  ])];
  if (faqs.length) ld.push(faqLd(faqs));
  const lvlLinks = qualsOf(job)
    .map((q) => `<a class="chip" href="/qualification/${q.slug}/">${esc(q.name)}</a>`).join("");
  const selection = Array.isArray(job.selection_process) && job.selection_process.length
    ? `<h2 class="section-h">Selection process</h2><ol class="steps">${job.selection_process.map((s)=>`<li>${esc(s)}</li>`).join("")}</ol>`
    : "";

  const hiAlt = job.hi && job.hi.title ? { ...(SITE.crawlHindiDetail ? { alternates: [{ hreflang: "en", href: canonical }, { hreflang: "hi", href: `${SITE.url}/hi/jobs/${job.id}/` }, { hreflang: "x-default", href: canonical }] } : {}), langSwitch: `/hi/jobs/${job.id}/` } : {};
  return head({ title, desc, canonical, ld, ogType: "article", image: ogImage(`og/jobs/${job.id}.png`), ...hiAlt }) + `
<main class="wrap" id="main">
  ${job.hi && job.hi.title ? `<p class="lang-note" lang="hi"><a href="/hi/jobs/${esc(job.id)}/">यह जानकारी हिंदी में पढ़ें &rarr;</a></p>` : ""}
  <p class="crumb"><a href="/">Jobs</a> &nbsp;&rsaquo;&nbsp; ${ORG_PAGES.has(slug(orgKey(job)))
    ? `<a href="/organization/${slug(orgKey(job))}/">${esc(orgKey(job))}</a>`
    : esc(orgKey(job) || job.organization)}</p>
  <div class="detail-head">
    <div class="headline-row">
      <span class="org-tag">${esc(job.organization)}</span>
      <span class="status ${st.cls}">${esc(st.label)}</span>
    </div>
    <h1>${esc(job.title)}</h1>
    ${job.via === "official" ? `<p class="verified">✓ Verified from the official website${job.official_website ? ` — <a href="${esc(job.official_website)}" rel="nofollow noopener" target="_blank">${esc(hostOf(job.official_website))}</a>` : ""}</p>` : ""}
    ${isStale(job) ? `<div class="closed-notice"><strong>This recruitment has closed.</strong> ${job.application_end ? `The last date to apply was ${fmtDate(job.application_end)}.` : `Its notice is more than ${Number(SITE.staleDays || 45)} days old.`} This page is kept for reference — <a href="/">browse current open jobs</a> or check the <a href="/updates/">latest results &amp; admit cards</a>.</div>` : ""}
    ${keyFacts(job, "en", { cta: statusOf(job).live })}
    <p class="lede">${esc(job.summary || "")}</p>
    ${job.summary_hindi ? `<p class="hindi" lang="hi">${esc(job.summary_hindi)}</p>` : ""}
    ${pct !== null ? `<div class="window" role="img" aria-label="Application window from ${fmtDate(job.application_start)} to ${fmtDate(job.application_end)}">
      <div class="bar"><span class="fill ${st.cls}" style="width:${pct.toFixed(0)}%"></span></div>
      <div class="window-ends"><span>${fmtDate(job.application_start)}</span><span>${fmtDate(job.application_end)}</span></div>
    </div>` : ""}
  </div>

  <h2 class="section-h">Recruitment details</h2>
  <div class="spec"><dl>
    ${row("Organisation", esc(job.organization))}
    ${row("Post name", esc(job.post_name))}
    ${row("Total vacancies", `<span class="mono">${inr(job.total_vacancies)}</span>`)}
    ${row("Qualification", esc(job.qualification))}
    ${row("Age limit", job.age_max ? `${job.age_min ? job.age_min + "&ndash;" : "Up to "}${job.age_max} years` : "")}
    ${row("Salary", esc(job.salary))}
    ${row("Application fee", esc(job.fee))}
    ${row("Job location", esc(job.location))}
    ${row("Application starts", fmtDate(job.application_start), true)}
    ${row("Last date to apply", `<b>${fmtDate(job.application_end)}</b>`)}
    ${row("Exam date", fmtDate(job.exam_date), true)}
  </dl></div>

  ${adSlot("job-mid")}

  ${eligibilityProse(job) ? `<div class="prose"><h2 class="section-h">Eligibility criteria</h2>${eligibilityProse(job)}${lvlLinks ? `<p class="tagrow">Eligibility: ${lvlLinks}</p>` : ""}</div>` : ""}

  ${selection}

  ${salaryProse(job) ? `<div class="prose"><h2 class="section-h">Salary &amp; benefits</h2>${salaryProse(job)}</div>` : ""}

  ${steps ? `<h2 class="section-h">How to apply</h2><ol class="steps">${steps}</ol>` : ""}

  ${statusOf(job).live
    ? (ctaHtml(job, "en", { hint: false }) ? `<div class="apply-bar">${ctaHtml(job, "en", { hint: false })}</div>` : "")
    : (job.official_notification ? `<div class="apply-bar"><a class="btn btn-ghost" href="${esc(job.official_notification)}" target="_blank" rel="noopener nofollow">Official notification (for reference)</a></div>` : "")}

  <div class="prose">
    <h2 class="section-h">About this recruitment</h2>
    ${overviewProse(job)}
  </div>
  <p class="note">Always verify dates and eligibility on the official website before applying. ${esc(SITE.brand)} aggregates publicly available notifications and is not a government body.</p>
  ${tgCta("new government jobs")}

  ${(() => { const ex = require("./exams.js").examOf(job.title); return ex ? `<p class="cta-row"><a class="btn btn-ghost" href="/exam/${ex.slug}/">All ${esc(ex.name)} updates — admit card, answer key, result &rarr;</a></p>` : ""; })()}
  ${prepTips(job)}

  ${adSlot("job-end")}

  ${faqSection(faqs)}

  ${helpfulGuidesForJob(job)}

  ${relatedList(job, all)}
</main>` + foot();
}

/* ---- 404 -------------------------------------------------------- */
function build404() {
  return head({ title: "Page not found | " + SITE.name, desc: "The page you were looking for doesn't exist.",
    canonical: SITE.url + "/404", ld: [] }) + `
<main class="wrap" id="main">
  <section class="hero">
    <p class="eyebrow">404</p>
    <h1>That page isn't here.</h1>
    <p>The notification may have expired or the link is wrong. Browse the latest jobs instead.</p>
    <div class="apply-bar"><a class="btn btn-primary" href="/">See latest jobs</a></div>
  </section>
</main>` + foot();
}

/* ---- Feeds ------------------------------------------------------ */
function buildSitemap(jobs, cats, extra = [], mods = new Map()) {
  // lastmod must be honest: a page's own date, not "today" on every build (Google stops trusting a
  // sitemap whose dates are all today). Hubs genuinely change daily and keep today's date.
  // Jobs closed for 60+ days stay live and linked but leave the sitemap, so crawl slots go to new pages.
  const today = IST_DATE;
  // Google crawls a young site only ~100-200 pages a day, so the sitemap lists what is worth that budget:
  // jobs leave it 15 days after closing (config sitemapClosedDays); their pages stay live and linked.
  const cutoff = new Date(BUILT.getTime() - Number(SITE.sitemapClosedDays || 15) * 86400000).toISOString().slice(0, 10);
  const mapJobs = jobs.filter((j) => !(j.application_end && j.application_end < cutoff));
  const urls = [
    { loc: SITE.url + "/", mod: today },
    ...extra.map((u) => ({ loc: `${SITE.url}/${u}`, mod: mods.get(u) || today })),
    ...cats.filter((c) => !c.noindex).map((c) => ({ loc: `${SITE.url}/${c.kind}/${c.slug ? c.slug + "/" : ""}`, mod: mods.get(`${c.kind}/${c.slug ? c.slug + "/" : ""}`) || today })),
    ...mapJobs.map((j) => ({ loc: `${SITE.url}/jobs/${j.id}/`, mod: j.published || today })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod></url>`).join("") +
    `</urlset>`;
}
/* Fresh-URL sitemap: only pages published today and the two days before (IST), plus the hubs that list them.
   It stays small and is re-submitted to Search Console after every deploy (notify-search.js), so Google
   can find brand-new pages without wading through the full sitemap. Dates are the pages' own dates. */
function buildLatestSitemap({ jobs, updates, news }) {
  const day = (x) => (String(x || "").match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
  const fresh = (x) => { const d = day(x) && daysLeft(day(x)); return d !== null && d !== undefined && d <= 0 && d >= -2; };
  const urls = [];
  const add = (p, mod) => urls.push(`<url><loc>${SITE.url}/${p}</loc><lastmod>${mod}</lastmod></url>`);
  for (const h of ["", "latest/", "jobs/", "closing-soon/", ...TOPIC_HUBS.map((t) => `${t.slug}/`), "vacancy-tracker/", "updates/", ...Object.keys(UPDATE_TYPES).map((k) => `updates/${k}/`), "news/"]) add(h, IST_DATE);
  // English pages only: while Google's crawl budget for the site is small, the fresh list points it at the
  // primary job/result pages first (the Hindi twins stay in sitemap.xml and are linked via hreflang).
  for (const j of jobs) if (fresh(j.published)) add(`jobs/${j.id}/`, day(j.published));
  for (const u of updates) if (fresh(u.date)) add(`updates/${u.id}/`, day(u.date));
  for (const a of news) if (fresh(a.date)) add(`news/${a.id}/`, day(a.date));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;
}
/* Google News sitemap: results, admit cards, answer keys, exam dates and current-affairs articles from today and
   yesterday (Google reads news sitemaps far more often than ordinary ones). Job pages use JobPosting instead. */
function buildNewsSitemap({ updates, news }) {
  const day = (x) => (String(x || "").match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
  const recent = (x) => { const d = day(x) ? daysLeft(day(x)) : null; return d !== null && d <= 0 && d >= -1; };
  const items = [
    ...updates.filter((u) => recent(u.date)).map((u) => ({ loc: `${SITE.url}/updates/${u.id}/`, date: day(u.date), title: u.title })),
    ...news.filter((a) => recent(a.date)).map((a) => ({ loc: `${SITE.url}/news/${a.id}/`, date: day(a.date), title: a.title })),
  ].slice(0, 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">` +
    items.map((x) => `<url><loc>${x.loc}</loc><news:news><news:publication><news:name>${esc(SITE.brand)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${x.date}</news:publication_date><news:title>${esc(x.title)}</news:title></news:news></url>`).join("") +
    `</urlset>\n`;
}
/* /search.json — loaded by the homepage only when someone starts typing: every open (and recently closed) job plus
   the last 60 days of results/admit cards/answer keys, so search covers the whole site without heavy page markup. */
/* ---- Android app data: /app/v1/ (static JSON on Cloudflare — the app's whole backend) ----
   index.json  open jobs + those closed in the last 15 days, results/admit cards of the last 60 days, filter lists
   j/<id>.json one job in full, u/<id>.json one update in full. Field names are short in the index (it is fetched on
   every app refresh) and long in the detail files. Bump APP_API when a field changes meaning. */
const APP_API = 1;
const appDay = (x) => (String(x || "").match(/^\d{4}-\d{2}-\d{2}/) || [])[0] || "";
const appArr = (x) => (Array.isArray(x) ? x.filter(Boolean).map(String) : x ? [String(x)] : []);
const appFaq = (x) => (Array.isArray(x) ? x.filter((f) => f && f.q && f.a).map((f) => ({ q: String(f.q), a: String(f.a) })) : []);
function appStates(job) { return isGulf(job) ? ["gulf"] : statesOf(job).map((st) => st.slug); }
function appJobsInFeed(jobs) {
  return jobs.filter((j) => { if (isStale(j)) return false; const d = daysLeft(j.application_end); return statusOf(j).live || (d !== null && d >= -15); }).sort(liveFirst);
}
function appUpdatesInFeed(updates) {
  const cutoff = new Date(BUILT.getTime() - 60 * 86400000).toISOString().slice(0, 10);
  return updates.filter((u) => UPDATE_TYPES[u.type] && appDay(u.date) >= cutoff).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
/* Categories the app lets people browse and filter by (sent in the feed, so they can change without an app update).
   A job can be in more than one (BPSC teacher recruitment = PSC + Teaching). */
const APP_CATS = [
  ["railway", "Railway", "रेलवे", /\b(rrb|rrc|railways?|ircon|rites|irctc|dfccil|metro rail|rvnl|konkan railway)\b/i],
  ["bank", "Bank & insurance", "बैंक व बीमा", /\b(banks?|banking|ibps|sbi|rbi|nabard|sidbi|exim|dccb|lic|insurance|niacl|uiic|sebi|irdai)\b/i],
  ["ssc", "SSC & selection boards", "SSC व चयन बोर्ड", /\b(ssc|staff selection commission|sssc|sssb|osssc|dsssb|hssc|jssc|wbssc|rsmssb|rssb|upsssc|uksssc|psssb|gsssb|hpssc|hprca|jkssb|tnusrb|kea|selection board|subordinate services?)\b/i],
  ["post", "Post office", "डाक विभाग", /\b(india post|postal|post office|gds|dak sevak)\b/i],
  ["psc", "UPSC & State PSC", "UPSC व राज्य PSC", /psc\b|public service commission/i],
  ["police", "Police", "पुलिस", /\b(police|constables?|sub[- ]inspectors?|home guards?|jail warders?|prisons?)\b/i],
  ["defence", "Defence & forces", "रक्षा व सशस्त्र बल", /\b(army|navy|naval|air force|iaf|agniveer|agnipath|bsf|crpf|cisf|itbp|ssb|assam rifles|coast guard|nda|cds|afcat|echs|military|defence|territorial army)\b/i],
  ["teaching", "Teaching", "शिक्षक", /\b(teachers?|tgt|pgt|prt|lecturers?|professors?|faculty|principal|kvs|nvs|tet|ctet|tre|schools?)\b/i],
  ["medical", "Medical & nursing", "मेडिकल व नर्सिंग", /\b(nurs(e|es|ing)|aiims|esic|jipmer|medical|doctors?|anm|gnm|pharmacists?|hospitals?|health|nhm|cho|residents?|lab technicians?|paramedical)\b/i],
  ["psu", "PSU", "PSU", /\b(ntpc|bhel|ongc|iocl|indian oil|gail|sail|coal india|bel|hal|power ?grid|nhpc|nlc|npcil|hpcl|bpcl|ecil|becil|cwc|rinl|nmdc|mecon|engineers india|psu)\b/i],
  ["research", "University & research", "विश्वविद्यालय व रिसर्च", /\b(universit(y|ies)|iit|nit|iiit|iim|iiser|iisc|aiish|isro|drdo|barc|csir|icar|icmr|institute|research|fellow(ship)?|jrf|srf|project (assistant|associate|scientist|fellow))\b/i],
  ["court", "Courts", "कोर्ट", /\b(high court|district court|supreme court|courts?|judicial|judiciary)\b/i],
  ["local", "District & local bodies", "जिला व स्थानीय निकाय", /\b(district|zilla|zila|collector(ate)?|municipal|nagar (nigam|palika)|panchayat|cantonment)\b/i],
];
const appCats = (text) => APP_CATS.filter(([, , , re]) => re.test(text)).map(([slug]) => slug);
/* Short title for app lists: the headline up to "…Recruitment 2026" / "…Admit Card 2026", without the SEO tail
   ("Notification Out – Apply Online for 78 Posts"). The full title stays on the job page. */
function shortTitle(t) {
  t = String(t || "").trim();
  const m = t.match(/(recruitment|vacancy|admit card|hall ticket|result|answer key|exam date|exam city|cut ?off|merit list|syllabus|typing test|skill test|interview schedule|भर्ती|रिजल्ट|परिणाम|प्रवेश पत्र|एडमिट कार्ड|उत्तर कुंजी|आंसर की|टेस्ट|लिस्ट|तारीख|तिथि|कट ऑफ)(\s+20\d\d)?/i);
  if (!m) return t;
  const end = m.index + m[0].length;
  const rest = t.slice(end);
  const sep = rest.search(/\s[–—-]\s|:\s|\s\|\s|,\s(?=apply|download|check)/i);
  let head = sep >= 0 ? t.slice(0, end + sep) : t;
  head = head.replace(/\s+(notification|notice|advertisement)?\s*(out|released|declared|issued)(\s+today|\s+now)?$/i, "").replace(/\s+notification$/i, "")
    .replace(/\s+(आज\s+)?(जारी|घोषित|सूचना|अधिसूचना)(\s+हुआ|\s+हुई|\s+किया गया)?$/, "").trim();
  return head.length >= 12 ? head : t;
}
function buildAppIndex(jobs, updates) {
  const J = appJobsInFeed(jobs).map((j) => ({
    id: j.id, t: j.title, th: (j.hi && j.hi.title) || "", o: orgKey(j) || "", p: j.post_name || "",
    v: Math.round(Number(j.total_vacancies)) || 0, q: qualsOf(j).map((x) => x.slug), s: appStates(j),
    a0: Number(j.age_min) || 0, a1: Number(j.age_max) || 0, st: appDay(j.application_start), en: appDay(j.application_end),
    pub: appDay(j.published), x: appDay(j.exam_date), ok: j.via === "official" ? 1 : 0,
    tc: shortTitle(j.title), thc: shortTitle((j.hi && j.hi.title) || ""), w: /walk[- ]?in/i.test(`${j.title} ${j.post_name || ""}`) ? 1 : 0,
    c: appCats(`${orgKey(j)} ${j.organization || ""} ${j.title} ${j.post_name || ""}`),
  }));
  const U = appUpdatesInFeed(updates).map((u) => ({
    id: u.id, t: u.title, th: (u.hi && u.hi.title) || "", o: u.org_short || "", ty: u.type, d: appDay(u.date), ev: appDay(u.event_date),
    big: /\b(ssc|rrb|railway|ibps|sbi|upsc|ctet|police|constable|army|navy|agniveer|nvs|kvs|bpsc|uppsc|upsssc|rpsc|rssb|mppsc|tnpsc|kpsc|kea|hssc|dsssb|ntpc|lic)\b/i.test(u.title) ? 1 : 0,
    tc: shortTitle(u.title), thc: shortTitle((u.hi && u.hi.title) || ""),
    c: appCats(`${u.org_short || ""} ${u.organization || ""} ${u.title} ${u.exam_name || ""}`),
  }));
  return JSON.stringify({
    api: APP_API, built: BUILD_ID, at: BUILT.toISOString(), site: SITE.url,
    states: STATES.map((x) => ({ slug: x.slug, name: x.name })).concat([{ slug: "gulf", name: "Gulf / abroad" }]),
    quals: QUALS.map((x) => ({ slug: x.slug, name: x.name })),
    types: Object.entries(UPDATE_TYPES).map(([k, v]) => ({ slug: k, name: v.plural })),
    cats: APP_CATS.map(([slug, name, hi]) => ({ slug, name, hi })),
    jobs: J, updates: U,
    ads: (() => { // whole numbers only: the app reads every/gap as integers
      const a = Object.assign({ on: true, banner: true, bannerSize: "standard", inline: true, interstitial: true, every: 4, gap: 240 }, SITE.appAds || {});
      for (const k of ["every", "gap"]) a[k] = Math.max(1, Math.round(Number(a[k]) || (k === "every" ? 4 : 240)));
      return a;
    })(),
  });
}
function appJobDetail(j) {
  const h = j.hi || {};
  return JSON.stringify({
    id: j.id, url: `${SITE.url}/jobs/${j.id}/`, title: j.title, organization: j.organization || "", org_short: orgKey(j) || "",
    post_name: j.post_name || "", total_vacancies: Math.round(Number(j.total_vacancies)) || 0, qualification: j.qualification ? String(j.qualification) : "",
    quals: levelsOf(j), states: statesOf(j).map((x) => x.name), age_min: Number(j.age_min) || 0, age_max: Number(j.age_max) || 0,
    salary: j.salary ? String(j.salary) : "", fee: j.fee ? (typeof j.fee === "string" ? j.fee : JSON.stringify(j.fee)) : "",
    application_start: appDay(j.application_start), application_end: appDay(j.application_end), exam_date: appDay(j.exam_date),
    location: j.location ? String(j.location) : "", published: appDay(j.published), verified: j.via === "official",
    summary: j.summary || "", overview: appArr(j.overview), eligibility_notes: j.eligibility_notes ? String(j.eligibility_notes) : "",
    selection_process: appArr(j.selection_process), how_to_apply: appArr(j.how_to_apply), faq: appFaq(j.faq),
    official_notification: j.official_notification || "", apply_link: j.apply_link || "", official_website: j.official_website || "",
    cta: ctaOf(j).cta || "", cta_url: ctaOf(j).url || "", apply_mode: LIB.applyMode(j),
    hi: h.title ? { title: h.title, summary: h.summary || j.summary_hindi || "", overview: appArr(h.overview), eligibility_notes: h.eligibility_notes ? String(h.eligibility_notes) : "",
      selection_process: appArr(h.selection_process), how_to_apply: appArr(h.how_to_apply), faq: appFaq(h.faq) } : null,
  });
}
function appUpdateDetail(u) {
  const h = u.hi || {};
  return JSON.stringify({
    id: u.id, url: `${SITE.url}/updates/${u.id}/`, type: u.type, type_name: (UPDATE_TYPES[u.type] || {}).label || "Update", title: u.title,
    organization: u.organization || "", org_short: u.org_short || "", exam_name: u.exam_name || "", date: appDay(u.date), event_date: appDay(u.event_date),
    summary: u.summary || "", steps: appArr(u.steps), details: appArr(u.details), faq: appFaq(u.faq),
    official_link: u.official_link || "", official_website: u.official_website || "", link: u.link || "",
    hi: h.title ? { title: h.title, summary: h.summary || u.summary_hi || "", steps: appArr(h.steps), details: appArr(h.details), faq: appFaq(h.faq) } : null,
  });
}
// Android App Links: news-views.in/jobs/... and /updates/... open in the app. Add the Play "app signing key" SHA-256
// (Play Console → Test and release → App integrity) to config.json "androidCertSha256" after the first upload.
const ANDROID_CERTS = [
  "86:97:1F:B4:DB:E0:05:19:9D:F2:6D:1A:6C:0E:59:1C:15:9B:7F:50:DC:AC:02:2F:9F:3B:0F:E5:CA:9E:0C:AE",   // upload key
  ...[].concat(SITE.androidCertSha256 || []),
];
function writeAppFeed(jobs, updates) {
  write(".well-known/assetlinks.json", JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: "in.newsviews.app", sha256_cert_fingerprints: [...new Set(ANDROID_CERTS)] } }], null, 2) + "\n");
  write("app/v1/index.json", buildAppIndex(jobs, updates));
  const J = appJobsInFeed(jobs), U = appUpdatesInFeed(updates);
  for (const j of J) write(`app/v1/j/${j.id}.json`, appJobDetail(j));
  for (const u of U) write(`app/v1/u/${u.id}.json`, appUpdateDetail(u));
  console.log(`App feed: ${J.length} jobs, ${U.length} updates -> app/v1/`);
}
function buildSearchIndex(jobs, updates) {
  const J = [...jobs].filter((j) => !isStale(j)).sort(liveFirst).map((j) => {
    const st = statusOf(j);
    return { i: j.id, t: j.title, o: orgKey(j) || j.organization || "", p: j.post_name || "", q: levelsOf(j).slice(0, 2),
      v: Number(j.total_vacancies) || 0, a: j.age_max ? `${j.age_min ? j.age_min + "–" : "up to "}${j.age_max}` : "",
      d: j.application_end ? fmtDate(j.application_end) : "", s: st.cls, l: st.label, n: st.live && isNew(j.published) ? 1 : 0 };
  });
  const cutoff = new Date(BUILT.getTime() - 60 * 86400000).toISOString().slice(0, 10);
  const U = updates.filter((u) => String(u.date || "") >= cutoff).map((u) => ({ i: u.id, t: u.title, o: u.org_short || "",
    y: (UPDATE_TYPES[u.type] || {}).label || "Update", c: u.type, d: u.date ? fmtDate(String(u.date).slice(0, 10)) : "" }));
  return JSON.stringify({ built: BUILD_ID, jobs: J, updates: U });
}
/* Queue for the owner's daily manual "Request indexing" in Search Console (10 a day): the newest pages most
   worth Google's attention first — the biggest open recruitments interleaved with results/admit cards of
   major exams, then the hubs. The daily task skips anything already on Google or requested in 14 days. */
function buildIndexQueue({ jobs, updates }) {
  const day = (x) => (String(x || "").match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
  const ago = (x) => { const d = day(x) ? daysLeft(day(x)) : null; return d === null ? 99 : -d; };
  const BIG = /\b(ssc|rrb|railway|ibps|sbi|upsc|nvs|jnvst?|ctet|tet|police|constable|army|navy|air ?force|agniveer|bpsc|uppsc|upsssc|mppsc|mpesb|rpsc|rssb|rsmssb|hpsc|hssc|kpsc|kea|tnpsc|tspsc|tgpsc|appsc|opsc|osssc|wbpsc|wbssc|gpsc|gsssb|mpsc|jkssb|bssc|dsssb|kvs|aiims|drdo|isro|bel|bhel|ntpc|ongc|iocl|lic|gds|post office|high court)\b/i;
  const J = jobs.filter((j) => ago(j.published) <= 3 && statusOf(j).live)
    .sort((a, b) => (Number(b.total_vacancies) || 0) - (Number(a.total_vacancies) || 0) || String(b.published).localeCompare(String(a.published)))
    .slice(0, 24).map((j) => `${SITE.url}/jobs/${j.id}/`);
  const U = updates.filter((u) => ago(u.date) <= 2)
    .sort((a, b) => (BIG.test(b.title) - BIG.test(a.title)) || String(b.date).localeCompare(String(a.date)))
    .slice(0, 12).map((u) => `${SITE.url}/updates/${u.id}/`);
  // New evergreen pages go first for their first ten days, so the daily requests reach them once (the task skips
  // anything it requested in the last 14 days).
  const NEW_PAGES = [["vacancy-tracker/", "2026-10-30"], ["tools/kruti-dev-to-unicode/", "2026-10-30"], ["tools/unicode-to-kruti-dev/", "2026-10-30"], ["tools/hindi-typing-test/", "2026-10-30"], ["tools/english-typing-test/", "2026-10-30"],
    ["walk-in-interview/", "2026-10-30"], ["jobs-without-exam/", "2026-10-30"], ["apprentice/", "2026-10-30"]];
  const out = NEW_PAGES.filter(([, d]) => Date.parse(IST_DATE) - Date.parse(d) <= 10 * 86400000).map(([p]) => `${SITE.url}/${p}`);
  while (J.length || U.length) { out.push(...J.splice(0, 2)); out.push(...U.splice(0, 1)); }
  out.push(...["latest/", "closing-soon/", ...TOPIC_HUBS.map((t) => `${t.slug}/`), "updates/result/", "updates/admit-card/", "updates/answer-key/", "jobs/", "news/"].map((p) => `${SITE.url}/${p}`));
  return `# news-views.in — pages to request indexing for, most important first (built ${IST_DATE} ${IST_TIME} IST)\n` + [...new Set(out)].join("\n") + "\n";
}
// RSS feed of the newest jobs AND results/admit cards. Google accepts RSS as a sitemap and re-reads feeds often;
// the WebSub hub link lets notify-search.js announce each update the moment a deploy is live.
function buildFeed(jobs, updates = []) {
  const items = [
    ...jobs.map((j) => ({ title: j.title, url: `${SITE.url}/jobs/${j.id}/`, date: j.published, desc: j.summary || j.post_name || j.title })),
    ...updates.map((u) => ({ title: u.title, url: `${SITE.url}/updates/${u.id}/`, date: u.date, desc: u.summary || u.title })),
  ].filter((x) => /^\d{4}-\d{2}-\d{2}/.test(String(x.date || ""))).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 60);
  const when = (d) => new Date(Math.min(Date.parse(String(d).slice(0, 10) + "T09:00:00+05:30"), BUILT.getTime())).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
  <title>${esc(SITE.brand)} — Government Jobs, Results &amp; Admit Cards</title>
  <link>${SITE.url}/</link>
  <atom:link href="${SITE.url}/feed.xml" rel="self" type="application/rss+xml"/>
  <atom:link href="https://pubsubhubbub.appspot.com/" rel="hub"/>
  <description>${esc(SITE.tagline)}</description>
  <language>en-in</language>
  <lastBuildDate>${BUILT.toUTCString()}</lastBuildDate>${items.map((x) => `
  <item>
    <title>${esc(x.title)}</title>
    <link>${x.url}</link>
    <guid isPermaLink="true">${x.url}</guid>
    <pubDate>${when(x.date)}</pubDate>
    <description>${esc(x.desc)}</description>
  </item>`).join("")}
</channel></rss>`;
}

/* ---- Mini markdown (for guide articles; zero deps) -------------- */
function md(src) {
  const lines = String(src).replace(/\r/g, "").split("\n");
  let html = "", i = 0;
  const inline = (t) => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  while (i < lines.length) {
    const l = lines[i];
    if (/^#{1,3}\s/.test(l)) {
      const n = l.match(/^#+/)[0].length;
      const txt = l.replace(/^#+\s/, "");
      const id = slug(txt);
      html += `<h${n} id="${id}">${inline(txt)}</h${n}>`; i++;
    } else if (/^\s*[-*]\s/.test(l)) {
      html += "<ul>"; while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*[-*]\s/, ""))}</li>`; i++; } html += "</ul>";
    } else if (/^\s*\d+\.\s/.test(l)) {
      html += "<ol>"; while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\s*\d+\.\s/, ""))}</li>`; i++; } html += "</ol>";
    } else if (/^>\s?/.test(l)) {
      html += `<blockquote>${inline(l.replace(/^>\s?/, ""))}</blockquote>`; i++;
    } else if (l.trim() === "") { i++; }
    else { let p = l; i++; while (i < lines.length && lines[i].trim() !== "" && !/^[#>\-*]|^\d+\./.test(lines[i])) { p += " " + lines[i]; i++; } html += `<p>${inline(p)}</p>`; }
  }
  return html;
}
function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (mm) meta[mm[1]] = mm[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

/* ---- Job article prose + FAQ ------------------------------------ */
function overviewProse(job) {
  const live = statusOf(job).live;
  // Prefer AI-written overview paragraphs when the extractor produced them.
  const ai = Array.isArray(job.overview) ? job.overview : (typeof job.overview === "string" && job.overview.trim() ? [job.overview] : null);
  if (ai && ai.length) {
    const facts = [];
    if (job.total_vacancies) facts.push(`<strong>${inr(job.total_vacancies)} vacancies</strong>`);
    if (job.application_end) facts.push(`last date <strong>${fmtDate(job.application_end)}</strong>`);
    return ai.map((p) => `<p>${esc(String(p))}</p>`).join("") +
      (facts.length ? `<p class="fact-line">Key facts: ${facts.join(" &middot; ")}.</p>` : "") +
      (job.about_organization ? `<p>${esc(String(job.about_organization))}</p>` : "");
  }
  const bits = [];
  bits.push(`The ${esc(job.organization)}${job.org_short ? ` (${esc(job.org_short)})` : ""} has invited online applications for <strong>${esc(job.title)}</strong>${job.post_name ? `, for the post of ${esc(job.post_name)}` : ""}.`);
  if (job.total_vacancies) bits.push(`A total of <strong>${inr(job.total_vacancies)} vacancies</strong> are to be filled through this recruitment.`);
  if (job.application_end) bits.push(`The online application window ${live ? "is open" : "was open"}${job.application_start ? ` from ${fmtDate(job.application_start)}` : ""} until <strong>${fmtDate(job.application_end)}</strong>.`);
  if (job.exam_date) bits.push(`The examination is scheduled for ${fmtDate(job.exam_date)}.`);
  bits.push(`Candidates who meet the eligibility conditions explained below should apply through the official website before the last date.`);
  return `<p>${bits.join(" ")}</p>`;
}
function eligibilityProse(job) {
  const p = [];
  if (job.eligibility_notes) p.push(esc(String(job.eligibility_notes)));
  if (job.qualification) p.push(`To apply for ${esc(job.title)}, a candidate must have ${esc(job.qualification)}.`);
  if (job.age_max) p.push(`The age of applicants should generally be <strong>${job.age_min ? `between ${job.age_min} and ${job.age_max} years` : `up to ${job.age_max} years`}</strong> as on the cut-off date mentioned in the official notification. Age relaxation is provided to candidates from SC, ST, OBC, PwD and other reserved categories as per government rules.`);
  if (job.location) p.push(`The posts are based in ${esc(job.location)}.`);
  if (!p.length) return "";
  return `<p>${p.join(" ")}</p>`;
}
function salaryProse(job) {
  if (!job.salary) return "";
  return `<p>Selected candidates will receive a pay of <strong>${esc(job.salary)}</strong>. Government employees are also generally entitled to allowances such as Dearness Allowance (DA), House Rent Allowance (HRA) and other benefits applicable to the post and pay level.</p>`;
}
function faqsFor(job) {
  const searchFaq = Array.isArray(job.faq_search) ? job.faq_search.filter((x) => x && x.q && x.a) : [];
  const base = faqsBase(job);
  const seen = new Set(searchFaq.map((x) => x.q.toLowerCase()));
  return [...searchFaq, ...base.filter((x) => !seen.has(x.q.toLowerCase()))].slice(0, 10);
}
function faqsBase(job) {
  const aiFaq = Array.isArray(job.faq) ? job.faq : (Array.isArray(job.faqs) ? job.faqs : null);
  if (aiFaq && aiFaq.length) {
    const cleaned = aiFaq
      .map((x) => ({ q: String(x && (x.q || x.question) || "").trim(), a: String(x && (x.a || x.answer) || "").trim() }))
      .filter((x) => x.q && x.a);
    if (cleaned.length) return cleaned;
  }
  const f = [];
  if (job.application_end) f.push({ q: `What is the last date to apply for ${job.title}?`, a: `The last date to submit the online application is ${fmtDate(job.application_end)}.` });
  if (job.total_vacancies) f.push({ q: `How many vacancies are there in ${job.title}?`, a: `There are ${inr(job.total_vacancies)} vacancies in this recruitment.` });
  if (job.qualification) f.push({ q: `What is the educational qualification required?`, a: `Candidates must have ${job.qualification}.` });
  if (job.age_max) f.push({ q: `What is the age limit for this recruitment?`, a: `The age limit is generally ${job.age_min ? job.age_min + "–" : "up to "}${job.age_max} years, with relaxation for reserved categories as per government norms.` });
  if (job.fee) f.push({ q: `What is the application fee?`, a: `The application fee is ${job.fee}.` });
  if (job.salary) f.push({ q: `What is the salary for ${job.post_name || job.title}?`, a: `The pay offered is ${job.salary}.` });
  f.push({ q: `How can I apply for ${job.title}?`, a: `Applications are accepted online through the official website. The step-by-step process is listed in the "How to apply" section above.` });
  return f;
}
function faqSection(faqs) {
  if (!faqs.length) return "";
  const items = faqs.map((x) =>
    `<details class="faq-item"><summary>${esc(x.q)}</summary><div class="faq-a">${esc(x.a)}</div></details>`).join("\n");
  return `<h2 class="section-h">Frequently asked questions</h2><div class="faq">${items}</div>`;
}
function faqLd(faqs) {
  return {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faqs.map((x) => ({
      "@type": "Question", name: x.q,
      acceptedAnswer: { "@type": "Answer", text: x.a },
    })),
  };
}

/* ---- Static pages (About / Contact / Privacy / Disclaimer / Terms) */
function pageShell(o) {
  // o: {slug, title, desc, h1, body, ld?}
  const canonical = `${SITE.url}/${o.slug}/`;
  return head({ title: `${o.title} | ${SITE.name}`, desc: o.desc, canonical, ld: o.ld || [] }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; ${esc(o.title)}</p>
  <h1>${esc(o.h1 || o.title)}</h1>
  ${o.body}
</main>` + foot();
}
function policyPages() {
  const updated = fmtDate(IST_DATE);
  const out = {};
  out["about"] = pageShell({
    slug: "about", title: "About Us", desc: `About ${SITE.brand} — what we do and who we are.`,
    body: md(
`${SITE.brand} is an independent platform that publishes the latest government job (Sarkari Naukri) notifications in India in a clear, simple format. For every recruitment we summarise the vacancies, eligibility, important dates, application fee and a step-by-step application process, and we link to the official source so you can verify and apply.

## What we cover
- Central and state government job notifications
- Eligibility, age limit and qualification details
- Application start and last dates, and exam dates where available
- Direct links to official notifications and apply pages

## Our approach
We aim to save you time. Government notifications are often long and hard to read; we condense the essentials and present them consistently. We are not a recruitment agency and we do not charge candidates any fee.

## Our editorial standards
Our preparation guides are written by the ${SITE.brand} editorial team; job and result listings are compiled from official sources by an automated process with strict rules (see [how we verify](/editorial-policy/)). We follow a few firm principles: we base information on official notifications and authoritative sources; we write in plain, practical language that genuinely helps candidates; we keep our preparation guides factual and free of false promises or guaranteed-selection claims; and we review and update our content as exam patterns, eligibility rules and dates change. Where a detail can vary or change, we say so and point you to the official source.

## Why you can trust us
We are independent and candidate-first. We never charge for information, we clearly separate official facts from general guidance, and we always link to the original notification so you can verify everything yourself. Our goal is to be a reliable, honest starting point for your government-job journey — not the final authority, which is always the official recruiting body.

## Accuracy
We work to keep information correct and up to date, but details can change. Always confirm the final details on the official website before applying. If you spot an error, please [contact us](/contact/) and we will fix it quickly.`)
  });
  out["editorial-policy"] = pageShell({
    slug: "editorial-policy", title: "How We Verify Notifications",
    desc: `How ${SITE.brand} finds, checks and updates government job notifications, results and admit cards.`,
    body: md(
`${SITE.brand} publishes government job notifications, results, admit cards and answer keys quickly — but speed is worthless if the facts are wrong. This page explains exactly how a notification reaches the site and how we keep it accurate.

## Where notifications come from
- **Official websites.** We monitor the notice boards of central and state recruitment bodies directly — commissions, selection boards, police recruitment boards, railway and banking recruiters and other departments. New notices are read from the official page or PDF itself.
- **Established job-news feeds.** We also watch well-known notification feeds to catch announcements early, then trace each one back to the official source before linking to it.

## What we check before publishing
- **Official links only.** The "Apply" and "Official notification" buttons point only to government or recruiting-organisation websites — never to another job portal.
- **Facts come from the notice.** Vacancies, dates, age limits, fees and eligibility are taken from the notification text. If a detail is not in the notice, we leave it out rather than guess.
- **Verified badge.** Pages marked "✓ Verified from the official website" were read directly from the recruiter's own website.
- **No duplicates or filler.** When the same recruitment is reported twice, we merge the pages and redirect the old address. We do not publish generic "latest jobs" round-ups or work-from-home schemes.
- **Indian dates.** Deadlines are calculated in Indian Standard Time, so a recruitment shows as closed as soon as its last date has passed in India.

## How the pages are written
Summaries, frequently asked questions, step-by-step application instructions and Hindi translations are drafted with the help of AI tools from the official notice text, then checked by automated rules — official-domain links, dates in range, no figures that do not appear in the source. Preparation guides are written by our editorial team.

## Updates and corrections
Recruiting bodies often publish corrigenda, extend last dates or change exam dates. When that happens we update the page; for example, when a corrigendum changed the number of posts in a railway recruitment, the page was corrected and duplicate listings with the old figure were merged into it. If you spot an error, please [contact us](/contact/) with the link to the official notice and we will correct it.

## Independence
${SITE.brand} is not a government body, is not affiliated with any recruiting organisation and never charges candidates a fee. Always confirm the final details on the official website before you apply or pay any fee.

*Last updated: ${updated}*`),
  });
  out["contact"] = pageShell({
    slug: "contact", title: "Contact Us", desc: `Get in touch with the ${SITE.brand} team.`,
    body: md(
`We would love to hear from you. For corrections, suggestions, partnership or any other query, reach us at:

**Email:** ${SITE.email}

We usually respond within 2–3 working days. If you are reporting an error in a job listing, please include the link to the page and the correct detail so we can update it quickly.`)
  });
  out["privacy-policy"] = pageShell({
    slug: "privacy-policy", title: "Privacy Policy", desc: `How ${SITE.brand} handles data, cookies and advertising.`,
    body: md(
`_Last updated: ${updated}_

This Privacy Policy explains how ${SITE.brand} ("we", "us") handles information when you visit our website.

## Information we collect
We do not ask you to create an account or submit personal information to read our content. Like most websites, our servers and analytics may automatically record standard log data such as your browser type, approximate location, and the pages you visit.

## Cookies
We use cookies to understand how visitors use the site and to improve it.

## Third-party advertising (Google AdSense)
We may use third-party advertising companies, including Google, to serve ads when you visit our website. Google's use of advertising cookies (including the DoubleClick cookie) enables it and its partners to serve ads based on your visit to this and other sites. You may opt out of personalised advertising by visiting Google's Ads Settings. Third-party vendors and ad networks may also use cookies to serve ads based on your prior visits.

## Analytics
We may use analytics tools to measure traffic and usage patterns in aggregate. This data is not used to personally identify you.

## Android app
Our Android app, **Sarkari Radar** (published by ${SITE.brand}, package in.newsviews.app), has no accounts and collects no personal information. Saved jobs, your language and your alert choices (states and qualifications) are stored only on your phone. To send job alerts, the app registers with Google's Firebase Cloud Messaging, which gives your phone an anonymous token and subscribes it to the alert topics you choose; we never receive your name, phone number or contacts. You can turn alerts off in the app or uninstall it at any time.

The app is free and is supported by ads from Google AdMob. To show and measure ads and to prevent fraud, Google's ad software may collect your device's advertising ID, your IP address (which gives an approximate location), diagnostic information and how you interact with ads. In regions where the law requires it (such as the EEA and the UK), the app asks for your consent first, and you can change your choice at any time under Alerts › About › Ad privacy choices. Anywhere, you can reset or delete your advertising ID in your phone's settings (Settings › Privacy › Ads, or Settings › Google › Ads). Learn more in [Google's privacy policy](https://policies.google.com/technologies/partner-sites).${mediationPolicy()}

## Your choices
You can disable cookies in your browser settings at any time. Doing so may affect how some parts of the site function.

## Children
This website is intended for a general audience and is not directed at children under 13.

## Changes
We may update this policy from time to time. Continued use of the site means you accept the current version.

## Contact
Questions about this policy? Email ${SITE.email}.`)
  });
  out["disclaimer"] = pageShell({
    slug: "disclaimer", title: "Disclaimer", desc: `Important disclaimer about the information on ${SITE.brand}.`,
    body: md(
`_Last updated: ${updated}_

${SITE.brand} is an independent information website. We are **not** a government body and have no affiliation with any government department, recruitment board or official organisation.

All job information is compiled from publicly available notifications and is provided for general guidance only. While we make every effort to keep it accurate and current, we do not guarantee completeness or accuracy. Dates, vacancies, fees and eligibility can change.

**Before applying to any job, you must verify all details on the official website** linked on each page. We are not responsible for any loss, inconvenience or damage caused by reliance on information published here. We never charge candidates any fee and we do not guarantee employment.`)
  });
  out["terms"] = pageShell({
    slug: "terms", title: "Terms of Use", desc: `Terms of use for ${SITE.brand}.`,
    body: md(
`_Last updated: ${updated}_

By using ${SITE.brand} you agree to these terms.

## Use of content
Content is provided for personal, non-commercial information. You may not republish our compiled content at scale without permission. Official notifications and government content belong to their respective owners.

## No warranty
The site is provided "as is" without warranties of any kind. We do not guarantee that the information is accurate, complete or up to date.

## External links
We link to official and third-party websites for your convenience. We are not responsible for the content or practices of those sites.

## Limitation of liability
We are not liable for any damages arising from the use of this site. Always verify information on official sources.

## Contact
For questions about these terms, email ${SITE.email}.`)
  });
  return out;
}

/* ---- Guides (markdown articles) --------------------------------- */
function readGuides() {
  const dir = path.join(ROOT, "content", "guides");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { meta, body } = frontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
    return { slug: meta.slug || slug(f.replace(/\.md$/, "")), meta, body };
  }).sort((a, b) => (b.meta.date || "").localeCompare(a.meta.date || ""));
}
function guideFaqs(body) {
  const i = body.indexOf("## Frequently asked questions");
  if (i < 0) return [];
  let sec = body.slice(i);
  const next = sec.indexOf("\n## ", 3);
  if (next > 0) sec = sec.slice(0, next);
  const out = [];
  const re = /\*\*(.+?)\*\*\s*\n([^\n]+)/g;
  let m;
  while ((m = re.exec(sec))) out.push({ q: m[1].trim(), a: m[2].trim() });
  return out;
}
function buildGuide(g) {
  const canonical = `${SITE.url}/guides/${g.slug}/`;
  const title = `${g.meta.title} | ${SITE.name}`;
  const desc = g.meta.description || g.meta.title;
  const faqs = guideFaqs(g.body);
  const ld = [
    { "@context": "https://schema.org", "@type": "Article",
      headline: g.meta.title, description: desc, datePublished: g.meta.date,
      dateModified: g.meta.updated || g.meta.date,
      author: { "@type": "Organization", name: g.meta.author || SITE.publisher },
      publisher: { "@type": "Organization", name: SITE.brand, logo: { "@type": "ImageObject", url: SITE.url + "/icon-512.png" } },
      mainEntityOfPage: canonical },
    breadcrumbLd([
      { name: "Home", url: SITE.url + "/" },
      { name: "Guides", url: SITE.url + "/guides/" },
      { name: g.meta.title, url: canonical },
    ]),
  ];
  if (faqs.length) ld.push(faqLd(faqs));
  const wordCount = (g.body.match(/\b\w+\b/g) || []).length;
  const readMins = Math.max(1, Math.round(wordCount / 200));
  const heads = [];
  g.body.replace(/^##\s+(.+)$/gm, (m, t) => { heads.push(t.trim()); return ""; });
  const toc = heads.length >= 4
    ? `<nav class="toc" aria-label="Table of contents"><p class="toc-title">In this guide</p><ol>${heads.map((h) => `<li><a href="#${slug(h)}">${esc(h)}</a></li>`).join("")}</ol></nav>`
    : "";
  return head({ title, desc, canonical, ld, ogType: "article", published: g.meta.date, modified: g.meta.updated || g.meta.date }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/guides/">Guides</a></p>
  <article>
    <p class="eyebrow">${g.meta.category ? esc(g.meta.category) : "Guide"}${g.meta.date ? ` &middot; ${fmtDate(g.meta.date)}` : ""} &middot; ${readMins} min read</p>
    <h1>${esc(g.meta.title)}</h1>
    ${g.meta.description ? `<p class="lede">${esc(g.meta.description)}</p>` : ""}
    ${toc}
    <div class="prose">${md(g.body)}</div>
    <div class="author-box">
      <div class="author-avatar" aria-hidden="true">N.</div>
      <div class="author-meta">
        <p class="author-name">${esc(g.meta.author || SITE.publisher)}</p>
        <p class="author-bio">Researched and written by the ${esc(SITE.brand)} editorial team. We produce practical, fact-checked guides on government jobs and exam preparation in India, and update them as rules and patterns change. ${esc(SITE.brand)} is an independent platform with no government affiliation; always verify final details on the official notification.</p>
        <p class="author-dates">${g.meta.date ? `Published ${fmtDate(g.meta.date)}` : ""}${g.meta.updated && g.meta.updated !== g.meta.date ? ` &middot; Updated ${fmtDate(g.meta.updated)}` : ""}</p>
      </div>
    </div>
    ${relatedGuidesHtml(g)}
  </article>
</main>` + foot();
}
let ALL_GUIDES = [];
let TOOL_DEFS = [];
let ALL_QUIZ = [];
let ALL_JOBS = [];
let ORG_PAGES = new Set();   // org slugs that actually get a page (active jobs only)
function relatedGuidesHtml(current) {
  const others = ALL_GUIDES.filter((x) => x.slug !== current.slug);
  if (!others.length) return "";
  // simple relevance: shared significant words in the title
  const stop = new Set("a an the to of for in on and or how what which your you guide government job jobs exam exams india 2026".split(" "));
  const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !stop.has(w)));
  const cw = words(current.meta.title + " " + (current.meta.description || ""));
  const scored = others.map((o) => {
    const ow = words(o.meta.title);
    let score = 0; ow.forEach((w) => { if (cw.has(w)) score++; });
    return { o, score };
  }).sort((a, b) => b.score - a.score || (b.o.meta.date || "").localeCompare(a.o.meta.date || ""));
  const picks = scored.slice(0, 3).map((s) => s.o);
  return `<section class="related"><h2 class="section-h">Related guides</h2>
    <ul class="guides">${picks.map((g) => `<li><a class="guide-card" href="/guides/${g.slug}/"><h2>${esc(g.meta.title)}</h2><p>${esc(g.meta.description || "")}</p><span class="readmore">Read guide &rarr;</span></a></li>`).join("")}</ul>
  </section>`;
}
function buildGuidesIndex(guides) {
  const canonical = SITE.url + "/guides/";
  const CAT_ORDER = ["Exam Preparation & Strategy", "Subject Guides", "Choosing Your Career", "Applying & Eligibility"];
  const card = (g) =>
    `<li><a class="guide-card" href="/guides/${g.slug}/">
      <h3>${esc(g.meta.title)}</h3>
      <p>${esc(g.meta.description || "")}</p>
      <span class="readmore">Read guide &rarr;</span>
    </a></li>`;
  const groups = new Map();
  for (const g of guides) {
    const c = g.meta.category || "More Guides";
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(g);
  }
  const orderedCats = [...CAT_ORDER.filter((c) => groups.has(c)), ...[...groups.keys()].filter((c) => !CAT_ORDER.includes(c))];
  const sections = orderedCats.map((c) =>
    `<section class="guide-group">
      <h2 class="section-h">${esc(c)} <span class="grp-count">${groups.get(c).length}</span></h2>
      <ul class="guides">${groups.get(c).map(card).join("\n")}</ul>
    </section>`).join("\n");
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Guides", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "Government Job Guides", url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: guides.map((g, i) => ({
        "@type": "ListItem", position: i + 1, url: `${SITE.url}/guides/${g.slug}/`, name: g.meta.title })) } },
  ];
  return head({ title: `Government Job Guides & Preparation Tips (${guides.length}+ Articles) | ${SITE.name}`,
    desc: "In-depth guides on government exam preparation, subject strategies, choosing a career, eligibility and how to apply — practical, free and updated regularly.",
    canonical, ld }) + `
<main class="wrap" id="main">
  <section class="cat-head">
    <p class="eyebrow">Guides &middot; ${guides.length} articles</p>
    <h1>Guides &amp; preparation tips</h1>
    <p class="lede">In-depth, practical articles on exam preparation, subject strategies, choosing the right government job, and the application process — written to be genuinely useful, and completely free.</p>
  </section>
  ${guides.length ? sections : `<p class="empty">New guides are on the way.</p>`}
</main>` + foot();
}

/* ---- Run -------------------------------------------------------- */
function write(rel, content) {
  const full = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function main() {
  const rawJobs = JSON.parse(fs.readFileSync(DATA, "utf8"));
  // Defensive sanitiser: the automation's AI can occasionally return a field as a
  // number/object/array. Coerce text fields to strings so the build never crashes.
  const TEXT = ["id", "title", "organization", "org_short", "post_name", "qualification",
    "summary", "summary_hindi", "location", "fee", "salary", "apply_link",
    "application_start", "application_end", "exam_date", "published"];
  const jobs = (Array.isArray(rawJobs) ? rawJobs : []).map((j) => {
    // same hygiene as the automation: objects become "Key: value" text (never "[object Object]"), numbers numbers,
    // dates YYYY-MM-DD, links http(s), list fields arrays of strings
    const o = LIB.sanitizeJob(j);
    for (const k of TEXT) {
      if (o[k] != null && typeof o[k] !== "string") o[k] = LIB.toText(o[k], k);
    }
    if (o.total_vacancies != null && typeof o.total_vacancies !== "number") {
      const n = parseInt(String(o.total_vacancies).replace(/[^\d]/g, ""), 10);
      o.total_vacancies = Number.isFinite(n) ? n : null;
    }
    if (o.how_to_apply != null && !Array.isArray(o.how_to_apply)) o.how_to_apply = [String(o.how_to_apply)];
    // Source headlines say "Apply Online" for email and postal applications too; the notice decides (lib.js applyMode).
    if (o.title && /apply online/i.test(o.title)) {
      const m = LIB.applyMode(o);
      if (m === "email") o.title = o.title.replace(/apply online/i, "Apply by Email");
      else if (m === "offline") o.title = o.title.replace(/apply online/i, "Apply Offline");
    }
    if (o.hi && o.hi.title && /ऑनलाइन आवेदन/.test(o.hi.title)) {
      const m = LIB.applyMode(o);
      if (m === "email") o.hi = { ...o.hi, title: o.hi.title.replace(/ऑनलाइन आवेदन/, "ईमेल से आवेदन") };
      else if (m === "offline") o.hi = { ...o.hi, title: o.hi.title.replace(/ऑनलाइन आवेदन/, "ऑफलाइन आवेदन") };
    }
    // Guarantee a URL-safe id no matter what's in the data (spaces/unicode/empty).
    const safeId = String(o.id || o.title || "")
      .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 70).replace(/-+$/g, "");
    o.id = safeId;
    return o;
  }).filter((j) => j.id && j.id.length >= 2 && j.title);
  // Drop duplicate ids that could collide into the same URL (keep first/newest).
  { const seen = new Set(); for (let i = jobs.length - 1; i >= 0; i--) {
      if (seen.has(jobs[i].id)) jobs.splice(i, 1); else seen.add(jobs[i].id);
  } }
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const f of ["styles.css", "site.js", "sw.js", "favicon.svg", "og.png", "icon-512.png", "icon-192.png", "icon-180.png", "site.webmanifest", "_headers", "761d3fa6bfbb9013f7da584d6b8b4eaa.txt", "googledb93c44ec31e6b4b.html"]) {
    const src = path.join(ROOT, "src", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
  }

  // Split: `jobs` = ALL (each gets its own page — SEO preserved, no 404s).
  // `activeJobs` = not stale (drives homepage, category listings, counts, sitemap priority).
  const activeJobs = jobs.filter((j) => !isStale(j));
  const staleCount = jobs.length - activeJobs.length;
  if (staleCount) console.log(`Lifecycle: ${staleCount} stale job(s) hidden from listings (pages kept live).`);

  const levelMap = new Map();   // qual slug -> ACTIVE jobs (for listings)
  const orgMap = new Map();
  const stateMap = new Map();    // state slug -> ACTIVE jobs
  const gulfMap = new Map();     // gulf country slug -> ACTIVE jobs
  for (const job of activeJobs) {
    for (const q of qualsOf(job)) {
      if (!levelMap.has(q.slug)) levelMap.set(q.slug, []);
      levelMap.get(q.slug).push(job);
    }
    const g = gulfOf(job);
    if (g) {
      if (!gulfMap.has(g.slug)) gulfMap.set(g.slug, []);
      gulfMap.get(g.slug).push(job);
    }
    for (const st of statesOf(job)) {
      if (!stateMap.has(st.slug)) stateMap.set(st.slug, []);
      stateMap.get(st.slug).push(job);
    }
  }
  // Organisation pages: built from ALL jobs (stable URLs), only when an organisation has 2+ jobs —
  // a one-job "organisation page" is a thin duplicate of the job page.
  { const tmp = new Map();
    for (const job of jobs) {
      const short = orgKey(job); if (!short) continue;
      const k = slug(short); if (!k) continue;
      if (!tmp.has(k)) tmp.set(k, { short, jobs: [] });
      tmp.get(k).jobs.push(job);
    }
    for (const [k, o] of tmp) if (o.jobs.length >= 2) {
      o.jobs.sort((x, y) => (statusOf(x).cls === "closed") - (statusOf(y).cls === "closed") || String(y.published || "").localeCompare(String(x.published || "")));
      orgMap.set(o.short, o);
    }
  }
  const qualCounts = new Map(QUALS.map((q) =>
    [q.slug, (levelMap.get(q.slug) || []).filter((j) => statusOf(j).cls !== "closed").length]));
  const gulfCounts = new Map(GULF.map((g) =>
    [g.slug, (gulfMap.get(g.slug) || []).filter((j) => statusOf(j).cls !== "closed").length]));
  const stateCounts = new Map(STATES.map((s) =>
    [s.slug, (stateMap.get(s.slug) || []).filter((j) => statusOf(j).cls !== "closed").length]));
  const levels = QUALS.map((q) => q.name);
  const orgs = [...orgMap.values()].sort((a, b) => b.jobs.length - a.jobs.length);
  ORG_PAGES = new Set(orgs.map((o) => slug(o.short)));   // set BEFORE any page is rendered

  const guides = readGuides();
  ALL_GUIDES = guides;
  ALL_JOBS = jobs;
  const updates = readUpdates();
  const news = readNews();
  TG = readTelegram();
  FOOT_LATEST = footLatest(activeJobs, updates);   // before any page is rendered
  makeShareImages(jobs, updates);                  // before job/update pages, which link their own image

  // Tools, salary pages (calculators that work in the browser)
  const TOOLS = require("./tools.js").buildToolPages({ head, foot, esc, SITE, BUILT, breadcrumbLd, faqLd, faqSection,
    rates: (JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).payRates || {}) });
  for (const tp of TOOLS.pages) write(tp.path, tp.html);
  const HI_TOOL_PAGES = require("./tools.js").buildHindiTools({ head, foot, esc, SITE, breadcrumbLd, faqLd,
    rates: (JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8")).payRates || {}) });
  for (const tp of HI_TOOL_PAGES) write(tp.path, tp.html);
  TOOLS.pages.push(...HI_TOOL_PAGES);
  TOOL_DEFS = TOOLS.defs;
  console.log(`Tools: ${TOOLS.defs.length} tools + ${TOOLS.levels.length} pay-level pages.`);

  write("index.html", buildHome(activeJobs, levels, orgs, guides, qualCounts, updates, stateCounts, news));
  for (const job of jobs) write(`jobs/${job.id}/index.html`, buildJob(job, jobs));

  ALL_QUIZ = readQuiz();
  write("quiz/index.html", buildQuizIndex(ALL_QUIZ));
  for (const z of ALL_QUIZ) write(`quiz/${z.id}/index.html`, buildQuizPage(z, ALL_QUIZ));
  write("news/index.html", buildNewsIndex(news));
  for (const a of news) write(`news/${a.id}/index.html`, buildNewsPage(a, news));

  write("updates/index.html", buildUpdatesIndex(updates));
  for (const u of updates) write(`updates/${u.id}/index.html`, buildUpdatePage(u, updates));
  for (const k of Object.keys(UPDATE_TYPES)) write(`updates/${k}/index.html`, buildUpdateTypeIndex(k, updates.filter((u) => u.type === k)));
  const HINDI = require("./hindi.js").buildHindi({ head, foot, esc, SITE, BUILT, breadcrumbLd, faqLd, statusOf, daysLeft, isStale, adSlot, jobs, updates, STATES, QUALS, statesOf, qualsOf, keyFacts, ctaHtml });
  HI_BROWSE = HINDI.hiBrowse;
  for (const hp of HINDI.pages) write(hp.path, hp.html);
  console.log(`Hindi: ${HINDI.hiJobIds.size} job + ${HINDI.hiUpdIds.size} update page(s) + hubs.`);
  const EXAMP = require("./exams.js").buildExamPages({ head, foot, esc, SITE, BUILT, breadcrumbLd, faqLd, faqSection, fmtDate, statusOf, adSlot, jobs, updates, hiDate: require("./hindi.js").hiDate });
  for (const ep of EXAMP.pages) write(ep.path, ep.html);
  console.log(`Exams: ${EXAMP.pages.filter((p) => !p.path.startsWith("hi/")).length - 1} exam hub(s) + ${EXAMP.pages.filter((p) => p.path.startsWith("hi/")).length - 1} Hindi.`);
  write("latest/index.html", buildLatestPage(activeJobs));
  write("jobs/index.html", buildAllJobsPage(activeJobs));
  write("closing-soon/index.html", buildClosingSoonPage(activeJobs));
  for (const t of TOPIC_HUBS) write(`${t.slug}/index.html`, buildTopicHub(t, activeJobs));
  write("vacancy-tracker/index.html", buildVacancyTracker(jobs, updates));

  const cats = [];
  cats.push({ kind: "news", slug: "" });
  for (const a of news) cats.push({ kind: "news", slug: a.id });
  for (const q of QUALS) {
    write(`qualification/${q.slug}/index.html`, buildQualPage(q, levelMap.get(q.slug) || []));
    cats.push({ kind: "qualification", slug: q.slug });
  }
  // Gulf / overseas country pages
  write("gulf/index.html", buildGulfIndex(gulfCounts));
  cats.push({ kind: "gulf", slug: "" });
  for (const g of GULF) {
    write(`gulf/${g.slug}/index.html`, buildGulfPage(g, gulfMap.get(g.slug) || []));
    cats.push({ kind: "gulf", slug: g.slug });
  }

  // State landing pages (statewise browsing)
  write("state/index.html", buildStatesIndex(stateCounts));
  cats.push({ kind: "state", slug: "" });
  const MIN_COMBO = Number(SITE.minComboJobs || 3);   // don't publish thin combo pages
  let comboCount = 0;
  for (const st of STATES) {
    const stJobs = stateMap.get(st.slug) || [];
    write(`state/${st.slug}/index.html`, buildStatePage(st, stJobs));
    cats.push({ kind: "state", slug: st.slug });
    // Long-tail: "<State> government jobs for <qualification>"
    for (const q of QUALS) {
      const list = stJobs.filter((j) => qualsOf(j).some((x) => x.slug === q.slug));
      const liveN = list.filter((j) => statusOf(j).cls !== "closed").length;
      if (liveN < MIN_COMBO) continue;
      write(`state/${st.slug}/${q.slug}/index.html`, buildStateQualPage(st, q, list));
      cats.push({ kind: "state", slug: `${st.slug}/${q.slug}` });
      comboCount++;
    }
  }
  if (comboCount) console.log(`Long-tail: ${comboCount} state x qualification page(s) (min ${MIN_COMBO} live jobs each).`);
  // A body with fewer than 3 listings makes a thin page (~80 words, 1-2 links): visitors still get it, but it stays
  // out of Google's index and the sitemap until it has 3, so crawling goes to pages with substance.
  const MIN_ORG_INDEX = Number(SITE.minOrgIndex || 3);
  let thinOrgs = 0;
  for (const { short, jobs: list } of orgMap.values()) {
    const s = slug(short), thin = list.length < MIN_ORG_INDEX;
    if (thin) thinOrgs++;
    write(`organization/${s}/index.html`, buildCategory("organization", short, s, list, { noindex: thin }));
    cats.push({ kind: "organization", slug: s, noindex: thin });
  }
  if (thinOrgs) console.log(`Organisation pages: ${thinOrgs} with fewer than ${MIN_ORG_INDEX} listings kept out of the index.`);

  write("404.html", build404());

  // Guides (markdown articles)
  write("guides/index.html", buildGuidesIndex(guides));
  for (const g of guides) write(`guides/${g.slug}/index.html`, buildGuide(g));

  // Policy / about pages (required for AdSense)
  const pages = policyPages();
  for (const [s, htmlOut] of Object.entries(pages)) write(`${s}/index.html`, htmlOut);

  // extra URLs for sitemap
  const extra = [
    "guides/",
    "updates/",
    "latest/",
    "jobs/",
    "quiz/",
    ...HINDI.pages.filter((p) => !p.noindex).map((p) => p.path.replace(/index\.html$/, "")),
    ...EXAMP.pages.map((p) => p.path.replace(/index\.html$/, "")),
    ...ALL_QUIZ.map((z) => `quiz/${z.id}/`),
    ...TOOLS.pages.map((p) => p.path.replace(/index\.html$/, "")),
    "closing-soon/",
    ...TOPIC_HUBS.map((t) => `${t.slug}/`),
    "vacancy-tracker/",
    ...Object.keys(UPDATE_TYPES).map((k) => `updates/${k}/`),
    ...updates.map((u) => `updates/${u.id}/`),
    ...guides.map((g) => `guides/${g.slug}/`),
    ...Object.keys(pages).map((s) => `${s}/`),
  ];

  // Real modification dates for dated pages (everything else is a hub that changes with each build).
  const mods = new Map();
  const d = (x) => (String(x || "").match(/^\d{4}-\d{2}-\d{2}/) || [])[0];
  for (const u of updates) if (d(u.date)) { mods.set(`updates/${u.id}/`, d(u.date)); mods.set(`hi/updates/${u.id}/`, d(u.date)); }
  for (const j of jobs) if (d(j.published)) mods.set(`hi/jobs/${j.id}/`, d(j.published));
  for (const a of news) if (d(a.date)) mods.set(`news/${a.id}/`, d(a.date));
  for (const z of ALL_QUIZ) if (d(z.date)) mods.set(`quiz/${z.id}/`, d(z.date));
  for (const g of guides) if (d(g.meta && g.meta.date)) mods.set(`guides/${g.slug}/`, d(g.meta.date));
  const cutoff60 = new Date(BUILT.getTime() - 60 * 86400000).toISOString().slice(0, 10);
  const oldClosed = new Set(jobs.filter((j) => j.application_end && j.application_end < cutoff60).map((j) => `hi/jobs/${j.id}/`));
  // Hindi twins stay out of the sitemap while Google's crawl budget for the site is small (they were 45% of it
  // and earn almost no impressions yet); they stay live and Google still finds them via hreflang links.
  // Set config.json "sitemapHindi": true to list them again.
  write("sitemap.xml", buildSitemap(jobs, cats, extra.filter((u) => !oldClosed.has(u) && (SITE.sitemapHindi || !u.startsWith("hi/"))), mods));

  // Human-readable master list of every URL — handy for checking/indexing.
  const allUrls = [
    SITE.url + "/",
    ...jobs.map((j) => `${SITE.url}/jobs/${j.id}/`),
    ...cats.map((c) => `${SITE.url}/${c.kind}/${c.slug ? c.slug + "/" : ""}`),
    ...updates.map((u) => `${SITE.url}/updates/${u.id}/`),
    SITE.url + "/updates/",
    ...Object.keys(UPDATE_TYPES).map((k) => `${SITE.url}/updates/${k}/`),
    SITE.url + "/latest/", SITE.url + "/jobs/", SITE.url + "/closing-soon/", SITE.url + "/quiz/",
    ...HINDI.pages.filter((p) => !p.noindex).map((p) => p.url),
    ...EXAMP.pages.map((p) => p.url),
    ...ALL_QUIZ.map((z) => `${SITE.url}/quiz/${z.id}/`),
    ...TOOLS.pages.map((p) => p.url),
    ...news.map((a) => `${SITE.url}/news/${a.id}/`),
    SITE.url + "/news/",
    SITE.url + "/gulf/",
    ...GULF.map((g) => `${SITE.url}/gulf/${g.slug}/`),
    ...guides.map((g) => `${SITE.url}/guides/${g.slug}/`),
    SITE.url + "/guides/",
    ...Object.keys(pages).map((s) => `${SITE.url}/${s}/`),
  ];
  write("all-urls.txt", [...new Set(allUrls)].join("\n") + "\n");
  write("feed.xml", buildFeed(jobs, updates));
  write("sitemap-latest.xml", buildLatestSitemap({ jobs, updates, news }));
  write("index-queue.txt", buildIndexQueue({ jobs, updates }));
  write("search.json", buildSearchIndex(jobs, updates));
  writeAppFeed(jobs, updates);
  write("news-sitemap.xml", buildNewsSitemap({ updates, news }));
  write("version.json", JSON.stringify({ build: BUILD_ID, at: BUILT.toISOString(), ist: `${IST_DATE} ${IST_TIME}` }) + "\n");

  // 301s for pages that were removed or merged (off-topic, duplicates, re-classified),
  // so old URLs that Google already saw keep their value instead of 404ing.
  try {
    const reds = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8"));
    // Every URL ever published is remembered in data/known-urls.json. If one is no longer generated
    // (a thin page dropped, a job removed), 301 it to the nearest parent page that still exists.
    try {
      const KNOWN = path.join(ROOT, "data", "known-urls.json");
      let known = []; try { known = JSON.parse(fs.readFileSync(KNOWN, "utf8")); } catch {}
      const current = [...new Set(allUrls.map((u) => u.replace(SITE.url, "")).filter((u) => u.endsWith("/")))];
      const have = new Set(reds.map((r) => r[0]));
      let auto = 0;
      for (const u of known) {
        if (fs.existsSync(path.join(DIST, u, "index.html")) || have.has(u)) continue;
        let parent = u.replace(/[^/]+\/$/, "");
        while (parent.length > 1 && !fs.existsSync(path.join(DIST, parent, "index.html"))) parent = parent.replace(/[^/]+\/$/, "");
        reds.push([u, parent || "/"]); have.add(u); auto++;
      }
      if (auto) console.log(`Redirects: ${auto} vanished URL(s) auto-redirected to their parent page.`);
      fs.writeFileSync(KNOWN, JSON.stringify([...new Set([...known, ...current])].sort(), null, 0) + "\n");
    } catch (e) { console.log("known-urls: " + e.message); }
    // A redirect whose target has itself gone (a merged update, an organisation page that fell below 2 listings) follows
    // the chain of redirects, else falls back to the target's nearest existing parent — a retired URL never 404s.
    const exists = (p) => p === "/" || fs.existsSync(path.join(DIST, p.replace(/^\//, ""), "index.html"));
    const redirTo = new Map(reds.map(([f, t]) => [f, t]));
    const parentOf = (p) => { let q = p.replace(/[^/]+\/$/, ""); while (q.length > 1 && !exists(q)) q = q.replace(/[^/]+\/$/, ""); return q || "/"; };
    const resolve = (t) => { const hops = new Set(); while (!exists(t) && redirTo.has(t) && !hops.has(t)) { hops.add(t); t = redirTo.get(t); } return exists(t) ? t : parentOf(t); };
    const lines = [], seen = new Set();
    for (const [from, to] of reds) {
      if (!from || !to || seen.has(from)) continue;
      if (fs.existsSync(path.join(DIST, from, "index.html"))) continue;
      const dst = /^https?:/.test(to) || to.includes("*") ? to : resolve(to);
      if (dst === from) continue;
      seen.add(from); lines.push(`${from} ${dst} 301`);
    }
    // Cloudflare Pages allows 2,000 static redirects: past 1,900, keep the specific ones (merged pages) over the
    // fallbacks to a section page, so the file never stops working as a whole
    if (lines.length > 1900) {
      const generic = (l) => /\s\/(jobs|updates|hi\/jobs|hi\/updates|organization|hi)?\/?\s301$/.test(l);
      const keep = [...lines.filter((l) => !generic(l)), ...lines.filter(generic)].slice(0, 1900);
      console.log(`Redirects: ${lines.length} rules, capped at 1900 (dropped ${lines.length - 1900} fallbacks to section pages)`);
      lines.length = 0; lines.push(...keep);
    }
    if (lines.length) { write("_redirects", lines.join("\n") + "\n"); console.log(`Redirects: ${lines.length} retired URL(s) -> 301.`); }
  } catch { /* no redirects file */ }
  write("offline/index.html", head({ title: `Offline | ${SITE.name}`, desc: "You are offline.", canonical: SITE.url + "/offline/" }) + `
<main class="wrap" id="main"><section class="cat-head">
  <p class="eyebrow">Offline</p><h1>You're offline right now</h1>
  <p class="lede">This page isn't cached yet. Reconnect to the internet and try again — previously visited pages remain available offline.</p>
  <p class="cta-row"><a class="btn btn-primary" href="/">Go to homepage</a></p>
</section></main>` + foot());

  write("offline/index.html", head({ title: `Offline | ${SITE.name}`, desc: "You are offline.", canonical: SITE.url + "/offline/" }) + `
<main class="wrap" id="main">
  <section class="cat-head">
    <p class="eyebrow">Offline</p>
    <h1>You're offline right now</h1>
    <p class="lede">This page isn't available without an internet connection. Pages you've visited before may still open. Once you're back online, the latest jobs and updates will load automatically.</p>
    <p class="cta-row"><a class="btn btn-primary" href="/">Try the homepage &rarr;</a></p>
  </section>
</main>` + foot());

  // Google crawls this young site only ~100-240 times a day, so the ~1,650 machine-translated Hindi job and update
  // pages (2 impressions in a month) are kept out of its crawl until the English pages are indexed; visitors still
  // get them and the Hindi hub pages stay crawlable. Set config.json "crawlHindiDetail": true to open them again.
  const hiBlock = SITE.crawlHindiDetail ? "" : "Disallow: /hi/jobs/\nDisallow: /hi/updates/\n";
  write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /api/\n${hiBlock}Sitemap: ${SITE.url}/sitemap.xml\nSitemap: ${SITE.url}/sitemap-latest.xml\nSitemap: ${SITE.url}/news-sitemap.xml\n`);
  // Only /api/* runs as a Cloudflare Pages Function (functions/); every page and file stays a free static asset.
  write("_routes.json", JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }) + "\n");
  if (SITE.adsenseId) {
    const pub = SITE.adsenseId.replace(/^ca-/, "");
    write("ads.txt", `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  }
  // Other web ad partners (a header-bidding / Ad Manager partner, another network) give their own ads.txt lines.
  const adsExtra = [].concat(SITE.adsTxtExtra || []).map(String).filter(Boolean);
  if (adsExtra.length) {
    const prev = SITE.adsenseId ? fs.readFileSync(path.join(DIST, "ads.txt"), "utf8") : "";
    write("ads.txt", prev + adsExtra.join("\n") + "\n");
  }
  // app-ads.txt: AdMob checks this file on the developer website named in the Play listing (news-views.in).
  // The publisher ID is the part of the AdMob app ID between "ca-app-" and "~".
  const appPub = String((SITE.admob || {}).appId || "").match(/^ca-app-(pub-\d+)~/);
  // Mediation networks (Meta Audience Network etc.) ask for their own lines too: config.json "admob.appAdsTxt".
  const appExtra = [].concat((SITE.admob || {}).appAdsTxt || []).map(String).filter(Boolean);
  if (appPub || appExtra.length) write("app-ads.txt", (appPub ? `google.com, ${appPub[1]}, DIRECT, f08c47fec0942fa0\n` : "") + appExtra.map((l) => l + "\n").join(""));

  console.log(`Built: home + ${jobs.length} jobs + ${cats.length} categories + ${guides.length} guides + ${Object.keys(pages).length} pages + 404/sitemap/feed -> dist/`);
}

main();
