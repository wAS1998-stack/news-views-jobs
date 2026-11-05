package com.newsviews.app

import android.content.Context
import android.os.Bundle
import com.google.firebase.analytics.FirebaseAnalytics

/** Usage events for Firebase Analytics (only in builds with google-services.json). No personal data: names and counts. */
object Stats {
    fun event(ctx: Context, name: String, vararg params: Pair<String, String>) {
        if (!BuildConfig.HAS_FIREBASE) return
        try {
            val b = Bundle()
            for ((k, v) in params) b.putString(k, v.take(100))
            FirebaseAnalytics.getInstance(ctx.applicationContext).logEvent(name, b)
        } catch (_: Exception) { }
    }

    fun screen(ctx: Context, name: String) = event(ctx, FirebaseAnalytics.Event.SCREEN_VIEW, FirebaseAnalytics.Param.SCREEN_NAME to name)

    /** Non-personal segments for revenue and retention reports: language, qualification level, alerts on/off, Pro. */
    fun userProps(ctx: Context, hindi: Boolean, qual: String, alerts: Boolean, pro: Boolean) {
        if (!BuildConfig.HAS_FIREBASE) return
        try {
            val fa = FirebaseAnalytics.getInstance(ctx.applicationContext)
            fa.setUserProperty("lang", if (hindi) "hi" else "en")
            fa.setUserProperty("qual", qual)
            fa.setUserProperty("alerts", if (alerts) "on" else "off")
            fa.setUserProperty("pro", if (pro) "yes" else "no")
        } catch (_: Exception) { }
    }

    /** A purchase with its value, so Pro revenue sits next to ad revenue in Analytics. */
    fun purchase(ctx: Context, item: String, value: Double, currency: String) {
        if (!BuildConfig.HAS_FIREBASE) return
        try {
            val b = Bundle()
            b.putString(FirebaseAnalytics.Param.ITEM_ID, item)
            b.putDouble(FirebaseAnalytics.Param.VALUE, value)
            b.putString(FirebaseAnalytics.Param.CURRENCY, currency)
            FirebaseAnalytics.getInstance(ctx.applicationContext).logEvent(FirebaseAnalytics.Event.PURCHASE, b)
        } catch (_: Exception) { }
    }
}

/** Logs [name] once while this screen element is shown (e.g. an offer card), with a source. */
@androidx.compose.runtime.Composable
fun LogOnce(name: String, from: String) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    androidx.compose.runtime.LaunchedEffect(name, from) { Stats.event(ctx, name, "from" to from) }
}
