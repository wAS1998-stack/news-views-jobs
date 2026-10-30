#!/usr/bin/env node
/* Renders the Play Store icon (512x512) and feature graphic (1024x500) for the Sarkari Radar app from SVG.
   Usage: node tools-dev/app-brand.js  → android/store/icon-512.png, android/store/feature-graphic-1024x500.png */
const fs = require("fs"), path = require("path");
const C = { ink: "#14213D", saffron: "#E8772E", paper: "#FBFAF7" };
const mark = (cx, cy, s) => `<g transform="translate(${cx - 54 * s},${cy - 54 * s}) scale(${s})">
  <circle cx="54" cy="54" r="30" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3.5"/>
  <circle cx="54" cy="54" r="19" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3.5"/>
  <path d="M54,54 L69,28.02 A30,30 0 0,1 84,54 Z" fill="#fff" fill-opacity=".22"/>
  <path d="M54,54 L69,28.02" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="54" cy="54" r="5" fill="#fff"/>
  <circle cx="72" cy="41" r="5.5" fill="${C.saffron}"/></g>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${C.ink}"/>${mark(256, 256, 6.2)}</svg>`;
const feature = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <defs><radialGradient id="g" cx="20%" cy="45%" r="70%"><stop offset="0" stop-color="#22345E"/><stop offset="1" stop-color="${C.ink}"/></radialGradient></defs>
  <rect width="1024" height="500" fill="url(#g)"/>
  ${mark(230, 250, 4.6)}
  <text x="430" y="220" font-family="Inter" font-weight="800" font-size="76" fill="#fff">Sarkari <tspan fill="${C.saffron}">Radar</tspan></text>
  <text x="432" y="282" font-family="Inter" font-weight="600" font-size="31" fill="#D9DEEA">Govt job alerts for your state</text>
  <text x="432" y="322" font-family="Inter" font-weight="600" font-size="31" fill="#D9DEEA">and qualification — the moment</text>
  <text x="432" y="362" font-family="Inter" font-weight="600" font-size="31" fill="#D9DEEA">they are announced.</text>
</svg>`;
(async () => {
  const { Resvg, initWasm } = require("@resvg/resvg-wasm");
  await initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  const fontBuffers = ["Inter-ExtraBold.otf", "Inter-SemiBold.otf"].map((f) => fs.readFileSync(path.join(__dirname, "..", "fonts", f)));
  const out = path.join(__dirname, "..", "android", "store");
  for (const [name, svg, w] of [["icon-512.png", icon, 512], ["feature-graphic-1024x500.png", feature, 1024]]) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: w }, font: { fontBuffers, defaultFontFamily: "Inter", loadSystemFonts: false } }).render().asPng();
    fs.writeFileSync(path.join(out, name), png);
    console.log("wrote", name, png.length);
  }
})();
