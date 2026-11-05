package com.newsviews.app.ads

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Typeface
import android.os.SystemClock
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.graphics.toArgb
import com.google.android.gms.ads.AdLoader
import com.google.android.gms.ads.nativead.MediaView
import com.google.android.gms.ads.nativead.NativeAd
import com.google.android.gms.ads.nativead.NativeAdOptions
import com.google.android.gms.ads.nativead.NativeAdView
import com.newsviews.app.Stats
import com.newsviews.app.play.Billing
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
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
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import com.newsviews.app.BuildConfig
import com.newsviews.app.data.AdsConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Google AdMob, kept polite: one anchored banner under the lists, one unit inside each job / result page and a
 * full-screen ad only when going back from a page, at most once per [AdsConfig.every] pages and [AdsConfig.gap]
 * seconds (never in the first minute). Consent is asked through Google's UMP form where the law requires it (EEA/UK);
 * nothing loads until the SDK says ads may be requested. Release builds without real IDs never start the SDK.
 *
 * Rewarded video (the "ad-free pass"): entirely opt-in — an offer card says "watch one short video, no ads for N hours";
 * nothing in the app is locked behind it. While the pass runs, no banner, in-page or full-screen ad is shown.
 */
object Ads {
    const val TAG = "NVAds"
    private val started = AtomicBoolean(false)
    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready.asStateFlow()
    private val _config = MutableStateFlow(AdsConfig())
    val config: StateFlow<AdsConfig> = _config.asStateFlow()
    private val _privacyRequired = MutableStateFlow(false)
    val privacyRequired: StateFlow<Boolean> = _privacyRequired.asStateFlow()

    private var app: Context? = null
    private var interstitial: InterstitialAd? = null
    private var loading = false
    private var rewarded: RewardedAd? = null
    private var rewardedLoading = false
    private val _rewardedReady = MutableStateFlow(false)
    /** A rewarded video is loaded, so the ad-free offer can be shown (the tap then always plays). */
    val rewardedReady: StateFlow<Boolean> = _rewardedReady.asStateFlow()
    private val _adFreeUntil = MutableStateFlow(0L)
    /** Epoch millis until which no ads are shown — earned by watching a rewarded video; 0 = no pass. */
    val adFreeUntil: StateFlow<Long> = _adFreeUntil.asStateFlow()
    private val _pro = MutableStateFlow(false)
    /** "Pro" bought through Play Billing: no ads, ever (see play/Billing.kt). */
    val pro: StateFlow<Boolean> = _pro.asStateFlow()
    const val PREFS = "ads"

    fun adFree(): Boolean = _pro.value || System.currentTimeMillis() < _adFreeUntil.value
    fun setPro(v: Boolean) { _pro.value = v }

    /** No ads right now (a pass is running or Pro is owned). Call it first thing in a composable: it collects state. */
    @Composable
    fun adsOff(): Boolean {
        val until by adFreeUntil.collectAsStateWithLifecycle()
        val isPro by pro.collectAsStateWithLifecycle()
        return isPro || until > System.currentTimeMillis()
    }

    /** Call from Application.onCreate: restores a running ad-free pass and the Pro flag. */
    fun restore(ctx: Context) {
        app = ctx.applicationContext
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        _adFreeUntil.value = p.getLong("adFreeUntil", 0L)
        _pro.value = p.getBoolean("pro", false)
        installedAt = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).firstInstallTime } catch (e: Exception) { System.currentTimeMillis() }
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
    fun onProcessBackground() { backgroundSince = SystemClock.elapsedRealtime(); foregroundPending = false }

    /** The app came back (ON_START): an app-open ad becomes possible if the break was long enough. */
    fun onProcessForeground() {
        foregroundPending = backgroundSince > 0 &&
            SystemClock.elapsedRealtime() - backgroundSince >= _config.value.appOpenAway.coerceAtLeast(60) * 1000L
    }

    /** Arrived through a notification or a link: show what they came for, no app-open ad this time. */
    fun suppressAppOpen() { foregroundPending = false }

    private fun preloadAppOpen(ctx: Context) {
        val c = _config.value
        if (!on() || !c.appOpen || BuildConfig.AD_APP_OPEN.isBlank() || appOpenLoading) return
        if (appOpenAd != null && SystemClock.elapsedRealtime() - appOpenAt < 4 * 3_600_000L) return   // app-open ads expire after 4 h
        appOpenLoading = true
        AppOpenAd.load(ctx.applicationContext, BuildConfig.AD_APP_OPEN, AdRequest.Builder().build(), object : AppOpenAd.AppOpenAdLoadCallback() {
            override fun onAdLoaded(ad: AppOpenAd) { appOpenAd = ad; appOpenAt = SystemClock.elapsedRealtime(); appOpenLoading = false; Log.i(TAG, "app-open loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) { appOpenAd = null; appOpenLoading = false; Log.i(TAG, "app-open: ${error.message}") }
        })
    }

    /** Call from the activity's onResume (after onNewIntent, so a notification tap has already suppressed it). */
    fun maybeShowAppOpen(activity: Activity) {
        if (!_ready.value) return
        val pending = foregroundPending || forceAppOpen
        foregroundPending = false
        val ad = appOpenAd
        val now = SystemClock.elapsedRealtime()
        val wall = System.currentTimeMillis()
        val p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val c = _config.value
        val allowed = forceAppOpen || (on() && c.appOpen && wall - installedAt >= 24 * 3_600_000L &&
            wall - p.getLong("appOpenShown", 0L) >= c.appOpenGap.coerceAtLeast(3600) * 1000L && now - lastShown >= 60_000L)
        val fresh = ad != null && now - appOpenAt < 4 * 3_600_000L
        if (!pending || !allowed || !fresh || activity.isFinishing || activity.isDestroyed) { preloadAppOpen(activity); return }
        forceAppOpen = false
        appOpenAd = null
        ad!!.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { preloadAppOpen(activity) }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { Log.w(TAG, "app-open show: ${error.message}"); preloadAppOpen(activity) }
        }
        p.edit().putLong("appOpenShown", wall).apply()
        lastShown = now            // counts towards the interstitial's gap too: never two full-screen ads close together
        Stats.event(activity, "app_open_ad")
        ad.show(activity)
    }
    private var pagesSince = 0
    private var lastShown = 0L
    private val appStart = SystemClock.elapsedRealtime()
    /** Debug-only: show the next full-screen ad regardless of the caps (used by the CI screenshots). */
    var forceNext = false

    fun setConfig(c: AdsConfig) {
        _config.value = c
        app?.let { preloadRewarded(it); if (c.pro) Billing.start(it, c.proProduct) }
    }

    private fun on(): Boolean = BuildConfig.ADS && _config.value.on && !adFree()

    /** Call from the activity's onCreate: refreshes consent (shows the form only where required), then starts the SDK. */
    fun start(activity: Activity) {
        if (!BuildConfig.ADS) return
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
        CoroutineScope(Dispatchers.IO).launch {
            MobileAds.initialize(app) {}
            withContext(Dispatchers.Main) {
                _ready.value = true
                preload(app)
                preloadRewarded(app)
                preloadAppOpen(app)
            }
        }
    }

    /** The "privacy choices" form, shown from Alerts › About where the user's region requires it. */
    fun showPrivacyOptions(activity: Activity) {
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { err -> if (err != null) Log.w(TAG, "privacy form: ${err.message}") }
    }

    private fun preload(ctx: Context) {
        if (!on() || !_config.value.interstitial || interstitial != null || loading || BuildConfig.AD_INTERSTITIAL.isBlank()) return
        loading = true
        InterstitialAd.load(ctx.applicationContext, BuildConfig.AD_INTERSTITIAL, AdRequest.Builder().build(), object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(ad: InterstitialAd) { interstitial = ad; loading = false; Log.i(TAG, "interstitial loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) { interstitial = null; loading = false; Log.i(TAG, "interstitial: ${error.message}") }
        })
    }

    /** Loads the next rewarded video. It plays only when the person taps the ad-free offer. */
    fun preloadRewarded(ctx: Context) {
        val c = _config.value
        if (!_ready.value || !BuildConfig.ADS || !c.on || !c.rewarded || BuildConfig.AD_REWARDED.isBlank() || rewarded != null || rewardedLoading) return
        rewardedLoading = true
        RewardedAd.load(ctx.applicationContext, BuildConfig.AD_REWARDED, AdRequest.Builder().build(), object : RewardedAdLoadCallback() {
            override fun onAdLoaded(ad: RewardedAd) { rewarded = ad; rewardedLoading = false; _rewardedReady.value = true; Log.i(TAG, "rewarded loaded") }
            override fun onAdFailedToLoad(error: LoadAdError) { rewarded = null; rewardedLoading = false; _rewardedReady.value = false; Log.i(TAG, "rewarded: ${error.message}") }
        })
    }

    /** Plays the rewarded video the person asked for. The pass starts when the SDK reports the reward as earned. */
    fun showRewarded(activity: Activity): Boolean {
        val ad = rewarded ?: return false
        if (activity.isFinishing || activity.isDestroyed) return false
        rewarded = null
        _rewardedReady.value = false
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { preloadRewarded(activity) }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { Log.w(TAG, "rewarded show: ${error.message}"); preloadRewarded(activity) }
        }
        Stats.event(activity, "pass_watch")
        ad.show(activity) { grantAdFree(activity) }
        return true
    }

    /* ---- native ads: one per list, kept for an hour, so scrolling past it never re-requests ---- */
    private val natives = mutableMapOf<String, NativeAd>()
    private val nativeAt = mutableMapOf<String, Long>()
    private val nativeLoading = mutableSetOf<String>()
    private val _nativeVersion = MutableStateFlow(0)
    /** Bumps whenever a native ad arrives, so the list card recomposes. */
    val nativeVersion: StateFlow<Int> = _nativeVersion.asStateFlow()

    /** The native ad for [slot] ("jobs", "updates"), loading it (or a fresh one after an hour) when needed. */
    fun nativeAd(slot: String, ctx: Context): NativeAd? {
        val c = _config.value
        if (!_ready.value || !BuildConfig.ADS || !c.on || !c.nativeAds || BuildConfig.AD_NATIVE.isBlank() || adFree()) return null
        val have = natives[slot]
        val stale = have == null || SystemClock.elapsedRealtime() - (nativeAt[slot] ?: 0L) > 3_600_000L
        if (stale && slot !in nativeLoading) {
            nativeLoading += slot
            AdLoader.Builder(ctx.applicationContext, BuildConfig.AD_NATIVE)
                .forNativeAd { ad ->
                    natives.remove(slot)?.destroy()
                    natives[slot] = ad; nativeAt[slot] = SystemClock.elapsedRealtime(); nativeLoading -= slot
                    _nativeVersion.value = _nativeVersion.value + 1
                    Log.i(TAG, "native loaded ($slot)")
                }
                .withAdListener(object : AdListener() {
                    override fun onAdFailedToLoad(error: LoadAdError) { nativeLoading -= slot; Log.i(TAG, "native ($slot): ${error.message}") }
                })
                .withNativeAdOptions(NativeAdOptions.Builder().setAdChoicesPlacement(NativeAdOptions.ADCHOICES_TOP_RIGHT).build())
                .build()
                .loadAd(AdRequest.Builder().build())
        }
        return have
    }

    private fun grantAdFree(ctx: Context) {
        Stats.event(ctx, "pass_granted")
        val hours = _config.value.rewardHours.coerceIn(1, 24 * 7)
        val until = maxOf(System.currentTimeMillis(), _adFreeUntil.value) + hours * 3_600_000L
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("adFreeUntil", until).apply()
        _adFreeUntil.value = until
        Log.i(TAG, "ad-free pass until $until")
    }

    /** A job or result page was opened. */
    fun pageOpened() { pagesSince++ }

    /** The user went back from a page to a list: a natural break, the only place a full-screen ad may appear. Returns true if one is shown. */
    fun backFromPage(activity: Activity): Boolean {
        if (!_ready.value || !on()) return false
        val c = _config.value
        val now = SystemClock.elapsedRealtime()
        val due = forceNext || (c.interstitial && pagesSince >= c.every.coerceAtLeast(1) &&
            now - lastShown >= c.gap.coerceAtLeast(60) * 1000L && now - appStart >= 60_000L)
        val ad = interstitial
        Log.i(TAG, "back from page: due=$due loaded=${ad != null} pages=$pagesSince")
        if (!due || ad == null || activity.isFinishing || activity.isDestroyed) { preload(activity); return false }
        forceNext = false
        interstitial = null
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
            override fun onAdDismissedFullScreenContent() { preload(activity) }
            override fun onAdFailedToShowFullScreenContent(error: AdError) { preload(activity) }
        }
        pagesSince = 0
        lastShown = now
        ad.show(activity)
        return true
    }
}

fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) { if (c is Activity) return c; c = c.baseContext }
    return null
}

/** Anchored adaptive banner (under the lists). Its height is kept free while it loads (no jump); it folds away if no ad comes. */
@Composable
fun BottomBanner(adLabel: String) {
    val ready by Ads.ready.collectAsStateWithLifecycle()
    val cfg by Ads.config.collectAsStateWithLifecycle()
    val off = Ads.adsOff()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.banner || BuildConfig.AD_BANNER.isBlank() || off) return
    val width = LocalConfiguration.current.screenWidthDp
    val large = cfg.bannerSize == "large"
    // labelled and kept off the tab bar (a 6 dp gap), so it can't be mistaken for app content or tapped by accident
    AdBox(BuildConfig.AD_BANNER, { ctx -> if (large) AdSize.getLargeAnchoredAdaptiveBannerAdSize(ctx, width) else standardAnchored(ctx, width) },
        label = adLabel, reserve = true, key = large, modifier = Modifier.padding(bottom = 6.dp))
}

/** The regular anchored adaptive size (deprecated in SDK 25 in favour of the "large" one, which is up to twice as tall). */
@Suppress("DEPRECATION")
private fun standardAnchored(ctx: Context, width: Int): AdSize = AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(ctx, width)

/** One in-content unit on job and result pages, labelled so it can't be mistaken for page content. */
@Composable
fun InlineAd(label: String) {
    val ready by Ads.ready.collectAsStateWithLifecycle()
    val cfg by Ads.config.collectAsStateWithLifecycle()
    val off = Ads.adsOff()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.inline || BuildConfig.AD_INLINE.isBlank() || off) return
    AdBox(BuildConfig.AD_INLINE, { AdSize.MEDIUM_RECTANGLE }, label = label, modifier = Modifier.padding(top = 18.dp))
}

/** One native ad inside a list, styled like the cards around it but labelled, with Google's AdChoices mark. */
@Composable
fun NativeAdCard(slot: String, label: String, modifier: Modifier = Modifier) {
    val ready by Ads.ready.collectAsStateWithLifecycle()
    val cfg by Ads.config.collectAsStateWithLifecycle()
    val off = Ads.adsOff()
    val version by Ads.nativeVersion.collectAsStateWithLifecycle()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.nativeAds || BuildConfig.AD_NATIVE.isBlank() || off) return
    val ctx = LocalContext.current
    val ad = remember(version, slot) { Ads.nativeAd(slot, ctx) } ?: return
    val fg = MaterialTheme.colorScheme.onSurface.toArgb()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant.toArgb()
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 8.dp))
            AndroidView(factory = { c -> NativeAdView(c).also { buildNativeViews(it) } }, update = { v -> bindNative(v, ad, fg, muted) }, modifier = Modifier.fillMaxWidth())
        }
    }
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
    val media = MediaView(c).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(150)); setImageScaleType(ImageView.ScaleType.CENTER_CROP) }
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
    v.mediaView?.apply { if (media != null) setMediaContent(media); visibility = if (media == null) View.GONE else View.VISIBLE }
    v.setNativeAd(ad)
}

@Composable
private fun AdBox(unit: String, size: (Context) -> AdSize, label: String?, modifier: Modifier = Modifier, reserve: Boolean = false, key: Any? = null) {
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
                override fun onAdLoaded() { loaded = true; Log.i(Ads.TAG, "banner loaded ${adSize.width}x$heightDp") }
                override fun onAdFailedToLoad(error: LoadAdError) { failed = true; Log.i(Ads.TAG, "banner failed ${error.code}: ${error.message}") }
            }
            Log.i(Ads.TAG, "banner request ${adSize.width}x$heightDp")
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
        // the reserved banner keeps the label's line too, so nothing moves when the ad arrives
        if (label != null && (loaded || reserve)) Text(if (loaded) label else " ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 2.dp))
        // the view must be attached to load; an in-page unit waits at height 0, the anchored banner keeps its space
        Box(Modifier.fillMaxWidth().height(if (loaded || reserve) heightDp else 0.dp), contentAlignment = Alignment.Center) {
            AndroidView(factory = { view })
        }
    }
}
