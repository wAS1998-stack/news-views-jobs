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
}
