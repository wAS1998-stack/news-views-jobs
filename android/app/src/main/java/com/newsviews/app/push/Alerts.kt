package com.newsviews.app.push

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.newsviews.app.BuildConfig
import com.newsviews.app.MainActivity
import com.newsviews.app.R
import com.newsviews.app.data.Prefs
import com.newsviews.app.data.Settings
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Job alerts are Firebase topics; the server (push-notify.js on the site) sends each new job to
 * (s-central for central/all-India jobs, else its state or s-any) AND (its lowest qualification level) AND the language. This keeps the phone's topic list
 * in step with the person's choices.
 */
object Alerts {
    const val CH_JOBS = "jobs"
    const val CH_RESULTS = "results"
    const val CH_REMINDERS = "reminders"

    fun topicsFor(s: Settings): Set<String> {
        val t = mutableSetOf<String>()
        if (s.alerts) {
            if (s.central) t += "s-central"
            if (s.states.isEmpty()) t += "s-any" else s.states.forEach { t += "s-$it" }
            s.qual.levels.forEach { t += "q-$it" }
        }
        if (s.results) t += "results"     // its own switch on the Alerts screen
        // followed departments: everything new from them, even with general job alerts off
        s.follows.map { orgTopic(it) }.filter { it != "o-" }.forEach { t += it }
        if (t.isNotEmpty()) t += if (s.hindi) "l-hi" else "l-en"
        return t
    }

    fun orgTopic(org: String) = "o-" + com.newsviews.app.data.orgSlug(org)

    fun firebaseReady(context: Context): Boolean =
        BuildConfig.HAS_FIREBASE && try { FirebaseApp.getApps(context).isNotEmpty() } catch (e: Exception) { false }

    private val syncLock = Mutex()

    /** Subscribe/unsubscribe only the difference; remembers what the phone is subscribed to. One sync at a time
        (settings changes, app resume and a new token can all ask at once), each topic call bounded by a timeout. */
    suspend fun sync(context: Context, prefs: Prefs) {
        if (!firebaseReady(context)) return
        syncLock.withLock {
            val s = prefs.current()
            val want = topicsFor(s)
            val have = s.subscribed
            val fm = FirebaseMessaging.getInstance()
            val done = have.toMutableSet()
            for (t in have - want) if (withTimeoutOrNull(15_000) { runCatching { fm.unsubscribeFromTopic(t).await() }.isSuccess } == true) done -= t
            for (t in want - have) if (withTimeoutOrNull(15_000) { runCatching { fm.subscribeToTopic(t).await() }.isSuccess } == true) done += t
            prefs.setSubscribed(done)
        }
    }

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CH_JOBS, "Job alerts", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "New government jobs for your state and qualification"
        })
        nm.createNotificationChannel(NotificationChannel(CH_RESULTS, "Results & admit cards", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Results, admit cards and answer keys of major exams"
        })
        nm.createNotificationChannel(NotificationChannel(CH_REMINDERS, "Last-date reminders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Reminders before the last date of jobs you saved"
        })
    }

    /** Notifications can really be shown: the Android 13+ permission and the app-level switch in system settings. */
    fun canNotify(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    const val OPEN_ITEM = "in.newsviews.app.OPEN_ITEM"

    @SuppressLint("MissingPermission")   // canNotify() is checked first
    fun show(context: Context, channel: String, tag: String, title: String, body: String, kind: String, id: String) {
        if (!canNotify(context)) return
        val intent = Intent(context, MainActivity::class.java).apply {
            action = OPEN_ITEM
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("kind", kind)
            putExtra("id", id)
        }
        val pi = PendingIntent.getActivity(context, tag.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.brand_azure))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)          // the same job sent to two of the phone's topics buzzes once
            .setContentIntent(pi)
            .build()
        try { NotificationManagerCompat.from(context).notify(tag, 1, n) } catch (e: SecurityException) { /* permission revoked */ }
    }
}
