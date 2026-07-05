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
};

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const DATA = path.join(ROOT, "data", "jobs.json");
const BUILT = new Date();

// Load the single user config file (config.json) and apply it.
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  for (const k of ["url", "email", "adsenseId", "brand", "name", "tagline"]) {
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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return esc(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function daysLeft(endIso) {
  if (!endIso) return null;
  const end = new Date(endIso + "T23:59:59");
  if (isNaN(end)) return null;
  return Math.ceil((end - BUILT) / 86400000);
}
function statusOf(job) {
  const d = daysLeft(job.application_end);
  if (d === null) return { cls: "open", label: "Open", live: true };
  if (d < 0) return { cls: "closed", label: "Closed", live: false };
  if (d <= 7) return { cls: "soon", label: d === 0 ? "Last day" : `${d} days left`, live: true };
  return { cls: "open", label: "Open", live: true };
}
function windowPct(job) {
  if (!job.application_start || !job.application_end) return null;
  const s = new Date(job.application_start + "T00:00:00");
  const e = new Date(job.application_end + "T23:59:59");
  if (isNaN(s) || isNaN(e) || e <= s) return null;
  const p = ((BUILT - s) / (e - s)) * 100;
  return Math.max(0, Math.min(100, p));
}
const inr = (n) => (n === 0 || n) ? Number(n).toLocaleString("en-IN") : "—";

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

/* parse "Rs 25,500 - 1,51,100 per month" -> {min,max,unit} for structured salary */
function parseSalary(s) {
  if (!s) return null;
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}">
<link rel="canonical" href="${esc(o.canonical)}">
<meta name="theme-color" content="#14213D">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="${o.ogType || "website"}">
${o.published ? `<meta property="article:published_time" content="${o.published}">` : ""}
${o.modified || o.published ? `<meta property="article:modified_time" content="${o.modified || o.published}">` : ""}
<meta property="og:site_name" content="${esc(SITE.brand)}">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta property="og:image" content="${SITE.url}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.desc)}">
<meta name="twitter:image" content="${SITE.url}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.brand)} Jobs" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/styles.css">
${adsense}
${ldBlocks}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
  <a class="brand" href="/" aria-label="${esc(SITE.brand)} home">
    <span class="mark" aria-hidden="true">N<span class="dot">.</span></span>
    News-Views<span class="dot">.</span>
  </a>
  <nav class="nav" aria-label="Primary">
    <details class="nav-dd">
      <summary>Jobs</summary>
      <div class="dd">
        <a href="/">All jobs</a>
        ${QUALS.map((q) => `<a href="/qualification/${q.slug}/">${esc(q.name)}</a>`).join("")}
      </div>
    </details>
    <a href="/updates/">Updates</a>
    <a href="/guides/">Guides</a>
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
  </nav>
</div></header>`;
}

function foot() {
  return `<footer class="site-foot"><div class="wrap">
  <span>&copy; ${BUILT.getFullYear()} ${esc(SITE.brand)} &middot; Updated ${fmtDate(BUILT.toISOString().slice(0,10))}</span>
  <span class="links">
    <a href="/about/">About</a>
    <a href="/contact/">Contact</a>
    <a href="/privacy-policy/">Privacy</a>
    <a href="/disclaimer/">Disclaimer</a>
    <a href="/terms/">Terms</a></p>
    <p class="foot-edu">${QUALS.map((q) => `<a href="/qualification/${q.slug}/">${esc(q.name)} jobs</a>`).join(" &middot; ")}
    <a href="/feed.xml">RSS</a>
  </span>
</div></footer>
<script src="/site.js" defer></script>
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
function jobCard(job) {
  const st = statusOf(job);
  const text = (job.title + " " + job.organization + " " + (job.qualification||"") + " " +
    (job.post_name||"") + " " + levelsOf(job).join(" ")).toLowerCase();
  return `<li><a class="job" href="/jobs/${esc(job.id)}/" data-text="${esc(text)}">
    <div class="job-top">
      <span class="org-tag">${esc(job.org_short || job.organization)}</span>
      ${qualsOf(job).slice(0,2).map((q)=>`<span class="qual-tag">${esc(q.name)}</span>`).join("")}
      <span class="status ${st.cls}">${esc(st.label)}</span>
    </div>
    <h2>${esc(job.title)}</h2>
    <p class="post">${esc(job.post_name || "")}</p>
    <div class="meta">
      <span class="stat"><span class="n">${inr(job.total_vacancies)}</span><span class="l">Posts</span></span>
      <span class="stat"><span class="n">${job.age_max ? job.age_min + "&ndash;" + job.age_max : "&mdash;"}</span><span class="l">Age</span></span>
      <span class="deadline${st.cls === "soon" ? " soon" : ""}">Last date <b>${fmtDate(job.application_end)}</b></span>
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
function updateCard(u) {
  return `<li><a class="update" href="/updates/${esc(u.id)}/">
    <span class="upd-type upd-${u.type}">${UPDATE_TYPES[u.type].label}</span>
    <span class="upd-title">${esc(u.title)}</span>
    <span class="upd-meta">${esc(u.org_short || u.organization)}${u.date ? " &middot; " + fmtDate(u.date) : ""}</span>
  </a></li>`;
}
function buildUpdatePage(u, all) {
  const canonical = `${SITE.url}/updates/${u.id}/`;
  const rel = all.filter((x) => x.id !== u.id && (x.org_short === u.org_short || x.type === u.type)).slice(0, 4);
  const relJobs = (typeof ALL_JOBS !== "undefined" ? ALL_JOBS : []).filter((j) => (j.org_short || j.organization) === (u.org_short || u.organization)).slice(0, 2);
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Updates", url: SITE.url + "/updates/" }, { name: u.title, url: canonical }]),
    { "@context": "https://schema.org", "@type": "NewsArticle", headline: u.title, datePublished: u.date,
      dateModified: u.date, description: u.summary,
      author: { "@type": "Organization", name: SITE.publisher },
      publisher: { "@type": "Organization", name: SITE.brand, logo: { "@type": "ImageObject", url: SITE.url + "/icon-512.png" } },
      mainEntityOfPage: canonical },
  ];
  return head({ title: `${u.title} | ${SITE.name}`, desc: u.summary.slice(0, 158), canonical, ld, ogType: "article", published: u.date, modified: u.date }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/updates/">Updates</a></p>
  <article>
    <p class="eyebrow"><span class="upd-type upd-${u.type}">${UPDATE_TYPES[u.type].label}</span> &middot; ${esc(u.org_short || u.organization)} &middot; ${fmtDate(u.date)}</p>
    <h1>${esc(u.title)}</h1>
    <div class="prose">
      <p>${esc(u.summary)}</p>
      ${u.summary_hi ? `<p class="hindi" lang="hi">${esc(u.summary_hi)}</p>` : ""}
      ${u.event_date ? `<p><strong>Important date:</strong> <b class="mono">${fmtDate(u.event_date)}</b></p>` : ""}
    </div>
    <p class="cta-row"><a class="btn btn-primary" href="${esc(u.link)}" rel="nofollow noopener" target="_blank">Check on official website &rarr;</a></p>
    <p class="smallprint">Always verify on the official website — ${esc(SITE.brand)} aggregates publicly announced updates and is not a government body.</p>
    ${relJobs.length ? `<section class="related"><h2 class="section-h">Related jobs</h2><ul class="jobs">${relJobs.map(jobCard).join("")}</ul></section>` : ""}
    ${rel.length ? `<section class="related"><h2 class="section-h">More updates</h2><ul class="updates">${rel.map(updateCard).join("")}</ul></section>` : ""}
  </article>
</main>` + foot();
}
function buildUpdatesIndex(updates) {
  const canonical = SITE.url + "/updates/";
  const groups = Object.keys(UPDATE_TYPES).map((k) => {
    const list = updates.filter((u) => u.type === k);
    return list.length ? `<section class="upd-group">
      <h2 class="section-h">${UPDATE_TYPES[k].plural} <span class="grp-count">${list.length}</span></h2>
      <ul class="updates">${list.map(updateCard).join("\n")}</ul></section>` : "";
  }).join("\n");
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Updates", url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: "Sarkari Results, Admit Cards & Answer Keys", url: canonical,
      mainEntity: { "@type": "ItemList", itemListElement: updates.map((u, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/updates/${u.id}/`, name: u.title })) } },
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

function buildQualPage(q, list) {
  const canonical = `${SITE.url}/qualification/${q.slug}/`;
  const live = list.filter((j) => statusOf(j).cls !== "closed");
  const sorted = [...list].sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const guides = (ALL_GUIDES || []).filter((g) => q.guideSlugs.includes(g.slug));
  const ld = [
    breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: q.name, url: canonical }]),
    { "@context": "https://schema.org", "@type": "CollectionPage", name: q.h1, url: canonical, description: q.desc,
      mainEntity: { "@type": "ItemList", itemListElement: sorted.map((j, i) => ({
        "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title: `${q.h1} ${BUILT.getFullYear()} — Latest Notifications | ${SITE.name}`, desc: q.desc, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; ${esc(q.name)}</p>
  <section class="cat-head">
    <p class="eyebrow">Browse by education &middot; ${live.length} live</p>
    <h1>${esc(q.h1)}</h1>
    <div class="prose qual-intro">${q.intro.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
  </section>
  ${sorted.length ? `<ul class="jobs">${sorted.map(jobCard).join("\n")}</ul>`
    : `<p class="empty">No live notifications in this category right now — new jobs are added automatically several times a day, so check back soon or <a href="/">browse all current jobs</a>.</p>`}
  ${guides.length ? `<section class="related">
    <h2 class="section-h">Guides for ${esc(q.name)} candidates</h2>
    <ul class="guides">${guides.map((g) => `<li><a class="guide-card" href="/guides/${g.slug}/"><h3>${esc(g.meta.title)}</h3><p>${esc(g.meta.description || "")}</p><span class="readmore">Read guide &rarr;</span></a></li>`).join("")}</ul>
  </section>` : ""}
</main>` + foot();
}

/* ---- Home ------------------------------------------------------- */
function buildHome(jobs, levels, orgs, guides, qualCounts, updates) {
  const sorted = [...jobs].sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const title = `Latest Government Jobs ${BUILT.getFullYear()} — Sarkari Naukri Notifications | ${SITE.name}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "Organization", name: SITE.brand,
      url: SITE.url + "/", logo: SITE.url + "/icon-512.png",
      description: `${SITE.brand} is an independent platform that publishes the latest Indian government job notifications and in-depth, fact-checked preparation guides. It is not a government body and never charges candidates a fee.` },
    { "@context": "https://schema.org", "@type": "WebSite", name: SITE.brand, url: SITE.url + "/",
      potentialAction: { "@type": "SearchAction", target: `${SITE.url}/?q={search_term_string}`, "query-input": "required name=search_term_string" } },
    { "@context": "https://schema.org", "@type": "CollectionPage",
      name: title, url: SITE.url + "/",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: sorted.map((j, i) => ({
          "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title,
        })),
      } },
    breadcrumbLd([{ name: "Jobs", url: SITE.url + "/" }]),
  ];
  const live = sorted.filter((j) => statusOf(j).cls !== "closed");
  const closingSoon = sorted.filter((j) => statusOf(j).cls === "soon");
  const totalPosts = sorted.reduce((s, j) => s + (Number(j.total_vacancies) || 0), 0);
  return head({ title, desc: SITE.tagline, canonical: SITE.url + "/", ld }) + `
<main class="wrap" id="main">
  <section class="hero">
    <p class="eyebrow">${esc(SITE.section)} &middot; Updated ${fmtDate(BUILT.toISOString().slice(0,10))}</p>
    <h1>Government jobs, without the clutter.</h1>
    <p>${esc(SITE.tagline)}</p>
    <div class="search-row">
      <input class="search" id="q" type="search" placeholder="Search by post, department or qualification…" aria-label="Search jobs">
    </div>
    <p class="count" id="count"></p>
    <nav class="hero-quick" aria-label="Browse by education">
      <span class="hq-label">Browse:</span>
      ${QUALS.map((q) => `<a class="hq-pill" href="/qualification/${q.slug}/">${esc(q.name)}</a>`).join("")}
    </nav>
  </section>

  <div class="stats" aria-label="At a glance">
    <div class="stat-box"><span class="n">${live.length}</span><span class="l">Live notifications</span></div>
    <div class="stat-box"><span class="n">${totalPosts ? inr(totalPosts) + "+" : "—"}</span><span class="l">Total vacancies</span></div>
    <div class="stat-box"><span class="n">${orgs.length}</span><span class="l">Departments</span></div>
    <div class="stat-box"><span class="n">Daily</span><span class="l">Updated &amp; free</span></div>
  </div>

  ${(updates && updates.length) ? `<section class="home-updates">
    <div class="hu-head"><h2 class="section-h">📢 Latest updates</h2><a class="backlink" href="/updates/">All updates &rarr;</a></div>
    <ul class="updates">${updates.slice(0,6).map(updateCard).join("")}</ul>
  </section>` : ""}

  ${eduSection(qualCounts)}

  ${chips(levels, orgs)}

  ${closingSoon.length ? `<section class="closing">
    <h2 class="section-h">⏳ Closing soon</h2>
    <ul class="jobs">${closingSoon.slice(0,3).map(jobCard).join("\n")}</ul>
  </section>` : ""}

  <h2 class="section-h list-h">Latest government jobs</h2>
  ${sorted.length ? `<ul class="jobs" id="list">
    ${sorted.map(jobCard).join("\n")}
  </ul>
  <p class="empty" id="empty" hidden>No jobs match that search.</p>` :
  `<p class="empty">New job notifications are being added automatically and will appear here shortly.</p>`}

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
function buildCategory(kind, label, slugVal, jobs) {
  const sorted = [...jobs].sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const isQ = kind === "qualification";
  const title = isQ
    ? `${label} Government Jobs ${BUILT.getFullYear()} — Sarkari Naukri for ${label} | ${SITE.name}`
    : `${label} Recruitment ${BUILT.getFullYear()} — Latest ${label} Vacancies | ${SITE.name}`;
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
        itemListElement: sorted.map((j, i) => ({
          "@type": "ListItem", position: i + 1, url: `${SITE.url}/jobs/${j.id}/`, name: j.title })) } },
  ];
  return head({ title, desc, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Jobs</a> &nbsp;&rsaquo;&nbsp; ${esc(isQ ? "Qualification" : "Department")}</p>
  <section class="cat-head">
    <p class="eyebrow">${esc(isQ ? "Eligibility" : "Department")}</p>
    <h1>${esc(label)} ${isQ ? "government jobs" : "recruitment"}</h1>
    <p class="lede">${esc(desc)}</p>
  </section>
  <p class="count static">${sorted.length} ${sorted.length === 1 ? "job" : "jobs"}</p>
  <ul class="jobs">${sorted.map(jobCard).join("\n")}</ul>
  <p class="backlink"><a href="/">&larr; All government jobs</a></p>
</main>` + foot();
}

/* ---- Job detail ------------------------------------------------- */
function row(dt, dd, mono) {
  if (dd === undefined || dd === null || dd === "") return "";
  return `<dt>${esc(dt)}</dt><dd${mono ? ' class="mono"' : ""}>${dd}</dd>`;
}
function jobLd(job) {
  const sal = parseSalary(job.salary);
  const descHtml =
    `<p>${esc(job.summary || job.title)}</p>` +
    (job.qualification ? `<p><b>Qualification:</b> ${esc(job.qualification)}</p>` : "") +
    (job.age_max ? `<p><b>Age limit:</b> ${job.age_min}-${job.age_max} years</p>` : "") +
    (job.fee ? `<p><b>Application fee:</b> ${esc(job.fee)}</p>` : "") +
    ((job.how_to_apply||[]).length
      ? `<p><b>How to apply:</b></p><ol>${job.how_to_apply.map((s)=>`<li>${esc(s)}</li>`).join("")}</ol>` : "");
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: descHtml,
    datePosted: job.published,
    employmentType: "FULL_TIME",
    directApply: false,
    identifier: { "@type": "PropertyValue", name: job.organization, value: job.id },
    hiringOrganization: { "@type": "Organization", name: job.organization, sameAs: job.apply_link },
    jobLocation: { "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: job.location || "India", addressCountry: "IN" } },
    applicantLocationRequirements: { "@type": "Country", name: "India" },
  };
  if (job.application_end) ld.validThrough = job.application_end + "T23:59:59+05:30";
  if (job.qualification) ld.educationRequirements = { "@type": "EducationalOccupationalCredential", credentialCategory: job.qualification };
  if (sal) ld.baseSalary = { "@type": "MonetaryAmount", currency: "INR",
    value: { "@type": "QuantitativeValue", minValue: sal.min, maxValue: sal.max, unitText: sal.unit } };
  return ld;
}
function relatedList(job, all) {
  const lvls = new Set(levelsOf(job));
  const pool = all.filter((j) => j.id !== job.id);
  const sameOrg = pool.filter((j) => (j.org_short || j.organization) === (job.org_short || job.organization));
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
function buildJob(job, all) {
  const st = statusOf(job);
  const canonical = `${SITE.url}/jobs/${job.id}/`;
  const title = `${job.title} — ${inr(job.total_vacancies)} Posts, Apply by ${fmtDate(job.application_end)} | ${SITE.name}`;
  const desc = job.summary || `${job.organization} recruitment for ${job.post_name}. Check eligibility, vacancies and last date.`;
  const steps = (job.how_to_apply || []).map((s) => `<li>${esc(s)}</li>`).join("\n");
  const pct = windowPct(job);
  const faqs = faqsFor(job);
  const ld = [jobLd(job), breadcrumbLd([
    { name: "Jobs", url: SITE.url + "/" },
    { name: job.org_short || job.organization, url: `${SITE.url}/organization/${slug(job.org_short || job.organization)}/` },
    { name: job.title, url: canonical },
  ])];
  if (faqs.length) ld.push(faqLd(faqs));
  const lvlLinks = qualsOf(job)
    .map((q) => `<a class="chip" href="/qualification/${q.slug}/">${esc(q.name)}</a>`).join("");
  const selection = Array.isArray(job.selection_process) && job.selection_process.length
    ? `<h2 class="section-h">Selection process</h2><ol class="steps">${job.selection_process.map((s)=>`<li>${esc(s)}</li>`).join("")}</ol>`
    : "";

  return head({ title, desc, canonical, ld, ogType: "article" }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Jobs</a> &nbsp;&rsaquo;&nbsp; <a href="/organization/${slug(job.org_short || job.organization)}/">${esc(job.org_short || job.organization)}</a></p>
  <div class="detail-head">
    <div class="headline-row">
      <span class="org-tag">${esc(job.organization)}</span>
      <span class="status ${st.cls}">${esc(st.label)}</span>
    </div>
    <h1>${esc(job.title)}</h1>
    <p class="lede">${esc(job.summary || "")}</p>
    ${job.summary_hindi ? `<p class="hindi" lang="hi">${esc(job.summary_hindi)}</p>` : ""}
    ${pct !== null ? `<div class="window" role="img" aria-label="Application window from ${fmtDate(job.application_start)} to ${fmtDate(job.application_end)}">
      <div class="bar"><span class="fill ${st.cls}" style="width:${pct.toFixed(0)}%"></span></div>
      <div class="window-ends"><span>${fmtDate(job.application_start)}</span><span>${fmtDate(job.application_end)}</span></div>
    </div>` : ""}
  </div>

  <div class="prose">
    <h2 class="section-h">Overview</h2>
    ${overviewProse(job)}
  </div>

  <h2 class="section-h">Recruitment details</h2>
  <div class="spec"><dl>
    ${row("Organisation", esc(job.organization))}
    ${row("Post name", esc(job.post_name))}
    ${row("Total vacancies", `<span class="mono">${inr(job.total_vacancies)}</span>`)}
    ${row("Qualification", esc(job.qualification))}
    ${row("Age limit", job.age_max ? `${job.age_min}&ndash;${job.age_max} years` : "")}
    ${row("Salary", esc(job.salary))}
    ${row("Application fee", esc(job.fee))}
    ${row("Job location", esc(job.location))}
    ${row("Application starts", fmtDate(job.application_start), true)}
    ${row("Last date to apply", `<b>${fmtDate(job.application_end)}</b>`)}
    ${row("Exam date", fmtDate(job.exam_date), true)}
  </dl></div>

  ${eligibilityProse(job) ? `<div class="prose"><h2 class="section-h">Eligibility criteria</h2>${eligibilityProse(job)}${lvlLinks ? `<p class="tagrow">Eligibility: ${lvlLinks}</p>` : ""}</div>` : ""}

  ${selection}

  ${salaryProse(job) ? `<div class="prose"><h2 class="section-h">Salary &amp; benefits</h2>${salaryProse(job)}</div>` : ""}

  ${steps ? `<h2 class="section-h">How to apply</h2><ol class="steps">${steps}</ol>` : ""}

  <div class="apply-bar">
    ${job.apply_link ? `<a class="btn btn-primary" href="${esc(job.apply_link)}" target="_blank" rel="noopener nofollow">Apply on official site &uarr;</a>` : ""}
    ${job.official_notification ? `<a class="btn btn-ghost" href="${esc(job.official_notification)}" target="_blank" rel="noopener nofollow">Read official notification</a>` : ""}
  </div>
  <p class="note">Always verify dates and eligibility on the official website before applying. ${esc(SITE.brand)} aggregates publicly available notifications and is not a government body.</p>

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
function buildSitemap(jobs, cats, extra = []) {
  const today = BUILT.toISOString().slice(0, 10);
  const urls = [
    { loc: SITE.url + "/", mod: today },
    ...extra.map((u) => ({ loc: `${SITE.url}/${u}`, mod: today })),
    ...cats.map((c) => ({ loc: `${SITE.url}/${c.kind}/${c.slug}/`, mod: today })),
    ...jobs.map((j) => ({ loc: `${SITE.url}/jobs/${j.id}/`, mod: j.published || today })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    urls.map((u) => `<url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod></url>`).join("") +
    `</urlset>`;
}
function buildFeed(jobs) {
  const sorted = [...jobs].sort((a, b) => (b.published || "").localeCompare(a.published || "")).slice(0, 30);
  const items = sorted.map((j) => `
  <item>
    <title>${esc(j.title)}</title>
    <link>${SITE.url}/jobs/${j.id}/</link>
    <guid isPermaLink="true">${SITE.url}/jobs/${j.id}/</guid>
    <pubDate>${new Date((j.published || BUILT.toISOString().slice(0,10)) + "T09:00:00+05:30").toUTCString()}</pubDate>
    <description>${esc(j.summary || j.post_name || j.title)}</description>
  </item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(SITE.brand)} — Government Jobs</title>
  <link>${SITE.url}/</link>
  <description>${esc(SITE.tagline)}</description>
  <language>en-in</language>${items}
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
  if (job.qualification) p.push(`To apply for ${esc(job.title)}, a candidate must have ${esc(job.qualification)}.`);
  if (job.age_max) p.push(`The age of applicants should generally be between <strong>${job.age_min} and ${job.age_max} years</strong> as on the cut-off date mentioned in the official notification. Age relaxation is provided to candidates from SC, ST, OBC, PwD and other reserved categories as per government rules.`);
  if (job.location) p.push(`The posts are based in ${esc(job.location)}.`);
  if (!p.length) return "";
  return `<p>${p.join(" ")}</p>`;
}
function salaryProse(job) {
  if (!job.salary) return "";
  return `<p>Selected candidates will receive a pay of <strong>${esc(job.salary)}</strong>. Government employees are also generally entitled to allowances such as Dearness Allowance (DA), House Rent Allowance (HRA) and other benefits applicable to the post and pay level.</p>`;
}
function faqsFor(job) {
  if (Array.isArray(job.faqs) && job.faqs.length) return job.faqs;
  const f = [];
  if (job.application_end) f.push({ q: `What is the last date to apply for ${job.title}?`, a: `The last date to submit the online application is ${fmtDate(job.application_end)}.` });
  if (job.total_vacancies) f.push({ q: `How many vacancies are there in ${job.title}?`, a: `There are ${inr(job.total_vacancies)} vacancies in this recruitment.` });
  if (job.qualification) f.push({ q: `What is the educational qualification required?`, a: `Candidates must have ${job.qualification}.` });
  if (job.age_max) f.push({ q: `What is the age limit for this recruitment?`, a: `The age limit is generally ${job.age_min}–${job.age_max} years, with relaxation for reserved categories as per government norms.` });
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
  const updated = fmtDate(BUILT.toISOString().slice(0, 10));
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
Our guides and listings are researched and written by the ${SITE.brand} editorial team. We follow a few firm principles: we base information on official notifications and authoritative sources; we write in plain, practical language that genuinely helps candidates; we keep our preparation guides factual and free of false promises or guaranteed-selection claims; and we review and update our content as exam patterns, eligibility rules and dates change. Where a detail can vary or change, we say so and point you to the official source.

## Why you can trust us
We are independent and candidate-first. We never charge for information, we clearly separate official facts from general guidance, and we always link to the original notification so you can verify everything yourself. Our goal is to be a reliable, honest starting point for your government-job journey — not the final authority, which is always the official recruiting body.

## Accuracy
We work to keep information correct and up to date, but details can change. Always confirm the final details on the official website before applying. If you spot an error, please [contact us](/contact/) and we will fix it quickly.`)
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
let ALL_JOBS = [];
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
  const jobs = JSON.parse(fs.readFileSync(DATA, "utf8"));
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const f of ["styles.css", "site.js", "sw.js", "favicon.svg", "og.png", "icon-512.png", "icon-192.png", "icon-180.png", "site.webmanifest"]) {
    const src = path.join(ROOT, "src", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
  }

  const levelMap = new Map();   // qual slug -> jobs
  const orgMap = new Map();
  for (const job of jobs) {
    for (const q of qualsOf(job)) {
      if (!levelMap.has(q.slug)) levelMap.set(q.slug, []);
      levelMap.get(q.slug).push(job);
    }
    const short = job.org_short || job.organization;
    if (!orgMap.has(short)) orgMap.set(short, { short, jobs: [] });
    orgMap.get(short).jobs.push(job);
  }
  const qualCounts = new Map(QUALS.map((q) =>
    [q.slug, (levelMap.get(q.slug) || []).filter((j) => statusOf(j).cls !== "closed").length]));
  const levels = QUALS.map((q) => q.name);
  const orgs = [...orgMap.values()].sort((a, b) => b.jobs.length - a.jobs.length);

  const guides = readGuides();
  ALL_GUIDES = guides;
  ALL_JOBS = jobs;
  const updates = readUpdates();

  write("index.html", buildHome(jobs, levels, orgs, guides, qualCounts, updates));
  for (const job of jobs) write(`jobs/${job.id}/index.html`, buildJob(job, jobs));

  write("updates/index.html", buildUpdatesIndex(updates));
  for (const u of updates) write(`updates/${u.id}/index.html`, buildUpdatePage(u, updates));

  const cats = [];
  for (const q of QUALS) {
    write(`qualification/${q.slug}/index.html`, buildQualPage(q, levelMap.get(q.slug) || []));
    cats.push({ kind: "qualification", slug: q.slug });
  }
  for (const { short, jobs: list } of orgMap.values()) {
    const s = slug(short);
    write(`organization/${s}/index.html`, buildCategory("organization", short, s, list));
    cats.push({ kind: "organization", slug: s });
  }

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
    ...updates.map((u) => `updates/${u.id}/`),
    ...guides.map((g) => `guides/${g.slug}/`),
    ...Object.keys(pages).map((s) => `${s}/`),
  ];

  write("sitemap.xml", buildSitemap(jobs, cats, extra));
  write("feed.xml", buildFeed(jobs));
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

  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
  if (SITE.adsenseId) {
    const pub = SITE.adsenseId.replace(/^ca-/, "");
    write("ads.txt", `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
  }

  console.log(`Built: home + ${jobs.length} jobs + ${cats.length} categories + ${guides.length} guides + ${Object.keys(pages).length} pages + 404/sitemap/feed -> dist/`);
}

main();
