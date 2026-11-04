package com.newsviews.app.ads

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import android.util.Log
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
    private const val PREFS = "ads"

    fun adFree(): Boolean = System.currentTimeMillis() < _adFreeUntil.value

    /** Call from Application.onCreate: restores a running ad-free pass. */
    fun restore(ctx: Context) {
        app = ctx.applicationContext
        _adFreeUntil.value = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("adFreeUntil", 0L)
    }
    private var pagesSince = 0
    private var lastShown = 0L
    private val appStart = SystemClock.elapsedRealtime()
    /** Debug-only: show the next full-screen ad regardless of the caps (used by the CI screenshots). */
    var forceNext = false

    fun setConfig(c: AdsConfig) { _config.value = c; app?.let { preloadRewarded(it) } }

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
        ad.show(activity) { grantAdFree(activity) }
        return true
    }

    private fun grantAdFree(ctx: Context) {
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
    val adFreeUntil by Ads.adFreeUntil.collectAsStateWithLifecycle()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.banner || BuildConfig.AD_BANNER.isBlank() || adFreeUntil > System.currentTimeMillis()) return
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
    val adFreeUntil by Ads.adFreeUntil.collectAsStateWithLifecycle()
    if (!ready || !BuildConfig.ADS || !cfg.on || !cfg.inline || BuildConfig.AD_INLINE.isBlank() || adFreeUntil > System.currentTimeMillis()) return
    AdBox(BuildConfig.AD_INLINE, { AdSize.MEDIUM_RECTANGLE }, label = label, modifier = Modifier.padding(top = 18.dp))
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
