// node --test: record hygiene, employer filter, Apply-button honesty, twins, filters and the update archive (lib.js).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const L = require("../lib.js");

test("sanitizeJob never stores objects as [object Object]", () => {
  const o = L.sanitizeJob({ id: "x", title: "T", fee: { General: 100, "SC/ST": 0 }, salary: { min: 25500, max: 81100 },
    location: { city: "Patna", state: "Bihar" }, total_vacancies: "1,234 posts", application_end: "2026-11-30T10:00:00Z",
    apply_link: "javascript:alert(1)", how_to_apply: "One step", faq: [{ q: "a", a: "b" }, { q: "no answer" }] });
  assert.ok(!JSON.stringify(o).includes("[object Object]"));
  assert.strictEqual(o.fee, "General: 100; SC/ST: 0");
  assert.strictEqual(o.location, "Patna, Bihar");
  assert.strictEqual(o.total_vacancies, 1234);
  assert.strictEqual(o.application_end, "2026-11-30");
  assert.strictEqual(o.apply_link, undefined);
  assert.deepStrictEqual(o.how_to_apply, ["One step"]);
  assert.strictEqual(o.faq.length, 1);
});

test("sanitizeJob rewrites Cloudflare's hidden e-mail placeholder", () => {
  const o = L.sanitizeJob({ title: "T", summary: "Send the form to [email protected] by post." });
  assert.ok(o.summary.includes("the e-mail address given in the official notice"));
  assert.ok(!/protected\]/.test(o.summary));
});

test("stripTags decodes data-cfemail addresses", () => {
  const email = "recruit@example.gov.in", key = 0x42;
  const hex = key.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  const html = `<p>Apply to <a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a></p>`;
  assert.strictEqual(L.stripTags(html), `Apply to ${email}`);
});

test("sanitizeJob keeps only real notice statuses", () => {
  assert.strictEqual(L.sanitizeJob({ title: "T", notice_status: "maybe", status_note: "x" }).notice_status, undefined);
  assert.strictEqual(L.sanitizeJob({ title: "T", notice_status: "maybe", status_note: "x" }).status_note, undefined);
  assert.strictEqual(L.sanitizeJob({ title: "T", notice_status: "cancelled" }).notice_status, "cancelled");
  assert.strictEqual(L.aiJobFields({ notice_status: "cancelled", status_note: "x", post_name: "Clerk" }).notice_status, undefined);
});

test("isNonGovt blocks private employers and NGOs, keeps grey areas kept on purpose", () => {
  assert.strictEqual(L.isNonGovt({ title: "ABC Infra Pvt Ltd Recruitment 2026" }), true);
  assert.strictEqual(L.isNonGovt({ title: "Helping Hands NGO Recruitment 2026 – Field Officer" }), true);
  assert.strictEqual(L.isNonGovt({ title: "HDFC Bank Relationship Manager Recruitment 2026" }), true);
  assert.strictEqual(L.isNonGovt({ title: "MIT Manipal Research Associate Recruitment 2026", organization: "Manipal Institute of Technology" }), true);
  assert.strictEqual(L.isNonGovt({ title: "MSRMC Recruitment 2026", organization: "Ramaiah Medical College Hospital" }), true);
  assert.strictEqual(L.isNonGovt({ title: "MGUG X-Ray Technician Recruitment 2026", organization: "Mahayogi Gorakhnath University, Gorakhpur" }), true);
  assert.strictEqual(L.isNonGovt({ title: "Army Public School Bareilly Recruitment 2026", organization: "Army Public School Bareilly" }), false);
  assert.strictEqual(L.isNonGovt({ title: "Kangra DCCB Clerk Recruitment 2026", organization: "Kangra Central Co-operative Bank (DCCB)" }), false);
});

test("linkKind / applyInfo: a homepage is never an Apply link", () => {
  assert.strictEqual(L.linkKind("https://upsc.gov.in/"), "home");
  assert.strictEqual(L.linkKind("https://upsc.gov.in/sites/default/files/Notif-CSP-26.pdf"), "pdf");
  assert.strictEqual(L.linkKind("https://upsconline.gov.in/ora/"), "deep");
  assert.strictEqual(L.linkKind("https://becilregistration.in/"), "portal");
  assert.strictEqual(L.applyInfo({ title: "UPSC Recruitment 2026", apply_link: "https://upsc.gov.in/" }).cta, "website");
  assert.strictEqual(L.applyInfo({ title: "X Recruitment 2026 – Apply Online", apply_link: "https://x.gov.in/online/apply.php" }).cta, "apply");
  const off = L.applyInfo({ title: "X Recruitment 2026", how_to_apply: ["Send the filled form by speed post"], official_notification: "https://x.gov.in/a.pdf" });
  assert.strictEqual(off.cta, "form");
});

test("isDuplicate: one notice PDF is one recruitment; different advertisement numbers never are", () => {
  const a = { id: "a", title: "A", organization: "Staff Selection Commission", org_short: "SSC", official_notification: "https://x.gov.in/advt-05-2026.pdf", published: "2026-11-01" };
  const b = { id: "b", title: "B", organization: "Staff Selection Commission (SSC)", org_short: "SSC", official_notification: "https://x.gov.in/advt-05-2026.pdf", published: "2026-11-03" };
  assert.strictEqual(L.isDuplicate(b, [a]), a);
  assert.strictEqual(L.isDuplicate({ ...b, advt_no: "06/2026" }, [{ ...a, advt_no: "05/2026" }]), null);
  // a generic careers page is not a notice
  const c = { ...a, official_notification: "https://x.gov.in/careers/" }, d = { ...b, official_notification: "https://x.gov.in/careers/" };
  assert.strictEqual(L.isDuplicate(d, [c]), null);
  // 20+ posts, same last date, same body, within 45 days
  const e = { id: "e", organization: "Staff Selection Commission", org_short: "SSC", total_vacancies: 120, application_end: "2026-12-01", post_name: "Stenographer Grade C", published: "2026-11-01" };
  const f = { id: "f", organization: "Staff Selection Commission", org_short: "SSC", total_vacancies: 118, application_end: "2026-12-01", post_name: "Stenographer Grade C and D", published: "2026-11-10" };
  assert.strictEqual(L.isDuplicate(f, [e]), e);
  // review cases: different institutes of one family, and one PDF announcing unrelated posts of different bodies
  const p = { id: "p", organization: "AIIMS Patna", org_short: "AIIMS Patna", total_vacancies: 40, application_end: "2026-12-01", post_name: "Senior Resident", published: "2026-11-01" };
  const q = { id: "q", organization: "AIIMS Bhopal", org_short: "AIIMS Bhopal", total_vacancies: 35, application_end: "2026-12-01", post_name: "Senior Resident", published: "2026-11-02" };
  assert.strictEqual(L.isDuplicate(q, [p]), null);
});

test("isDupUpdate: one login page serves different updates; the same PDF of the same kind is one update", () => {
  const ak = { id: "ak", type: "answer-key", title: "GSSSB Lab Assistant Answer Key 2026", official_link: "https://g.tcsion.com/login", date: "2026-11-01" };
  const ad = { id: "ad", type: "admit-card", title: "GSSSB Lab Assistant Admit Card 2026", official_link: "https://g.tcsion.com/login", date: "2026-11-03" };
  assert.strictEqual(L.isDupUpdate(ad, [ak]), false);
  const r1 = { id: "r1", type: "result", title: "BSF HC Result 2026", official_link: "https://bsf.gov.in/res-2026.pdf", date: "2026-11-01" };
  const r2 = { id: "r2", type: "result", title: "BSF HC Result 2026 Out – Download PDF", official_link: "https://bsf.gov.in/res-2026.pdf", date: "2026-11-02" };
  assert.strictEqual(L.isDupUpdate(r2, [r1]), true);
  const ak2 = { ...ad, official_link: "https://bsf.gov.in/res-2026.pdf" };
  assert.strictEqual(L.isDupUpdate(ak2, [r1]), false);
});

test("OFF_TOPIC keeps recruitments that mention board exams, rejects the exams themselves", () => {
  for (const t of ["WBSSC SLST Class 9-10 Result 2026", "WBSSC Group D Recruitment 2026 – Madhyamik Pass", "Indian Navy Agniveer SSR (Class 12) Notification 2026",
    "Assistant Director Vacancy at NIOS 2026", "Executive Assistant Vacancy in ICAI 2026", "IISER Junior Research Fellow Recruitment 2026 with Scholarship", "Osmania University Assistant Professor Result 2026"]) assert.strictEqual(L.OFF_TOPIC.test(t), false, t);
  for (const t of ["ONGC Scholarship 2026-27: Students Can Get Rs. 48,000 Per Year, Apply Before 30 November", "CA Inter Results 2026 Out ICAI", "NIOS Hall Ticket 2026 Out - Download Class 10 & 12", "MSBTE Hall Ticket 2026 Out", "JNVST Class 6 Result 2026"]) assert.strictEqual(L.OFF_TOPIC.test(t), true, t);
});

test("matchNoticeStatus: an old year's cancellation never cancels this year's recruitment", () => {
  const job = { id: "bp", title: "Bihar Police Constable Recruitment 2026", organization: "Bihar Police", org_short: "CSBC", post_name: "Constable", published: "2026-10-01" };
  assert.strictEqual(L.matchNoticeStatus({ title: "Bihar Police Constable Recruitment 2019 Cancelled", date: "2026-11-01" }, [job]), null);
});

test("isDupUpdate: roman numerals equal arabic ones", () => {
  const list = [{ id: "a", title: "UPSC CDS II Result 2026 Out", date: "2026-11-01" }];
  assert.ok(L.isDupUpdate({ id: "b", title: "UPSC CDS 2 Result 2026", date: "2026-11-02" }, list));
  assert.ok(!L.isDupUpdate({ id: "c", title: "UPSC CDS 1 Result 2026", date: "2026-11-02" }, list));
});

test("filters: board/professional exams, university results, listicles, guesswork", () => {
  for (const t of ["ICAI CA Foundation Result 2026", "NIOS 10th Result 2026", "MSBTE Hall Ticket 2026 Out", "WB Madhyamik Exam Date 2027",
    "JNVST 2027 Class 6 Admit Card", "Osmania University Results 2026 Out", "CBSE Class 12 Date Sheet 2027"]) assert.ok(L.OFF_TOPIC.test(t), t);
  for (const t of ["ICAI Recruitment 2026 for 20 Assistant Posts", "NIOS Recruitment 2026", "RRB NTPC Results 2026 Out",
    "University of Delhi Non-Teaching Recruitment Result 2026", "BSSC Inter Level Result 2026", "Recruitment for Class 10 Pass Candidates"]) assert.ok(!L.OFF_TOPIC.test(t), t);
  assert.ok(L.JUNK_TITLE.test("Top 5 Government Jobs November 2026"));
  assert.ok(L.isSpeculative({ title: "SSC GD 2027 Notification Expected Soon", official_link: "https://ssc.gov.in/" }));
  assert.ok(!L.isSpeculative({ title: "SSC GD 2027 Notification Expected Soon", official_link: "https://ssc.gov.in/api/attachment/gd-2027-notice.pdf" }));
  assert.ok(!L.isSpeculative({ title: "SBI Clerk 2026 Last Date Closing Soon" }));
});

test("cancellation notices mark only the one job they are about", () => {
  assert.strictEqual(L.noticeStatusOf("APS Bareilly Recruitment 2026 Cancelled"), "cancelled");
  assert.strictEqual(L.noticeStatusOf("UKSSSC Group C Exam 2026 Postponed"), "");          // an exam, not the recruitment
  assert.strictEqual(L.noticeStatusOf("SSC CGL Tier 2 Exam Cancelled at one centre"), "");
  const jobs = [{ id: "aps", title: "Army Public School Bareilly Recruitment 2026 – Apply Offline for Account Clerk", organization: "Army Public School Bareilly", published: "2026-10-24" },
    { id: "other", title: "Army Public School Meerut Recruitment 2026", organization: "Army Public School Meerut", published: "2026-10-20" }];
  const m = L.matchNoticeStatus({ title: "APS Bareilly Recruitment 2026 Cancelled", date: "2026-11-02" }, jobs);
  assert.strictEqual(m && m.job.id, "aps");
  const j = { ...jobs[0] };
  L.applyNoticeStatus(j, "cancelled", { title: "APS Bareilly Recruitment 2026 Cancelled – Official Notice PDF", date: "2026-11-02", link: "https://www.armypublicschoolbly.com/n.pdf", id: "u1" });
  assert.strictEqual(j.status_note, "APS Bareilly Recruitment 2026 Cancelled");
  assert.strictEqual(j.status_link, "https://www.armypublicschoolbly.com/n.pdf");
  assert.strictEqual(j.updated, "2026-11-02");
});

test("saveUpdates moves the overflow to the archive, once per id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nv-upd-"));
  const file = path.join(dir, "u.json"), archiveFile = path.join(dir, "a.json");
  const mk = (i) => ({ id: "u" + i, type: "result", title: "T" + i, date: `2026-11-${String(28 - i).padStart(2, "0")}` });
  const list = Array.from({ length: 8 }, (_, i) => mk(i));
  assert.deepStrictEqual(L.saveUpdates(list, { file, archiveFile, keep: 5 }), { kept: 5, archived: 3 });
  L.saveUpdates(list, { file, archiveFile, keep: 5 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(archiveFile, "utf8")).map((u) => u.id), ["u5", "u6", "u7"]);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).length, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("filters: a private urban co-operative bank, course allotment lists, programme seats and roundup lists are not jobs", () => {
  assert.strictEqual(L.isNonGovt({ title: "AP Mahesh Bank Chief Compliance Officer in DGM Cadre Recruitment 2026", organization: "AP Mahesh Co-operative Urban Bank" }), true);
  assert.strictEqual(L.isNonGovt({ title: "Kangra DCCB Clerk Recruitment 2026", organization: "Kangra Central Co-operative Bank (DCCB)" }), false);
  for (const t of ["KNRUHS BHMS Allotment List 2026-27 Out - Download Management Quota PDF", "Kerala Ayurveda and Allied Courses Phase 3 Provisional Allotment List 2026 Out",
    "AIIMS Fellowship Programme January 2027 - Apply Online for 93 Seats", "Metro Rail Jobs 2026 - Latest Recruitment Notifications List"]) assert.strictEqual(L.OFF_TOPIC.test(t), true, t);
  for (const t of ["IBPS Clerk Provisional Allotment List 2026", "RRB NTPC Zone Allotment List 2026 Out", "ITI Apprentice Training Programme 2026 - 500 Seats",
    "Metro Rail Recruitment 2026 – Apply Online for 120 Posts"]) assert.strictEqual(L.OFF_TOPIC.test(t), false, t);
});

test("sanitizeJob: impossible ages and a deadline over a year away are dropped; a guessed FAQ answer keeps only its fact", () => {
  const j = L.sanitizeJob({ title: "X Recruitment 2026", published: "2026-10-21", application_end: "2028-01-01", age_min: 10, age_max: 56,
    faq: [{ q: "Is there a fee?", a: "The notification does not mention any application fee, so it is assumed to be free." },
      { q: "What is the fee?", a: "The application fee is nil for SC/ST and Rs. 500 for others." },
      { q: "When is the exam?", a: "It is likely that the exam will be held in December." }] });
  assert.strictEqual(j.age_min, undefined);
  assert.strictEqual(j.age_max, 56);
  assert.strictEqual(j.application_end, undefined);
  assert.deepStrictEqual(j.faq.map((f) => f.a), ["The notification does not mention any application fee. Please confirm in the official notification.",
    "The application fee is nil for SC/ST and Rs. 500 for others."]);
  const k = L.sanitizeJob({ title: "Y", published: "2026-10-21", application_end: "2026-11-30", age_min: 18, age_max: 75 });
  assert.strictEqual(k.application_end, "2026-11-30");
  assert.strictEqual(k.age_min, 18);
  assert.strictEqual(k.age_max, undefined);
  const m = L.sanitizeJob({ title: "Z", age_min: 40, age_max: 30 });
  assert.strictEqual(m.age_min, undefined);
  assert.strictEqual(m.age_max, undefined);
});
