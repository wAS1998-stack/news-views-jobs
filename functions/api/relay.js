/**
 * /api/relay?url=<official page or PDF>
 *
 * Many Indian government recruitment sites refuse connections from outside India, which is where the
 * site's GitHub runners are. This Cloudflare Pages Function fetches the page from Cloudflare's network
 * instead, so official notices can be read at the source.
 *
 * Deliberately narrow: GET only, government hosts only (checked again on every redirect), streamed
 * through without being stored, never indexed. /api/relay?trace=1 reports where the function ran.
 */
const EXTRA_HOSTS = ["ibps.in", "nta.ac.in", "opportunities.rbi.org.in", "rbi.org.in", "aiimsexams.ac.in", "westbengalssc.com", "tgprb.in", "ncs.gov.in"];
const allowed = (host) => {
  host = String(host || "").toLowerCase().replace(/\.$/, "");
  return /\.(gov|nic)\.in$/.test(host) || EXTRA_HOSTS.some((h) => host === h || host.endsWith("." + h));
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_BYTES = 15e6;

const reply = (status, text, extra = {}) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...extra } });

export async function onRequestGet({ request }) {
  const params = new URL(request.url).searchParams;
  const colo = (request.cf && request.cf.colo) || "";

  if (params.get("trace")) {
    const out = { colo, country: request.cf && request.cf.country };
    for (const [k, u] of [["cloudflare", "https://www.cloudflare.com/cdn-cgi/trace"], ["ipinfo", "https://ipinfo.io/json"]]) {
      try { const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) }); out[k] = (await r.text()).slice(0, 600); }
      catch (e) { out[k] = "error: " + e.message; }
    }
    return reply(200, JSON.stringify(out, null, 1), { "content-type": "application/json" });
  }

  let target;
  try { target = new URL(params.get("url") || ""); } catch { return reply(400, "url parameter missing or invalid"); }
  for (let hop = 0; hop <= 5; hop++) {
    if (!/^https?:$/.test(target.protocol) || target.port && !["80", "443"].includes(target.port)) return reply(400, "only plain http(s) URLs");
    if (!allowed(target.hostname)) return reply(403, "host not allowed: " + target.hostname);
    let r;
    try {
      r = await fetch(target.toString(), {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(25000),
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8", "accept-language": "en-IN,en;q=0.9,hi;q=0.8" },
        cf: { cacheTtl: 120, cacheEverything: true },
      });
    } catch (e) {
      return reply(502, "upstream error: " + e.message, { "x-relay-colo": colo });
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      target = new URL(r.headers.get("location"), target);
      continue;
    }
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return reply(413, "too large", { "x-relay-colo": colo });
    return new Response(r.body, {
      status: r.status,
      headers: {
        "content-type": r.headers.get("content-type") || "application/octet-stream",
        "x-relay-final-url": target.toString(), "x-relay-colo": colo,
        "cache-control": "no-store", "x-robots-tag": "noindex",
      },
    });
  }
  return reply(508, "too many redirects");
}

