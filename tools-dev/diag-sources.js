// Diagnose why official sources fail from the runner: DNS, TCP, TLS or HTTP. Writes data/diag-sources.json.
const fs = require("fs"), tls = require("tls"), dns = require("dns").promises;
const src = JSON.parse(fs.readFileSync("data/sources-official.json", "utf8")).sources;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
function tlsProbe(host) {
  return new Promise((res) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const c = s.getPeerCertificate(true);
      res({ ok: s.authorized, err: s.authorizationError ? String(s.authorizationError) : null, issuer: c && c.issuer && c.issuer.CN, proto: s.getProtocol() }); s.end();
    });
    s.on("error", (e) => res({ ok: false, err: e.code || e.message }));
    s.on("timeout", () => { res({ ok: false, err: "TCP/TLS timeout" }); s.destroy(); });
  });
}
(async () => {
  const out = {};
  await Promise.all(src.map(async (s) => {
    const host = new URL(s.url).host, r = { host };
    try { r.ip = (await dns.lookup(host)).address; } catch (e) { r.dns = e.code; out[s.id] = r; return; }
    r.tls = await tlsProbe(host);
    try { const f = await fetch(s.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) }); r.http = f.status; }
    catch (e) { r.fetch = (e.cause && (e.cause.code || e.cause.message)) || e.message; }
    out[s.id] = r;
  }));
  fs.writeFileSync("data/diag-sources.json", JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(out));
})();
