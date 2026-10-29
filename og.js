#!/usr/bin/env node
/**
 * og.js — 1200x630 share images for job and result pages, so links on Telegram, WhatsApp and X show the
 * recruitment at a glance (title, posts, last date) instead of a generic logo, and pages qualify for large
 * previews. Called by build.js only inside the Cloudflare Pages build (CF_PAGES=1) or with OG=1 — never in the
 * GitHub Actions runs. Usage: node og.js <manifest.json> <distDir>; manifest = [{ file, kicker, title, facts[] }].
 * Never throws: on any problem it renders what it can and build.js falls back to /og.png for the rest.
 */
const fs = require("fs");
const path = require("path");

const W = 1200, H = 630;
const C = { ink: "#14213D", paper: "#FBFAF7", saffron: "#E8772E", muted: "#5C6370", line: "#E3E0D8", card: "#FFFFFF", green: "#1B7F5A" };
const x = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Greedy word wrap using an average glyph width (Inter ExtraBold ≈ 0.58 em); long words are cut.
function wrap(text, size, maxW, maxLines) {
  const per = Math.max(8, Math.floor(maxW / (size * 0.58)));
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = []; let cur = "";
  for (let w of words) {
    if (w.length > per) w = w.slice(0, per - 1) + "…";
    if (!cur) cur = w; else if ((cur + " " + w).length <= per) cur += " " + w; else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[\s,.:;–-]*\S*$/, "") + " …";
  return lines;
}

function svg(item) {
  // Title size adapts so long recruitment names still fit in three lines.
  let size = 66, lines = wrap(item.title, size, 1040, 3);
  if (lines.length === 3 && String(item.title).length > 95) { size = 56; lines = wrap(item.title, size, 1040, 3); }
  const top = 196, lh = Math.round(size * 1.14);
  const facts = (item.facts || []).filter(Boolean).slice(0, 3);
  let fx = 80;
  const factEls = facts.map((f) => {
    const w = Math.min(380, 44 + String(f).length * 17.5);
    const el = `<rect x="${fx}" y="452" width="${w}" height="64" rx="14" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>` +
      `<text x="${fx + 22}" y="494" font-family="Inter" font-weight="600" font-size="28" fill="${C.ink}">${x(f)}</text>`;
    fx += w + 18; return el;
  }).join("");
  if (String(item.kicker).length > 52) item.kicker = String(item.kicker).slice(0, 50).trim() + "…";
  const kickerW = 44 + String(item.kicker).length * 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <rect width="16" height="${H}" fill="${C.saffron}"/>
  <rect x="80" y="70" width="${kickerW}" height="52" rx="26" fill="${C.ink}"/>
  <text x="${80 + 22}" y="105" font-family="Inter" font-weight="600" font-size="26" fill="#FFFFFF">${x(item.kicker)}</text>
  ${lines.map((l, i) => `<text x="80" y="${top + i * lh}" font-family="Inter" font-weight="800" font-size="${size}" fill="${C.ink}">${x(l)}</text>`).join("\n  ")}
  ${factEls}
  <line x1="80" y1="560" x2="${W - 80}" y2="560" stroke="${C.line}" stroke-width="2"/>
  <text x="80" y="600" font-family="Inter" font-weight="800" font-size="30" fill="${C.ink}">news-views.in</text>
  <text x="${W - 80}" y="600" text-anchor="end" font-family="Inter" font-weight="600" font-size="24" fill="${C.green}">✓ Official links · Free · Updated daily</text>
</svg>`;
}

(async () => {
  const [manifestPath, dist] = process.argv.slice(2);
  let items = [];
  try { items = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (e) { console.log("og: no manifest — " + e.message); return; }
  let Resvg, initWasm;
  try { ({ Resvg, initWasm } = require("@resvg/resvg-wasm")); } catch { console.log("og: @resvg/resvg-wasm not installed — share images skipped"); return; }
  try { await initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))); }
  catch (e) { console.log("og: wasm init failed — " + e.message); return; }
  const fontBuffers = ["Inter-ExtraBold.otf", "Inter-SemiBold.otf"].map((f) => fs.readFileSync(path.join(__dirname, "fonts", f)));
  const t0 = Date.now(); let ok = 0, fail = 0;
  for (const it of items) {
    try {
      const out = path.join(dist, it.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const png = new Resvg(svg(it), { fitTo: { mode: "width", value: W }, font: { fontBuffers, defaultFontFamily: "Inter", loadSystemFonts: false } }).render().asPng();
      fs.writeFileSync(out, png); ok++;
    } catch (e) { fail++; if (fail <= 3) console.log("og: failed " + it.file + " — " + e.message); }
  }
  console.log(`og: ${ok} share images in ${((Date.now() - t0) / 1000).toFixed(1)}s${fail ? `, ${fail} failed` : ""}.`);
})().catch((e) => console.log("og: error " + e.message));
