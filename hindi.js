/* ==================================================================
   hindi.js — the Hindi edition (/hi/).
   Pages exist only for entries the automation has translated (job.hi /
   update.hi), so there are never half-English "Hindi" pages. Each Hindi page
   is paired with its English page via hreflang. JobPosting schema stays on
   the English page only, so Google Jobs never sees a duplicate posting.
   ================================================================== */
const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
function hiDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? String(iso) : `${d.getDate()} ${HI_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
const HI_TYPES = {
  result: { label: "रिजल्ट", plural: "सरकारी रिजल्ट", h1: "सरकारी रिजल्ट", seo: "Sarkari Result" },
  "admit-card": { label: "एडमिट कार्ड", plural: "एडमिट कार्ड", h1: "एडमिट कार्ड", seo: "Admit Card" },
  "answer-key": { label: "आंसर की", plural: "आंसर की", h1: "आंसर की", seo: "Answer Key" },
  "exam-date": { label: "परीक्षा तिथि", plural: "परीक्षा तिथि", h1: "परीक्षा तिथि और शेड्यूल", seo: "Exam Date" },
};

function buildHindi(ctx) {
  const { head, foot, esc, SITE, BUILT, breadcrumbLd, faqLd, statusOf, daysLeft, isStale, adSlot, jobs, updates } = ctx;
  const inr = (n) => (n === 0 || n) ? Number(n).toLocaleString("en-IN") : "—";
  const year = BUILT.getFullYear();
  const pages = [];
  const hiJobs = jobs.filter((j) => j.hi && j.hi.title);
  const hiUpd = updates.filter((u) => u.hi && u.hi.title);
  const openJobs = hiJobs.filter((j) => statusOf(j).cls !== "closed" && !isStale(j))
    .sort((a, b) => String(b.published || "").localeCompare(String(a.published || "")));

  const faqHtml = (faq) => faq && faq.length ? `<h2 class="section-h">अक्सर पूछे जाने वाले सवाल</h2><div class="faq">${faq.map((x) =>
    `<details class="faq-item"><summary>${esc(x.q)}</summary><div class="faq-a">${esc(x.a)}</div></details>`).join("")}</div>` : "";
  const statusHi = (j) => { const st = statusOf(j); const d = daysLeft(j.application_end);
    return { cls: st.cls, label: st.cls === "closed" ? "बंद" : st.cls === "soon" ? (d === 0 ? "आज अंतिम दिन" : `${d} दिन बाकी`) : "आवेदन जारी" }; };
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : "";
  const jobCardHi = (j) => { const st = statusHi(j); return `<li><a class="job" href="/hi/jobs/${esc(j.id)}/">
    <div class="job-top"><span class="org-tag">${esc(j.hi.organization || j.organization)}</span><span class="status ${st.cls}">${esc(st.label)}</span></div>
    <h2>${esc(j.hi.title)}</h2>
    <p class="post">${esc(j.hi.post_name || "")}</p>
    <div class="meta">${j.total_vacancies ? `<span class="stat"><span class="n">${inr(j.total_vacancies)}</span><span class="l">पद</span></span>` : ""}
      <span class="deadline${st.cls === "soon" ? " soon" : ""}">अंतिम तिथि <b>${hiDate(j.application_end)}</b></span></div></a></li>`; };
  const updCardHi = (u) => `<li><a class="update" href="/hi/updates/${esc(u.id)}/"><span class="upd-type upd-${u.type}">${(HI_TYPES[u.type] || {}).label || "अपडेट"}</span>
    <span class="upd-title">${esc(u.hi.title)}</span><span class="upd-meta">${esc(u.org_short || "")} &middot; ${hiDate(u.date)}</span></a></li>`;
  const examLink = (title) => { const { examOf } = require("./exams.js"); const e = examOf(title);
    return e ? `<p class="tagrow"><a class="chip" href="/hi/exam/${e.slug}/">${esc(e.name)} — सभी अपडेट (नोटिफिकेशन, एडमिट कार्ड, रिजल्ट) &rarr;</a></p>` : ""; };
  const alt = (en, hi) => [{ hreflang: "en", href: SITE.url + en }, { hreflang: "hi", href: SITE.url + hi }, { hreflang: "x-default", href: SITE.url + en }];

  /* ---- job pages ---- */
  for (const j of hiJobs) {
    const h = j.hi, st = statusHi(j);
    const enPath = `/jobs/${j.id}/`, hiPath = `/hi/jobs/${j.id}/`, canonical = SITE.url + hiPath;
    const vac = Number(j.total_vacancies) > 0 ? ` – ${inr(j.total_vacancies)} पद` : "";
    let title = `${h.title.split(/[:–|]/)[0].trim()}${vac}`;
    if (title.length > 62) title = title.slice(0, 60).replace(/\s+\S*$/, "");
    const desc = (h.summary || "").slice(0, 155);
    const ld = [breadcrumbLd([{ name: "होम", url: SITE.url + "/hi/" }, { name: "सरकारी नौकरी", url: SITE.url + "/hi/" }, { name: h.title, url: canonical }])];
    if (h.faq && h.faq.length) ld.push(faqLd(h.faq));
    const apply = j.apply_link || j.official_website || j.source;
    pages.push({ path: `hi/jobs/${j.id}/index.html`, url: canonical, html: head({ lang: "hi", title: `${title} | ${SITE.name}`, desc, canonical, ld, ogType: "article",
      alternates: alt(enPath, hiPath), langSwitch: enPath }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/hi/">सरकारी नौकरी</a> &nbsp;&rsaquo;&nbsp; ${esc(h.organization || j.organization)}</p>
  <div class="detail-head">
    <div class="headline-row"><span class="org-tag">${esc(h.organization || j.organization)}</span><span class="status ${st.cls}">${esc(st.label)}</span></div>
    <h1>${esc(h.title)}</h1>
    ${st.cls === "closed" ? `<div class="closed-notice"><strong>यह भर्ती बंद हो चुकी है।</strong> आवेदन की अंतिम तिथि ${hiDate(j.application_end)} थी। <a href="/hi/">नई सरकारी नौकरियाँ देखें</a>।</div>` : ""}
    <p class="lede">${esc(h.summary)}</p>
  </div>
  ${(h.overview || []).length ? `<div class="prose"><h2 class="section-h">भर्ती की जानकारी</h2>${h.overview.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}
  <h2 class="section-h">महत्वपूर्ण विवरण</h2>
  <div class="spec"><dl>
    ${row("संस्था", esc(h.organization || j.organization))}
    ${row("पद का नाम", esc(h.post_name || j.post_name || ""))}
    ${row("कुल पद", j.total_vacancies ? `<span class="mono">${inr(j.total_vacancies)}</span>` : "")}
    ${row("योग्यता", esc(h.qualification || j.qualification || ""))}
    ${row("आयु सीमा", j.age_max ? `${j.age_min ? j.age_min + "–" : ""}${j.age_max} वर्ष` : "")}
    ${row("वेतन", esc(h.salary || j.salary || ""))}
    ${row("आवेदन शुल्क", esc(h.fee || j.fee || ""))}
    ${row("नौकरी का स्थान", esc(h.location || j.location || ""))}
    ${row("आवेदन शुरू", j.application_start ? hiDate(j.application_start) : "")}
    ${row("अंतिम तिथि", j.application_end ? `<b>${hiDate(j.application_end)}</b>` : "")}
    ${row("परीक्षा तिथि", j.exam_date ? hiDate(j.exam_date) : "")}
  </dl></div>
  ${adSlot("hi-job-mid")}
  ${h.eligibility_notes ? `<div class="prose"><h2 class="section-h">पात्रता</h2><p>${esc(h.eligibility_notes)}</p></div>` : ""}
  ${(h.selection_process || []).length ? `<h2 class="section-h">चयन प्रक्रिया</h2><ol class="steps">${h.selection_process.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
  ${(h.how_to_apply || []).length ? `<h2 class="section-h">आवेदन कैसे करें</h2><ol class="steps">${h.how_to_apply.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
  <div class="apply-bar">
    ${apply ? `<a class="btn btn-primary" href="${esc(apply)}" target="_blank" rel="noopener nofollow">${j.apply_link ? "ऑफिशियल साइट पर आवेदन करें" : "ऑफिशियल वेबसाइट"} &uarr;</a>` : ""}
    ${j.official_notification ? `<a class="btn btn-ghost" href="${esc(j.official_notification)}" target="_blank" rel="noopener nofollow">ऑफिशियल नोटिफिकेशन</a>` : ""}
    <a class="btn btn-ghost" href="${enPath}" lang="en">Read in English</a>
  </div>
  <p class="note">आवेदन से पहले ऑफिशियल वेबसाइट पर तिथियाँ और पात्रता ज़रूर जाँच लें। ${esc(SITE.brand)} सार्वजनिक नोटिफिकेशन की जानकारी देता है, यह कोई सरकारी संस्था नहीं है।</p>
  ${(h.preparation_tips || []).length ? `<div class="prose"><h2 class="section-h">तैयारी के टिप्स</h2><ul>${h.preparation_tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  ${faqHtml(h.faq)}
  ${examLink(j.title)}
  <p class="cta-row"><a class="btn btn-ghost" href="/hi/tools/age-calculator/">आयु कैलकुलेटर</a> <a class="btn btn-ghost" href="/hi/tools/photo-resizer/">फोटो-सिग्नेचर रिसाइज़र</a></p>
  ${(() => { const rel = openJobs.filter((x) => x.id !== j.id).slice(0, 3); return rel.length ? `<section class="related"><h2 class="section-h">और सरकारी नौकरियाँ</h2><ul class="jobs">${rel.map(jobCardHi).join("")}</ul></section>` : ""; })()}
</main>` + foot() });
  }

  /* ---- update pages ---- */
  for (const u of hiUpd) {
    const h = u.hi, T = HI_TYPES[u.type] || HI_TYPES.result;
    const enPath = `/updates/${u.id}/`, hiPath = `/hi/updates/${u.id}/`, canonical = SITE.url + hiPath;
    const official = u.official_link || u.official_website || u.source || u.link;
    let title = h.title.split(/\s+[–—|-]\s+/)[0].trim(); if (title.length > 62) title = title.slice(0, 60).replace(/\s+\S*$/, "");
    const ld = [breadcrumbLd([{ name: "होम", url: SITE.url + "/hi/" }, { name: T.plural, url: `${SITE.url}/hi/updates/${u.type}/` }, { name: h.title, url: canonical }])];
    if ((h.steps || []).length) ld.push({ "@context": "https://schema.org", "@type": "HowTo", name: h.title, step: h.steps.map((t, i) => ({ "@type": "HowToStep", position: i + 1, text: t })) });
    if ((h.faq || []).length) ld.push(faqLd(h.faq));
    pages.push({ path: `hi/updates/${u.id}/index.html`, url: canonical, html: head({ lang: "hi", title: `${title} | ${SITE.name}`, desc: (h.summary || "").slice(0, 155), canonical, ld, ogType: "article",
      alternates: alt(enPath, hiPath), langSwitch: enPath }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/hi/">होम</a> &nbsp;&rsaquo;&nbsp; <a href="/hi/updates/${u.type}/">${T.plural}</a></p>
  <article>
    <p class="eyebrow"><span class="upd-type upd-${u.type}">${T.label}</span> &middot; ${esc(u.org_short || "")} &middot; ${hiDate(u.date)}</p>
    <h1>${esc(h.title)}</h1>
    <div class="prose"><p class="lede">${esc(h.summary)}</p></div>
    <p class="cta-row">${official ? `<a class="btn btn-primary" href="${esc(official)}" rel="nofollow noopener" target="_blank">ऑफिशियल वेबसाइट पर देखें &rarr;</a>` : ""} <a class="btn btn-ghost" href="${enPath}" lang="en">English</a></p>
    ${adSlot("hi-update-mid")}
    ${(h.steps || []).length ? `<h2 class="section-h">${T.label} कैसे डाउनलोड/चेक करें</h2><ol class="steps">${h.steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}
    ${(h.details || []).length ? `<div class="prose"><h2 class="section-h">उम्मीदवारों के लिए ज़रूरी बातें</h2>${h.details.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}
    ${faqHtml(h.faq)}
    ${examLink(u.title)}
    <p class="smallprint">हमेशा ऑफिशियल वेबसाइट पर जानकारी की पुष्टि करें — ${esc(SITE.brand)} सरकारी संस्था नहीं है।</p>
    ${(() => { const rel = hiUpd.filter((x) => x.id !== u.id && x.type === u.type).slice(0, 5); return rel.length ? `<section class="related"><h2 class="section-h">और ${T.plural}</h2><ul class="updates">${rel.map(updCardHi).join("")}</ul></section>` : ""; })()}
  </article>
</main>` + foot() });
  }

  /* ---- hubs ---- */
  for (const [type, T] of Object.entries(HI_TYPES)) {
    const list = hiUpd.filter((u) => u.type === type);
    const canonical = `${SITE.url}/hi/updates/${type}/`;
    pages.push({ path: `hi/updates/${type}/index.html`, url: canonical, noindex: !list.length, html: head({ lang: "hi", noindex: !list.length, title: `${T.h1} ${year} – लेटेस्ट ${T.plural} (${T.seo}) | ${SITE.name}`,
      desc: `सभी सरकारी परीक्षाओं के लेटेस्ट ${T.plural} एक जगह — डाउनलोड/चेक करने का तरीका और ऑफिशियल लिंक के साथ।`, canonical,
      ld: [breadcrumbLd([{ name: "होम", url: SITE.url + "/hi/" }, { name: T.plural, url: canonical }])],
      alternates: alt(`/updates/${type}/`, `/hi/updates/${type}/`), langSwitch: `/updates/${type}/` }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/hi/">होम</a> &nbsp;&rsaquo;&nbsp; ${T.plural}</p>
  <section class="cat-head"><p class="eyebrow">${list.length} अपडेट</p><h1>${T.h1} ${year}</h1>
  <p class="lede">सरकारी परीक्षाओं के नए ${T.plural} — हर अपडेट के साथ डाउनलोड करने के आसान स्टेप और ऑफिशियल वेबसाइट का लिंक।</p>
  <p class="tagrow">${Object.entries(HI_TYPES).filter(([k]) => k !== type).map(([k, t]) => `<a class="chip" href="/hi/updates/${k}/">${t.plural}</a>`).join("")}</p></section>
  ${list.length ? `<ul class="updates">${list.map(updCardHi).join("")}</ul>` : `<p class="empty">नए अपडेट जल्द ही यहाँ दिखेंगे।</p>`}
</main>` + foot() });
  }
  {
    const canonical = `${SITE.url}/hi/`;
    const vac = openJobs.reduce((n, j) => n + (Number(j.total_vacancies) || 0), 0);
    const ld = [breadcrumbLd([{ name: "होम", url: canonical }]),
      { "@context": "https://schema.org", "@type": "CollectionPage", name: `सरकारी नौकरी ${year}`, url: canonical, inLanguage: "hi",
        mainEntity: { "@type": "ItemList", itemListElement: openJobs.slice(0, 50).map((j, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/hi/jobs/${j.id}/`, name: j.hi.title })) } }];
    const col = (title, href, items) => `<section class="glance-col"><h2><a href="${href}">${title}</a></h2><ul>${items.join("")}</ul><a class="glance-more" href="${href}">सभी देखें &rarr;</a></section>`;
    pages.push({ path: "hi/index.html", url: canonical, noindex: openJobs.length < 5, html: head({ lang: "hi", noindex: openJobs.length < 5, title: `सरकारी नौकरी ${year} – लेटेस्ट सरकारी भर्ती, रिजल्ट, एडमिट कार्ड | ${SITE.name}`,
      desc: `सरकारी नौकरी ${year}: ${openJobs.length} भर्तियाँ, ${inr(vac)}+ पद। SSC, रेलवे, बैंक, पुलिस, राज्य भर्ती — योग्यता, अंतिम तिथि, ऑफिशियल लिंक, रिजल्ट और एडमिट कार्ड हिंदी में।`, canonical, ld,
      alternates: alt("/", "/hi/"), langSwitch: "/" }) + `
<main class="wrap" id="main">
  <section class="cat-head"><p class="eyebrow">अपडेट: ${hiDate(BUILT.toISOString().slice(0, 10))}</p>
  <h1>सरकारी नौकरी ${year} — लेटेस्ट सरकारी भर्ती हिंदी में</h1>
  <p class="lede">केंद्र और राज्य सरकार की नई भर्तियाँ, रिजल्ट और एडमिट कार्ड — सरल हिंदी में, ऑफिशियल लिंक के साथ। अभी <b>${openJobs.length}</b> भर्तियों में <b>${inr(vac)}+</b> पदों पर आवेदन जारी है।</p></section>
  <div class="glance">
    ${col("नई सरकारी नौकरी", "/hi/", openJobs.slice(0, 10).map((j) => `<li><a href="/hi/jobs/${esc(j.id)}/">${esc(j.hi.title)}</a></li>`))}
    ${col("सरकारी रिजल्ट", "/hi/updates/result/", hiUpd.filter((u) => u.type === "result").slice(0, 10).map((u) => `<li><a href="/hi/updates/${esc(u.id)}/">${esc(u.hi.title)}</a></li>`))}
    ${col("एडमिट कार्ड", "/hi/updates/admit-card/", hiUpd.filter((u) => u.type === "admit-card").slice(0, 10).map((u) => `<li><a href="/hi/updates/${esc(u.id)}/">${esc(u.hi.title)}</a></li>`))}
  </div>
  <h2 class="section-h">आवेदन जारी — सभी भर्तियाँ</h2>
  ${openJobs.length ? `<ul class="jobs">${openJobs.map(jobCardHi).join("")}</ul>` : `<p class="empty">हिंदी में भर्तियाँ जोड़ी जा रही हैं — तब तक <a href="/" lang="en">English</a> में देखें।</p>`}
  <section class="related"><h2 class="section-h">परीक्षा के अनुसार देखें</h2><p class="tagrow">${["ssc-cgl", "ssc-gd", "ssc-chsl", "ssc-mts", "rrb-ntpc", "rrb-group-d", "rrb-alp", "ibps-po", "sbi-po", "upsc-cse", "police-constable", "ctet", "india-post-gds", "agniveer"].map((s) => { const e = require("./exams.js").EXAMS.find((x) => x.slug === s); return e ? `<a class="chip" href="/hi/exam/${s}/">${esc(e.name)}</a>` : ""; }).join("")}<a class="chip" href="/hi/exam/">सभी परीक्षाएँ &rarr;</a></p></section>
  <section class="home-tools"><h2 class="section-h">🧰 मुफ़्त टूल्स</h2><ul class="tool-list">
    <li><a class="tool-card" href="/hi/tools/photo-resizer/"><b>फोटो और सिग्नेचर रिसाइज़र</b><span>SSC, IBPS, RRB फॉर्म के लिए सही साइज़ (20–50 KB) में फोटो बनाएं — बिना अपलोड।</span></a></li>
    <li><a class="tool-card" href="/hi/tools/age-calculator/"><b>आयु कैलकुलेटर</b><span>कट-ऑफ तिथि पर अपनी सटीक आयु और OBC/SC/ST छूट के साथ पात्रता जाँचें।</span></a></li>
    <li><a class="tool-card" href="/hi/tools/7th-pay-commission-salary-calculator/"><b>सैलरी कैलकुलेटर (7वां वेतन आयोग)</b><span>बेसिक, DA, HRA, TA और इन-हैंड सैलरी हर लेवल के लिए।</span></a></li>
    <li><a class="tool-card" href="/quiz/"><b>डेली करंट अफेयर्स क्विज़</b><span>रोज़ 10 सवाल, उत्तर और व्याख्या के साथ।</span></a></li>
  </ul></section>
</main>` + foot() });
  }
  return { pages, hiJobIds: new Set(hiJobs.map((j) => j.id)), hiUpdIds: new Set(hiUpd.map((u) => u.id)) };
}

module.exports = { buildHindi, hiDate };
