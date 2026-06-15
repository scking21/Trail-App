# Trail App — Mobile (iOS & Android)

Native iOS and Android wrapper around the Trail App web experience (Map / Trails /
Planner), built with [Capacitor](https://capacitorjs.com). The entire UI is the
existing single-file web app — Capacitor packages it into real App Store / Play
Store binaries and gives it native GPS, splash screen, and status-bar control.

## Project layout

```
index.html             ← source of truth for the app (edit this)
www/index.html         ← copy that Capacitor bundles (run `npm run build` to refresh)
capacitor.config.json  ← app id, name, plugin config
package.json           ← Capacitor deps + scripts
ios/                   ← generated native Xcode project (after `cap add ios`)
android/               ← generated native Android Studio project (after `cap add android`)
```

> Edit `index.html`, then `npm run build` (or `npm run sync`) to push changes into
> `www/` and the native projects.

## One-time toolchain setup (not yet installed on this machine)

This machine is missing the build tools. Install them first:

1. **Node.js 20+** (includes npm): https://nodejs.org or `brew install node`.
   This repo pins Node via `.nvmrc` — with [nvm](https://github.com/nvm-sh/nvm)
   installed, just run `nvm use` (or `nvm install`) in the project root.
2. **Xcode** (full app, not just Command Line Tools) from the Mac App Store, then:
   ```
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```
   For CocoaPods (the iOS dependency manager), **do not** use `sudo gem install
   cocoapods` — macOS system Ruby is too old. See the note below.
3. **Android Studio** (for the Android build): https://developer.android.com/studio
   - Open it once and let the setup wizard download the SDK, **or** install the SDK
     headlessly with the command-line tools (no GUI needed):
     ```bash
     SDK="$HOME/Library/Android/sdk"; mkdir -p "$SDK/cmdline-tools"
     curl -fsSL -o /tmp/cmdtools.zip https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip
     unzip -q /tmp/cmdtools.zip -d "$SDK/cmdline-tools" && mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
     export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
     yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses
     "$SDK/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-34" "build-tools;34.0.0"
     ```
   - This repo's `.zshrc` setup exports `ANDROID_HOME`, `JAVA_HOME` (Android Studio's
     bundled JDK 21), and adds `platform-tools` to `PATH`.

### iOS / CocoaPods note (macOS system Ruby is too old)

macOS ships Ruby 2.6, which current CocoaPods **cannot** install on (its deps need
Ruby 3.0+). Install a modern Ruby + CocoaPods via Homebrew — `brew install cocoapods`
brings its own Ruby, so don't fight the system one:

```bash
# The Homebrew installer needs an interactive sudo password, so run it yourself
# in a normal terminal (it can't be automated headlessly):
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install cocoapods
```

Two gotchas after installing, both worth adding to `~/.zprofile`:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"  # put brew (and pod) on your PATH
export LANG=en_US.UTF-8                     # CocoaPods crashes without a UTF-8 locale
```

Then `npx cap sync ios` will run `pod install` successfully.

## Build & run

```bash
# 1. install JS deps
npm install

# 2. add native platforms (creates ios/ and android/)
npx cap add ios
npx cap add android

# 3. copy web assets into the native projects
npm run sync

# 4. open in the native IDE to run on a simulator/device
npm run open:ios       # → Xcode  (pick a simulator, press ▶)
npm run open:android   # → Android Studio (pick an emulator, press ▶)

# …or run directly from the CLI
npm run run:ios
npm run run:android
```

After adding the platforms, apply the native permission/config that the generated
projects don't include by default:

```bash
npm run config:native     # injects iOS location-usage string, verifies Android manifest
```

## Native features wired in

- **Locate me** — the 📍 button on the map uses the native Geolocation plugin on
  device and the browser API in a normal browser.
- **Splash screen** — dark-green branded splash, auto-hidden on load.
- **Status bar** — themed to match the app header (`#1f3a24`).
- **Safe areas** — header, panels, and the trail detail sheet respect notches and
  the home indicator on both platforms.
- **Offline maps** — a service worker (`sw.js`) caches the app shell + viewed map
  tiles, so previously-seen areas (and the app itself) load with no signal. Live
  USGS/PAD-US data calls are intentionally left uncached so they stay fresh.
- **Download area for offline use** — the ⬇ button on the map bulk-downloads every
  tile in the current view across three zoom levels (current → +2) before a trip.
  Shows a tile-count + size estimate, a live progress bar, and stop/resume. Capped
  at 4,000 tiles per download with 4-way concurrency to stay polite to the tile
  server. Tiles land in the same `trail-tiles-v1` cache the map reads from offline.

> **Dev note:** `sw.js` is network-first for the app shell when served from a
> localhost dev server (a host:port origin), so edits show on a normal reload — no
> manual cache-clearing. In the packaged native app it's cache-first for true
> offline launch. No version bumping needed during development.

## Trail Marker AR (sensor overlay)

A camera-overlay "AR" marker that floats over the live camera and points toward a
waypoint — no ARKit/ARCore, just **camera + GPS + heading + trig**, so it tolerates
GPS slop gracefully. Launched from the **📷 AR — point me there** button on a trail's
detail card.

- `geo.js` — pure math (bearing, distance, circular heading smoothing, screen
  projection, compass-vs-GPS-course selection). No DOM/sensors. `npm test` runs the
  Jest suite (`geo.test.js`, 21 tests).
- `ar.js` — the overlay: camera background, sensor wiring, heading smoothing,
  on-screen marker + off-screen "turn left/right" chevron, debug HUD, FOV calibration.

**Two things only you can do** (the scaffold can't):
1. **Calibrate FOV** — open the debug HUD (ⓘ), aim a known-direction landmark to
   screen center, nudge FOV ± until the marker lines up as you pan. Default 55° is a
   guess; portrait main cameras usually land ~50–60°. Stored in `localStorage`.
2. **Field-test on foot** — walk a real trail; tune `HEADING_ALPHA` (lower = calmer)
   and `COURSE_SPEED_THRESHOLD` in `ar.js` until it feels locked-on while moving.

> Camera + compass don't work in the simulator — use a **real device** (run from
> Xcode). `npm run config:native` applies the iOS camera/location usage strings and
> the Android `CAMERA` permission. Capacitor's WebView grants the in-page
> `getUserMedia` request once `CAMERA` is declared — no Java changes needed.

## Permissions (auto-applied)

Run `npm run config:native` after adding platforms. It applies:

- **iOS** (`Info.plist`): `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`.
- **Android** (`AndroidManifest.xml`): `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`.

> ⚠️ `@capacitor/geolocation` ships an **empty** manifest — location permissions are
> **NOT** auto-merged on Android. The script adds them explicitly; without them the
> locate button and AR GPS silently fail. The script is idempotent (safe to re-run).

## App icons & splash (already generated)

Source art lives in `resources/` — `icon.svg`/`icon.png` (1024²) and
`splash.svg`/`splash.png` (2732²), a dark-green mountain-and-trail mark. To fan
them out into every per-platform size after adding the native projects:

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate     # reads resources/icon.png + resources/splash.png
```

Edit the `.svg` files and re-run `qlmanage -t -s 1024 -o resources resources/icon.svg`
(and `mv`) to regenerate the PNGs.
