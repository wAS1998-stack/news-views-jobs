// Lightweight homepage filter — no dependencies.
(function () {
  var q = document.getElementById("q");
  if (!q) return;
  var items = Array.prototype.slice.call(document.querySelectorAll("#list > li"));
  var count = document.getElementById("count");
  var empty = document.getElementById("empty");

  function tally(n) { if (count) count.textContent = n + (n === 1 ? " job listed" : " jobs listed"); }
  tally(items.length);

  q.addEventListener("input", function () {
    var term = q.value.trim().toLowerCase();
    var shown = 0;
    items.forEach(function (li) {
      var hay = li.querySelector(".job").getAttribute("data-text") || "";
      var match = !term || hay.indexOf(term) !== -1;
      li.hidden = !match;
      if (match) shown++;
    });
    tally(shown);
    if (empty) empty.hidden = shown !== 0;
  });
})();

// Cookie consent banner (privacy / AdSense friendliness). Uses localStorage on the live site.
(function () {
  try { if (localStorage.getItem("nv_cookie_ok")) return; } catch (e) {}
  var bar = document.createElement("div");
  bar.className = "cookiebar";
  bar.innerHTML =
    '<p>We use cookies to improve your experience and to show ads. By using this site you agree to our <a href="/privacy-policy/">Privacy Policy</a>.</p>' +
    '<button type="button" class="cookie-ok">Got it</button>';
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
