# News-Views Android app

Native Kotlin + Jetpack Compose app for news-views.in. The website is its backend:

- `build.js` publishes `https://news-views.in/app/v1/index.json` (open jobs, recent results, filter lists) and
  `/app/v1/j/<id>.json`, `/app/v1/u/<id>.json` on every site build (static files on Cloudflare, no server).
- `push-notify.js` (in the "Update jobs" workflow) sends job alerts through Firebase Cloud Messaging to topics:
  `s-<state>`/`s-any`, `q-<level>` (every level the person qualifies for), `l-en`/`l-hi`, `results`.

Features: job list with search and state/qualification/closing-soon filters, results & admit cards, job and update
pages (facts, eligibility, how to apply, FAQ, official links in Custom Tabs), saved jobs with last-date reminders
(WorkManager, 2 days before and on the day), alerts by state + highest qualification + language, Hindi/English,
offline cache, news-views.in links open in the app.

Build: GitHub Actions `.github/workflows/android.yml` (needs no local SDK). Every push to `android/` builds the debug
APK (published to the `app-latest` release), a signed `.aab` when signing secrets exist, and emulator screenshots in
`android/ci/screens/`. Package: `in.newsviews.app` (debug: `in.newsviews.app.debug`).

Secrets (repo Settings → Secrets and variables → Actions):
- `GOOGLE_SERVICES_JSON` — contents of google-services.json from Firebase (Android app `in.newsviews.app`)
- `FIREBASE_SERVICE_ACCOUNT_JSON` — Firebase service-account key (Project settings → Service accounts), used by push-notify.js
- `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` (and optional `ANDROID_KEY_ALIAS`, default `upload`) — upload key
