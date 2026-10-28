/* ==================================================================
   exams.js — evergreen exam hubs (/exam/<slug>/).
   People search exam names far more than individual notices ("ssc cgl 2026",
   "rrb ntpc admit card"). Each hub collects every job and update the
   automation has published for that exam into one lifecycle timeline, next to
   stable facts (conducting body, eligibility, stages) and the right tools.
   Facts here are deliberately conservative — details that change every cycle
   (dates, vacancies, fees) come only from the live notices in the timeline.
   ================================================================== */
const { HI_EXAMS, buildHindiExamPages } = require("./exams-hi.js");
const EXAMS = [
  // ---- SSC ----
  { slug: "ssc-cgl", name: "SSC CGL", full: "SSC Combined Graduate Level Examination", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bssc\b.*\bcgl\b|\bcgl\b|combined graduate level/i, qual: "Graduation from a recognised university (some posts need specific subjects)", level: ["4", "5", "6", "7", "8"],
    stages: ["Tier 1 — computer-based test (qualifying/screening)", "Tier 2 — computer-based test (merit)", "Skill or computer proficiency test where the post requires it", "Document verification"],
    about: "SSC CGL fills Group B and Group C posts in central ministries, departments and organisations — Assistant Section Officer, Inspector (Income Tax, Central Excise, Preventive Officer), Assistant Audit Officer, Auditor, Tax Assistant and more. It is one of the most applied-for graduate exams in India." },
  { slug: "ssc-chsl", name: "SSC CHSL", full: "SSC Combined Higher Secondary Level Examination", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bssc\b.*\bchsl\b|ssc chsl|ssc combined higher secondary/i, qual: "12th pass from a recognised board", level: ["2", "4"],
    stages: ["Tier 1 — computer-based test", "Tier 2 — computer-based test with skill / typing test", "Document verification"],
    about: "SSC CHSL recruits Lower Division Clerks / Junior Secretariat Assistants, Postal and Sorting Assistants and Data Entry Operators for central government offices — the main entry route to a central clerical job after 12th." },
  { slug: "ssc-mts", name: "SSC MTS", full: "SSC Multi Tasking Staff & Havaldar Examination", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bssc\b.*\bmts\b|ssc multi[- ]tasking|\bmts\b.*havaldar/i, qual: "10th pass", level: ["1"],
    stages: ["Computer-based test", "Physical efficiency / standard test (Havaldar only)", "Document verification"],
    about: "SSC MTS recruits Multi Tasking (non-technical) Staff for central offices and Havaldars for CBIC and CBN. It is a 10th-level exam and one of the largest SSC recruitments by number of applicants." },
  { slug: "ssc-gd", name: "SSC GD Constable", full: "SSC Constable (GD) in CAPFs, SSF, Assam Rifles & NCB", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bssc\b.*\bgd\b|ssc gd/i, qual: "10th pass", level: ["3"],
    stages: ["Computer-based test", "Physical efficiency test & physical standard test", "Medical examination", "Document verification"],
    about: "SSC GD recruits Constables (General Duty) for BSF, CISF, CRPF, ITBP, SSB, SSF, Rifleman (GD) in Assam Rifles and Sepoy in the Narcotics Control Bureau — a uniformed central job open to 10th pass candidates." },
  { slug: "ssc-cpo", name: "SSC CPO", full: "SSC Sub-Inspector in Delhi Police & CAPFs", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bcpo\b|sub[- ]inspector.*(delhi police|capf)/i, qual: "Graduation", level: ["6"],
    stages: ["Paper 1 — computer-based test", "Physical standard & endurance test", "Paper 2 — computer-based test", "Medical examination"],
    about: "SSC CPO recruits Sub-Inspectors for Delhi Police and the Central Armed Police Forces (BSF, CISF, CRPF, ITBP, SSB) — a Level 6 uniformed post for graduates." },
  { slug: "ssc-je", name: "SSC JE", full: "SSC Junior Engineer (Civil, Mechanical, Electrical)", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bssc\b.*\bje\b|ssc junior engineer/i, qual: "Diploma or degree in Civil, Mechanical or Electrical engineering (as per post)", level: ["6"],
    stages: ["Paper 1 — computer-based test", "Paper 2 — technical computer-based test", "Document verification"],
    about: "SSC JE recruits Junior Engineers for CPWD, MES, Border Roads, Central Water Commission and other central organisations — the main central government route for engineering diploma holders." },
  { slug: "ssc-stenographer", name: "SSC Stenographer", full: "SSC Stenographer Grade C & D", cat: "SSC", body: "Staff Selection Commission (SSC)", site: "https://ssc.gov.in/",
    re: /\bssc\b.*steno|stenographer grade/i, qual: "12th pass", level: [],
    stages: ["Computer-based test", "Stenography skill test", "Document verification"],
    about: "SSC Stenographer recruits Grade C and Grade D stenographers for central ministries and departments. The skill test checks dictation and transcription speed, so shorthand practice matters as much as the written test." },
  // ---- Railways ----
  { slug: "rrb-ntpc", name: "RRB NTPC", full: "RRB Non-Technical Popular Categories", cat: "Railway", body: "Railway Recruitment Boards (RRBs)", site: "https://www.rrbapply.gov.in/",
    re: /\brrb\b.*\bntpc\b|\bntpc\b.*\b(rrb|railway|undergraduate|cen)\b|non[- ]technical popular/i, qual: "12th pass (undergraduate posts) or graduation (graduate posts)", level: ["2", "3", "5", "6"],
    stages: ["CBT 1", "CBT 2", "Typing skill test or computer-based aptitude test (as per post)", "Document verification & medical"],
    about: "RRB NTPC recruits Station Masters, Goods Train Managers, Senior Clerks, Junior Account Assistants, Commercial cum Ticket Clerks, Junior Clerks and Trains Clerks for Indian Railways — separate notices are issued for graduate and undergraduate posts." },
  { slug: "rrb-group-d", name: "RRB Group D", full: "RRB Level-1 (Group D) Posts", cat: "Railway", body: "Railway Recruitment Boards (RRBs)", site: "https://www.rrbapply.gov.in/",
    re: /\b(rrb|rrc|railway)\b.*(group[- ]d|level[- ]?1)\b/i, qual: "10th pass or ITI / National Apprenticeship Certificate", level: ["1"],
    stages: ["Computer-based test", "Physical efficiency test", "Document verification & medical"],
    about: "RRB Group D (Level 1) is Indian Railways' largest recruitment — Track Maintainer, Assistant (various departments), Pointsman and other Level-1 posts, open to 10th and ITI candidates." },
  { slug: "rrb-alp", name: "RRB ALP", full: "RRB Assistant Loco Pilot", cat: "Railway", body: "Railway Recruitment Boards (RRBs)", site: "https://www.rrbapply.gov.in/",
    re: /\balp\b|assistant loco pilot/i, qual: "10th + ITI in the specified trades, or diploma / degree in engineering", level: ["2"],
    stages: ["CBT 1", "CBT 2", "Computer-based aptitude test", "Document verification & medical (A-1 standard)"],
    about: "RRB ALP recruits Assistant Loco Pilots who assist in running trains — a Level 2 post with running allowances that make take-home pay much higher than the basic suggests." },
  { slug: "rrb-je", name: "RRB JE", full: "RRB Junior Engineer, DMS & CMA", cat: "Railway", body: "Railway Recruitment Boards (RRBs)", site: "https://www.rrbapply.gov.in/",
    re: /\brrb\b.*\bje\b|rrb junior engineer/i, qual: "Diploma or degree in the relevant engineering branch", level: ["6"],
    stages: ["CBT 1", "CBT 2 (technical)", "Document verification & medical"],
    about: "RRB JE recruits Junior Engineers, Depot Material Superintendents and Chemical & Metallurgical Assistants for Indian Railways at Level 6." },
  { slug: "rrb-technician", name: "RRB Technician", full: "RRB Technician Grade I Signal & Grade III", cat: "Railway", body: "Railway Recruitment Boards (RRBs)", site: "https://www.rrbapply.gov.in/",
    re: /\brrb\b.*technician/i, qual: "10th + ITI (Grade III) or B.Sc / diploma (Grade I Signal)", level: ["2", "5"],
    stages: ["Computer-based test", "Document verification & medical"],
    about: "RRB Technician recruits Grade III technicians (Level 2) in many trades and Technician Grade I Signal (Level 5) for railway workshops and maintenance." },
  { slug: "rpf", name: "RPF Constable & SI", full: "Railway Protection Force Constable and Sub-Inspector", cat: "Railway", body: "Railway Recruitment Boards (RRBs) for RPF", site: "https://www.rrbapply.gov.in/",
    re: /\brpf\b|railway protection force/i, qual: "10th pass (Constable) or graduation (Sub-Inspector)", level: ["3", "6"],
    stages: ["Computer-based test", "Physical efficiency & measurement test", "Document verification"],
    about: "RPF recruitment fills Constable and Sub-Inspector posts in the Railway Protection Force, which secures railway property and passengers." },
  // ---- Banking ----
  { slug: "ibps-po", name: "IBPS PO", full: "IBPS Probationary Officer / Management Trainee", cat: "Banking", body: "Institute of Banking Personnel Selection (IBPS)", site: "https://www.ibps.in/",
    re: /\bibps\b.*\bpo\b/i, qual: "Graduation in any discipline", level: [],
    stages: ["Preliminary exam", "Main exam", "Interview"],
    about: "IBPS PO selects Probationary Officers for participating public sector banks (Bank of Baroda, PNB, Canara Bank, Bank of India and others). Officers join as Junior Management Grade Scale I." },
  { slug: "ibps-clerk", name: "IBPS Clerk", full: "IBPS Clerk (Customer Service Associate)", cat: "Banking", body: "Institute of Banking Personnel Selection (IBPS)", site: "https://www.ibps.in/",
    re: /\bibps\b.*clerk|customer service associate/i, qual: "Graduation in any discipline; proficiency in the official language of the state applied for", level: [],
    stages: ["Preliminary exam", "Main exam", "Language proficiency test"],
    about: "IBPS Clerk recruits clerical staff (Customer Service Associates) for public sector banks, with state-wise vacancies — there is no interview." },
  { slug: "ibps-rrb", name: "IBPS RRB", full: "IBPS RRB Officer Scale I & Office Assistant", cat: "Banking", body: "Institute of Banking Personnel Selection (IBPS)", site: "https://www.ibps.in/",
    re: /\bibps\b.*\brrb\b/i, qual: "Graduation; local language proficiency", level: [],
    stages: ["Preliminary exam", "Main exam", "Interview (Officer posts only)"],
    about: "IBPS RRB recruits Officers (Scale I, II, III) and Office Assistants (Multipurpose) for Regional Rural Banks across India." },
  { slug: "ibps-so", name: "IBPS SO", full: "IBPS Specialist Officer", cat: "Banking", body: "Institute of Banking Personnel Selection (IBPS)", site: "https://www.ibps.in/",
    re: /\bibps\b.*(\bso\b|specialist)/i, qual: "Degree in the specialist field (IT, agriculture, law, HR, marketing, Rajbhasha)", level: [],
    stages: ["Preliminary exam", "Main exam (professional knowledge)", "Interview"],
    about: "IBPS SO recruits specialist officers — IT Officer, Agricultural Field Officer, Law Officer, HR/Personnel Officer, Marketing Officer and Rajbhasha Adhikari — for public sector banks." },
  { slug: "sbi-po", name: "SBI PO", full: "SBI Probationary Officer", cat: "Banking", body: "State Bank of India", site: "",
    re: /\bsbi\b.*\bpo\b|sbi probationary/i, qual: "Graduation in any discipline", level: [],
    stages: ["Preliminary exam", "Main exam", "Psychometric test, group exercise & interview"],
    about: "SBI PO recruits Probationary Officers for the State Bank of India, the country's largest bank — one of the most sought-after banking jobs for graduates." },
  { slug: "sbi-clerk", name: "SBI Clerk", full: "SBI Junior Associate (Customer Support & Sales)", cat: "Banking", body: "State Bank of India", site: "",
    re: /\bsbi\b.*(clerk|junior associate)/i, qual: "Graduation; knowledge of the local language", level: [],
    stages: ["Preliminary exam", "Main exam", "Local language test"],
    about: "SBI Clerk recruits Junior Associates for State Bank of India branches with state-wise vacancies." },
  { slug: "rbi", name: "RBI Grade B & Assistant", full: "Reserve Bank of India Grade B Officer and Assistant", cat: "Banking", body: "Reserve Bank of India", site: "https://www.rbi.org.in/",
    re: /\brbi\b/i, qual: "Graduation with minimum marks as per post", level: [],
    stages: ["Phase I / Preliminary exam", "Phase II / Main exam", "Interview or language proficiency test (as per post)"],
    about: "The Reserve Bank of India recruits Grade B Officers (General, DEPR, DSIM) and Assistants — among the best-paid entry-level government jobs for graduates." },
  // ---- UPSC & Defence ----
  { slug: "upsc-cse", name: "UPSC Civil Services", full: "UPSC Civil Services Examination (IAS, IPS, IFS)", cat: "UPSC", body: "Union Public Service Commission (UPSC)", site: "https://upsc.gov.in/",
    re: /^(?!.*(geo-?scientist|cgse|engineering services|\bese\b)).*(\bupsc\b.*(civil services|\bcse\b|prelims)|\bias\b.*exam)/i, qual: "Graduation in any discipline", level: ["10"],
    stages: ["Preliminary exam (objective, qualifying)", "Main exam (written)", "Personality test (interview)"],
    about: "The Civil Services Examination selects officers for the IAS, IPS, IFS and other Group A and B central services. It is held once a year and is India's most prestigious recruitment exam." },
  { slug: "upsc-nda", name: "UPSC NDA", full: "National Defence Academy & Naval Academy Examination", cat: "Defence", body: "Union Public Service Commission (UPSC)", site: "https://upsc.gov.in/",
    re: /\bnda\b|national defence academy/i, qual: "12th pass (Physics & Maths for Air Force and Navy wings)", level: [],
    stages: ["Written exam (Mathematics & General Ability Test)", "SSB interview", "Medical examination"],
    about: "UPSC NDA is held twice a year to admit cadets to the National Defence Academy (Army, Navy, Air Force) and the Indian Naval Academy — the main route to a permanent commission straight after 12th." },
  { slug: "upsc-cds", name: "UPSC CDS", full: "Combined Defence Services Examination", cat: "Defence", body: "Union Public Service Commission (UPSC)", site: "https://upsc.gov.in/",
    re: /\bcds\b|combined defence services/i, qual: "Graduation (engineering for Naval Academy; Physics & Maths at 12th or degree for Air Force Academy)", level: [],
    stages: ["Written exam", "SSB interview", "Medical examination"],
    about: "UPSC CDS selects graduates for the Indian Military Academy, Indian Naval Academy, Air Force Academy and Officers' Training Academy, twice a year." },
  { slug: "upsc-capf", name: "UPSC CAPF AC", full: "UPSC Central Armed Police Forces (Assistant Commandant)", cat: "UPSC", body: "Union Public Service Commission (UPSC)", site: "https://upsc.gov.in/",
    re: /\bupsc\b.*(capf|assistant commandant)|\bcapf\b.*\bac\b/i, qual: "Graduation", level: ["10"],
    stages: ["Written exam (two papers)", "Physical & medical standards tests", "Interview / personality test"],
    about: "UPSC CAPF recruits Assistant Commandants — Group A officers — for BSF, CRPF, CISF, ITBP and SSB." },
  { slug: "upsc-ese", name: "UPSC ESE", full: "UPSC Engineering Services Examination", cat: "UPSC", body: "Union Public Service Commission (UPSC)", site: "https://upsc.gov.in/",
    re: /engineering services|\bupsc\b.*\bese\b|\bies\b exam/i, qual: "Engineering degree", level: ["10"],
    stages: ["Preliminary exam", "Main exam", "Personality test"],
    about: "UPSC ESE recruits Group A engineers for Indian Railways, CPWD, Central Water Engineering, defence, telecom and other technical services." },
  { slug: "agniveer", name: "Agniveer", full: "Agnipath Scheme — Agniveer Army, Navy & Air Force", cat: "Defence", body: "Indian Army, Indian Navy and Indian Air Force", site: "",
    re: /agniveer|agnipath/i, qual: "10th or 12th pass as per trade", level: [],
    stages: ["Online common entrance exam", "Physical fitness & measurement tests", "Medical examination"],
    about: "Under the Agnipath scheme the armed forces recruit Agniveers for a four-year engagement, after which up to a quarter may be retained for regular service." },
  { slug: "afcat", name: "AFCAT", full: "Air Force Common Admission Test", cat: "Defence", body: "Indian Air Force", site: "https://afcat.cdac.in/",
    re: /\bafcat\b/i, qual: "Graduation / engineering with Physics & Maths at 12th (Flying branch)", level: [],
    stages: ["Online test", "AFSB interview", "Medical examination"],
    about: "AFCAT selects officers for the Flying, Ground Duty (Technical) and Ground Duty (Non-Technical) branches of the Indian Air Force, twice a year." },
  // ---- Teaching ----
  { slug: "ctet", name: "CTET", full: "Central Teacher Eligibility Test", cat: "Teaching", body: "Central Board of Secondary Education (CBSE)", site: "https://ctet.nic.in/",
    re: /\bctet\b|central teacher eligibility/i, qual: "D.El.Ed / B.Ed or equivalent as per paper", level: [],
    stages: ["Paper I (classes 1–5)", "Paper II (classes 6–8)"],
    about: "CTET is an eligibility test, not a recruitment: qualifying it is required to apply for teaching posts in central government schools such as KVS and NVS. The certificate is valid for life." },
  { slug: "kvs", name: "KVS Recruitment", full: "Kendriya Vidyalaya Sangathan Teaching & Non-Teaching Posts", cat: "Teaching", body: "Kendriya Vidyalaya Sangathan", site: "https://kvsangathan.nic.in/",
    re: /\bkvs\b|kendriya vidyalaya/i, qual: "As per post (B.Ed + CTET for teachers)", level: [],
    stages: ["Written / computer-based test", "Interview or skill test (as per post)"],
    about: "KVS recruits PGTs, TGTs, PRTs, librarians and non-teaching staff for Kendriya Vidyalayas across India and abroad." },
  { slug: "tet", name: "State TET", full: "State Teacher Eligibility Tests (UPTET, REET, HTET, JTET and others)", cat: "Teaching", body: "State education boards", site: "",
    re: /\b(up ?tet|reet|htet|jtet|mahatet|ap ?tet|ts ?tet|ptet|ostet|wbtet|tet)\b/i, qual: "D.El.Ed / B.Ed or equivalent", level: [],
    stages: ["Paper I (primary)", "Paper II (upper primary)"],
    about: "Each state runs its own Teacher Eligibility Test; qualifying it is required for government teacher recruitment in that state." },
  // ---- State & police ----
  { slug: "state-psc", name: "State PSC", full: "State Public Service Commission Exams (UPPSC, BPSC, RPSC, MPPSC and others)", cat: "State", body: "State Public Service Commissions", site: "",
    re: /\b(uppsc|bpsc|rpsc|mppsc|mpsc|tnpsc|kpsc|appsc|tspsc|tgpsc|wbpsc|opsc|hpsc|hppsc|ukpsc|jpsc|cgpsc|gpsc|kerala psc|ppsc)\b/i, qual: "Graduation for most combined services exams", level: [],
    stages: ["Preliminary exam", "Main exam", "Interview (for most gazetted posts)"],
    about: "State Public Service Commissions recruit state administrative, police and allied services officers (such as PCS, RAS, BPSC CCE) and many other state posts." },
  { slug: "police-constable", name: "Police Constable", full: "State Police Constable Recruitment", cat: "State", body: "State police recruitment boards", site: "",
    re: /police.*constable|constable.*police|\buppbpb\b|\bcsbc\b/i, qual: "10th or 12th pass (varies by state)", level: [],
    stages: ["Written exam", "Physical standard & efficiency tests", "Document verification & medical"],
    about: "State police boards recruit constables in large numbers every year — UP, Bihar, Rajasthan, MP, Maharashtra and others. Physical standards and age limits differ by state." },
  { slug: "india-post-gds", name: "India Post GDS", full: "India Post Gramin Dak Sevak", cat: "Central", body: "Department of Posts", site: "https://indiapostgdsonline.gov.in/",
    re: /\bgds\b|gramin dak sevak/i, qual: "10th pass with Maths & English; knowledge of the local language; cycling", level: [],
    stages: ["Merit list based on 10th marks (no written exam)", "Document verification"],
    about: "India Post recruits Gramin Dak Sevaks — Branch Postmaster, Assistant Branch Postmaster and Dak Sevak — on the basis of 10th-class marks, with no exam." },
  { slug: "gate", name: "GATE", full: "Graduate Aptitude Test in Engineering", cat: "Central", body: "IISc / IITs (organising institute rotates every year)", site: "",
    re: /\bgate\b/i, qual: "Engineering / science degree (final-year students may apply)", level: [],
    stages: ["Computer-based test"],
    about: "GATE scores are used for M.Tech admissions and by PSUs such as NTPC, BHEL, IOCL, NIC and PGCIL to recruit engineers without a separate written test." },
];

const TYPE_LABEL = { job: "Notification", result: "Result", "admit-card": "Admit Card", "answer-key": "Answer Key", "exam-date": "Exam Date" };

function examOf(title) {
  const t = String(title || "");
  for (const e of EXAMS) if (e.re.test(t)) return e;
  return null;
}

function buildExamPages(ctx) {
  const { head, foot, esc, SITE, BUILT, breadcrumbLd, faqLd, faqSection, fmtDate, statusOf, adSlot, jobs, updates } = ctx;
  const year = BUILT.getFullYear();
  const pages = [];
  const hiAlt = (en) => [{ hreflang: "en", href: SITE.url + en }, { hreflang: "hi", href: SITE.url + "/hi" + en }, { hreflang: "x-default", href: SITE.url + en }];
  const items = (e) => [
    ...jobs.filter((j) => e.re.test(j.title)).map((j) => ({ type: "job", title: j.title, hiTitle: j.hi && j.hi.title, date: j.published, url: `/jobs/${j.id}/`, end: j.application_end, open: statusOf(j).cls !== "closed" })),
    ...updates.filter((u) => e.re.test(u.title)).map((u) => ({ type: u.type, title: u.title, hiTitle: u.hi && u.hi.title, date: u.date, url: `/updates/${u.id}/` })),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const index = [];
  for (const e of EXAMS) {
    const list = items(e);
    const open = list.filter((x) => x.type === "job" && x.open);
    const canonical = `${SITE.url}/exam/${e.slug}/`;
    const has = (t) => list.some((x) => x.type === t);
    const faq = [
      { q: `Who conducts the ${e.name} exam?`, a: `${e.full} is conducted by the ${e.body}.${e.site ? ` The official website is ${e.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}.` : ""}` },
      { q: `What is the educational qualification for ${e.name}?`, a: `${e.qual}. Always confirm the exact requirement for your post in the official notification.` },
      { q: `What is the selection process of ${e.name}?`, a: `${e.stages.join("; ")}.` },
      { q: `When will the ${e.name} ${year} notification, admit card and result be released?`, a: `Dates are announced by the ${e.body}. This page is updated automatically whenever a new ${e.name} notification, admit card, answer key or result is published${list.length ? ` — the latest update was on ${fmtDate(list[0].date)}` : ""}.` },
    ];
    const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Exams", url: SITE.url + "/exam/" }, { name: e.name, url: canonical }]), faqLd(faq)];
    if (list.length) ld.push({ "@context": "https://schema.org", "@type": "ItemList", name: `${e.name} updates`, itemListElement: list.slice(0, 30).map((x, i) => ({ "@type": "ListItem", position: i + 1, url: SITE.url + x.url, name: x.title })) });
    const kw = ["Notification", has("admit-card") && "Admit Card", has("answer-key") && "Answer Key", has("result") && "Result"].filter(Boolean);
    const title = `${e.name} ${year}: ${kw.join(", ")}${kw.length < 3 ? (e.level.length ? ", Eligibility & Salary" : ", Eligibility & Selection") : ""}`;
    const tools = [
      `<a class="chip" href="/tools/age-calculator/">Age calculator</a>`,
      `<a class="chip" href="/tools/photo-resizer/">Photo & signature resizer</a>`,
      `<a class="chip" href="/tools/exam-score-calculator/">Score calculator</a>`,
      ...e.level.map((l) => `<a class="chip" href="/salary/pay-level-${l.toLowerCase()}/">Level ${l} salary</a>`),
    ].join("");
    index.push({ e, n: list.length, open: open.length, latest: list[0] });
    pages.push({ path: `exam/${e.slug}/index.html`, url: canonical, html: head({
      title: `${title} | ${SITE.name}`.length <= 72 ? `${title} | ${SITE.name}` : title.slice(0, 70),
      desc: `${e.full} ${year}: latest notification, important dates, admit card, answer key and result with official links — plus eligibility, selection process and salary.`.slice(0, 158), canonical, ld,
      ...(HI_EXAMS[e.slug] ? { alternates: hiAlt(`/exam/${e.slug}/`), langSwitch: `/hi/exam/${e.slug}/` } : {}) }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/exam/">Exams</a> &nbsp;&rsaquo;&nbsp; ${esc(e.cat)}</p>
  <article>
    <p class="eyebrow">${esc(e.cat)} exam &middot; updated ${fmtDate(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(BUILT))}</p>
    <h1>${esc(e.name)} ${year} — notification, admit card, answer key &amp; result</h1>
    <p class="lede">${esc(e.about)}</p>
    ${open.length ? `<div class="closed-notice" style="border-color:var(--green);background:#EAF6F0"><strong>Applications open:</strong> ${open.map((x) => `<a href="${x.url}">${esc(x.title)}</a>${x.end ? ` — last date ${fmtDate(x.end)}` : ""}`).join(" · ")}</div>` : ""}
    <h2 class="section-h">Latest ${esc(e.name)} updates</h2>
    ${list.length ? `<ul class="exam-timeline">${list.slice(0, 25).map((x) => `<li><span class="upd-type upd-${x.type}">${TYPE_LABEL[x.type] || "Update"}</span> <a href="${x.url}">${esc(x.title)}</a> <span class="when">${fmtDate(x.date)}</span></li>`).join("")}</ul>`
      : `<p class="empty">No ${esc(e.name)} notice is open on the site right now. New notifications, admit cards, answer keys and results appear here automatically as soon as they are published — bookmark this page.</p>`}
    ${adSlot("exam-mid")}
    <h2 class="section-h">${esc(e.name)} at a glance</h2>
    <div class="spec"><dl>
      <dt>Full name</dt><dd>${esc(e.full)}</dd>
      <dt>Conducted by</dt><dd>${esc(e.body)}</dd>
      ${e.site ? `<dt>Official website</dt><dd><a href="${esc(e.site)}" rel="nofollow noopener" target="_blank">${esc(e.site.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a></dd>` : ""}
      <dt>Qualification</dt><dd>${esc(e.qual)}</dd>
      ${e.level.length ? `<dt>Pay level</dt><dd>${e.level.map((l) => `<a href="/salary/pay-level-${l.toLowerCase()}/">Level ${l}</a>`).join(", ")} (7th CPC)</dd>` : ""}
    </dl></div>
    <h2 class="section-h">Selection process</h2>
    <ol class="steps">${e.stages.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <h2 class="section-h">Useful tools for ${esc(e.name)} candidates</h2>
    <p class="tagrow">${tools}</p>
    ${faqSection(faq)}
    <section class="related"><h2 class="section-h">Related exams</h2><p class="tagrow">${EXAMS.filter((x) => x.cat === e.cat && x.slug !== e.slug).map((x) => `<a class="chip" href="/exam/${x.slug}/">${esc(x.name)}</a>`).join("")}</p></section>
  </article>
</main>` + foot() });
  }
  // hub
  {
    const canonical = `${SITE.url}/exam/`;
    const cats = [...new Set(EXAMS.map((e) => e.cat))];
    pages.push({ path: "exam/index.html", url: canonical, html: head({ title: `Government Exams ${year} – SSC, Railway, Bank, UPSC, Defence | ${SITE.name}`,
      desc: "Every major government exam in one place — latest notification, admit card, answer key and result for SSC, RRB, IBPS, SBI, UPSC, defence, teaching and state exams.", canonical,
      ld: [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Exams", url: canonical }])], alternates: hiAlt("/exam/"), langSwitch: "/hi/exam/" }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Exams</p>
  <section class="cat-head"><p class="eyebrow">${EXAMS.length} exams tracked automatically</p><h1>Government exams ${year}</h1>
  <p class="lede">Pick your exam to see everything in one place — the latest notification, admit card, answer key and result, plus eligibility, selection process and salary.</p></section>
  ${cats.map((c) => `<h2 class="section-h">${esc(c)}</h2><ul class="tool-list">${index.filter((x) => x.e.cat === c).map((x) => `<li><a class="tool-card" href="/exam/${x.e.slug}/"><b>${esc(x.e.name)}</b><span>${x.open ? `<b style="color:var(--green)">${x.open} open</b> · ` : ""}${x.n ? `${x.n} update${x.n === 1 ? "" : "s"} · latest ${fmtDate(x.latest.date)}` : esc(x.e.full)}</span></a></li>`).join("")}</ul>`).join("")}
</main>` + foot() });
  }
  pages.push(...buildHindiExamPages(ctx, EXAMS, items));
  return { pages, examOf };
}

module.exports = { EXAMS, buildExamPages, examOf };
