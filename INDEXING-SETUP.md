# Google Indexing API — near-instant job indexing (optional but powerful)

Your site already submits a sitemap, but for a **jobs** site Google offers a faster
lane: the **Indexing API**. It notifies Google the moment a job page is added, and
pages are typically crawled within **5–30 minutes** instead of days/weeks. It's
officially supported for JobPosting pages — which yours are — so this is a legitimate,
intended use. Setup is ~15 minutes, one time. The API is free.

Once set up, your automation pings Google automatically after every run. No manual work.

---

## Step 1 — Create a Google Cloud project + enable the API
1. Go to https://console.cloud.google.com/ (same Google account as Search Console).
2. Top bar → project dropdown → **New Project** → name it `news-views-indexing` → Create.
3. With that project selected, go to **APIs & Services → Library**.
4. Search **"Web Search Indexing API"** (a.k.a. Indexing API) → open it → **Enable**.

## Step 2 — Create a service account + JSON key
1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Name it `indexing-bot` → Create and continue → skip roles → Done.
3. Click the new service account → **Keys** tab → **Add key → Create new key → JSON** → Create.
4. A `.json` file downloads. **Keep it safe — this is the key.**
5. Open the JSON in Notepad and copy the value of **`client_email`**
   (looks like `indexing-bot@news-views-indexing.iam.gserviceaccount.com`).

## Step 3 — Make the service account an OWNER in Search Console
This is the step most people miss — without it, every API call fails.
1. Go to https://search.google.com/search-console → select your **news-views.in** property.
2. **Settings → Users and permissions → Add user**.
3. Paste the `client_email` from Step 2 → Permission: **Owner** → Add.

## Step 4 — Add the key as a GitHub secret
1. Open the downloaded JSON file in Notepad → **select all → copy** (the whole thing,
   starting `{` and ending `}`).
2. GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `GOOGLE_SERVICE_ACCOUNT_JSON`  (exactly)
4. Secret: **paste the entire JSON** → Add secret.

## Done!
- Next time the automation runs (or you click **Actions → Update jobs → Run workflow**),
  it will submit your job URLs to Google. The log will say:
  `Indexing API: submitted N job URL(s) to Google.`
- Quota is 200 URLs/day (plenty). The script submits up to 180 per run to stay safe.
- **Only job pages** are submitted (Google's rules). Guides/updates rely on the sitemap.

## Notes
- Until you add the secret, nothing breaks — the step just prints "skipping (optional)".
- To also index your guides/homepage, use **Search Console → URL Inspection → Request
  Indexing** manually for those (~10/day). The API is job-pages-only by Google's policy.
