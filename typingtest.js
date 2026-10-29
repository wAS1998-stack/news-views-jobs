/* ==================================================================
   typingtest.js — browser side of /tools/hindi-typing-test/ and /tools/english-typing-test/.
   Hindi is typed on the Kruti Dev / Remington layout: the keys pressed are kept as Kruti Dev codes and
   shown as Unicode Hindi (KrutiDev.toUnicode, from krutidev.js). Everything stays in the browser.
   ================================================================== */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var DATA = JSON.parse($("tt-data").textContent);
  var box = $("tt"), ta = $("tt-input"), view = $("tt-passage");
  var lang = box.getAttribute("data-lang"), minutes = 2, passage = 0;
  var raw = "", started = 0, timer = null, done = false, keys = 0;

  var norm = function (s) { return String(s).normalize("NFC").replace(/[​-‍﻿]/g, ""); };
  var words = function (s) { return norm(s).split(/\s+/).filter(Boolean); };
  var list = function () { return DATA[lang]; };
  var text = function () { return list()[passage].text; };

  function fill(sel, items, current) {
    sel.innerHTML = "";
    items.forEach(function (it, i) { var o = document.createElement("option"); o.value = i; o.textContent = it; if (i === current) o.selected = true; sel.appendChild(o); });
  }
  function typed() { return lang === "hi" ? KrutiDev.toUnicode(raw) : ta.value; }

  function paint() {
    var target = words(text()), mine = words(typed());
    var inProgress = !/\s$/.test(typed()) && mine.length > 0;
    var html = "";
    for (var i = 0; i < target.length; i++) {
      var cls = "";
      if (i < mine.length - (inProgress ? 1 : 0)) cls = mine[i] === target[i] ? "ok" : "bad";
      else if (i === mine.length - (inProgress ? 1 : 0)) cls = "cur";
      html += '<span class="' + cls + '">' + target[i].replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span> ";
    }
    view.innerHTML = html;
    var cur = view.querySelector(".cur");
    if (cur && cur.offsetTop > view.scrollTop + view.clientHeight - 40) view.scrollTop = cur.offsetTop - 40;
  }

  function clock() {
    var left = minutes * 60 - (started ? (Date.now() - started) / 1000 : 0);
    if (left <= 0) { finish(); left = 0; }
    var m = Math.floor(left / 60), s = Math.floor(left % 60);
    $("tt-time").textContent = m + ":" + (s < 10 ? "0" : "") + s;
    if (started) {
      var mins = Math.max((Date.now() - started) / 60000, 1 / 60);
      $("tt-live").textContent = Math.round(keys / 5 / mins) + " WPM";
    }
  }
  function start() {
    if (started || done) return;
    started = Date.now();
    timer = setInterval(clock, 250);
  }

  // word-level edit distance: how many words were wrong, missed or extra
  function errors(target, mine) {
    var n = mine.length, m = Math.min(target.length, n + 5), prev = [], cur, i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      cur = [i];
      for (j = 1; j <= m; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (mine[i - 1] === target[j - 1] ? 0 : 1));
      prev = cur;
    }
    var best = Infinity;
    for (j = 0; j <= m; j++) best = Math.min(best, prev[j]);   // the test may stop anywhere in the passage
    return best;
  }

  function finish() {
    if (done) return;
    done = true; clearInterval(timer); ta.readOnly = true;
    var mins = started ? Math.max((Date.now() - started) / 60000, 1 / 60) : minutes;
    var target = words(text()), mine = words(typed());
    var err = Math.min(errors(target, mine), mine.length);
    var gross = keys / 5 / mins, net = Math.max(0, gross - err / mins);
    var acc = mine.length ? Math.max(0, (mine.length - err) / mine.length * 100) : 0;
    var wrong = [];
    for (var i = 0; i < mine.length && wrong.length < 12; i++) if (mine[i] !== target[i]) wrong.push(mine[i] + " → " + (target[i] || "—"));
    $("tt-result").innerHTML =
      '<div class="tt-stats">' +
      '<div class="stat-box"><span class="n">' + Math.round(net) + '</span><span class="l">Net speed (WPM)</span></div>' +
      '<div class="stat-box"><span class="n">' + Math.round(gross) + '</span><span class="l">Gross speed (WPM)</span></div>' +
      '<div class="stat-box"><span class="n">' + acc.toFixed(1) + '%</span><span class="l">Accuracy</span></div>' +
      '<div class="stat-box"><span class="n">' + Math.round(keys / mins * 60).toLocaleString("en-IN") + '</span><span class="l">Key depressions / hour</span></div>' +
      "</div><p>" + mine.length + " words typed, " + err + " word" + (err === 1 ? "" : "s") + " wrong, missed or extra, " + keys + " keystrokes in " + mins.toFixed(1) + " min.</p>" +
      (wrong.length ? '<p class="tt-wrong"><b>Check these words:</b> ' + wrong.map(function (w) { return "<span>" + w.replace(/</g, "&lt;") + "</span>"; }).join(" ") + "</p>" : "") +
      '<p><button type="button" class="btn btn-primary" id="tt-again">Try again</button></p>';
    $("tt-again").addEventListener("click", reset);
    $("tt-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function reset() {
    clearInterval(timer); raw = ""; keys = 0; started = 0; done = false;
    ta.value = ""; ta.readOnly = false; $("tt-result").innerHTML = ""; $("tt-live").textContent = "";
    box.setAttribute("data-lang", lang);
    ta.setAttribute("lang", lang); view.setAttribute("lang", lang);
    $("tt-layout").hidden = lang !== "hi";
    clock(); paint(); ta.focus({ preventScroll: true });
  }

  // Hindi: keep the Kruti Dev keys, show Unicode
  ta.addEventListener("keydown", function (e) {
    if (lang !== "hi" || done || e.ctrlKey || e.metaKey) return;
    if (e.key === "Backspace") { e.preventDefault(); raw = raw.slice(0, -1); ta.value = typed(); paint(); return; }
    if (e.key === "Enter") { e.preventDefault(); return; }
    if (e.key && e.key.length === 1 && !e.altKey) { e.preventDefault(); start(); raw += e.key; keys++; ta.value = typed(); paint(); }
  });
  ta.addEventListener("beforeinput", function (e) {
    if (done) { e.preventDefault(); return; }
    if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") { e.preventDefault(); return; }
    if (lang !== "hi") return;
    // characters that did not come through keydown (Alt codes, on-screen keyboards)
    e.preventDefault();
    if (e.inputType === "insertText" && e.data) { start(); raw += e.data; keys += e.data.length; }
    else if (e.inputType === "deleteContentBackward") raw = raw.slice(0, -1);
    ta.value = typed(); paint();
  });
  ta.addEventListener("input", function () { if (lang !== "hi" && !done) { start(); paint(); } });
  ta.addEventListener("paste", function (e) { e.preventDefault(); });

  // English keystrokes: count every character key
  ta.addEventListener("keydown", function (e) { if (lang === "en" && !done && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) keys++; }, true);

  $("tt-lang").addEventListener("change", function () { lang = this.value; passage = 0; fill($("tt-pass"), list().map(function (p, i) { return (i + 1) + ". " + p.title; }), 0); reset(); });
  $("tt-pass").addEventListener("change", function () { passage = +this.value; reset(); });
  $("tt-min").addEventListener("change", function () { minutes = +this.value; reset(); });
  $("tt-restart").addEventListener("click", reset);
  $("tt-finish").addEventListener("click", function () { if (started) finish(); });

  fill($("tt-pass"), list().map(function (p, i) { return (i + 1) + ". " + p.title; }), 0);
  reset();
})();
