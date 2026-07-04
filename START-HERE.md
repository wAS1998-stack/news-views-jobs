# START HERE — Everything You Need to Fill (and nothing else)

You asked for fully automatic, no manual posting. Here is the complete list.
There are only **TWO things to fill**. After that, the site runs itself.

================================================================
## ① Edit ONE file: config.json
================================================================

Open `config.json` and fill these values:

```json
{
  "url": "https://news-views.in",          ← your live web address
  "email": "contact@news-views.in",        ← your contact email
  "adsenseId": "",                          ← leave empty until AdSense approves you
  "feeds": [
    "https://PUT-YOUR-JOB-FEED-URL-HERE/feed"   ← THE job source (see note below)
  ],
  "maxNewPerRun": 8                         ← how many new jobs per run (leave as 8)
}
```

What each one means:
- **url** — `https://news-views.in` if using the main domain, or
  `https://jobs.news-views.in` if using a subdomain. Nothing else needs changing.
- **email** — shown on your Contact and Privacy pages.
- **adsenseId** — leave `""` for now. After Google AdSense approves you, paste
  your `ca-pub-XXXXXXXXXXXXXXXX` here and ads + ads.txt turn on automatically.
- **feeds** — THIS is the one thing that makes jobs appear. It is the RSS/Atom
  feed of an official or authorised job-notification source. You can add more than
  one. **This is the only input the system genuinely cannot create for you** — a
  tool can't fetch jobs from nowhere; it needs a source to read.
- **maxNewPerRun** — leave at 8. Caps how many new jobs are added each run so you
  publish a steady trickle, not a flood.

================================================================
## ② Add ONE secret on GitHub: OPENAI_API_KEY
================================================================

This lets the system read each notification and fill in all the details
(vacancies, dates, eligibility, salary, how-to-apply) so pages are rich, not thin.

1. Go to your GitHub repo → **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Name: `OPENAI_API_KEY`
4. Value: your OpenAI API key (starts with `sk-...`).
5. Save.

Cost: about ₹10–30 per month. New OpenAI accounts usually have free credit.

================================================================
## That's it. What happens next, automatically:
================================================================

- 3 times a day, on its own, the system reads your feed, finds new
  notifications, uses AI to fill in all the details, and publishes a full job page.
- The new job appears on the homepage, the right category pages, the sitemap and
  the RSS feed — with no action from you.
- Cloudflare rebuilds and the site goes live within about a minute.
- You never open a spreadsheet, never edit a job, never touch code.

You can watch the first run happen: GitHub repo → **Actions → Update jobs →
Run workflow.** Check the log to confirm jobs were added.

----------------------------------------------------------------
## The ONE honest catch
----------------------------------------------------------------

You MUST put at least one feed URL in `config.json`. There is no way around this —
no software can "find jobs" from nothing; it has to read a source. Choosing a
good, official/authorised source is the single most important decision, because
it protects your SEO and AdSense standing. Re-publishing another website's
articles word-for-word is both a copyright problem and flagged by Google as
duplicate, low-value content.

If you don't have a feed yet, that's the one thing to sort out — and I can help
you find a legitimate source. Once it's in `config.json`, everything else is
fully automatic, forever.

----------------------------------------------------------------
## Optional (only if you want):
----------------------------------------------------------------

- Delete the 3 sample jobs: set `data/jobs.json` to `[]`. Your feed will fill it.
  (The homepage handles "no jobs yet" gracefully until the first run.)
- Write more guide articles: drop a `.md` file in `content/guides/`. Not required
  for automation — your 30 guides are already done.
