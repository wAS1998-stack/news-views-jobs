#!/usr/bin/env bash
# Runs inside the emulator job of .github/workflows/android.yml: installs the debug APK, opens the main screens
# with real data from news-views.in and saves screenshots (plus any crash log) to android/ci/screens/.
set -u
APK="$1"
PKG=in.newsviews.app.debug
ACT=com.newsviews.app.MainActivity
OUT=android/ci/screens
mkdir -p "$OUT"; rm -f "$OUT"/*.png "$OUT"/*.txt
shot() { sleep "${2:-6}"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }

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
adb shell am start -n $PKG/$ACT --es tab alerts; shot 02c-alerts 5
adb shell input swipe 540 1900 540 500 400; shot 02d-alerts-follow 3
adb shell input swipe 540 1900 540 300 400; adb shell input swipe 540 1900 540 300 400; shot 02e-alerts-age 3
adb shell am start -n $PKG/$ACT --es tab jobs; sleep 2
# 3. a job page: the first job in the live feed
JOB=$(curl -s https://news-views.in/app/v1/index.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["jobs"][0]["id"])' 2>/dev/null)
UPD=$(curl -s https://news-views.in/app/v1/index.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["updates"][0]["id"])' 2>/dev/null)
echo "job=$JOB update=$UPD" > "$OUT/ids.txt"
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --es kind job --es id "$JOB"; shot 03-job 8
  adb shell input swipe 540 1900 540 700 400; shot 03b-job-ad 5; fi
# 4. a result / admit card page
if [ -n "$UPD" ]; then adb shell am start -n $PKG/$ACT --es kind update --es id "$UPD"; shot 04-update 8; fi
# 5. the same job in Hindi
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --ez hindi true --es kind job --es id "$JOB"; shot 05-job-hindi 8; fi
# 6. a news-views.in link opened in the app
if [ -n "$JOB" ]; then adb shell am start -a android.intent.action.VIEW -d "https://news-views.in/jobs/$JOB/" $PKG; shot 06-link 8; fi
adb shell am start -n $PKG/$ACT --ez hindi true --es tab jobs; shot 07-jobs-hindi 6
adb shell am start -n $PKG/$ACT --ez hindi false; sleep 3
# 8. Google test ads: the full-screen ad on the way back from a page (caps bypassed by the debug-only ad_test hook)
adb shell am start -n $PKG/$ACT --es tab jobs; sleep 3
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --ez ad_test true --es kind job --es id "$JOB"; sleep 8
  adb shell input keyevent 4; shot 08-interstitial 7; adb shell input keyevent 4; shot 09-jobs-after-ad 8; fi
adb logcat -d -s NVAds:* > "$OUT/ads-log.txt"

adb logcat -d -s AndroidRuntime:E | tail -60 > "$OUT/crash.txt"
[ -s "$OUT/crash.txt" ] || rm -f "$OUT/crash.txt"
ls -l "$OUT"
exit 0
