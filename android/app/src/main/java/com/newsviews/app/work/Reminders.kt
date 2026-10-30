package com.newsviews.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.newsviews.app.data.Dates
import com.newsviews.app.data.Prefs
import com.newsviews.app.push.Alerts
import java.time.Duration
import java.time.LocalTime
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/** Saved jobs get two reminders: 9 AM two days before the last date, and 9 AM on the last day. */
object Reminders {
    private fun name(id: String, which: String) = "remind-$which-$id"

    fun schedule(context: Context, id: String, title: String, lastDate: String) {
        val end = Dates.parse(lastDate) ?: return
        val wm = WorkManager.getInstance(context)
        for ((which, daysBefore) in listOf("2d" to 2L, "0d" to 0L)) {
            val at = ZonedDateTime.of(end.minusDays(daysBefore), LocalTime.of(9, 0), Dates.IST)
            val delay = Duration.between(ZonedDateTime.now(Dates.IST), at).toMillis()
            if (delay <= 0) continue
            val req = OneTimeWorkRequestBuilder<ReminderWorker>()
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setInputData(workDataOf("id" to id, "title" to title, "end" to lastDate, "which" to which))
                .build()
            wm.enqueueUniqueWork(name(id, which), ExistingWorkPolicy.REPLACE, req)
        }
    }

    /** After each refresh: saved jobs follow their current last date (deadlines are often extended). REPLACE keeps it idempotent. */
    fun rescheduleAll(context: Context, jobs: List<com.newsviews.app.data.JobItem>, hindi: Boolean) {
        for (j in jobs) if (j.en.isNotBlank()) schedule(context, j.id, j.title(hindi), j.en)
    }

    fun cancelAll(context: Context, ids: Collection<String>) { for (id in ids) cancel(context, id) }

    fun cancel(context: Context, id: String) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(name(id, "2d"))
        wm.cancelUniqueWork(name(id, "0d"))
    }
}

class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.success()
        val title = inputData.getString("title") ?: return Result.success()
        val end = inputData.getString("end") ?: ""
        val settings = Prefs(applicationContext).current()
        if (!settings.reminders || id !in settings.saved) return Result.success()
        val lastDay = inputData.getString("which") == "0d"
        val head = when {
            settings.hindi && lastDay -> "आज अंतिम तिथि है"
            settings.hindi -> "अंतिम तिथि 2 दिन में (${Dates.pretty(end)})"
            lastDay -> "Last day to apply today"
            else -> "Last date in 2 days (${Dates.pretty(end)})"
        }
        Alerts.show(applicationContext, Alerts.CH_REMINDERS, "r-$id", head, title, "job", id)
        return Result.success()
    }
}
