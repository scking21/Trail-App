# Blackrow Trails — Feature/PR Review Checklist

A review checklist tailored to this app: a Capacitor-wrapped single-page web
app (`index.html` + `geo.js`, `ar.js`, `billing.js`, `share.js`, `sw.js`)
shipping native iOS/Android builds, with offline trail maps (Leaflet + OSM/
OpenTrailMap tiles), background geolocation, AR view, and in-app purchases via
`cordova-plugin-purchase`. Use this when reviewing a feature branch or PR
before merge. Mark each item Pass / Fail / N/A.

## 1. Functional requirements
- [ ] Feature works on both a fresh install and an upgrade from the previous
      build (no stale `www/` or cached service-worker assets).
- [ ] Behavior verified on both iOS and Android where the change touches
      native plugins (geolocation, purchase, share, splash/status bar).
- [ ] Offline mode: cached trail tiles/data behave correctly with no network
      (per `sw.js` caching strategy).
- [ ] Search box and region dropdown still resolve trails correctly if map or
      data-loading code was touched.
- [ ] `npm run sync` (not raw `npx cap sync`) was used to regenerate `www/`
      before testing on device/simulator.

## 2. Code quality
- [ ] Changes are made in source files (`index.html`, `*.js` modules, `privacy.html`,
      `terms.html`) — never hand-edited in generated `www/`.
- [ ] No dead code, commented-out blocks, or leftover `console.log`/debug output.
- [ ] Naming and structure consistent with existing modules (`geo.js`, `ar.js`,
      `billing.js`, `share.js`).
- [ ] Relevant unit tests updated/added (`*.test.js`, run via `npm test`/Jest).
- [ ] `npm test` passes locally.

## 3. Performance
- [ ] No unnecessary network calls to USGS/OSM trail APIs (debounce/throttle
      preserved for search-as-you-type).
- [ ] Map re-renders and marker/layer updates are not triggered more than
      necessary (no redundant Leaflet layer churn).
- [ ] Service worker cache (`sw.js`) doesn't grow unbounded or re-fetch assets
      already cached.
- [ ] Background geolocation usage is scoped (interval/accuracy) to avoid
      excess battery drain.
- [ ] Bundle/asset size impact considered (no unneeded vendor libs added to
      `vendor/`).

## 4. Security
- [ ] All user-controlled or third-party trail data (names, descriptions,
      coordinates from APIs) is escaped before insertion into the DOM — no
      reintroduction of the earlier XSS class of bug.
- [ ] No secrets, API keys, or store credentials committed to the repo or
      `capacitor.config.json`.
- [ ] In-app purchase flow (`billing.js`) validates receipts/product IDs
      server- or store-side, not solely client-side trust.
- [ ] External requests (USGS, OSM/OpenTrailMap, tile servers) use HTTPS and
      handle failure/timeouts gracefully without leaking errors to the UI.
- [ ] Dependency changes checked against known CVEs (`npm audit` / lockfile
      diff reviewed).

## 5. Accessibility
- [ ] Interactive controls (search box, region dropdown, trail detail card,
      AR toggle) are reachable and operable via keyboard/focus order.
- [ ] Map and AR views have a non-visual fallback or equivalent text content
      for screen readers where feasible.
- [ ] Color contrast of UI text/controls meets WCAG AA, including any new
      map overlays or badges.
- [ ] Buttons/icons have accessible labels (`aria-label`/`title`), not just
      icons.

## 6. User experience
- [ ] Error states are clear and actionable (e.g., location permission
      denied, no network while offline caching is unavailable, purchase
      failure).
- [ ] Edge cases handled: no search results, trail with missing data fields,
      GPS unavailable, first-run with no cached tiles.
- [ ] Native platform conventions respected (status bar, splash screen,
      back-button behavior on Android).
- [ ] Legal/compliance pages (`privacy.html`, `terms.html`) updated if the
      feature changes data collection or purchase behavior.

## 7. Documentation
- [ ] `README.md` project layout/setup instructions updated if files or the
      build/sync flow changed.
- [ ] `THIRD_PARTY_NOTICES.md` updated if a new dependency or map tile
      provider was added.
- [ ] Non-obvious logic (e.g., caching strategy, geolocation tuning, IAP
      edge cases) has a short comment explaining the *why*, not the *what*.
- [ ] `PRIVACY.md` reflects any new data collected or third-party service
      used.
