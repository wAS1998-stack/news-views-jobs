#!/usr/bin/env bash
# Makes the Google Play upload key ONCE, on the owner's own computer (needs Java: `keytool` comes with any JDK), and
# prints exactly what to paste into GitHub -> Settings -> Secrets and variables -> Actions -> New repository secret.
# After the two secrets exist, every Android build is signed with this key and also produces sarkari-radar.aab for Play.
# Keep upload-key.jks and its password somewhere safe (a password manager): Play needs the same key for every update.
# Never commit them (android/.gitignore keeps *.jks and *.b64 out of git).
set -euo pipefail
cd "$(dirname "$0")"
if [ -f upload-key.jks ]; then echo "upload-key.jks already exists here - not overwriting it."; exit 1; fi
PASS=$( (openssl rand -base64 18 2>/dev/null || head -c 18 /dev/urandom | base64) | tr -d '/+=' | cut -c1-20)
keytool -genkeypair -v -keystore upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=News-Views, OU=Sarkari Radar, O=News-Views, C=IN" >/dev/null
if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0 upload-key.jks > upload-key.b64; else base64 upload-key.jks | tr -d '\n' > upload-key.b64; fi
echo
echo "Add these two secrets in GitHub (Settings -> Secrets and variables -> Actions):"
echo "  ANDROID_KEYSTORE_PASSWORD  =  $PASS"
echo "  ANDROID_KEYSTORE_B64       =  the whole content of $(pwd)/upload-key.b64 (one long line)"
echo "(the key alias is 'upload', the workflow's default, so ANDROID_KEY_ALIAS is not needed)"
echo
echo "Upload-key certificate (for Play Console -> App integrity, if asked):"
keytool -list -v -keystore upload-key.jks -storepass "$PASS" | grep -E "SHA1|SHA256" | sed 's/^\s*/  /'
echo
echo "Then run the 'Android app' workflow (GitHub -> Actions -> Android app -> Run workflow): the build's app-latest"
echo "release will contain sarkari-radar.aab, signed with this key - that is the file to upload to Google Play."
