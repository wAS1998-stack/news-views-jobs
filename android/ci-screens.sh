#!/usr/bin/env bash
# Runs inside the emulator job of .github/workflows/android.yml: installs the debug APK, opens the main screens
# with real data from news-views.in and saves screenshots (plus any crash log) to android/ci/screens/.
set -u
APK="$1"
REL="${2:-}"
PKG=in.newsviews.app
ACT=com.newsviews.app.MainActivity
OUT=android/ci/screens
mkdir -p "$OUT"; rm -f "$OUT"/*.png "$OUT"/*.jpg "$OUT"/*.txt
shot() { sleep "${2:-6}"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }

# the emulator's own launcher sometimes stops responding under load: keep its "isn't responding" dialogs off the shots
adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb install -r "$APK" || { echo "install failed" > "$OUT/error.txt"; exit 0; }
adb logcat -c
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true

# 1. first launch: welcome screen
adb shell am start -n $PKG/$ACT; shot 01-welcome 12
# start-up time: two cold starts after the first run (debug build on an emulator, so slower than a real phone)
for i in 1 2; do adb shell am force-stop $PKG; sleep 2; adb shell am start -W -n $PKG/$ACT | grep -E "TotalTime|WaitTime" | tr '\n' ' ' >> "$OUT/startup.txt"; echo >> "$OUT/startup.txt"; sleep 4; done
# 2. job list (skip the welcome screen; sample date of birth + followed departments, both debug-only hooks)
adb shell am start -n $PKG/$ACT --ez skip_onboarding true --ez demo_profile true; shot 02-jobs 12
adb shell am start -n $PKG/$ACT --es tab updates; shot 02b-results 6
adb shell am start -n $PKG/$ACT --ez upcoming true --es tab updates; shot 02f-upcoming 5
adb shell am start -n $PKG/$ACT --es tab updates; sleep 1
adb shell am start -n $PKG/$ACT --es tab alerts; shot 02c-alerts 5
adb shell input swipe 540 1900 540 500 400; shot 02d-alerts-follow 3
adb shell input swipe 540 1900 540 300 400; adb shell input swipe 540 1900 540 300 400; shot 02e-alerts-age 3
adb shell am start -n $PKG/$ACT --es tab jobs; sleep 2
# 3. a job page: the first job in the live feed (the feed is downloaded once)
FEED=$(mktemp); curl -s https://news-views.in/app/v1/index.json > "$FEED" || true
JOB=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["jobs"][0]["id"])' "$FEED" 2>/dev/null)
UPD=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["updates"][0]["id"])' "$FEED" 2>/dev/null)
# the Play listing's job screenshot: the open job with the most posts (a big, recognisable recruitment), not jobs[0]
BIGJOB=$(python3 -c '
import json, sys, datetime
d = json.load(open(sys.argv[1]))
today = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).date().isoformat()
live = [j for j in d["jobs"] if (not j.get("en") or j["en"] >= today) and j.get("ns", "") != "cancelled"] or d["jobs"]
print(max(live, key=lambda j: j.get("v", 0))["id"])' "$FEED" 2>/dev/null)
[ -n "$BIGJOB" ] || BIGJOB="$JOB"
echo "job=$JOB update=$UPD store-job=$BIGJOB" > "$OUT/ids.txt"
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --es kind job --es id "$JOB"; shot 03-job 8
  adb shell input swipe 540 1900 540 700 400; shot 03b-job-ad 5; fi
# 4. a result / admit card page
if [ -n "$UPD" ]; then adb shell am start -n $PKG/$ACT --es kind update --es id "$UPD"; shot 04-update 8; fi
# 5. the same job in Hindi
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --ez hindi true --es kind job --es id "$JOB"; shot 05-job-hindi 8; fi
# 5b. the daily quiz (debug-only hook opens it directly)
QUIZ=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print((d.get("quizzes") or [{}])[0].get("id",""))' "$FEED" 2>/dev/null)
if [ -n "$QUIZ" ]; then adb shell am start -n $PKG/$ACT --ez hindi false --es quiz "$QUIZ"; shot 05b-quiz 8; fi
# 6. a news-views.in link opened in the app
if [ -n "$JOB" ]; then adb shell am start -a android.intent.action.VIEW -d "https://news-views.in/jobs/$JOB/" $PKG; shot 06-link 8; fi
adb shell am start -n $PKG/$ACT --ez hindi true --es tab jobs; shot 07-jobs-hindi 6
adb shell am start -n $PKG/$ACT --ez hindi false; sleep 3
# 8. Google test ads: the full-screen ad on the way back from a page (caps bypassed by the debug-only ad_test hook)
adb shell am start -n $PKG/$ACT --es tab jobs; sleep 3
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --ez ad_test true --es kind job --es id "$JOB"; sleep 8
  adb shell input keyevent 4; shot 08-interstitial 7
  # test interstitials ignore Back: tap their close button (top right on the 1080x2400 pixel_6 screen)
  adb shell input tap 1019 192; shot 09-jobs-after-ad 6; fi
# 9b. app-open ad on coming back (caps bypassed by the debug-only app_open_test hook): arm it, go home, come back
adb shell am start -n $PKG/$ACT --ez app_open_test true --es tab jobs; sleep 8
adb shell input keyevent 3; sleep 3
adb shell am start -n $PKG/$ACT; shot 09b-app-open 6
adb shell input keyevent 4; sleep 2
adb logcat -d -s NVAds:* > "$OUT/ads-log.txt"
# the ad SDK's own messages about failed requests (why a format didn't fill)
adb logcat -d -s Ads:* | grep -iE "native|fail|error|could not|unable" | tail -60 > "$OUT/gma-log.txt"

# 8b. Play Store listing screenshots: no ads (debug-only store_mode), English and Hindi -> android/ci/screens/store-*.jpg (below)
adb shell am force-stop $PKG; sleep 2
adb shell am start -n $PKG/$ACT --ez store_mode true --ez skip_onboarding true --ez hindi false --es tab jobs; shot store-1-jobs 12
if [ -n "$BIGJOB" ]; then adb shell am start -n $PKG/$ACT --es kind job --es id "$BIGJOB"; shot store-2-job 8; fi
adb shell am start -n $PKG/$ACT --es tab updates; shot store-3-results 6
if [ -n "${QUIZ:-}" ]; then adb shell am start -n $PKG/$ACT --es quiz "$QUIZ"; shot store-4-quiz 8; fi
adb shell am start -n $PKG/$ACT --es tab alerts; shot store-5-alerts 5
adb shell am start -n $PKG/$ACT --ez hindi true --es tab jobs; shot store-6-hindi 6
adb shell am start -n $PKG/$ACT --ez hindi false --ez store_mode false --es tab jobs; sleep 2

# Play accepts phone screenshots up to a 2:1 aspect ratio and without transparency: the 1080x2400 PNGs become
# 1080x2160 JPEGs (120 px off the top and the bottom: status bar and gesture bar), alpha removed, quality 92.
IM=$(command -v magick || command -v convert || true)
if [ -n "$IM" ]; then
  for f in "$OUT"/store-*.png; do
    [ -s "$f" ] || continue
    read -r W H < <(python3 -c 'import struct,sys; b=open(sys.argv[1],"rb").read(24); print(*struct.unpack(">II", b[16:24]))' "$f" 2>/dev/null || echo "0 0")
    if [ "${W:-0}" -le 0 ] || [ "${H:-0}" -le 0 ]; then echo "store: cannot read size of $f"; continue; fi
    CH=$(( H - 240 )); MAXH=$(( W * 2 )); [ "$CH" -gt "$MAXH" ] && CH=$MAXH
    TOP=$(( (H - CH) / 2 ))
    if "$IM" "$f" -crop "${W}x${CH}+0+${TOP}" +repage -background white -alpha remove -alpha off -quality 92 "${f%.png}.jpg"; then
      rm -f "$f"; echo "store: ${f%.png}.jpg ${W}x${CH}"
    else
      echo "store: convert failed for $f (PNG kept)"
    fi
  done
else
  echo "ImageMagick not found: store screenshots stay PNG (not Play-ready)" > "$OUT/store-note.txt"
fi

# 9. the release build (shrunk with R8, no debug hooks): install, open, and look for a crash
if [ -n "$REL" ] && [ -f "$REL" ]; then
  adb logcat -d -s AndroidRuntime:E | tail -60 > "$OUT/crash-debug.txt"; [ -s "$OUT/crash-debug.txt" ] || rm -f "$OUT/crash-debug.txt"
  adb logcat -c
  adb uninstall $PKG >/dev/null 2>&1 || true
  if adb install "$REL"; then
    adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
    adb shell am start -n $PKG/$ACT; shot 10-release-welcome 12
    for i in 1 2; do adb shell am force-stop $PKG; sleep 2; echo "release $(adb shell am start -W -n $PKG/$ACT | grep -E 'TotalTime' | tr -d '\r')" >> "$OUT/startup.txt"; sleep 4; done
    adb shell am start -a android.intent.action.VIEW -d "https://news-views.in/jobs/$JOB/" $PKG; shot 11-release-job 10
    adb shell input keyevent 4; shot 12-release-back 4
    echo "release ok" > "$OUT/release.txt"
  else
    echo "release install failed" > "$OUT/release.txt"
  fi
fi

adb logcat -d -s AndroidRuntime:E | tail -60 > "$OUT/crash.txt"
[ -s "$OUT/crash.txt" ] || rm -f "$OUT/crash.txt"
ls -l "$OUT"
exit 0
