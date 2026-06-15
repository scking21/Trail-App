#!/usr/bin/env bash
# Applies native config that the generated iOS/Android projects don't include by
# default. Safe to re-run. Run this AFTER `npx cap add ios` / `npx cap add android`.
set -euo pipefail
cd "$(dirname "$0")/.."

PLIST="ios/App/App/Info.plist"
LOC_MSG="Trail App uses your location to center the map on you and show nearby trailheads and water sources."

if [ -f "$PLIST" ]; then
  echo "→ Patching $PLIST with location usage strings"
  # PlistBuddy ships with macOS
  PB=/usr/libexec/PlistBuddy
  set_str() {
    "$PB" -c "Add :$1 string \"$2\"" "$PLIST" 2>/dev/null \
      || "$PB" -c "Set :$1 \"$2\"" "$PLIST"
  }
  set_str NSLocationWhenInUseUsageDescription "$LOC_MSG"
  echo "  ✓ NSLocationWhenInUseUsageDescription set"
  set_str NSCameraUsageDescription "Show the trail marker over your live camera in AR view."
  echo "  ✓ NSCameraUsageDescription set"
  # Export compliance: the app uses only standard HTTPS encryption, which is
  # exempt — declaring this skips the App Store Connect prompt on every upload.
  "$PB" -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST" 2>/dev/null \
    || "$PB" -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST"
  echo "  ✓ ITSAppUsesNonExemptEncryption = NO"
else
  echo "• Skipping iOS: $PLIST not found (run 'npx cap add ios' first)"
fi

# Android: the Geolocation plugin auto-merges ACCESS_*_LOCATION permissions, so
# nothing to inject. We just confirm the manifest exists.
AMAN="android/app/src/main/AndroidManifest.xml"
if [ -f "$AMAN" ]; then
  echo "→ Patching Android manifest (perms are NOT auto-merged — the plugin ships an empty manifest)"
  add_perm() {
    if grep -q "$1" "$AMAN"; then echo "  ✓ $1 already present"; else
      perl -0pi -e "s{(<uses-permission android:name=\"android.permission.INTERNET\" />)}{\$1\n    <uses-permission android:name=\"$1\" />}" "$AMAN"
      echo "  ✓ added $1"
    fi
  }
  add_perm android.permission.ACCESS_FINE_LOCATION
  add_perm android.permission.ACCESS_COARSE_LOCATION
  add_perm android.permission.CAMERA
  if ! grep -q 'android.hardware.camera' "$AMAN"; then
    perl -0pi -e 's{(<uses-permission android:name="android.permission.CAMERA" />)}{$1\n    <uses-feature android:name="android.hardware.camera" android:required="false" />}' "$AMAN"
    echo "  ✓ added camera hardware feature (optional)"
  fi
else
  echo "• Skipping Android: manifest not found (run 'npx cap add android' first)"
fi

echo "Done."
