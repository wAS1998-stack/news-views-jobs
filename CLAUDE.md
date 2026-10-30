# CLAUDE.md — News-Views (news-views.in + Android app)

Read this first in every session. The owner has given **full hands-off approval**: make changes, commit and push to
`main` without asking. The goal is traffic (target: 2 million visits/month) and, from now on, ad revenue — without
hurting users or breaking Google's policies.

## What this repo is
- **news-views.in** — an Indian government-jobs (sarkari naukri) site in English + Hindi. A static site, built by
  `node build.js` from `data/*.json` into `dist/`, and hosted on **Cloudflare Pages**, which builds and deploys every
  push to `main`.
- **Android app** (`android/`) — native Kotlin + Jetpack Compose. Package `in.newsviews.app`. Its "backend" is the
  same build: `build.js` writes a static JSON feed to `/app/v1/` (index.json, j/<id>.json, u/<id>.json).
- **Automation** — GitHub Actions fetch new notifications, enrich them with AI, rebuild and notify search engines,
  Telegram and app users, around the clock.

## Map of the code
| Path | What it does |
|---|---|
| `config.json` | The one settings file: site URL, feeds, caps, **ads** (`adsenseId`, `adsenseSlot`, `admob`, `appAds`), crawl switches |
| `build.js` | The whole site generator: pages, sitemaps, schema (JobPosting, NewsArticle), redirects, robots, app feed, ads.txt / app-ads.txt |
| `fetch-jobs.js`, `watch.js`, `lib.js` | Pull job/result notices from feeds and official sites; `classify()` sorts jobs vs results; `isDuplicate()` merges twins |
| `enrich-jobs.js`, `due.js`, `hindi.js` | AI enrichment (summaries, eligibility, Hindi) within daily cost caps |
| `push-notify.js` | Firebase topic alerts to the app after each build (topics `s-<state>`/`s-any`, `q-<level>`, `l-en`/`l-hi`, `results`) |
| `notify-search.js`, `indexnow.js`, `gsc.js`, `google.js` | IndexNow, Search Console data, Google APIs |
| `tools.js`, `krutidev.js`, `typingtest.js` | Tool pages (salary calculators, Kruti Dev converter, typing tests) |
| `functions/api/relay.js` | The only server code: a Pages Function that fetches .gov.in/.nic.in pages for the fetchers |
| `data/` | Source of truth: `jobs.json`, `updates.json`, `redirects.json` (retired IDs → 301), `watch-state.json`, run logs |
| `android/` | The app; `android/ci/last-build.txt` and `android/ci/screens/` hold the latest CI build result and emulator screenshots |
| `.github/workflows/` | `update-jobs.yml` (fetch → build → notify), `chain.yml` (scheduler that dispatches it every ~40 min), `android.yml` (app build + screenshots), `inspect.yml` (diagnostics) |

## Rules that matter
- **Never invent facts.** Every job detail must come from the notice or official site; when unsure, leave it out.
- **Never delete a page without a redirect.** Retired job IDs go in `data/redirects.json` and are never re-added.
- **Cloudflare Pages free plan = 500 builds/month.** Commits that don't change the site (app code, CLAUDE.md, data
  logs, docs) must include `[CF-Pages-Skip]` in the commit message. Batch site changes into few commits.
- **Crawl budget:** organisation pages with fewer than 3 listings are noindex (`minOrgIndex`); Hindi job/update detail
  pages are disallowed in robots.txt until `crawlHindiDetail` is set true. Don't undo these without a reason.
- **Ads must stay policy-safe:** label every ad "Advertisement", never place ads next to Apply/Download buttons, never
  incentivise clicks, keep the in-app full-screen ad capped (`appAds.every`, `appAds.gap`) and only on "back".
- Don't automate backlinks, spam communities, or post anywhere on the owner's behalf. Don't enter passwords or API
  keys anywhere and don't create accounts — the owner pastes secrets into GitHub himself.
- The site must state it is **not affiliated with the government** (it does: footer, About, app disclaimer).

## Ads (how they switch on)
- **Website (AdSense):** put the publisher ID in `config.json` → `adsenseId` ("ca-pub-…"). The build then adds the
  AdSense script, the verification meta tag and `ads.txt`. Optional `adsenseSlot` (an in-article ad unit ID) turns on
  the manual in-content units in `adSlot()`; otherwise AdSense Auto ads places them.
- **App (AdMob):** put `admob.appId` ("ca-app-pub-…~…") and `admob.banner`, `admob.inline`, `admob.interstitial`
  ("ca-app-pub-…/…") in `config.json`. Pushing that rebuilds the app (android.yml watches config.json) and the site
  writes `app-ads.txt`. Debug builds always use Google's test IDs. `appAds` switches reach installed apps through the
  feed within minutes (turn placements off, change caps, `bannerSize` "standard"/"large") with no app update.
- **More ad networks (bidding):** `admob.mediation` in `config.json` lists the networks whose AdMob mediation adapters are
  built into the app (meta, applovin, inmobi, liftoff, unity, mintegral, ironsource, dtexchange, moloco; also available:
  pangle, pubmatic, bigo, chartboost — versions in `android/app/build.gradle.kts`). The owner switches each on in
  AdMob › Mediation with that network's account; `admob.appAdsTxt` holds the extra app-ads.txt lines they ask for.
  The privacy policy lists the networks automatically. Website: `adsTxtExtra` (ads.txt lines) and `webAdsHead`
  (a partner's script, e.g. a header-bidding / Ad Manager partner) are ready for other web ad partners.
- Code: `android/app/src/main/java/com/newsviews/app/ads/Ads.kt` (consent via Google UMP, banners, interstitial).

## Working in Claude's cloud sandbox
- Maven/Google/Gradle repos are blocked, so the **app can only be built in GitHub Actions**: push, then read
  `android/ci/last-build.txt` (OK or the compiler errors) and look at `android/ci/screens/*.png`.
- GitHub GraphQL is blocked: use `gh api` REST (e.g. `gh api -X POST repos/OWNER/REPO/actions/workflows/X/dispatches -f ref=main`), not `gh workflow run`.
- Action logs can't be downloaded; workflows write what's needed into committed files (`data/last-run.json` etc.).
- `git pull --rebase` before pushing — the bots commit data every run.
- Test locally with `node build.js` (no network needed) and open files in `dist/`.

## Secrets (names only; the owner sets them in GitHub → Settings → Secrets → Actions)
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `JOBS_FEEDS`, app: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `GOOGLE_SERVICES_JSON`, `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Where things stand / what's next
- Google Jobs already sends clicks; manual "Request indexing" in Search Console is done daily by a scheduled task.
- App: built and verified in CI; waiting for the owner's Play Console upload (12 testers × 14 days for new personal
  accounts), Firebase secrets (instant alerts) and AdMob IDs. After the first Play upload, add the Play app-signing
  SHA-256 to `config.json` → `androidCertSha256` so news-views.in links open in the app.
- Ideas with the biggest upside: faster coverage of big notifications (SSC, RRB, IBPS, state PSCs), results/admit-card
  pages that rank, Hindi coverage once English pages are indexed, app retention through relevant alerts.
