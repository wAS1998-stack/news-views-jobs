package com.newsviews.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.newsviews.app.data.Dates
import com.newsviews.app.data.JobItem
import com.newsviews.app.data.Prefs
import com.newsviews.app.data.Status
import com.newsviews.app.data.isClosed
import com.newsviews.app.data.status
import com.newsviews.app.data.UpdateItem
import com.newsviews.app.push.Alerts
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * Saved jobs get two reminders: 9 AM two days before the last date, and 9 AM on the last day (none once marked applied).
 * "Remind me" on a result / admit card / exam date gets two as well: 7 PM the evening before and 8 AM on the day.
 */
object Reminders {
    private fun name(id: String, which: String) = "remind-$which-$id"

    private fun enqueue(wm: WorkManager, unique: String, at: ZonedDateTime, data: androidx.work.Data): Boolean {
        val delay = Duration.between(ZonedDateTime.now(Dates.IST), at).toMillis()
        if (delay <= 0) { wm.cancelUniqueWork(unique); return false }   // the date moved earlier or passed: no stale reminder
        val req = OneTimeWorkRequestBuilder<ReminderWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).setInputData(data).build()
        wm.enqueueUniqueWork(unique, ExistingWorkPolicy.REPLACE, req)
        return true
    }

    fun schedule(context: Context, id: String, title: String, lastDate: String) {
        val end = Dates.parse(lastDate) ?: return
        val wm = WorkManager.getInstance(context)
        for ((which, daysBefore) in listOf("2d" to 2L, "0d" to 0L)) {
            val at = ZonedDateTime.of(end.minusDays(daysBefore), LocalTime.of(9, 0), Dates.IST)
            enqueue(wm, name(id, which), at, workDataOf("kind" to "job", "id" to id, "title" to title, "end" to lastDate, "which" to which))
        }
    }

    /** After each refresh: saved jobs follow their current last date (deadlines are often extended). REPLACE keeps it
        idempotent. Jobs marked as applied get no reminders. */
    fun rescheduleAll(context: Context, jobs: List<JobItem>, hindi: Boolean, applied: Set<String> = emptySet()) {
        for (j in jobs) {
            // applied, closed, cancelled or postponed (the feed's date is then the notice date): no reminders
            val st = j.status()
            if (j.id in applied || st.isClosed() || st == Status.POSTPONED || j.ns.isNotBlank() || j.en.isBlank()) cancel(context, j.id)
            else schedule(context, j.id, j.title(hindi), j.en)
        }
    }

    fun cancelAll(context: Context, ids: Collection<String>) { for (id in ids) cancel(context, id) }

    fun cancel(context: Context, id: String) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(name(id, "2d"))
        wm.cancelUniqueWork(name(id, "0d"))
    }

    /* ---- "Remind me" on dates: key "u:<updateId>" (a result / admit card / exam date) or "x:<jobId>" (a job's exam) ---- */

    /** 7 PM IST the day before [date] and 8 AM on the day. [label]: what the notice is ("Admit card", "Exam"…) in the
        app's language; the reminder says only that its date is tomorrow / today, not what happens on it. */
    /** Whether an event reminder can still come: 7 PM IST the day before or 8 AM IST on the day is still ahead. */
    fun canRemind(date: String): Boolean {
        val day: LocalDate = Dates.parse(date) ?: return false
        val now = java.time.ZonedDateTime.now(Dates.IST)
        return java.time.ZonedDateTime.of(day, java.time.LocalTime.of(8, 0), Dates.IST).isAfter(now)
    }

    fun scheduleEvent(context: Context, key: String, title: String, label: String, date: String) {
        val day: LocalDate = Dates.parse(date) ?: return
        val wm = WorkManager.getInstance(context)
        val kind = if (key.startsWith("x:")) "exam" else "update"
        val id = key.substringAfter(':')
        val slots = listOf("ev1" to ZonedDateTime.of(day.minusDays(1), LocalTime.of(19, 0), Dates.IST), "ev0" to ZonedDateTime.of(day, LocalTime.of(8, 0), Dates.IST))
        for ((which, at) in slots) {
            enqueue(wm, name(key, which), at, workDataOf("kind" to kind, "id" to id, "key" to key, "title" to title, "label" to label, "end" to date, "which" to which))
        }
    }

    fun cancelEvent(context: Context, key: String) {
        val wm = WorkManager.getInstance(context)
        wm.cancelUniqueWork(name(key, "ev1"))
        wm.cancelUniqueWork(name(key, "ev0"))
    }

    /** The event date of a tracked key in the current feed ("" when it is no longer there). */
    fun eventDate(key: String, jobs: Map<String, JobItem>, updates: Map<String, UpdateItem>): String = when {
        key.startsWith("u:") -> updates[key.substring(2)]?.ev.orEmpty()
        key.startsWith("x:") -> jobs[key.substring(2)]?.x.orEmpty()
        else -> ""
    }
}

class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("id") ?: return Result.success()
        val title = inputData.getString("title") ?: return Result.success()
        val end = inputData.getString("end") ?: ""
        val which = inputData.getString("which") ?: ""
        val kind = inputData.getString("kind") ?: "job"          // older requests (before this field) were all saved jobs
        val settings = Prefs(applicationContext).current()
        val hi = settings.hindi
        if (kind == "update" || kind == "exam") {
            val key = inputData.getString("key") ?: return Result.success()
            if (key !in settings.tracked) return Result.success()
            val label = inputData.getString("label") ?: ""
            val head = when {
                which == "ev0" && hi -> "आज, ${Dates.pretty(end, true)}"
                which == "ev0" -> "Today, ${Dates.pretty(end)}"
                hi -> "कल, ${Dates.pretty(end, true)}"
                else -> "Tomorrow, ${Dates.pretty(end)}"
            }
            val body = if (label.isBlank()) title else "$label: $title"
            // an exam date of a job opens the job; a result / admit card opens its page
            Alerts.show(applicationContext, Alerts.CH_REMINDERS, "e-$key-$which", head, body, if (kind == "exam") "job" else "update", id)
            return Result.success()
        }
        if (!settings.reminders || id !in settings.saved || id in settings.applied) return Result.success()
        val lastDay = which == "0d"
        val head = when {
            hi && lastDay -> "आज अंतिम तिथि है"
            hi -> "अंतिम तिथि 2 दिन में (${Dates.pretty(end, true)})"
            lastDay -> "Last day to apply today"
            else -> "Last date in 2 days (${Dates.pretty(end)})"
        }
        Alerts.show(applicationContext, Alerts.CH_REMINDERS, "r-$id", head, title, "job", id)
        return Result.success()
    }
}
