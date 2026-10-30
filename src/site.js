// Homepage search over every open job and recent result / admit card / answer key.
// The page itself lists only the newest jobs; /search.json (built with the site) is fetched on first use.
(function () {
  var q = document.getElementById("q");
  if (!q || !window.fetch) return;
  var box = document.getElementById("results"), list = document.getElementById("home-list");
  var count = document.getElementById("count"), empty = document.getElementById("empty"), lh = document.getElementById("list-h");
  var total = count ? count.getAttribute("data-total") : "", loading = null, timer = 0;
  function load() {
    if (!loading) loading = fetch("/search.json").then(function (r) { return r.json(); }).then(function (d) {
      function hay(x, extra) { x._h = (x.t + " " + x.o + " " + (x.p || "") + " " + (x.q || []).join(" ") + " " + (extra || "")).toLowerCase(); }
      d.jobs.forEach(function (x) { hay(x); }); d.updates.forEach(function (x) { hay(x, x.y); });
      return d;
    }).catch(function () { loading = null; return null; });
    return loading;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function jobCard(j) {
    return '<li><a class="job" href="/jobs/' + esc(j.i) + '/"><div class="job-top"><span class="org-tag">' + esc(j.o) + "</span>" +
      (j.q || []).map(function (x) { return '<span class="qual-tag">' + esc(x) + "</span>"; }).join("") +
      (j.n ? '<span class="new-badge">NEW</span>' : "") + '<span class="status ' + esc(j.s) + '">' + esc(j.l) + "</span></div>" +
      "<h2>" + esc(j.t) + "</h2>" + (j.p ? '<p class="post">' + esc(j.p) + "</p>" : "") + '<div class="meta">' +
      (j.v ? '<span class="stat"><span class="n">' + j.v.toLocaleString("en-IN") + '</span><span class="l">Posts</span></span>' : "") +
      (j.a ? '<span class="stat"><span class="n">' + esc(j.a) + '</span><span class="l">Age</span></span>' : "") +
      (j.d ? '<span class="deadline' + (j.s === "soon" ? " soon" : "") + '">' + (j.s === "closed" ? "Closed on" : "Last date") + " <b>" + esc(j.d) + "</b></span>" : "") +
      "</div></a></li>";
  }
  function updCard(u) {
    return '<li><a class="update" href="/updates/' + esc(u.i) + '/"><span class="upd-type upd-' + esc(u.c) + '">' + esc(u.y) + "</span>" +
      '<span class="upd-title">' + esc(u.t) + '</span><span class="upd-meta">' + esc(u.o) + (u.d ? " &middot; " + esc(u.d) : "") + "</span></a></li>";
  }
  function sections(searching) {
    var c = document.getElementById("closing-sec"); if (c) c.style.display = searching ? "none" : "";
    [".stats", ".glance", ".tagrow", ".chips", ".edu-browse", ".home-updates", ".home-news", ".home-guides", ".home-about", ".state-browse", ".home-tools"].forEach(function (sel) {
      var el = document.querySelector(sel); if (el) el.style.display = searching ? "none" : "";
    });
    if (lh) lh.textContent = searching ? "Search results" : "Latest government jobs";
  }
  function run() {
    var term = q.value.trim().toLowerCase();
    sections(!!term);
    if (!term) {
      box.hidden = true; box.innerHTML = ""; if (list) list.hidden = false; if (empty) empty.hidden = true;
      if (count) count.textContent = total + " open jobs"; return;
    }
    if (count) count.textContent = "Searching…";
    load().then(function (d) {
      if (!d || q.value.trim().toLowerCase() !== term) return;
      var words = term.split(/\s+/);
      function hit(x) { for (var k = 0; k < words.length; k++) if (x._h.indexOf(words[k]) === -1) return false; return true; }
      var jobs = d.jobs.filter(hit), ups = d.updates.filter(hit);
      var html = "";
      if (jobs.length) html += '<ul class="jobs">' + jobs.slice(0, 40).map(jobCard).join("") + "</ul>";
      if (ups.length) html += '<h2 class="section-h">Results, admit cards &amp; answer keys</h2><ul class="updates">' + ups.slice(0, 20).map(updCard).join("") + "</ul>";
      box.innerHTML = html; box.hidden = !html; if (list) list.hidden = true;
      if (empty) empty.hidden = !!html;
      if (count) count.textContent = jobs.length + (jobs.length === 1 ? " job" : " jobs") + (ups.length ? " and " + ups.length + " result/admit card updates" : "") + " found";
    });
  }
  q.addEventListener("focus", load);
  q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(run, 120); });
  var m = location.search.match(/[?&]q=([^&]+)/);   // WebSite SearchAction target: /?q=term
  if (m) { q.value = decodeURIComponent(m[1].replace(/\+/g, " ")); run(); }
})();

// Cookie consent banner (privacy / AdSense friendliness). Uses localStorage on the live site.
(function () {
  try { if (localStorage.getItem("nv_cookie_ok")) return; } catch (e) {}
  var bar = document.createElement("div");
  bar.className = "cookiebar";
  bar.innerHTML =
    '<p>Cookies help us run the site and show ads. <a href="/privacy-policy/">Privacy policy</a></p>' +
    '<button type="button" class="cookie-ok">OK</button>';
  document.body.appendChild(bar);
  bar.querySelector(".cookie-ok").addEventListener("click", function () {
    try { localStorage.setItem("nv_cookie_ok", "1"); } catch (e) {}
    bar.remove();
  });
})();

// PWA: service worker + install prompt
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js"); });
}
(function () {
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferred = e;
    if (document.querySelector(".install-btn")) return;
    var b = document.createElement("button");
    b.className = "install-btn"; b.type = "button";
    b.innerHTML = "&#128241; Install app";
    b.addEventListener("click", function () {
      b.remove(); if (deferred) { deferred.prompt(); deferred = null; }
    });
    document.body.appendChild(b);
  });
  window.addEventListener("appinstalled", function () {
    var b = document.querySelector(".install-btn"); if (b) b.remove();
  });
})();


// Mobile menu toggle (overlay panel)
(function () {
  var btn = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (!btn || !nav) return;
  function setOpen(open) {
    nav.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  btn.addEventListener("click", function () { setOpen(!nav.classList.contains("open")); });
  // Close when a menu link is tapped
  nav.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", function () { setOpen(false); });
  });
  // Close when tapping outside the menu
  document.addEventListener("click", function (e) {
    if (nav.classList.contains("open") && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
})();

/* Freshness self-check: phones restore old tabs from memory and caches can hold an old copy.
   Whenever the page is shown or brought back to the screen, ask the server (bypassing every cache)
   which build is live; if it is newer than this page, reload once. */
(function () {
  var meta = document.querySelector('meta[name="nv-build"]');
  if (!meta || !window.fetch) return;
  var mine = meta.getAttribute("content"), last = 0;
  function check() {
    var now = Date.now();
    if (now - last < 60000 || document.visibilityState === "hidden") return;
    last = now;
    fetch("/version.json?t=" + now, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) {
        if (!v || !v.build || v.build === mine) return;
        try { if (sessionStorage.getItem("nv-reloaded") === v.build) return; sessionStorage.setItem("nv-reloaded", v.build); } catch (e) { /* private mode */ }
        location.reload();
      })
      .catch(function () { /* offline: keep showing what we have */ });
  }
  window.addEventListener("pageshow", check);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
  setInterval(check, 10 * 60000);
})();
