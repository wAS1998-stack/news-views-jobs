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
import com.newsviews.app.data.Dates
import com.newsviews.app.data.Prefs
import com.newsviews.app.data.Repository
import com.newsviews.app.data.Settings
import com.newsviews.app.data.Status
import com.newsviews.app.data.status
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
    const val CH_QUIZ = "quiz"
    val CHANNELS = setOf(CH_JOBS, CH_RESULTS, CH_REMINDERS, CH_QUIZ)

    /** [openSaved]: saved jobs that can still be applied for — each gets "sv-<id>", the topic push-notify.js uses to announce
        a new (later) last date (at most 50; a phone may hold 2000 topics). */
    fun topicsFor(s: Settings, openSaved: Collection<String> = emptyList()): Set<String> {
        val t = mutableSetOf<String>()
        if (s.alerts) {
            if (s.central) t += "s-central"
            val states = s.states - "gulf"   // no Gulf jobs in the app (private employers)
            if (states.isEmpty()) t += "s-any" else states.forEach { t += "s-$it" }
            s.qual.levels.forEach { t += "q-$it" }
            if (s.digest) t += "digest"   // the evening summary (push-notify.js), part of job alerts
        }
        if (s.results) t += "results"     // its own switch on the Alerts screen
        if (s.quizAlerts) t += "quiz"     // the morning "today's quiz is out" (push-notify.js, once a day)
        openSaved.filter { it in s.saved }.take(50).forEach { t += "sv-$it" }
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
            val want = topicsFor(s, openSavedJobs(context, s))
            val have = s.subscribed
            val fm = FirebaseMessaging.getInstance()
            val done = have.toMutableSet()
            for (t in have - want) if (withTimeoutOrNull(15_000) { runCatching { fm.unsubscribeFromTopic(t).await() }.isSuccess } == true) done -= t
            // FCM queues a subscribe and finishes it later when it times out here: only an outright failure is "not subscribed"
            for (t in want - have) if (withTimeoutOrNull(15_000) { runCatching { fm.subscribeToTopic(t).await() }.isSuccess } != false) done += t
            prefs.setSubscribed(done)
        }
    }

    /** Saved jobs still worth an extension alert: open, or closed in the last 3 days (extensions often come just after
        the old last date). From the saved snapshots, which follow the feed after every refresh. */
    private suspend fun openSavedJobs(context: Context, s: Settings): List<String> = if (s.saved.isEmpty()) emptyList() else withContext(Dispatchers.IO) {
        val repo = Repository(context)
        val since = Dates.today().minusDays(3).toString()
        s.saved.filter { id ->
            val j = repo.savedSnapshot(id) ?: return@filter true
            j.status() != Status.CANCELLED && (j.en.isBlank() || j.en >= since)
        }.sorted()
    }

    /** The notification channels, named in the app's language. [hindi] null (app start, before the settings are read):
        only missing channels are created, so names chosen earlier stay; otherwise every name follows the language
        (Android lets an app rename its channels; the importance the person set is kept). */
    fun createChannels(context: Context, hindi: Boolean? = null) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        val hi = hindi ?: Prefs.DEFAULT_HINDI
        fun make(id: String, en: String, enDesc: String, hiName: String, hiDesc: String, importance: Int) {
            if (hindi == null && nm.getNotificationChannel(id) != null) return
            nm.createNotificationChannel(NotificationChannel(id, if (hi) hiName else en, importance).apply { description = if (hi) hiDesc else enDesc })
        }
        make(CH_JOBS, "Job alerts", "New government jobs for your state and qualification",
            "नौकरी अलर्ट", "आपके राज्य और योग्यता की नई सरकारी नौकरियाँ", NotificationManager.IMPORTANCE_HIGH)
        make(CH_RESULTS, "Results & admit cards", "Results, admit cards and answer keys of major exams",
            "रिजल्ट और प्रवेश पत्र", "बड़ी परीक्षाओं के रिजल्ट, प्रवेश पत्र और उत्तर कुंजी", NotificationManager.IMPORTANCE_DEFAULT)
        make(CH_REMINDERS, "Last-date reminders", "Reminders before the last date of jobs you saved, and the dates you asked to be reminded of",
            "अंतिम तिथि रिमाइंडर", "सेव नौकरियों की अंतिम तिथि और आपकी चुनी तिथियों से पहले रिमाइंडर", NotificationManager.IMPORTANCE_HIGH)
        make(CH_QUIZ, "Daily quiz", "The new current affairs quiz, once a morning",
            "डेली क्विज़", "हर सुबह नया करंट अफेयर्स क्विज़", NotificationManager.IMPORTANCE_DEFAULT)
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
