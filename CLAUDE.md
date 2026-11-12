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
  The index carries short list titles (`tc`/`thc`, from `shortTitle()`), categories (`c`, from `APP_CATS`, sent as
  `cats` so chips can change without an app update), walk-in flag `w`, Hindi post names `ph`, the last 14 daily quizzes
  (`quizzes`; questions in `/app/v1/q/<id>.json`, from data/quiz.json) and the `ads` switches. Fields are additive:
  never rename or remove one (old app versions read it); bump `APP_API` only for a breaking change.
- **Automation** — GitHub Actions fetch new notifications, enrich them with AI, rebuild and notify search engines,
  Telegram and app users, around the clock.

## Map of the code
| Path | What it does |
|---|---|
| `config.json` | The one settings file: site URL, feeds, caps, **ads** (`adsenseId`, `adsenseSlot`, `admob`, `appAds`), crawl switches |
| `build.js` | The whole site generator: pages, sitemaps, schema (JobPosting, NewsArticle), redirects, robots, app feed, ads.txt / app-ads.txt |
| `fetch-jobs.js`, `watch.js`, `lib.js` | Pull job/result notices from feeds and official sites; `classify()` sorts jobs vs results; `isDuplicate()` merges twins |
| `enrich-jobs.js`, `due.js`, `hindi.js` | AI enrichment (summaries, eligibility, Hindi) within daily cost caps |
| `push-notify.js` | Firebase topic alerts to the app after each build (topics `s-central` for central/all-India jobs — the app's "Central Government" choice, on by default — `s-<state>`/`s-any`, `q-<level>`, `l-en`/`l-hi`, `results`, `o-<department>` for followers — same slug rule in the app's `orgSlug` — and `digest`, one evening summary per state a day. Budgets are per audience: ≤2 jobs per state per build, ≤4 per state and ≤5 central per IST day, "All states" phones (`s-any`) the biggest ≤2 per build / ≤4 per day of the state jobs (`ja:<id>` in pushed.json; until 12 Nov every state job carried the s-any clause and default phones got 53–96 alerts a day), results 3/6, followers results-first ≤5 per department a day; headline-only jobs (`L.factless`) wait until their notice is read; "Result declared" only from the English headline; quiet hours 22:00–07:00 IST, unsent items stay eligible for a day) |
| `notify-search.js`, `indexnow.js`, `gsc.js`, `google.js` | IndexNow, Search Console data, Google APIs |
| `districts.js` | District → state table and state-government web addresses, used by `statesOf()` (build.js) only where a job would otherwise fall into All India / Central (that bucket feeds the default-on `s-central` alert). Central bodies (`CENTRAL_BODY`) and national banks never use it. Leave out names shared by two states or that are common words; `test/districts.test.js` checks |
| `tools.js`, `krutidev.js`, `typingtest.js` | Tool pages (salary calculators, Kruti Dev converter, typing tests) |
| `functions/api/relay.js` | The only server code: a Pages Function that fetches .gov.in/.nic.in pages for the fetchers. Optional `RELAY_KEY` (Cloudflare Pages env var + GitHub secret, same value): then it answers only requests with that `x-relay-key` header, which lib.js/apply-links.js send to the site's own relay only |
| `data/` | Source of truth: the jobs (`data/jobs/<YYYY-MM>/<YYYY-MM-DD>.json`, one file per day of publication, one record per line — read and written ONLY through `L.loadJobs()` / `L.saveJobs()`), `updates.json`, `redirects.json` (retired IDs → 301), `watch-state.json`, run logs |
| `android/` | The app; `android/ci/last-build.txt` and `android/ci/screens/` hold the latest CI build result and emulator screenshots |
| `.github/workflows/` | `update-jobs.yml` (fetch → build → notify), `chain.yml` (scheduler that dispatches it every ~40 min), `android.yml` (app build + screenshots), `inspect.yml` (diagnostics) |

## Rules that matter
- **Never invent facts.** Every job detail must come from the notice or official site; when unsure, leave it out.
- **Government employers only** (central/state/local government, PSUs, statutory bodies, government-funded
  institutions). `L.NON_GOVT`/`L.isNonGovt` (lib.js) blocks private universities, private-sector and urban co-op banks,
  companies/contractors ("Pvt Ltd", "M/s."), private school chains and NGOs — in fetch-jobs.js and watch.js (headline
  and again after extraction) and in build.js on load. Admission entrance tests are `OFF_TOPIC`. Grey areas kept on
  purpose: Army Public Schools, cooperatives under state cooperative departments (IFFCO, DCCBs, milk unions). 47
  private listings were retired with redirects on 31 Oct. The app shows no Gulf/overseas jobs (private); the website's
  Gulf section says they are private and is noindex (and out of the sitemap) while it has no live job.
- **The Apply button must say what it opens** (`lib.js` `applyInfo`/`linkKind`/`applyMode`, rendered by `ctaHtml`/`keyFacts` in
  build.js, `cta`/`cta_url` in the app feed): "Apply online" only for a real application page or portal; offline jobs get
  "Download notice & form", walk-ins "Walk-in notice", a bare homepage "Official website" with a hint. `apply-links.js`
  (runs after watch.js) upgrades homepage links to the real application page found in the official notice or site —
  strictly (tied to this post, never admissions/exam/result pages, AI-confirmed; its first loose version was wrong
  most of the time) — and stores the organisation's Recruitment/Careers page as `careers_link` ("Official
  recruitment page" button) when only the homepage is known.
- **Every record goes through `L.sanitizeJob` / `L.aiJobFields`** (lib.js): AI output is never stored as-is (it once put
  objects into fee/salary and showed "[object Object]" on 110 pages). Only whitelisted fields, objects → "Key: value"
  text, numbers, YYYY-MM-DD dates, http(s) links. build.js applies the same on load. Dates are Indian dates (`L.todayIST`).
  `L.stripTags` decodes Cloudflare-hidden e-mail addresses (`data-cfemail`); older text that says "[email protected]"
  is rewritten by `sanitizeJob` to point at the official notice (it was showing on 55 job pages).
- **When the AI refuses calls** (no credit, an outage — it happened on 11 Nov: every OpenAI call answered 429 for a day
  and nobody saw it): `askAI` logs the provider's reason (`insufficient_quota`, `rate_limit_exceeded`), stops asking for
  the rest of that step when the account has no credit, and every section of `data/last-run.json` carries `aiStatus`
  ("ok (12 calls)" / "OpenAI refused: insufficient_quota") — read it first when pages look thin. Calls that read a new
  notice (`essential`) go to the second provider when both keys are set (`"aiFallback": false` in config.json switches
  that off; its use is metered under `fallback` in `data/ai-usage.json`). Jobs listed meanwhile are headline-only
  (`L.factless`): no JobPosting (the employer name is a guess), the stand-in steps `L.GENERIC_STEPS` (true for every way
  of applying — never "register online" on a walk-in), and `enrich-jobs.js` pass 0 reads their notice again, newest
  first (`maxFactsPerRun`, default 40; 3 empty readings at most) with the checks a new notice gets: a twin of a listing
  that was there first (same last date or none) is merged into it and redirected (`L.mergeTwin`, `L.addRedirects`), a
  private employer is flagged and never announced, and only the "1–31 January" template date is dropped (a real past
  date shows the job as closed). A reading that failed because the AI did not answer (refused, timed out) is never a
  try and never a mark: watch.js keeps the notice queued, apply-links.js skips the job, a thin update stays due, and
  fetch-jobs.js takes no twin / taken-id decision without the facts (the item is read again next run).
- **One brand name: News-Views.in** (alternates "News-Views", "NewsViews"). The homepage title starts with it, and the
  header, `og:site_name` and the Organization + WebSite JSON-LD (`orgLd()`/`websiteLd()` in build.js, also on /about/)
  all use it — change it everywhere or nowhere. `sameAs` lists only real profiles (Telegram once it works; add the Play
  listing and any official social profiles the owner creates). Background: the domain hosted a general news blog in
  2010–2014 and old Facebook pages called "News - Views" still describe that, so Google's AI Overview mixed the two up.
- A last date before publication is either a closed notice (skip it) or the extraction template "1–31 January" (drop the
  dates). Closed jobs never show an Apply button, are never pushed or posted to Telegram.
- **Never delete a page without a redirect.** Retired job IDs go in `data/redirects.json` and are never re-added.
  `_redirects` is written by `orderRedirects()` (build.js): plain rules first, wildcard rules ("/author/*") LAST —
  Cloudflare counts every rule after the first wildcard as "dynamic" and stops after 100 (on Nov 11 two wildcard rules
  at line 171 had silently switched off the 380 rules below them; retired pages answered 404).
  Retiring a record = add the English AND Hindi redirect AND remove it from the jobs store / updates.json (the build
  ignores a redirect while the page still exists; `L.addRedirects` writes them). The bot's commit step runs
  `L.dropRetired()` after its `rebase -X theirs`, which could bring a record retired by a concurrent push back (3
  retired updates had come back as live twins). Updates are never cut: the newest 800 stay in `data/updates.json`, older ones
  move to `data/updates-archive.json` via `L.saveUpdates` and their pages stay live.
- **IDs and twins:** ids keep stage numbers (`group-4`, `cbt-2`, roman → arabic; `node fetch-jobs.js --self-test`); an id
  taken by a different recruitment gets `distinctId`, never a silent drop; `legacySlug` only recognises old listings.
  Twin rules live in `lib.js` `isDuplicate`/`isDupUpdate` (shared by fetch and watch): a shared notice counts only if it
  is a PDF, of the same body family (one side bare: "RRB" vs "RRB Ahmedabad", never "AIIMS Patna" vs "AIIMS Bhopal"),
  with overlapping posts; updates also need the same type and stage. `tools-dev/dedupe.js` merges strict twins (dry run;
  `--write`). Items rejected after the AI read them are remembered 14 days in `data/fetch-skipped.json` (no repeat AI cost).
- **Cancelled/postponed recruitments:** a matching cancellation notice (same year, exactly one job) sets `notice_status`,
  `status_note`, `status_link`; the job stays live as a page with a red banner, loses JobPosting and its Apply button.
- **Sanitiser guards (`sanitizeJob`):** an age limit under 14 or over 70 is dropped (pay levels read as ages), a last
  date more than a year after publication is dropped, and an FAQ answer that guesses ("…so it is assumed to be free")
  keeps only its stated fact (`faqFacts`). The app feed carries only jobs with an official link of some kind (`ctaOf`;
  a job without one may use the same organisation's website from its other notices, `orgHomeOf`), and never passes an
  aggregator page as an update's `link`.
- **Filters:** `OFF_TOPIC` also rejects course allotment lists ("…Allotment List – Management Quota"), "programme … N
  seats" admissions and roundup articles ("… Recruitment Notifications List"), and board/professional exams (ICAI/CA/CS/CMA, NIOS, MSBTE, Madhyamik, class 6–12
  boards, JNVST) unless the headline has any recruitment word; speculative "expected/soon/release date" updates need an
  official PDF or deep link. `qualsOf` returns `[]` for unknown (any qualification; push routes it to `q-graduate`);
  "B.E."/capital "BE" only (the word "be" tagged 22 jobs Engineering), "Master" counts as a degree only in the
  qualification text (Branch Postmaster, Headmaster, Station Master are posts). State keywords in `statesOf` match whole
  words only ("Visakhapatnam" held "patna", "Lakhisarai" "hisar": 28 jobs had a wrong state). Two different official
  PDFs of one site with counts more than 5% apart are never twins (Orissa HC District Judge vs Civil Judge).
- **The jobs store is day files, not one file.** `data/jobs.json` (one pretty-printed array) had reached 37 MB in four
  weeks, +1.4 MB a day — GitHub refuses files over 100 MB, which would have stopped every push in late December 2026.
  `L.saveJobs()` writes `data/jobs/<month>/<day>.json` (about 1.3 MB each), touches only the days that changed, and
  refuses a list that would drop more than half of the store; `L.loadJobs()` returns all records, newest day first
  (and merges a leftover `data/jobs.json`). Never read or write these files directly. `data/updates-archive.json` is
  still one file (about 0.4 MB a day): split it the same way before it nears 50 MB.
- **Cloudflare Pages free plan = 500 builds/month.** Commits that don't change the site (app code, CLAUDE.md, data
  logs, docs) must include `[CF-Pages-Skip]` in the commit message. Batch site changes into few commits. Cloudflare
  reads only the LAST commit of a push: if a push carries site changes, its last commit must not have the skip flag
  (a skip-flagged last commit silently leaves the earlier site changes undeployed until the next unflagged push), and a
  push that changes only docs such as CLAUDE.md is not built either — the "Cloudflare Pages" check on the commit shows it.
- **File budget (Cloudflare Pages deploys at most 20,000 files; each job costs up to 4):** `fitToBudget()` in build.js
  estimates the build and, past `maxFiles` (config, default 20000 — set 100000 after upgrading the Cloudflare plan),
  leaves the longest-closed job pages and oldest update pages out of the BUILD, oldest first, never an open job
  (records stay in data/; their addresses get the "archived" page `/jobs/404.html` / `/updates/404.html`, status 404).
  Optional files are limited: share images only for the newest 700 open jobs + 200 updates (`ogMaxJobs`,
  `ogMaxUpdates`; also keeps the Cloudflare build well under its 20-minute limit), Hindi job pages only while a job is
  open and `hiClosedDays` (7) after (`hasHiPage`; later `/hi/jobs/404.html` forwards to the English page — link a
  Hindi job page only through `hasHiPage`). Pages left out on purpose never become `_redirects` rules. The build must
  never throw for size (update-jobs.yml discards a run's data when the build fails). `version.json` reports `files`.
- **Crawl budget:** organisation pages with fewer than 3 listings are noindex (`minOrgIndex`); Hindi job/update detail
  pages are disallowed in robots.txt until `crawlHindiDetail` is set true. Don't undo these without a reason. AI
  "-explained" analysis twins are off (`maxAnalysisPerRun` 0); existing ones are noindex with a self canonical (never
  noindex + a cross-page canonical) and out of all sitemaps. Indexing API: `ping-google.js` keeps
  `data/indexing-state.json` (200 a day counted on Google's clock — midnight Pacific, `_day.tz: "PT"`; counted per IST day it stalled ~20 h after each 429 — new → changed incl. cancellations → backlog → deleted; `--plan`; headline-only jobs are not sent).
- **Ads must stay policy-safe:** label every ad "Advertisement", never place ads next to Apply/Download buttons, never
  incentivise clicks, keep the in-app full-screen ad capped (`appAds.every`, `appAds.gap`) and only on "back"; the
  app-open ad only on returning after ≥15 min away (`appOpenAway`), ≤1 per 4 h (`appOpenGap`), never on a cold start, the
  first day, or a notification/link open, and only if already loaded. Keep the banner ≥12 dp off the tab bar and the
  in-page unit's height reserved (no layout jumps). The rewarded video is opt-in only (the "Sarkari Radar Pass": one short video → no ads + preparation tips open for N hours).
  Only bonus content (preparation tips) may sit behind the pass — never the notice, apply links, eligibility or dates —
  and it is shown freely whenever no rewarded ad is configured.
- Don't automate backlinks, spam communities, or post anywhere on the owner's behalf. Don't enter passwords or API
  keys anywhere and don't create accounts — the owner pastes secrets into GitHub himself.
- The site must state it is **not affiliated with the government** (it does: footer, About, app disclaimer).

## Ads (how they switch on)
- **Website (AdSense):** put the publisher ID in `config.json` → `adsenseId` ("ca-pub-…"). The build then adds the
  AdSense script, the verification meta tag and `ads.txt`. Optional `adsenseSlot` (an in-article ad unit ID) turns on
  the manual in-content units in `adSlot()`; otherwise AdSense Auto ads places them.
- **App (AdMob):** put `admob.appId` ("ca-app-pub-…~…") and `admob.banner`, `admob.inline`, `admob.interstitial`,
  `admob.rewarded` ("ca-app-pub-…/…"; the rewarded unit's reward item/amount in AdMob doesn't matter, the app grants the
  pass itself) in `config.json`. Pushing that rebuilds the app (android.yml watches config.json) and the site
  writes `app-ads.txt`. Debug builds always use Google's test IDs. `appAds` switches reach installed apps through the
  feed within minutes (turn placements off, change caps, `bannerSize` "standard"/"large", `rewarded` on/off and
  `rewardHours` for the ad-free pass, `native` for the ad card in the lists, `pro`/`proProduct` for the one-time "Pro"
  purchase through Play Billing — create the product in Play Console first, then set `pro` true) with no app update.
  `admob.native` is the native ad unit. `playUrl` (config.json) makes /app/ and the app's share links point to Play.
  Firebase Analytics (screen views, link opens, pass/pro events) and Crashlytics are built in when
  GOOGLE_SERVICES_JSON exists; the privacy policy and store listing mention them. Link AdMob to Firebase (AdMob ›
  App settings › Link to Firebase) so ad revenue per user (`ad_impression`) is logged automatically — don't add manual
  ad-revenue events on top (double counting). Firebase Remote Config key `app_ads` (JSON, e.g. `{"every":3}`) overrides
  single `appAds` values per A/B-test group. `admob.appOpen` is the app-open unit. The pass defaults to 6 hours
  (`rewardHours`; 24 h gave away more ad revenue than one rewarded view earns). Rewarded video pays several times a banner's eCPM, and the
  pass replaces a day of low-value impressions for people who would otherwise be annoyed away.
- **More ad networks (bidding):** `admob.mediation` in `config.json` lists the networks whose AdMob mediation adapters are
  built into the app (meta, applovin, inmobi, liftoff, unity, mintegral, ironsource, dtexchange, moloco; also available:
  pangle, pubmatic, bigo, chartboost — versions in `android/app/build.gradle.kts`). The owner switches each on in
  AdMob › Mediation with that network's account; `admob.appAdsTxt` holds the extra app-ads.txt lines they ask for.
  The privacy policy lists the networks automatically. Website: `adsTxtExtra` (ads.txt lines) and `webAdsHead`
  (a partner's script, e.g. a header-bidding / Ad Manager partner) are ready for other web ad partners.
- Code: `android/app/src/main/java/com/newsviews/app/ads/Ads.kt` (consent via Google UMP, banners, interstitial).
- Website ad keys (`adsenseSlots`, each falls back to `adsenseSlot`): `job-top`, `job-mid`, `job-end`, `update-mid`,
  `quiz-end`, `guide-inline`, `news-inline`, `list-inline`, `tool-result`. Rule: always at least one content block
  between an ad and any Apply/Download/Start/Calculate button. App: page natives alternate `detail-a`/`detail-b`; the
  interstitial page count and gap persist across restarts; ad requests carry the page URL where known.

## App feed and push (what old and new app versions read)
- Additive feed fields since Nov 6: index job `m` (apply mode), `ns` (cancelled|postponed); top-level `contact`,
  `minVersion` (config `appMinVersion`; above 0 shows older apps an "Update required" screen — use only for a breaking
  bug); detail `src_host`, `upd`, `notice_status`, `status_note`, `status_link`.
- Push topics added: `quiz` (daily quiz after 8 AM IST, follows the job-alert choice unless set) and `sv-<jobId>` (saved
  jobs: "New last date" when it moves; `en:<id>` in pushed.json). Every message has a TTL and collapse key; an item is
  marked sent only after a successful send; "Result declared" only when the headline says so.
- App strings added since Nov 6 live in `ui/MoreStrings.kt` (`Strings.x`). Search: `data/Search.kt` (typed words by
  word start; synonyms and two-word phrases exact via indexed word pairs).
- Store screenshots: `android/ci/screens/store-*.png` (no ads, English + `store-h*` Hindi; the job page is the
  biggest open job with a last date, an age limit and an apply page) from every Android CI run; `last-build.txt` ends
  with an "emulator crash:" line. **Play listing** (owner wants English only): text in `tools-dev/play-listing/text/en-IN/`
  (title 30, short 80, full 4000 chars; keep the government disclaimer + official source URLs, no "best/#1/free"),
  captions in `captions.json`; `node tools-dev/play-listing/play-listing.js --zip` renders the captioned 1080×1920
  screenshots and 1024×500 feature graphic (Chromium + Poppins) and writes the package with guides to
  `android/ci/play/Sarkari-Radar-Play-Listing/` (`--langs en-IN,hi-IN` adds Hindi).
- Content sourcing: `INDIA_RELAY_URL` secret / `indiaRelayUrl` config is tried first by the fetchers;
  `tools-dev/india-relay.js` is the server for an India-based host (the owner's cost decision). Tests: `npm test`
  (node:test, `test/*.test.js`, run by `.github/workflows/test.yml`).

## Working in Claude's cloud sandbox
- Maven/Google/Gradle repos are blocked, so the **app can only be built in GitHub Actions**: push, then read
  `android/ci/last-build.txt` (OK or the compiler errors) and look at `android/ci/screens/*.png`.
- GitHub GraphQL is blocked: use `gh api` REST (e.g. `gh api -X POST repos/OWNER/REPO/actions/workflows/X/dispatches -f ref=main`), not `gh workflow run`.
- Action logs can't be downloaded; workflows write what's needed into committed files (`data/last-run.json` etc.).
- `git pull --rebase` before pushing — the bots commit data every run.
- Test locally with `node build.js` (no network needed) and open files in `dist/`.
- **The live site cannot be reached from the sandbox.** Check it through Actions: dispatch `check-live.yml`
  (`gh api -X POST repos/OWNER/REPO/actions/workflows/check-live.yml/dispatches -f ref=main -F "inputs[full]=true"`),
  then read `data/live-report.json` (`tools-dev/live-check.js`: build stamp, core files, app feed, 404, redirects, ~55
  sitemap pages, headers, relay; `full` also requests every URL in `data/known-urls.json` — each must answer 200 or
  301, never 404). Run it after any change to redirects, robots, headers or the feed.

## Secrets (names only; the owner sets them in GitHub → Settings → Secrets → Actions)
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `JOBS_FEEDS`, app: `SARKARI_KEYSTORE_BASE64`, `SARKARI_KEYSTORE_PASSWORD`,
`SARKARI_KEY_ALIAS`, `SARKARI_KEY_PASSWORD` (upload key; `ANDROID_*` names are a fallback), `GOOGLE_SERVICES_JSON`,
`FIREBASE_SERVICE_ACCOUNT_JSON`. `android/ci/last-build.txt` line 2 says which signing secrets were seen.

## Where things stand / what's next
- **Final end-to-end check, Nov 11:** found and fixed four hidden problems that would each have stopped the site:
  380 retired URLs answering 404 (redirect rule order), the Cloudflare 20,000-file limit about two weeks away, the
  Cloudflare build at 14 of its 20 minutes (3,100 share images), and jobs.json on its way to GitHub's 100 MB limit.
  After a change to redirects/headers/feed, run the live check (`check-live.yml`, `full`). Capacity now: about
  11,000 files, growing ~180 a day (one page per job and per update, kept for ever) — the file budget starts archiving
  the oldest closed pages around the end of December 2026; a paid Cloudflare plan (100,000 files) plus
  `"maxFiles": 100000` keeps about five times more history (the owner's cost decision).
- **Only the owner can fix (Cloudflare dashboard):** `www.news-views.in` answers error 525 (make the `www` DNS record
  proxied and add Rules › Redirect Rules › "Redirect from WWW to root"); HSTS is off (SSL/TLS › Edge Certificates);
  the live robots.txt carries Cloudflare's managed block of AI-training crawlers (harmless for Google Search).
- Google Jobs already sends clicks; manual "Request indexing" in Search Console is done daily by a scheduled task.
- Brand search: the homepage is indexed (URL Inspection, Oct 30) but didn't rank for "news-views.in"; brand signals
  were added Oct 31. `data/gsc.json` → `brand` (searches for the site's own name, 90 days) and `home` track progress;
  run inspect.yml with mode `gsc` to refresh it on demand.
- App: built, verified and **signed with the owner's upload key** since build 36 (Nov 5); `sarkari-radar.aab` on the
  `app-latest` release is the Play upload. Firebase secrets are in (instant alerts on). Waiting for the owner's Play
  Console upload (12 testers × 14 days for new personal accounts) and the AdMob IDs (no ads in release until then). After the first Play upload, add the Play app-signing
  SHA-256 to `config.json` → `androidCertSha256` so news-views.in links open in the app.
- **OpenAI credit ran out on 11 Nov** (429 `credit_balance_exhausted` for 22 hours; the owner added $10 on 12 Nov and
  calls work again — `aiStatus` in `data/last-run.json`). Metered cost: about $0.20–0.25 a day in normal running
  (`data/ai-usage.json`), up to $0.91 a day while the backlog was written. Ask the owner to switch on auto-recharge at
  platform.openai.com → Billing. The headline-only jobs of that day (132) are read again 40 a run by enrich pass 0.
- **Multi-agent final check, 12 Nov** (8 areas, each finding re-checked): fixed the "All states" alert flood, the
  Indexing API clock, wrong states (substring matches) and qualification tags, 8 outage twins + 3 private + 1 closed
  listing retired, AI tips written into pages unescaped (now escaped), the broken Hindi-404 forwarder, Telegram
  failures stopping the notify steps, IndexNow resubmitting every URL, run-log dates, quiz quality checks
  (English only, no contradicted answers, answers spread over A–D), privacy-policy wording on Firebase user properties,
  JobPosting `INTERN` on PSU trainee posts, salary texts that one unit cannot describe (no baseSalary), the service
  worker caching eligibility.json, and the public test key in assetlinks. App fixes went into build 52+. Left for the
  owner: third-party actions in android.yml are pinned by tag (pin to commit SHAs), and set RELAY_KEY to close the relay.
- Ideas with the biggest upside: faster coverage of big notifications (SSC, RRB, IBPS, state PSCs), results/admit-card
  pages that rank, Hindi coverage once English pages are indexed, app retention through relevant alerts.
