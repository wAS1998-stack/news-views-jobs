# News-Views — Government Jobs (automated)

A fast, clean, static jobs site. Same deploy pipeline as usfreetools
(**GitHub → Cloudflare Pages, auto-deploy on push**) with two extra pieces
so it can update itself: a build step and a scheduled fetcher.

What's built in (the "top 1%" foundation):
- **Google Jobs–ready structured data** — every job page emits a valid
  `JobPosting` block (with salary, validThrough, location, identifier) plus
  `BreadcrumbList`, so listings are eligible for the Google Jobs widget.
- **SEO landing pages** — auto-generated category pages by qualification
  (`/qualification/graduate/`) and by department (`/organization/ssc/`).
  These are what jobs sites actually rank on.
- **Internal linking** — related jobs, eligibility chips, breadcrumbs.
- **Feeds & crawling** — `sitemap.xml` (with lastmod), RSS `feed.xml`, robots.txt.
- **Polish** — favicon, app icons, web manifest, social share image (og.png),
  a 404 page, skip-link + visible focus (accessibility), and an
  application-window progress bar showing how much time is left to apply.
- All output was validated before shipping: valid HTML, valid JSON-LD, no
  broken internal links, no missing assets across every generated page.

```
data/jobs.json   ← the job database (one entry per job)
build.js         ← turns jobs.json into the full site (dist/)
fetch-jobs.js    ← pulls new jobs from a Google Sheet (the automation)
src/             ← styles.css, site.js, favicon, icons, og image, manifest
.github/workflows/update-jobs.yml  ← runs the fetcher on a schedule
```

Build locally any time to preview:
```
npm run build        # writes the site into dist/
# open dist/index.html in a browser
```

---

## 1. One thing to set first

Open **build.js**, top of the file, and set your real address:

```js
const SITE = { url: "https://news-views.in", ... };
```

- Putting jobs on the **main domain**? Keep `https://news-views.in`.
- Keeping your current Hostinger site and adding jobs on a **subdomain**?
  Use `https://jobs.news-views.in` instead. (Subdomain is the safe way to
  start — your existing site stays untouched.)

---

## 2. Put it on GitHub (exactly like usfreetools)

1. Create a new repo on github.com (e.g. `news-views-jobs`), Public is fine.
2. In your unzipped folder:
   ```
   git init
   git add .
   git commit -m "jobs site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/news-views-jobs.git
   git push -u origin main
   ```
   (`index.html` doesn't sit at the root here — that's fine, Cloudflare builds it.)

---

## 3. Connect Cloudflare Pages

Same as before, but the build settings are **different from usfreetools** because
this site has a build step. Get them exactly right — wrong settings here is the
#1 reason a deploy fails.

- Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**
- Pick your `news-views-jobs` repo → **Begin setup**
- Set:

  | Field | Value |
  |---|---|
  | Framework preset | **None** |
  | Build command | **`node build.js`** |
  | Build output directory | **`dist`** |
  | Production branch | `main` |

- **Save and Deploy.** ~1 minute later you get a live `…pages.dev` URL. Open it.

---

## 4. Point your domain

- In your Pages project → **Custom domains** → add `news-views.in`
  (or `jobs.news-views.in`) and follow the DNS instructions it shows.
- If the domain currently runs your Hostinger site and you want jobs on a
  subdomain, just add `jobs.news-views.in` — Hostinger keeps serving the rest.

---

## 5. Jobs post themselves (no manual entry)

The automation lives in `fetch-jobs.js` and runs 3×/day via GitHub Actions.
It reads RSS feeds you set **once**, finds notifications it hasn't seen,
and publishes them — then Cloudflare redeploys. You don't touch anything.

**One-time setup:**
1. Open `data/sources.json` and add your feed URL(s):
   ```json
   { "feeds": ["https://example-source.com/jobs/feed"] }
   ```
   Use **official or authorised** sources. Re-publishing another site's
   articles word-for-word is a copyright problem and Google treats duplicate
   content as low value — so point it at official notification feeds, not a
   competitor's blog.
2. **Recommended — rich pages instead of thin ones:** add a repo secret
   `OPENAI_API_KEY` (GitHub → Settings → Secrets → Actions). When present,
   the fetcher reads each notification and auto-fills vacancies, dates,
   eligibility, fee, salary, how-to-apply and a summary. Without it, jobs still
   publish using just the feed's title + summary (thinner). It uses
   **GPT-4.1 Nano** by default (override with `OPENAI_MODEL`) — extraction is
   tiny, so the cost is roughly **₹10–30/month** even at a steady daily volume.
   (An `ANTHROPIC_API_KEY` works too if you prefer Claude; the fetcher
   auto-detects whichever key you set.)

That's the whole setup. After it, the site runs itself.

**Controls (optional env / secrets):**
- `MAX_NEW` — max new jobs added per run (default 8), keeps volume sane.
- `JOBS_FEEDS` — comma-separated feeds, an alternative to `sources.json`.

**Manual still works too:** you can always edit `data/jobs.json` by hand and
push — useful for a featured job or a correction.

### Honest note on "fully automatic + AdSense"
Auto-published listings with no human review are what AdSense scrutinises most,
and Google penalises mass low-value pages. Three things keep you on the right
side: (1) the AI-filled pages are substantial, not thin; (2) your **guides** add
real original content; (3) keep `MAX_NEW` modest so you publish a steady trickle,
not a daily flood. Apply for AdSense once you have a few weeks live, ~15–25 job
pages and 5–8 guides.

---

## Keep it within the free tier

- Cloudflare Pages free = **500 builds/month (~16/day)**. The schedule above uses
  3, so you have lots of headroom. If you later add more triggers, batch jobs
  into a single push rather than one push per job.
- Everything here — GitHub, Cloudflare Pages, the Google Sheet — is **₹0**.

## Staying out of "thin content" trouble

Jobs are safe to fully automate **because the data is the value** — real
vacancies, dates and eligibility that people need. Keep these habits:
- One job = one real listing. Don't generate near-duplicate pages.
- Fill `summary` and `how_to_apply` with specific, useful detail.
- Always link the official notification. Never invent dates or numbers.

---

## Content, AdSense & "not thin" — read this

Each job page is now a **full ~600-word page**, not a bare table: an Overview,
Recruitment details, Eligibility, Selection process, Salary & benefits, How to
apply, and an **8-question FAQ** (with `FAQPage` schema). That depth is what
keeps pages out of "thin content" territory and gives AdSense something real to
approve.

The site also ships the pages AdSense **requires** before it will approve you —
all generated automatically and linked in the footer:
`/about/`, `/contact/`, `/privacy-policy/` (includes the Google/AdSense cookie
disclosure), `/disclaimer/`, `/terms/`.

### Guides = your original-content layer
`content/guides/*.md` are full markdown articles (with `Article` schema). A
sample is included. **These should be genuinely useful and human-quality** —
they are what tip an AdSense review from "aggregator" to "real publisher", and
what rank for long-tail searches like "how to prepare for SSC CGL". Write a row
of facts in the sheet; write guides with care.

### The honest part about full automation
You can automate the *data* (job pages) safely because the facts are the value.
You should **not** mass-auto-generate hundreds of "articles" — Google's
scaled-content policy and AdSense both penalise that. The realistic top-1% model:
- Job pages: fully automated from the sheet. ✅
- Policy/about pages: automated. ✅
- Guides: a handful of strong, reviewed articles — quality over quantity.
- Then apply for AdSense once you have ~15–25 real job pages, 5–8 guides, steady
  traffic, and the site has been live a few weeks.

### Add AdSense later
When approved, paste your AdSense `<script>` once into the `head()` function in
`build.js` (just before `</head>`) and it appears site-wide on the next build.
