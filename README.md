# Blackrow Trails — Mobile (iOS & Android)

Native iOS and Android wrapper around the Blackrow Trails web experience (Map /
Planner), built with [Capacitor](https://capacitorjs.com). The entire UI is the
existing single-file web app — Capacitor packages it into real App Store / Play
Store binaries and gives it native GPS, splash screen, and status-bar control.

### Finding trails

A **search box on the map** (top-left) finds trails by name: it matches the
built-in featured guides instantly and also queries the **live USGS National Map
trail network** nationwide (debounced, 3+ characters). Picking a result flies the
map to the trail and opens its detail card. Jumping to a region or any of the 50
states is the header **region dropdown** (top-right) — the old standalone
“Trails” tab was a duplicate of that dropdown and has been removed.

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
- **GPS track recording** — battery-conscious by default: instead of a continuous
  high-accuracy watch, it polls one fix at a time on an adaptive interval (≈4 s
  moving, backing off to 12 s when still) and stops GPS entirely while the app is
  hidden. **Screen-off recording is opt-in** (Planner → Privacy & data → "Keep
  recording with the screen off"): when enabled it uses
  `@capacitor-community/background-geolocation`, which keeps a foreground-service
  notification running so the track continues with the screen off. If the plugin
  isn't present (e.g. a web build), the app silently falls back to the
  foreground sampler. Background recording needs the extra permissions applied by
  `npm run config:native` (iOS `NSLocationAlwaysAndWhenInUseUsageDescription` +
  `UIBackgroundModes: [location]`; Android `ACCESS_BACKGROUND_LOCATION`), so run
  `npm install && npx cap sync` after pulling this change to fetch and link the
  plugin.
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

## Monetization: Free / 14-day Trial / Trail Pro

The app ships a three-tier model, all enforced client-side through a single
`Entitlement` module (state in `localStorage`) plus a reusable paywall modal:

- **Free** — Trail Discovery (browse/search trails, read descriptions) and basic
  **real-time** track recording **while connected to data**. Recording offline,
  and downloading maps, are blocked.
- **14-day Trial** — full Trail Pro access; auto-expires back to Free after 14
  days. The trial can only be started once per device.
- **Trail Pro (paid)** — everything below.

**Pro-gated features** (each opens the paywall for Free users):

| Feature | Trigger that fires the paywall |
| --- | --- |
| Custom Route Planner | **Create New Plan** / **Edit Route** (Planner tab) |
| Offline Map Downloads | the ⬇ download-area button on the map |
| Advanced Overlays (land borders, slope shading, weather) | the Land / Cadastral / Slope / Radar toggles |
| Safety / wrong-turn alerts | the “▶ Follow (off-route alerts)” buttons |
| Offline track recording | tapping record while `navigator.onLine` is false |

Helpers: `requirePro(feature, action)` runs `action` if entitled else paywalls
(and runs it on unlock); `showPaywall(feature)` opens it directly.

### Real store subscriptions (`billing.js`)

`billing.js` is a defensive wrapper around **cordova-plugin-purchase**
(CdvPurchase v13), an open-source (MIT) library that talks **directly** to
**Apple StoreKit** and **Google Play Billing** — entirely on-device, with no
third-party backend, account, or analytics, which keeps the app’s “no servers /
no trackers” posture intact. On the web (or any build without the plugin)
`Billing.isAvailable()` is `false` and the app falls back to the simulated
Entitlement flow, so dev never breaks. When live, the paywall’s Subscribe /
Trial / Restore buttons route through the store and `Billing` syncs the result
back into `Entitlement` via `setFromStore()`. Receipt validation is on-device
(no server); add a validator URL in `billing.js` later if you want server-side
verification.

To go live (full checklist in the header comment of `billing.js`):

1. `npm i cordova-plugin-purchase && npx cap sync`
2. Create subscription products `trailpro_monthly` / `trailpro_yearly` in
   **App Store Connect** and **Play Console**, each with a 14-day free-trial /
   introductory offer.

No API keys, dashboards, or third-party accounts to configure — the product IDs
are all the library needs.

Apple/Google both require a visible **Restore purchases** path — it’s in the
paywall modal.

## Share trip plan (Pro)

Pro users can hand their itinerary to someone else through the **native OS share
sheet** — iOS `UIActivityViewController`, Android `ACTION_SEND` — so it goes to
Messages, Mail, WhatsApp, AirDrop, etc. The Planner has a **Trip start date**
picker and a **📤 Share trip plan** button; sharing builds a plain-text,
day-by-day itinerary (each day’s calendar date, every stop with distance/gain and
a Google Maps pin link, and trip totals) and opens the share sheet.

Wired via [`@capacitor/share`](https://capacitorjs.com/docs/apis/share) in
`share.js`, with a graceful fallback chain: **Capacitor Share** (packaged app) →
**Web Share API** (`navigator.share`, mobile browsers) → **clipboard copy**. So
it works in the native apps and degrades cleanly on the web. The button is gated
behind `requirePro` like every other paid feature. Native builds need the plugin
linked — already done via `npm i @capacitor/share && npx cap sync`.

## Trip Planner: multi-day itineraries

The Planner tab builds a **day-by-day** itinerary. Add as many days as you want
(“＋ Add another day”), rename each day inline, set one **active** day (new stops
land there), and move stops between days. Each day shows its own
distance/gain/time totals; the top totals box sums the whole trip. Trails added
from the map and custom routes both become day stops. Persisted in
`trailapp.plan.v1` (items, each tagged with `day`) + `trailapp.plandays.v1`
(day count, names, active day).

## Custom Route Planner (Pro)

Draw your own routes on the map: **Create New Plan** starts a drawing session
(toolbar at the top of the map) — tap to drop points, **Undo**, toggle **Snap to
trails** (pulls each point onto the nearest loaded USGS trail line within ~45 m),
then **Save**. **Edit Route** reopens a saved route to redraw it. Routes show
live distance + point count, can be added to any plan day, and are stored in
`trailapp.routes.v1`. Snapping needs the Trails layer loaded (zoom ≥ 11).

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

- **iOS** (`Info.plist`): `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`, and `UIBackgroundModes: [location]`
  (the last two enable opt-in screen-off recording).
- **Android** (`AndroidManifest.xml`): `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `ACCESS_BACKGROUND_LOCATION` (opt-in background recording), `CAMERA`.

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
