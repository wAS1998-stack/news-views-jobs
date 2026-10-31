# India relay — one-time setup (about 10 minutes)

**Why:** UPSC, SSC, IBPS, the RRBs, the armed forces, most PSUs and most state commissions refuse every
connection from outside India. The site's fetchers run on GitHub's servers in the USA, so they can't read those
websites and the notices arrive late (through feeds) or not at all. This small AWS Lambda function in Mumbai
reads the official page for them. It only reads Indian government websites, only for callers that know the
secret, and stores nothing.

**Cost:** ₹0. It stays inside AWS Lambda's always-free allowance (1 million requests and 400,000 GB-seconds a
month; the watcher uses roughly a quarter of that). AWS asks for a card when you open an account.

## Steps

1. Sign in at <https://console.aws.amazon.com> (or create an account at aws.amazon.com).
2. Top-right region menu → choose **Asia Pacific (Mumbai) ap-south-1**. This matters: the function must run in India.
3. Search for **Lambda** → **Create function** → *Author from scratch*:
   - Function name: `india-relay`
   - Runtime: **Node.js 22.x** (or the newest Node.js offered)
   - Architecture: arm64
   - → **Create function**
4. **Code** tab: open `index.mjs`, delete the sample code, paste the whole of
   [`india-relay/index.mjs`](./index.mjs) from this repository → **Deploy**.
5. **Configuration → General configuration → Edit**: Memory **256 MB**, Timeout **40 sec** → Save.
6. **Configuration → Environment variables → Edit → Add**:
   Key `RELAY_TOKEN`, Value: a long random password (40+ letters and digits; never put it in this repository) → Save.
7. **Configuration → Function URL → Create function URL**: Auth type **NONE** → Save.
   Copy the URL it shows (`https://….lambda-url.ap-south-1.on.aws/`).
   Opening `<that URL>?trace=1` in a browser should say `unauthorized` — correct, it needs the secret.
8. GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**, twice:
   - `INDIA_RELAY_URL` = the Function URL
   - `INDIA_RELAY_TOKEN` = the same random password as `RELAY_TOKEN`
9. Optional safety net: AWS **Billing → Budgets → Create budget → Zero spend budget**, so AWS e-mails you if
   anything ever costs money.

That's all. The next "Update jobs" run uses it automatically.

## Checking it works

- GitHub → Actions → **Inspect Google index status** → Run workflow → mode `relay`. A minute later
  `data/relay-test.json` shows an `india` result for every official source (`indiaOk` counts the ones it reads).
- `data/last-run.json` → `watch` → `viaIndiaRelay` counts the sources read through it on the last run.

## Notes

- Allowed websites: every `*.in` host plus the central-government domains listed in `EXTRA_HOSTS` at the top of
  `index.mjs` (`lib.js` reads the same list). To allow another domain without editing the code, add an environment
  variable `EXTRA_HOSTS` in the Lambda (comma-separated, e.g. `example-psu.com,another.org`).
- After changing `index.mjs` in the repository, paste it into the Lambda again and press Deploy.
- New AWS accounts can run 10 copies of a function at once; the watcher reads 8 sites at a time, so it fits.
