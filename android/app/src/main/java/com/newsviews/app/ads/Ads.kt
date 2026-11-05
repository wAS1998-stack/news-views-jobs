package com.newsviews.app.ads

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdLoader
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.appopen.AppOpenAd
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.nativead.MediaView
import com.google.android.gms.ads.nativead.NativeAd
import com.google.android.gms.ads.nativead.NativeAdOptions
import com.google.android.gms.ads.nativead.NativeAdView
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import com.newsviews.app.BuildConfig
import com.newsviews.app.Stats
import com.newsviews.app.data.AdsConfig
import com.newsviews.app.play.Billing
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Google AdMob, kept polite: one anchored banner under the lists, one unit inside each job / result page, one native
 * card in each list, a full-screen ad only when going back from a page (at most once per [AdsConfig.every] pages and
 * [AdsConfig.gap] seconds, never in the first minute) and an app-open ad only when someone returns after a real break.
 * Consent is asked through Google's UMP form where the law requires it (EEA/UK); nothing loads until the SDK says ads may
 * be requested. Release builds without real IDs never start the SDK.
 *
 * Rewarded video (the "Sarkari Radar Pass"): entirely opt-in — the offer says "watch one short video: no ads and the
 * preparation tips open for N hours". Only those bonus tips sit behind it (and they are shown freely whenever no video is
 * available); notices, dates, eligibility and apply links never do. While a pass runs, or with Pro, no ad is shown.
 *
 * Every format is loaded ahead of time (never in front of the reader), dropped before it expires, and retried with a
 * growing delay after a no-fill, so one failure can't switch a format off for the whole session.
 */
object Ads {
    const val TAG = "NVAds"
    const val PREFS = "ads"
    private val started = AtomicBoolean(false)
    /** start() has run in this process (it must run again after Android killed the app in the background). */
    val isStarted: Boolean get() = started.get()
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()
    private val _config = MutableStateFlow(AdsConfig())
    val config: StateFlow<AdsConfig> = _config.asStateFlow()
    /** A feed config is known (from the feed, or the last one saved): nothing is requested on built-in defaults. */
    private var configKnown = false
    private val _privacyRequired = MutableStateFlow(false)
    val privacyRequired: StateFlow<Boolean> = _privacyRequired.asStateFlow()
    private val _fullScreen = MutableStateFlow(false)
    /** A full-screen ad is on screen: the banner waits and the app's header hides its buttons (no mis-taps near the X). */
    val fullScreen: StateFlow<Boolean> = _fullScreen.asStateFlow()

    private val main = Handler(Looper.getMainLooper())
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; encodeDefaults = true }
    private var app: Context? = null

    private val _adFreeUntil = MutableStateFlow(0L)
    /** Epoch millis until which no ads are shown — earned by watching a rewarded video; 0 = no pass. */
    val adFreeUntil: StateFlow<Long> = _adFreeUntil.asStateFlow()
    private val _pro = MutableStateFlow(false)
    /** "Pro" bought through Play Billing: no ads, ever (see play/Billing.kt). */
    val pro: StateFlow<Boolean> = _pro.asStateFlow()

    fun adFree(): Boolean = _pro.value || System.currentTimeMillis() < _adFreeUntil.value
    fun setPro(v: Boolean) { _pro.value = v }

    /** No ads right now (a pass is running or Pro is owned). Call it first thing in a composable: it collects state. */
    @Composable
    fun adsOff(): Boolean {
        val until by adFreeUntil.collectAsStateWithLifecycle()
        val isPro by pro.collectAsStateWithLifecycle()
        return isPro || until > System.currentTimeMillis()
    }

    private fun on(): Boolean = BuildConfig.ADS && _config.value.on && !adFree()

    /** Call from Application.onCreate: restores a running pass, the Pro flag and the last feed config. */
    fun restore(ctx: Context) {
        app = ctx.applicationContext
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        _adFreeUntil.value = p.getLong("adFreeUntil", 0L)
        _pro.value = p.getBoolean("pro", false)
        p.getString("config", null)?.let { s ->
            try { _config.value = json.decodeFromString(AdsConfig.serializer(), s); configKnown = true } catch (_: Exception) { }
        }
        installedAt = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).firstInstallTime } catch (e: Exception) { System.currentTimeMillis() }
        // purchases are restored from Play whenever a product id is known — whatever the "pro" sales switch says
        if (configKnown && _config.value.proProduct.isNotBlank()) Billing.start(ctx, _config.value.proProduct)
    }

    private var feedConfig: AdsConfig? = null
    private var remote: JsonObject? = null

    /** Firebase Remote Config "app_ads" (a JSON object, e.g. {"every":3,"gap":180}) overrides single feed values for
        the users in an A/B-test group, so caps and the pass length can be tested instead of guessed. Blank = off. */
    fun setRemoteOverride(text: String) {
        remote = text.takeIf { it.isNotBlank() }?.let { try { json.parseToJsonElement(it).jsonObject } catch (e: Exception) { null } }
        feedConfig?.let { setConfig(it) }
    }

    /** The feed's ad switches (config.json appAds). Saved, so the next cold start honours them before the feed loads. */
    fun setConfig(feed: AdsConfig) {
        feedConfig = feed
        val c = remote?.let { r ->
            try { json.decodeFromJsonElement(AdsConfig.serializer(), JsonObject(json.encodeToJsonElement(AdsConfig.serializer(), feed).jsonObject + r)) } catch (e: Exception) { feed }
        } ?: feed
        val changed = !configKnown || c != _config.value
        _config.value = c
        configKnown = true
        val ctx = app ?: return
        if (changed) ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("config", json.encodeToString(AdsConfig.serializer(), c)).apply()
        if (c.proProduct.isNotBlank()) Billing.start(ctx, c.proProduct)
        preloadAll(ctx)
    }

    /** Call from the activity's onCreate (every time: after Android killed the process, the restored activity must start
        the SDK again). Refreshes consent (the form shows only where required), then starts the SDK. */
    fun start(activity: Activity) {
        if (!BuildConfig.ADS || _pro.value) return      // Pro: no ads, so no consent form and no ad SDK at all
        val info = UserMessagingPlatform.getConsentInformation(activity)
        val params = ConsentRequestParameters.Builder().build()
        info.requestConsentInfoUpdate(activity, params, {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { err ->
                if (err != null) Log.w(TAG, "consent form: ${err.message}")
                afterConsent(activity, info)
            }
        }, { err ->
            Log.w(TAG, "consent update: ${err.message}")
            afterConsent(activity, info)
        })
        // a returning user who already answered can start straight away
        if (info.canRequestAds()) init(activity.applicationContext)
    }

    private fun afterConsent(activity: Activity, info: ConsentInformation) {
        _privacyRequired.value = info.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        if (info.canRequestAds()) init(activity.applicationContext)
    }

    private fun init(app: Context) {
        if (started.getAndSet(true)) return
        this.app = app
        // a jobs app for adults: keep ads to general/teen content
        MobileAds.setRequestConfiguration(
            RequestConfiguration.Builder().setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_T).build()
        )
        // the first requests wait until the mediation adapters have started, so every bidder joins the first auctions;
        // an adapter that never reports can't hold the ads back for more than 8 seconds
        val done = AtomicBoolean(false)
        val ready = Runnable { if (!done.getAndSet(true)) { _ready.value = true; preloadAll(app) } }
        main.postDelayed(ready, 8_000L)
        CoroutineScope(Dispatchers.IO).launch {
            MobileAds.initialize(app) { status ->
                if (BuildConfig.DEBUG) status.adapterStatusMap.forEach { (k, v) -> Log.i(TAG, "adapter $k: ${v.initializationState} ${v.latency} ms") }
                main.post(ready)
            }
        }
    }

    /** The "privacy choices" form, shown from Alerts › About where the user's region requires it. */
    fun showPrivacyOptions(activity: Activity) {
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { err -> if (err != null) Log.w(TAG, "privacy form: ${err.message}") }
    }

    /** Back in the app (activity onResume): maybe the app-open ad, and refill anything used up or expired (also restarts
        the loads once a pass has run out). */
    fun onResume(activity: Activity) {
        maybeShowAppOpen(activity)
        preloadAll(activity)
        Billing.recheck()
    }

    private fun preloadAll(ctx: Context) {
        if (!_ready.value || !configKnown) return
        preload(ctx)
        preloadRewarded(ctx)
        preloadAppOpen(ctx)
        preloadNative(ctx, "jobs")
        preloadNative(ctx, "updates")
        preloadNative(ctx, "detail")
    }

    /* ---- no-fill retries: 15 s, 30 s, 1 min … up to 10 min, one pending retry per format. Until that time no other
       trigger (returning to the app, opening a list) may request the format again, so a no-fill never turns into a
       burst of requests (which lowers the match rate). ---- */
    private val retryDelay = mutableMapOf<String, Long>()
    private val retryPending = mutableSetOf<String>()
    private val notBefore = mutableMapOf<String, Long>()
    private fun retryLater(key: String, ctx: Context, load: (Context) -> Unit) {
        if (key in retryPending) return
        val d = retryDelay[key] ?: 15_000L
        retryDelay[key] = (d * 2).coerceAtMost(600_000L)
        notBefore[key] = now() + d
        retryPending += key
        val appCtx = ctx.applicationContext
        main.postDelayed({ retryPending -= key; notBefore.remove(key); load(appCtx) }, d)
    }
    private fun backingOff(key: String) = now() < (notBefore[key] ?: 0L)
    private fun loadedOk(key: String) { retryDelay.remove(key); notBefore.remove(key) }

    private fun now() = SystemClock.elapsedRealtime()
    private const val MAX_AGE = 55 * 60_000L          // interstitial, rewarded and native ads expire after an hour

    private fun fullScreenCallback(key: String, ctx: Context, reload: (Context) -> Unit) = object : FullScreenContentCallback() {
        override fun onAdDismissedFullScreenContent() { _fullScreen.value = false; reload(ctx) }
        override fun onAdFailedToShowFullScreenContent(error: AdError) { _fullScreen.value = false; Log.w(TAG, "$key show: ${error.message}"); reload(ctx) }
    }

    /* ---- interstitial: only on the way back from a page to a list ---- */
    private var interstitial: InterstitialAd? = null
    private var interstitialAt = 0L
    private var loading = false
    private var pagesSince = 0
    private var lastShown = 0L
    private val appStart = SystemClock.elapsedRealtime()
    /** Debug-only: show the next full-screen ad regardless of the caps (used by the CI screenshots). */
    var forceNext = false

    private fun preload(ctx: Context) {
        if (!_ready.value || !configKnown || !on() || !_config.value.interstitial || loading || BuildConfig.AD_INTERSTITIAL.isBlank() || backingOff("interstitial")) return
        if (interstitial != null && now() - interstitialAt < MAX_AGE) return
        interstitial = null
        loading = true
        InterstitialAd.load(ctx.applicationContext, BuildConfig.AD_INTERSTITIAL, AdRequest.Builder().build(), object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(ad: InterstitialAd) { interstitial = ad; interstitialAt = now(); loading = false; loadedOk("interstitial"); Log.i(TAG, "interstitial loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) { interstitial = null; loading = false; Log.i(TAG, "interstitial: ${error.message}"); retryLater("interstitial", ctx) { preload(it) } }
        })
    }

    /** A job or result page was opened. */
    fun pageOpened() { pagesSince++ }

    /** The user went back from a page to a list: a natural break, the only place a full-screen ad may appear. Returns true if one is shown. */
    fun backFromPage(activity: Activity): Boolean {
        if (!_ready.value || !on()) return false
        val c = _config.value
        val now = now()
        val due = forceNext || (c.interstitial && pagesSince >= c.every.coerceAtLeast(1) &&
            now - lastShown >= c.gap.coerceAtLeast(60) * 1000L && now - appStart >= 60_000L)
        val ad = interstitial?.takeIf { now - interstitialAt < MAX_AGE }
        Log.i(TAG, "back from page: due=$due loaded=${ad != null} pages=$pagesSince")
        if (!due || ad == null || activity.isFinishing || activity.isDestroyed) { preload(activity); return false }
        forceNext = false
        interstitial = null
        ad.fullScreenContentCallback = fullScreenCallback("interstitial", activity.applicationContext) { preload(it) }
        pagesSince = 0
        lastShown = now
        _fullScreen.value = true
        ad.show(activity)
        return true
    }

    /* ---- rewarded video: the opt-in Sarkari Radar Pass ---- */
    private var rewarded: RewardedAd? = null
    private var rewardedAt = 0L
    private var rewardedLoading = false
    private val _rewardedReady = MutableStateFlow(false)
    /** A rewarded video is loaded, so the pass offer can be shown (the tap then always plays). */
    val rewardedReady: StateFlow<Boolean> = _rewardedReady.asStateFlow()

    private fun preloadRewarded(ctx: Context) {
        val c = _config.value
        if (!_ready.value || !configKnown || !BuildConfig.ADS || !c.on || !c.rewarded || BuildConfig.AD_REWARDED.isBlank() || rewardedLoading || backingOff("rewarded")) return
        if (adFree()) return                        // a pass or Pro is running: the offer isn't shown, load again when it ends
        if (rewarded != null && now() - rewardedAt < MAX_AGE) return
        rewarded = null
        _rewardedReady.value = false
        rewardedLoading = true
        RewardedAd.load(ctx.applicationContext, BuildConfig.AD_REWARDED, AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
            override fun onAdLoaded(ad: RewardedAd) { rewarded = ad; rewardedAt = now(); rewardedLoading = false; _rewardedReady.value = true; loadedOk("rewarded"); Log.i(TAG, "rewarded loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) {
                rewarded = null; rewardedLoading = false; _rewardedReady.value = false
                Log.i(TAG, "rewarded: ${error.message}")
                retryLater("rewarded", ctx) { preloadRewarded(it) }
            }
        })
    }

    /** Plays the rewarded video the person asked for. The pass starts when the SDK reports the reward as earned. */
    fun showRewarded(activity: Activity, from: String = "other"): Boolean {
        val ad = rewarded?.takeIf { now() - rewardedAt < MAX_AGE } ?: run { preloadRewarded(activity); return false }
        if (activity.isFinishing || activity.isDestroyed) return false
        rewarded = null
        _rewardedReady.value = false
        ad.fullScreenContentCallback = fullScreenCallback("rewarded", activity.applicationContext) { preloadRewarded(it) }
        passFrom = from
        Stats.event(activity, "pass_watch", "from" to from)
        _fullScreen.value = true
        ad.show(activity) { grantAdFree(activity) }
        return true
    }

    private var passFrom = "other"

    private fun grantAdFree(ctx: Context) {
        Stats.event(ctx, "pass_granted", "from" to passFrom)
        val hours = _config.value.rewardHours.coerceIn(1, 24 * 7)
        val until = maxOf(System.currentTimeMillis(), _adFreeUntil.value) + hours * 3_600_000L
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("adFreeUntil", until).apply()
        _adFreeUntil.value = until
        Log.i(TAG, "ad-free pass until $until")
    }

    /* ---- app-open ad: only when someone comes back to the app after a real break (AdMob's "app open" format) ----
       Never on a cold start (the person would already be reading when it loaded), never on the first day after
       install, never when they arrive from a notification or a link (they came for that page), at most once per
       appAds.appOpenGap seconds, and never within a minute of another full-screen ad. Shown only if already loaded. */
    private var installedAt = 0L
    private var appOpenAd: AppOpenAd? = null
    private var appOpenAt = 0L
    private var appOpenLoading = false
    private var backgroundSince = 0L
    private var foregroundPending = false
    /** Debug-only (CI screenshots): show the next app-open ad regardless of the caps. */
    var forceAppOpen = false

    /** The whole app went to the background (ProcessLifecycleOwner ON_STOP). */
    fun onProcessBackground() { backgroundSince = now(); foregroundPending = false }

    /** The app came back (ON_START): an app-open ad becomes possible if the break was long enough. */
    fun onProcessForeground() {
        foregroundPending = backgroundSince > 0 && now() - backgroundSince >= _config.value.appOpenAway.coerceAtLeast(60) * 1000L
    }

    /** Arrived through a notification or a link: show what they came for, no app-open ad this time. */
    fun suppressAppOpen() { foregroundPending = false }

    private fun preloadAppOpen(ctx: Context) {
        val c = _config.value
        if (!_ready.value || !configKnown || !on() || !c.appOpen || BuildConfig.AD_APP_OPEN.isBlank() || appOpenLoading || backingOff("app-open")) return
        if (appOpenAd != null && now() - appOpenAt < 4 * 3_600_000L) return   // app-open ads expire after 4 h
        appOpenAd = null
        appOpenLoading = true
        AppOpenAd.load(ctx.applicationContext, BuildConfig.AD_APP_OPEN, AdRequest.Builder().build(), object : AppOpenAd.AppOpenAdLoadCallback() {
            override fun onAdLoaded(ad: AppOpenAd) { appOpenAd = ad; appOpenAt = now(); appOpenLoading = false; loadedOk("app-open"); Log.i(TAG, "app-open loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) { appOpenAd = null; appOpenLoading = false; Log.i(TAG, "app-open: ${error.message}"); retryLater("app-open", ctx) { preloadAppOpen(it) } }
        })
    }

    private fun maybeShowAppOpen(activity: Activity) {
        if (!_ready.value) return
        val pending = foregroundPending || forceAppOpen
        foregroundPending = false
        val ad = appOpenAd
        val now = now()
        val wall = System.currentTimeMillis()
        val p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val c = _config.value
        val allowed = forceAppOpen || (on() && c.appOpen && wall - installedAt >= 24 * 3_600_000L &&
            wall - p.getLong("appOpenShown", 0L) >= c.appOpenGap.coerceAtLeast(3600) * 1000L && now - lastShown >= 60_000L)
        val fresh = ad != null && now - appOpenAt < 4 * 3_600_000L
        if (!pending || !allowed || !fresh || _fullScreen.value || activity.isFinishing || activity.isDestroyed) return
        forceAppOpen = false
        appOpenAd = null
        ad!!.fullScreenContentCallback = fullScreenCallback("app-open", activity.applicationContext) { preloadAppOpen(it) }
        p.edit().putLong("appOpenShown", wall).apply()
        lastShown = now            // counts towards the interstitial's gap too: never two full-screen ads close together
        Stats.event(activity, "app_open_ad")
        Log.i(TAG, "app-open shown")
        _fullScreen.value = true
        ad.show(activity)
    }

    /* ---- native ads: one per list, loaded ahead of time; refreshed when the list is opened again after the ad was
       seen (at least 2 minutes earlier), hidden once it is an hour old ---- */
    private class NativeSlot { var ad: NativeAd? = null; var at = 0L; var seen = 0L; var loading = false }
    private val nativeSlots = mutableMapOf<String, NativeSlot>()
    private val _nativeVersion = MutableStateFlow(0)
    /** Bumps whenever a native ad arrives, so the list card recomposes. */
    val nativeVersion: StateFlow<Int> = _nativeVersion.asStateFlow()

    /** Loads (or refreshes) the native ad for [slot] ("jobs", "updates") when it is missing, old, or already seen. */
    fun preloadNative(ctx: Context, slot: String) {
        val c = _config.value
        if (!_ready.value || !configKnown || !on() || !c.nativeAds || BuildConfig.AD_NATIVE.isBlank()) return
        val s = nativeSlots.getOrPut(slot) { NativeSlot() }
        val now = now()
        val needed = s.ad == null || now - s.at > MAX_AGE || (s.seen > 0 && now - s.seen > 120_000L)
        if (!needed || s.loading || backingOff("native-$slot")) return
        s.loading = true
        AdLoader.Builder(ctx.applicationContext, BuildConfig.AD_NATIVE)
            .forNativeAd { ad ->
                s.ad?.destroy()
                s.ad = ad; s.at = now(); s.seen = 0L; s.loading = false
                loadedOk("native-$slot")
                _nativeVersion.value = _nativeVersion.value + 1
                Log.i(TAG, "native loaded ($slot)")
            }
            .withAdListener(object : AdListener() {
                override fun onAdFailedToLoad(error: LoadAdError) {
                    s.loading = false
                    Log.i(TAG, "native ($slot): ${error.code} ${error.message}" + if (BuildConfig.DEBUG) " | $error" else "")
                    retryLater("native-$slot", ctx) { preloadNative(it, slot) }
                }
                override fun onAdImpression() { s.seen = now() }
            })
            .withNativeAdOptions(NativeAdOptions.Builder().setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT).build())
            .build()
            .loadAd(AdRequest.Builder().build())
    }

    /** The loaded native ad for [slot], or null (none yet, ads off, or older than an hour — then it is hidden). */
    fun nativeAd(slot: String): NativeAd? {
        if (!on() || !_config.value.nativeAds) return null
        val s = nativeSlots[slot] ?: return null
        return s.ad?.takeIf { now() - s.at < 60 * 60_000L }
    }
}

fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is Activity) return c; c = c.baseContext }
    return null
}

/**
 * The anchored banner's AdView, owned by the screen root so it survives visits to job pages: it is paused while a page
 * is open and resumed on return, instead of being destroyed and requested again on every round trip (which also loaded
 * banners behind the full-screen ad). A banner that never filled is retried with a growing delay.
 */
class AnchoredBanner internal constructor(ctx: Context, unit: String, size: AdSize, val heightPx: Int) {
    val view = AdView(ctx)
    var loaded by mutableStateOf(false)
        private set
    var failed by mutableStateOf(false)
        private set
    private var requested = false
    private var destroyed = false
    private var retryMs = 30_000L
    private val handler = Handler(Looper.getMainLooper())

    init {
        view.adUnitId = unit
        view.setAdSize(size)
        view.adListener = object : AdListener() {
            override fun onAdLoaded() { loaded = true; failed = false; retryMs = 30_000L; Log.i(Ads.TAG, "banner loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) {
                Log.i(Ads.TAG, "banner failed ${error.code}: ${error.message}")
                if (loaded) return                  // a failed refresh keeps the last ad on screen
                failed = true
                handler.postDelayed({ if (!destroyed) request() }, retryMs)
                retryMs = (retryMs * 2).coerceAtMost(600_000L)
            }
        }
    }

    fun requestOnce() { if (!requested && !destroyed) { requested = true; request() } }
    private fun request() { Log.i(Ads.TAG, "banner request"); view.loadAd(AdRequest.Builder().build()) }
    fun destroy() { destroyed = true; handler.removeCallbacksAndMessages(null); view.destroy() }
}

/** Call once at the screen root; null while banners are off (feed switch, pass, Pro, no unit ID, SDK not ready). */
@Composable
fun rememberAnchoredBanner(): AnchoredBanner? {
    val ready by Ads.ready.collectAsStateWithLifecycle()
    val cfg by Ads.config.collectAsStateWithLifecycle()
    val off = Ads.adsOff()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.banner || BuildConfig.AD_BANNER.isBlank() || off) return null
    val ctx = LocalContext.current
    val width = LocalConfiguration.current.screenWidthDp
    val large = cfg.bannerSize == "large"
    val banner = remember(large, width) {
        val size = if (large) AdSize.getLargeAnchoredAdaptiveBannerAdSize(ctx, width) else standardAnchored(ctx, width)
        AnchoredBanner(ctx, BuildConfig.AD_BANNER, size, size.getHeightInPixels(ctx))
    }
    DisposableEffect(banner) { onDispose { banner.destroy() } }
    return banner
}

/** The anchored banner under the lists: labelled, its height kept free while it loads (no jump), and kept 12 dp off
    the tab bar (with a divider there) so a tap meant for the tabs can't land on it. Folds away if no ad came. */
@Composable
fun BottomBanner(banner: AnchoredBanner?, adLabel: String) {
    banner ?: return
    val fullScreen by Ads.fullScreen.collectAsStateWithLifecycle()
    LaunchedEffect(banner, fullScreen) { if (!fullScreen) banner.requestOnce() }   // never first-requested behind a full-screen ad
    LifecycleResumeEffect(banner) {
        banner.view.resume()
        onPauseOrDispose { banner.view.pause() }   // also when a page opens and the banner leaves the screen
    }
    if (banner.failed) return
    val heightDp = with(LocalDensity.current) { banner.heightPx.toDp() }
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (banner.loaded) adLabel else " ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 2.dp))
        Box(Modifier.fillMaxWidth().height(heightDp), contentAlignment = Alignment.Center) {
            AndroidView(factory = { (banner.view.parent as? ViewGroup)?.removeView(banner.view); banner.view })
        }
    }
}

/** The regular anchored adaptive size (deprecated in SDK 25 in favour of the "large" one, which is up to twice as tall). */
@Suppress("DEPRECATION")
private fun standardAnchored(ctx: Context, width: Int): AdSize = AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(ctx, width)

/** One in-content unit on job and result pages, labelled, with its 250 dp kept from the first frame so the page never
    jumps under the reader's finger when it arrives (the space closes only if no ad fills). */
@Composable
fun InlineAd(label: String) {
    val ready by Ads.ready.collectAsStateWithLifecycle()
    val cfg by Ads.config.collectAsStateWithLifecycle()
    val off = Ads.adsOff()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.inline || BuildConfig.AD_INLINE.isBlank() || off) return
    AdBox(BuildConfig.AD_INLINE, { AdSize.MEDIUM_RECTANGLE }, label = label, modifier = Modifier.padding(top = 18.dp))
}

/** One native ad inside a list, styled like the cards around it but labelled, with Google's AdChoices mark. Shown only
    once an ad is loaded (it is preloaded when the app starts, long before the reader scrolls to it). */
@Composable
fun NativeAdCard(slot: String, label: String, modifier: Modifier = Modifier, preloadNext: String? = null) {
    val ready by Ads.ready.collectAsStateWithLifecycle()
    val cfg by Ads.config.collectAsStateWithLifecycle()
    val off = Ads.adsOff()
    val version by Ads.nativeVersion.collectAsStateWithLifecycle()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.nativeAds || BuildConfig.AD_NATIVE.isBlank() || off) return
    val ad = remember(version, slot) { Ads.nativeAd(slot) } ?: return
    if (preloadNext != null) {
        val ctx = LocalContext.current
        LaunchedEffect(preloadNext) { Ads.preloadNative(ctx, preloadNext) }   // the next card down the list
    }
    val fg = MaterialTheme.colorScheme.onSurface.toArgb()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant.toArgb()
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 8.dp))
            AndroidView(factory = { c -> NativeAdView(c).also { buildNativeViews(it) } }, update = { v -> bindNative(v, ad, fg, muted) },
                onRelease = { it.destroy() }, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Refreshes a list's native ad when the list is opened (call from the list screen). */
@Composable
fun RefreshNative(slot: String) {
    val ctx = LocalContext.current
    LaunchedEffect(slot) { Ads.preloadNative(ctx, slot) }
}

/** The classic views (icon, headline, advertiser, body, media, button) a NativeAdView needs, built in code. */
private fun buildNativeViews(v: NativeAdView) {
    val c = v.context
    val d = c.resources.displayMetrics.density
    fun dp(x: Int) = (x * d).toInt()
    val root = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(6), dp(16), dp(14)) }
    val top = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    val icon = ImageView(c).apply { layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(10) } }
    val titles = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
    val headline = TextView(c).apply { textSize = 16f; setTypeface(null, Typeface.BOLD); maxLines = 2; ellipsize = TextUtils.TruncateAt.END }
    val advertiser = TextView(c).apply { textSize = 12f; maxLines = 1; ellipsize = TextUtils.TruncateAt.END }
    titles.addView(headline); titles.addView(advertiser)
    top.addView(icon); top.addView(titles)
    val body = TextView(c).apply { textSize = 14f; maxLines = 3; ellipsize = TextUtils.TruncateAt.END; setPadding(0, dp(6), 0, dp(8)) }
    val media = MediaView(c).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(150)); setImageScaleType(ImageView.ScaleType.FIT_CENTER) }
    val cta = Button(c).apply { isAllCaps = false; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) } }
    root.addView(top); root.addView(body); root.addView(media); root.addView(cta)
    v.addView(root)
    v.iconView = icon; v.headlineView = headline; v.advertiserView = advertiser; v.bodyView = body; v.mediaView = media; v.callToActionView = cta
}

private fun bindNative(v: NativeAdView, ad: NativeAd, fg: Int, muted: Int) {
    (v.headlineView as TextView).apply { text = ad.headline ?: ""; setTextColor(fg) }
    (v.advertiserView as TextView).apply { text = ad.advertiser ?: ad.store ?: ""; setTextColor(muted); visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE }
    (v.bodyView as TextView).apply { text = ad.body ?: ""; setTextColor(fg); visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE }
    (v.iconView as ImageView).apply { val ic = ad.icon?.drawable; setImageDrawable(ic); visibility = if (ic == null) View.GONE else View.VISIBLE }
    (v.callToActionView as Button).apply { text = ad.callToAction ?: ""; visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE }
    val media = ad.mediaContent
    v.mediaView?.apply {
        if (media != null) {
            setMediaContent(media)
            // keep the creative's own shape (only a little letterboxing): height from its aspect ratio, 120–220 dp
            val d = resources.displayMetrics.density
            val width = (resources.displayMetrics.widthPixels - 66 * d).coerceAtLeast(200 * d)   // list + card padding
            val ratio = media.aspectRatio
            val h = if (ratio > 0f) width / ratio else 150 * d
            layoutParams = layoutParams.apply { height = h.coerceIn(120 * d, 220 * d).toInt() }
        }
        visibility = if (media == null) View.GONE else View.VISIBLE
    }
    v.setNativeAd(ad)
}

@Composable
private fun AdBox(unit: String, size: (Context) -> AdSize, label: String?, modifier: Modifier = Modifier, key: Any? = null) {
    val ctx = LocalContext.current
    val density = LocalDensity.current
    var loaded by remember(unit, key) { mutableStateOf(false) }
    var failed by remember(unit, key) { mutableStateOf(false) }
    val adSize = remember(unit, key) { size(ctx) }
    val heightDp = remember(unit, key) { with(density) { adSize.getHeightInPixels(ctx).toDp() } }
    val view = remember(unit, key) {
        AdView(ctx).apply {
            adUnitId = unit
            setAdSize(adSize)
            adListener = object : AdListener() {
                override fun onAdLoaded() { loaded = true; Log.i(Ads.TAG, "inline loaded ${adSize.width}x$heightDp") }
                override fun onAdFailedToLoad(error: LoadAdError) { if (!loaded) failed = true; Log.i(Ads.TAG, "inline failed ${error.code}: ${error.message}") }
            }
            Log.i(Ads.TAG, "inline request ${adSize.width}x$heightDp")
            loadAd(AdRequest.Builder().build())
        }
    }
    DisposableEffect(view) { onDispose { view.destroy() } }
    LifecycleResumeEffect(view) {
        view.resume()
        onPauseOrDispose { view.pause() }
    }
    if (failed) return
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        // the label's line and the ad's height are kept from the first frame, so nothing moves when the ad arrives
        if (label != null) Text(if (loaded) label else " ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 2.dp))
        Box(Modifier.fillMaxWidth().height(heightDp), contentAlignment = Alignment.Center) {
            AndroidView(factory = { view })
        }
    }
}
