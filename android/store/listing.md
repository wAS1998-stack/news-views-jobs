# Google Play listing — Sarkari Radar (app by News-Views)

The listing is maintained in `tools-dev/play-listing/` (the owner wants the English listing only):

- `text/en-IN/` — app name (30), short description (80), full description (4000), release notes (500).
  The full description must keep the "not affiliated with any government" disclaimer and the official source URLs
  (Google's rule for apps with government information). No "best", "#1", "top", "free" or emojis in the name/graphics.
- `captions.json` — the captions of the 8 phone screenshots.
- `docs/` — upload guide, store settings + App content + Data safety answers, growth plan.
- `node tools-dev/play-listing/play-listing.js --zip` builds `android/ci/play/Sarkari-Radar-Play-Listing/` (+ .zip)
  from the CI screenshots in `android/ci/screens/`: captioned 1080×1920 JPEG screenshots, 1024×500 feature graphic,
  512 icon, text checked against Play's limits.

Hindi listing text and captions also exist (`text/hi-IN/`, `--langs en-IN,hi-IN`) but are not used.
