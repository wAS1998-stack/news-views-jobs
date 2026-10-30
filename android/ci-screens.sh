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
adb shell am start -n $PKG/$ACT; shot 01-welcome 8
# 2. job list (skip the welcome screen through the debug-only hook)
adb shell am start -n $PKG/$ACT --ez skip_onboarding true; shot 02-jobs 12
adb shell am start -n $PKG/$ACT --es tab updates; shot 02b-results 6
adb shell am start -n $PKG/$ACT --es tab alerts; shot 02c-alerts 5
adb shell am start -n $PKG/$ACT --es tab jobs; sleep 2
# 3. a job page: the first job in the live feed
JOB=$(curl -s https://news-views.in/app/v1/index.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["jobs"][0]["id"])' 2>/dev/null)
UPD=$(curl -s https://news-views.in/app/v1/index.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["updates"][0]["id"])' 2>/dev/null)
echo "job=$JOB update=$UPD" > "$OUT/ids.txt"
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --es kind job --es id "$JOB"; shot 03-job 8; fi
# 4. a result / admit card page
if [ -n "$UPD" ]; then adb shell am start -n $PKG/$ACT --es kind update --es id "$UPD"; shot 04-update 8; fi
# 5. the same job in Hindi
if [ -n "$JOB" ]; then adb shell am start -n $PKG/$ACT --ez hindi true --es kind job --es id "$JOB"; shot 05-job-hindi 8; fi
# 6. a news-views.in link opened in the app
if [ -n "$JOB" ]; then adb shell am start -a android.intent.action.VIEW -d "https://news-views.in/jobs/$JOB/" $PKG; shot 06-link 8; fi
adb shell am start -n $PKG/$ACT --ez hindi true --es tab jobs; shot 07-jobs-hindi 6
adb shell am start -n $PKG/$ACT --ez hindi false

adb logcat -d -s AndroidRuntime:E | tail -60 > "$OUT/crash.txt"
[ -s "$OUT/crash.txt" ] || rm -f "$OUT/crash.txt"
ls -l "$OUT"
exit 0
