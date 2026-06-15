#!/usr/bin/env bash
# Increments the iOS build number (CURRENT_PROJECT_VERSION) in the Xcode project.
# Every TestFlight / App Store upload needs a build number higher than the last,
# even when the marketing version (1.0, 1.1, …) is unchanged. Run this before
# each `Product > Archive`. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

PBX="ios/App/App.xcodeproj/project.pbxproj"
[ -f "$PBX" ] || { echo "✗ $PBX not found (run 'npx cap add ios' first)"; exit 1; }

cur=$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+;' "$PBX" | grep -oE '[0-9]+')
[ -n "${cur:-}" ] || { echo "✗ Could not read CURRENT_PROJECT_VERSION"; exit 1; }
next=$((cur + 1))

# Bump every build configuration (Debug + Release) so they stay in sync.
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = ${next};/g" "$PBX"

ver=$(grep -m1 -oE 'MARKETING_VERSION = [^;]+;' "$PBX" | sed -E 's/MARKETING_VERSION = (.*);/\1/')
echo "✓ iOS build number: ${cur} → ${next}   (marketing version ${ver})"
echo "  Now: npm run sync && open ios/App/App.xcworkspace, then Product > Archive."
