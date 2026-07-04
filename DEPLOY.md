# Going Live — Step-by-Step Deploy Guide

Your site is a static site that builds itself. Hosting it is free and takes about
20 minutes. This is the exact path, start to finish.

---

## Step 0 — Decide: main domain or subdomain?

- **Main domain** (`news-views.in`): the jobs site becomes your homepage,
  replacing the current Hostinger site. Most SEO benefit, but your existing site
  is replaced.
- **Subdomain** (`jobs.news-views.in`): your current Hostinger homepage stays
  exactly as it is, and the jobs site lives alongside it. Safest way to start.

Open **build.js** and set `SITE.url` to match your choice:
```js
const SITE = { url: "https://news-views.in", ... }   // or "https://jobs.news-views.in"
```
(If you change your mind later, change this one line and rebuild.)

---

## Step 1 — Put the project on GitHub

1. Create a free account at github.com if you don't have one.
2. Create a new repository, e.g. `news-views-jobs` (Public is fine).
3. On your computer, inside the unzipped project folder:
   ```
   git init
   git add .
   git commit -m "news-views jobs site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/news-views-jobs.git
   git push -u origin main
   ```

---

## Step 2 — Connect Cloudflare Pages (free hosting)

1. Sign in at dash.cloudflare.com (free account).
2. **Workers & Pages → Create → Pages → Connect to Git.**
3. Select your `news-views-jobs` repo → **Begin setup.**
4. Set the build settings **exactly**:

   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | **`node build.js`** |
   | Build output directory | **`dist`** |
   | Production branch | `main` |

5. **Save and Deploy.** In ~1 minute you get a live `…pages.dev` link. Open it —
   your whole site (jobs, 30 guides, all pages) is live.

> Wrong build settings are the #1 reason a first deploy fails. Double-check
> command = `node build.js` and output = `dist`.

---

## Step 3 — Point your domain

In your Cloudflare Pages project → **Custom domains → Set up a custom domain.**

- **Main domain:** add `news-views.in` (and `www.news-views.in`).
- **Subdomain:** add `jobs.news-views.in`.

Cloudflare shows you the DNS records to add. Since your domain is on Hostinger:

1. Log in to Hostinger → your domain → **DNS / Nameservers**.
2. Add the record Cloudflare asks for (usually a **CNAME** for a subdomain
   pointing to your `…pages.dev` address, or the records Cloudflare specifies for
   the root domain).
3. Save. DNS can take anywhere from a few minutes to a few hours to take effect.

(For the main root domain, Cloudflare may ask you to move your nameservers to
Cloudflare — follow its on-screen instructions. For a subdomain, a simple CNAME
in Hostinger is usually enough.)

---

## Step 4 — Turn on the automation (jobs post themselves)

1. Edit **data/sources.json** and add your RSS feed URL(s):
   ```json
   { "feeds": ["https://your-official-source/feed"] }
   ```
   Use official / authorised sources only.
2. In your GitHub repo → **Settings → Secrets and variables → Actions → New
   repository secret**: add `OPENAI_API_KEY` with your OpenAI key (for rich,
   non-thin pages — costs roughly ₹10–30/month).
3. Commit and push. The scheduled action runs 3×/day and publishes new jobs
   automatically. You can also run it now: **Actions → Update jobs → Run workflow.**

---

## Step 5 — Submit to Google (so you get found)

1. Go to Google Search Console (free), add your property (`news-views.in` or the
   subdomain), and verify it (DNS verification via Hostinger is easiest).
2. Submit your sitemap: enter `sitemap.xml` and submit.
3. This tells Google to crawl and index your pages. Indexing takes days to weeks.

---

## Step 6 — Apply for AdSense (after a few weeks live)

Wait until the site has been live a few weeks, has real job listings and your 30
guides, and is getting some visitors. Then:

1. Apply at Google AdSense with your domain.
2. Once approved, open **build.js** and set your publisher ID:
   ```js
   adsenseId: "ca-pub-XXXXXXXXXXXXXXXX",
   ```
3. Commit and push. The build automatically injects the AdSense script site-wide
   and generates `ads.txt`. Done.

---

## Day-to-day after launch

- **Jobs:** post themselves from your feed. Nothing to do.
- **New guides:** drop a new `.md` file in `content/guides/` (copy an existing one
  for the format), set its `category`, and `git push`. It appears automatically,
  grouped and cross-linked.
- **Edits:** change any file and push — Cloudflare redeploys in about a minute.

That's the whole operation: write occasionally, push, and the site runs itself.
