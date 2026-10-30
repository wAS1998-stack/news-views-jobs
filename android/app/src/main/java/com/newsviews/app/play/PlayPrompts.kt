package com.newsviews.app.play

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.android.play.core.review.ReviewManagerFactory
import com.newsviews.app.BuildConfig
import java.time.LocalDate

/**
 * Google Play's own rating sheet and update download. Both do nothing in copies not installed from Play (the debug
 * APK). The rating sheet is asked for only after real use — at least 6 job/result pages opened on 3 different days —
 * at most once every 90 days, at a natural break (back to the list), and Google applies its own quota on top.
 */
object PlayPrompts {
    private const val TAG = "NVPlay"
    private const val PREFS = "engagement"

    fun pageOpened(ctx: Context) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val today = LocalDate.now().toString()
        val e = p.edit().putInt("pages", p.getInt("pages", 0) + 1)
        if (p.getString("lastDay", "") != today) e.putString("lastDay", today).putInt("days", p.getInt("days", 0) + 1)
        e.apply()
    }

    /** Back on a list after reading pages: maybe show Play's "rate this app" sheet (it appears over the app; no redirect). */
    fun maybeAskReview(activity: Activity) {
        if (BuildConfig.DEBUG) return
        val p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (p.getInt("pages", 0) < 6 || p.getInt("days", 0) < 3 || now - p.getLong("askedAt", 0) < 90L * 86_400_000) return
        p.edit().putLong("askedAt", now).apply()
        val manager = ReviewManagerFactory.create(activity)
        manager.requestReviewFlow().addOnCompleteListener { task ->
            if (task.isSuccessful) manager.launchReviewFlow(activity, task.result)
            else Log.i(TAG, "review not available: ${task.exception?.message}")
        }
    }

    private var updates: AppUpdateManager? = null

    /** On start: if Play has a newer version, offer a background ("flexible") download — at most every 3 days per version. */
    fun checkForUpdate(activity: Activity, launcher: ActivityResultLauncher<IntentSenderRequest>) {
        val m = updates ?: AppUpdateManagerFactory.create(activity.applicationContext).also { updates = it }
        m.appUpdateInfo.addOnSuccessListener { info ->
            if (info.installStatus() == InstallStatus.DOWNLOADED) return@addOnSuccessListener   // installed on onStop
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE || !info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) return@addOnSuccessListener
            val p = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val key = "updateAsked_${info.availableVersionCode()}"
            val now = System.currentTimeMillis()
            if (now - p.getLong(key, 0) < 3L * 86_400_000) return@addOnSuccessListener
            p.edit().putLong(key, now).apply()
            m.startUpdateFlowForResult(info, launcher, AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build())
        }.addOnFailureListener { Log.i(TAG, "update check: ${it.message}") }
    }

    /** When the app goes to the background, a downloaded update installs quietly (no interruption while reading). */
    fun installIfDownloaded() {
        val m = updates ?: return
        m.appUpdateInfo.addOnSuccessListener { info -> if (info.installStatus() == InstallStatus.DOWNLOADED) m.completeUpdate() }
    }
}
