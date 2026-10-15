/* google.js — service-account access tokens for Google APIs (zero deps).
   Uses the same GOOGLE_SERVICE_ACCOUNT_JSON secret as the Indexing API. */
const crypto = require("crypto");

function loadKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  if (!raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function getToken(scope, key = loadKey()) {
  if (!key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: key.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }))}`;
  const signer = crypto.createSign("RSA-SHA256"); signer.update(unsigned);
  const jwt = `${unsigned}.${b64url(signer.sign(key.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("token error: " + JSON.stringify(data));
  return data.access_token;
}
module.exports = { loadKey, getToken };
