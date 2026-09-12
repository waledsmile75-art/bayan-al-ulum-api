#!/usr/bin/env bash
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/35.0.0:$PATH"
mkdir -p "$ANDROID_HOME/cmdline-tools"
if ! command -v sdkmanager >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  curl -L --fail --retry 3 -o "$tmp/cmdline-tools.zip" https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  rm -rf "$ANDROID_HOME/cmdline-tools/latest" "$tmp/cmdline-tools"
  mkdir -p "$tmp/cmdline-tools"
  unzip -q "$tmp/cmdline-tools.zip" -d "$tmp"
  mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
yes | sdkmanager --licenses >/dev/null || true
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
cd /home/ubuntu/bayan-al-ulum
if [ ! -d android ]; then npx expo prebuild --platform android --no-install; fi
cd android
./gradlew assembleRelease --no-daemon --stacktrace
mkdir -p ../artifacts
cp app/build/outputs/apk/release/app-release.apk ../artifacts/bayan-al-ulum-release.apk
sha256sum ../artifacts/bayan-al-ulum-release.apk
ls -lh ../artifacts/bayan-al-ulum-release.apk
