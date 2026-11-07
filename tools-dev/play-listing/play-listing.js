#!/usr/bin/env node
/**
 * play-listing.js — builds the Google Play store listing package of the Sarkari Radar app, ready to zip:
 *   - captioned phone screenshots, 1080x1920 (9:16) JPEG, English and Hindi, from the CI emulator screenshots
 *     (android/ci/screens, taken by android/ci-screens.sh: store-* in store_mode, i.e. without ads),
 *   - 1024x500 feature graphics (English, Hindi), the 512x512 icon,
 *   - the listing text (text/<lang>/*.txt), checked against Play's limits, and the guides in docs/.
 * Captions are in captions.json. Rendering uses the pre-installed Chromium (Playwright) with the Poppins font
 * (Latin + Devanagari, SIL OFL, fonts/), so Hindi is shaped correctly.
 *
 *   node tools-dev/play-listing/play-listing.js [--screens DIR] [--out DIR] [--langs en-IN,hi-IN] [--zip]
 *   defaults: --screens android/ci/screens  --out android/ci/play/Sarkari-Radar-Play-Listing  --langs en-IN
 * With one language the folders are flat; with several, each gets its own sub-folder.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const HERE = __dirname;
const ROOT = path.join(HERE, "..", "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SCREENS = path.resolve(ROOT, arg("--screens", "android/ci/screens"));
const OUT = path.resolve(ROOT, arg("--out", "android/ci/play/Sarkari-Radar-Play-Listing"));
const CAP = JSON.parse(fs.readFileSync(path.join(HERE, "captions.json"), "utf8"));
const LANG_DIR = { "en-IN": "english-en-IN", "hi-IN": "hindi-hi-IN" };
const LANGS = arg("--langs", "en-IN").split(",").filter((l) => LANG_DIR[l]);
const sub = (lang) => (LANGS.length > 1 ? LANG_DIR[lang] : "");
const TEXT_FILES = [["title.txt", "1-app-name.txt", 30], ["short-description.txt", "2-short-description.txt", 80],
  ["full-description.txt", "3-full-description.txt", 4000], ["whats-new.txt", "4-whats-new-release-notes.txt", 500]];

const b64 = (f) => fs.readFileSync(f).toString("base64");
const ICON = path.join(ROOT, "android", "store", "icon-512.png");

/* Poppins, Latin + Devanagari subsets, embedded so the pages need no network or file access. */
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const DEVA = "U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF";
const FONTS = [500, 600, 700, 800].map((w) => [["latin", LATIN], ["devanagari", DEVA]].map(([sub, range]) =>
  `@font-face{font-family:P;font-weight:${w};font-display:block;unicode-range:${range};src:url(data:font/woff2;base64,${b64(path.join(HERE, "fonts", `poppins-${sub}-${w}-normal.woff2`))}) format("woff2")}`).join("")).join("");

/** The first existing CI screenshot of a preference list (PNG 1080x2400, or a JPEG the CI already cropped). */
function screen(list) {
  for (const n of list) for (const ext of [".png", ".jpg"]) {
    const f = path.join(SCREENS, n + ext);
    if (fs.existsSync(f) && fs.statSync(f).size > 20000) return { file: f, name: n, mime: ext === ".png" ? "image/png" : "image/jpeg" };
  }
  return null;
}

const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0;overflow:hidden}
body{font-family:P,sans-serif;color:#fff;position:relative;background:#14213D}
.bg{position:absolute;inset:0;background:
  radial-gradient(70% 45% at 88% 6%,rgba(247,145,61,.24),transparent 70%),
  radial-gradient(70% 50% at 0% 100%,rgba(77,128,230,.20),transparent 70%),
  linear-gradient(165deg,#213767 0%,#14213D 52%,#0B1427 100%)}
.rings{position:absolute;inset:0;width:100%;height:100%}
em{font-style:normal;color:#F99A48}
.phone{position:absolute;background:#0A101E;box-shadow:0 50px 110px rgba(0,0,0,.55),inset 0 0 0 3px #2E3E63}
.screen{position:relative;overflow:hidden;background:#FAF8F3}
.screen canvas{display:block;width:100%}
.cam{position:absolute;left:50%;border-radius:50%;background:#0A101E}`;

/* Draws the screenshot on a canvas, painting over the emulator's status bar (time, icons) with the app's own
   background colour, so the phone shows a clean top edge with just the camera. */
const PREP_JS = `
async function prep(){
  await document.fonts.ready;
  for (const c of document.querySelectorAll('canvas[data-src]')) {
    const img = new Image(); img.src = c.dataset.src; await img.decode();
    c.width = img.naturalWidth; c.height = img.naturalHeight - (+c.dataset.cropb || 0);   // cropb: system taskbar off the bottom
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const bar = c.dataset.bar ? +c.dataset.bar : (img.naturalHeight >= 2300 ? 122 : 0);
    if (bar) { const p = x.getImageData(6, 6, 1, 1).data; x.fillStyle = 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')'; x.fillRect(0, 0, img.naturalWidth, bar); }
  }
  const cap = document.querySelector('.cap'), ph = document.querySelector('.phone.main');
  if (cap && ph) ph.style.top = Math.max(560, Math.round(cap.getBoundingClientRect().bottom + 64)) + 'px';
  // a tablet shot that caught the splash screen (one logo in the middle) is not used: every real screen has its top
  // bar, search or heading in the upper quarter, the splash screen has nothing there
  for (const c of document.querySelectorAll('canvas[data-check]')) {
    const t = document.createElement('canvas'); t.width = 150; t.height = 240;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, 150, 240);
    const px = x.getImageData(0, 20, 150, 40).data, bg = [px[0], px[1], px[2]];
    let busy = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 60) busy++;
    if (busy < 20) return false;
  }
  // tablets: the whole device, as large as fits under the caption
  const tab = document.querySelector('.tablet'), tc = tab && tab.querySelector('canvas');
  if (cap && tab) {
    const top = Math.round(cap.getBoundingClientRect().bottom + 56), pad = 24, ratio = tc.height / tc.width;
    const sw = Math.floor(Math.min(940 - 2 * pad, (1920 - top - 64 - 2 * pad) / ratio));
    tab.style.top = top + 'px'; tab.style.width = (sw + 2 * pad) + 'px'; tab.style.left = Math.round((1080 - sw - 2 * pad) / 2) + 'px';
    tab.querySelector('.screen').style.height = Math.round(sw * ratio) + 'px';
  }
  return true;
}`;

const rings = (cx, cy, rs) => `<svg class="rings" xmlns="http://www.w3.org/2000/svg">${rs.map((r, i) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,${(0.08 - i * 0.014).toFixed(3)})" stroke-width="3"/>`).join("")}</svg>`;

function screenshotHtml(c, idx, lang, shot) {
  const hi = lang === "hi-IN";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}${BASE_CSS}
html,body{width:1080px;height:1920px}
.cap{position:absolute;left:70px;right:70px;top:${c.brand ? 96 : 140}px;text-align:center}
.brand{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:38px}
.brand img{width:78px;height:78px;border-radius:19px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.brand b{font-weight:700;font-size:46px;letter-spacing:-.5px}
h1,p{text-wrap:balance}
h1{margin:0;font-weight:800;font-size:${hi ? 84 : 94}px;line-height:${hi ? 1.3 : 1.07};letter-spacing:${hi ? 0 : -1.5}px}
p{margin:${hi ? 26 : 30}px auto 0;font-weight:500;font-size:${hi ? 38 : 40}px;line-height:${hi ? 1.5 : 1.36};color:#C9D3E8;max-width:900px}
.phone.main{left:110px;top:600px;width:860px;height:1840px;border-radius:104px;padding:18px}
.phone.main .screen{width:824px;height:1804px;border-radius:88px}
.phone.main .cam{top:24px;width:30px;height:30px;margin-left:-15px}
</style></head><body><div class="bg"></div>${rings(540, 1380, [560, 700, 840])}
<div class="cap">${c.brand ? `<div class="brand"><img src="data:image/png;base64,${b64(ICON)}"><b>Sarkari <em>Radar</em></b></div>` : ""}
<h1>${c.h}</h1><p>${c.s}</p></div>
<div class="phone main"><div class="screen"><canvas data-src="data:${shot.mime};base64,${b64(shot.file)}"></canvas><div class="cam"></div></div></div>
<script>${PREP_JS}</script></body></html>`;
}

function tabletHtml(c, idx, shot) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}${BASE_CSS}
html,body{width:1080px;height:1920px}
.cap{position:absolute;left:70px;right:70px;top:${c.brand ? 96 : 130}px;text-align:center}
.brand{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:34px}
.brand img{width:74px;height:74px;border-radius:18px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.brand b{font-weight:700;font-size:44px;letter-spacing:-.5px}
h1,p{text-wrap:balance}
h1{margin:0;font-weight:800;font-size:88px;line-height:1.07;letter-spacing:-1.5px}
p{margin:26px auto 0;font-weight:500;font-size:38px;line-height:1.36;color:#C9D3E8;max-width:900px}
.tablet{position:absolute;background:#0A101E;border-radius:52px;padding:24px;box-shadow:0 50px 110px rgba(0,0,0,.55),inset 0 0 0 3px #2E3E63}
.tablet .screen{position:relative;overflow:hidden;border-radius:26px;background:#FAF8F3}
.tablet .screen canvas{display:block;width:100%}
.tablet .cam{position:absolute;top:8px;left:50%;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:#26324D}
</style></head><body><div class="bg"></div>${rings(540, 1300, [520, 680, 840])}
<div class="cap">${c.brand ? `<div class="brand"><img src="data:image/png;base64,${b64(ICON)}"><b>Sarkari <em>Radar</em></b></div>` : ""}
<h1>${c.h}</h1><p>${c.s}</p></div>
<div class="tablet"><div class="cam"></div><div class="screen"><canvas data-bar="120" data-cropb="120" data-check="1" data-src="data:${shot.mime};base64,${b64(shot.file)}"></canvas></div></div>
<script>${PREP_JS}</script></body></html>`;
}

function featureHtml(f, lang, front, back) {
  const hi = lang === "hi-IN";
  const check = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="#F99A48"/></svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}${BASE_CSS}
html,body{width:1024px;height:500px}
.left{position:absolute;left:62px;top:0;bottom:0;width:540px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:20px}
.brand img{width:96px;height:96px;border-radius:23px;box-shadow:0 8px 22px rgba(0,0,0,.4)}
.brand b{font-weight:800;font-size:56px;letter-spacing:-1px;line-height:1}
.tag{text-wrap:balance;margin-top:24px;font-weight:600;font-size:${hi ? 28 : 31}px;line-height:${hi ? 1.45 : 1.3};color:#E9EEF8;max-width:520px}
.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.chip{display:flex;align-items:center;gap:7px;font-weight:600;font-size:${hi ? 18 : 19}px;padding:8px 16px 8px 12px;border-radius:999px;background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.18);color:#fff}
.phone.f{left:606px;top:56px;width:292px;height:640px;border-radius:40px;padding:8px;z-index:2}
.phone.f .screen{width:276px;height:624px;border-radius:33px}
.phone.f .cam{top:9px;width:11px;height:11px;margin-left:-5.5px}
.phone.b{left:790px;top:104px;width:226px;height:520px;border-radius:33px;padding:7px;opacity:.9;z-index:1}
.phone.b .screen{width:212px;height:506px;border-radius:27px}
.phone.b .cam{top:8px;width:10px;height:10px;margin-left:-5px}
</style></head><body><div class="bg"></div>${rings(770, 300, [190, 290, 390])}
<div class="left"><div class="brand"><img src="data:image/png;base64,${b64(ICON)}"><b>Sarkari <em>Radar</em></b></div>
<div class="tag">${f.tag}</div><div class="chips">${f.chips.map((c) => `<span class="chip">${check}${c}</span>`).join("")}</div></div>
${back ? `<div class="phone b"><div class="screen"><canvas data-src="data:${back.mime};base64,${b64(back.file)}"></canvas><div class="cam"></div></div></div>` : ""}
<div class="phone f"><div class="screen"><canvas data-src="data:${front.mime};base64,${b64(front.file)}"></canvas><div class="cam"></div></div></div>
<script>${PREP_JS}</script></body></html>`;
}

async function render(browser, html, w, h, file, scale = 1) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "load" });
  const ok = await page.evaluate(() => window.prep());
  if (ok) await page.screenshot({ path: file, type: "jpeg", quality: 93 });   // JPEG: no alpha channel, as Play requires
  await page.close();
  return ok;
}

const jpegSize = (f) => {   // width/height from the SOF marker
  const b = fs.readFileSync(f);
  for (let i = 2; i < b.length;) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; }
  return [0, 0];
};

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const dirs = { icon: path.join(OUT, "1-app-icon"), feature: path.join(OUT, "2-feature-graphic"), shots: path.join(OUT, "3-phone-screenshots"),
    tab7: path.join(OUT, "3b-tablet-7-inch-screenshots"), tab10: path.join(OUT, "3c-tablet-10-inch-screenshots"), text: path.join(OUT, "4-store-text") };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const problems = [], report = [];

  fs.copyFileSync(ICON, path.join(dirs.icon, "icon-512.png"));
  const browser = await chromium.launch();
  try {
    for (const lang of LANGS) {
      const dir = path.join(dirs.shots, sub(lang)); fs.mkdirSync(dir, { recursive: true });
      for (const [i, c] of CAP[lang].entries()) {
        const shot = screen(c.src);
        if (!shot) { problems.push(`${lang} ${c.file}: none of ${c.src.join(", ")} found`); continue; }
        const out = path.join(dir, `${c.file}.jpg`);
        await render(browser, screenshotHtml(c, i, lang, shot), 1080, 1920, out);
        report.push(`${lang} ${c.file}.jpg  <- ${shot.name}${shot.name === c.src[0] ? "" : "  (fallback)"}`);
      }
      if (lang === "en-IN") for (const [n, scale] of [[7, 1], [10, 4 / 3]]) {
        for (const [i, c] of CAP[lang].entries()) {
          const shot = c.tab && screen([`tab${n}-${c.tab}`]);
          if (!shot) { problems.push(`${n}-inch tablet ${c.file}: tab${n}-${c.tab} not found`); continue; }
          const ok = await render(browser, tabletHtml(c, i, shot), 1080, 1920, path.join(dirs[`tab${n}`], `${c.file}.jpg`), scale);
          report.push(ok ? `${n}-inch ${c.file}.jpg  <- ${shot.name}` : `${n}-inch ${c.file}: skipped, ${shot.name} shows the splash screen`);
        }
      }
      const f = CAP.feature[lang], front = screen(f.src), back = screen(f.back);
      if (!front) problems.push(`${lang} feature graphic: none of ${f.src.join(", ")} found`);
      else { const name = LANGS.length > 1 ? f.file : "feature-graphic";
        await render(browser, featureHtml(f, lang, front, back), 1024, 500, path.join(dirs.feature, `${name}-1024x500.jpg`)); report.push(`${lang} ${name} <- ${front.name}${back ? " + " + back.name : ""}`); }
    }
  } finally { await browser.close(); }

  // Play's limits: screenshots 320-3840 px, long side at most twice the short side; feature graphic exactly 1024x500.
  for (const f of fs.readdirSync(dirs.shots, { recursive: true }).filter((x) => x.endsWith(".jpg"))) {
    const [w, h] = jpegSize(path.join(dirs.shots, f));
    if (w !== 1080 || h !== 1920) problems.push(`${f}: ${w}x${h}, expected 1080x1920`);
  }
  for (const f of fs.readdirSync(dirs.feature)) { const [w, h] = jpegSize(path.join(dirs.feature, f)); if (w !== 1024 || h !== 500) problems.push(`${f}: ${w}x${h}`); }
  for (const [d, W, H] of [[dirs.tab7, 1080, 1920], [dirs.tab10, 1440, 2560]]) for (const f of fs.readdirSync(d)) {
    const [w, h] = jpegSize(path.join(d, f)); if (w !== W || h !== H) problems.push(`${path.basename(d)}/${f}: ${w}x${h}, expected ${W}x${H}`);
  }
  for (const d of [dirs.tab7, dirs.tab10]) if (!fs.readdirSync(d).length) fs.rmdirSync(d);   // no tablet shots in this CI run

  const counts = {};
  for (const lang of LANGS) {
    const dir = path.join(dirs.text, sub(lang)); fs.mkdirSync(dir, { recursive: true });
    for (const [src, dst, max] of TEXT_FILES) {
      const t = fs.readFileSync(path.join(HERE, "text", lang, src), "utf8").replace(/\s+$/, "");
      const n = [...t].length;   // Play counts characters (code points)
      if (n > max) problems.push(`${lang}/${src}: ${n} characters, limit ${max}`);
      fs.writeFileSync(path.join(dir, dst), t + "\n");
      if (lang === LANGS[0]) counts[src.replace(".txt", "")] = n.toLocaleString("en-IN");
      report.push(`${lang} ${dst}: ${n}/${max}`);
    }
  }
  // guides, with the character counts filled in ({{title}}, {{short-description}}, {{full-description}}, {{whats-new}})
  for (const f of fs.readdirSync(path.join(HERE, "docs"))) {
    const t = fs.readFileSync(path.join(HERE, "docs", f), "utf8").replace(/\{\{([a-z-]+)\}\}/g, (m, k) => counts[k] || m);
    fs.writeFileSync(path.join(OUT, f), t.replace(/\r?\n/g, "\r\n"));   // Windows line ends: opens cleanly in Notepad
  }

  console.log(report.join("\n"));
  if (problems.length) { console.log("\nPROBLEMS:\n" + problems.join("\n")); process.exitCode = 1; }
  if (process.argv.includes("--zip")) {
    const zip = OUT + ".zip"; fs.rmSync(zip, { force: true });
    execFileSync("zip", ["-qr", zip, path.basename(OUT)], { cwd: path.dirname(OUT) });
    console.log(`\nzip: ${zip} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
