// ============================================================================
//  billing.js — In-App Purchase / subscription bridge (StoreKit + Play Billing)
//  ----------------------------------------------------------------------------
//  Blackrow Trails is a Capacitor app, so real subscriptions go through the native
//  stores. This file is a thin, defensive wrapper around the RevenueCat
//  Capacitor plugin (@revenuecat/purchases-capacitor), which abstracts Apple
//  StoreKit and Google Play Billing behind one API and handles receipt
//  validation, trials/intro offers, and cross-platform entitlement state.
//
//  On the web (or any build where the plugin isn't installed) every method
//  degrades gracefully: `isAvailable()` returns false and the app falls back to
//  the built-in simulated Entitlement flow, so development never breaks.
//
//  ---- One-time store setup (do this before shipping) ----
//  1. npm i @revenuecat/purchases-capacitor && npx cap sync
//  2. App Store Connect: create an auto-renewable subscription group "Trail Pro"
//     with products `trailpro_monthly` and `trailpro_yearly`. Add a 14-day free
//     trial as an *introductory offer* on each (StoreKit serves the trial).
//  3. Google Play Console: create a subscription `trailpro` with base plans
//     `monthly` / `yearly`, each with a 14-day free-trial offer.
//  4. RevenueCat dashboard: add both apps, paste the store API keys below,
//     create an entitlement called "pro" and attach all products to it, then
//     create an Offering ("default") with monthly + annual packages.
//  5. Fill in REVENUECAT_API_KEYS below with your public SDK keys.
// ============================================================================
window.Billing = (function () {
  // Public SDK keys from the RevenueCat dashboard (safe to ship in-app).
  const REVENUECAT_API_KEYS = {
    ios: '',      // appl_xxxxxxxxxxxxxxxxxxxxxxxxx
    android: ''   // goog_xxxxxxxxxxxxxxxxxxxxxxxxx
  };
  const ENTITLEMENT_ID = 'pro';            // must match the RevenueCat entitlement
  const PRODUCTS = { monthly: 'trailpro_monthly', yearly: 'trailpro_yearly' };

  const Cap = window.Capacitor;
  const platform = (Cap && Cap.getPlatform && Cap.getPlatform()) || 'web';
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  function purchasesPlugin() {
    // The plugin registers itself as Capacitor.Plugins.Purchases when installed.
    return (Cap && Cap.Plugins && Cap.Plugins.Purchases) || null;
  }
  function isAvailable() {
    const key = REVENUECAT_API_KEYS[platform];
    return isNative && !!purchasesPlugin() && !!key;
  }

  let configured = false;
  async function configure() {
    if (configured || !isAvailable()) return configured;
    const P = purchasesPlugin();
    try {
      await P.configure({ apiKey: REVENUECAT_API_KEYS[platform] });
      configured = true;
    } catch (e) { console.warn('[Billing] configure failed', e); }
    return configured;
  }

  // Reflect the live store entitlement into the app's Entitlement model.
  function applyCustomerInfo(info) {
    const active = !!(info && info.entitlements && info.entitlements.active &&
      info.entitlements.active[ENTITLEMENT_ID]);
    if (window.Entitlement && window.Entitlement.setFromStore) window.Entitlement.setFromStore(active);
    return active;
  }

  // Pull current subscription status from the store (call on app start).
  async function refresh() {
    if (!(await configure())) return false;
    try {
      const { customerInfo } = await purchasesPlugin().getCustomerInfo();
      return applyCustomerInfo(customerInfo);
    } catch (e) { console.warn('[Billing] refresh failed', e); return false; }
  }

  // Fetch the configured offering (for showing real localized prices).
  async function getOfferings() {
    if (!(await configure())) return null;
    try { return (await purchasesPlugin().getOfferings()).current || null; }
    catch (e) { console.warn('[Billing] getOfferings failed', e); return null; }
  }

  // Purchase a plan. term = 'monthly' | 'yearly'. Resolves true on success.
  async function purchase(term) {
    if (!(await configure())) return false;
    const productId = PRODUCTS[term] || PRODUCTS.yearly;
    try {
      const offering = await getOfferings();
      const pkg = offering && offering.availablePackages &&
        offering.availablePackages.find(p => p.product && p.product.identifier === productId);
      const P = purchasesPlugin();
      const res = pkg ? await P.purchasePackage({ aPackage: pkg })
                      : await P.purchaseStoreProduct({ product: { identifier: productId } });
      return applyCustomerInfo(res.customerInfo);
    } catch (e) {
      if (!(e && e.userCancelled)) console.warn('[Billing] purchase failed', e);
      return false;
    }
  }

  // Restore purchases (App Store / Play require a visible "Restore" path).
  async function restore() {
    if (!(await configure())) return false;
    try {
      const { customerInfo } = await purchasesPlugin().restorePurchases();
      return applyCustomerInfo(customerInfo);
    } catch (e) { console.warn('[Billing] restore failed', e); return false; }
  }

  return { isAvailable, configure, refresh, getOfferings, purchase, restore, PRODUCTS, ENTITLEMENT_ID, platform };
})();
