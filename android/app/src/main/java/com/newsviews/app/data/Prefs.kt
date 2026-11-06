package com.newsviews.app.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.datastore.preferences.core.emptyPreferences
import java.io.IOException
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

// a corrupted settings file is replaced with defaults instead of crashing the app on every start
private val Context.store by preferencesDataStore("settings", corruptionHandler = ReplaceFileCorruptionHandler { emptyPreferences() })

/** Highest qualification choices; each covers the levels a person with it can apply for. */
enum class Qual(val key: String, val en: String, val hi: String, val levels: List<String>) {
    TENTH("10th", "10th pass", "10वीं पास", listOf("10th-pass")),
    TWELFTH("12th", "12th pass", "12वीं पास", listOf("10th-pass", "12th-pass")),
    DIPLOMA("diploma", "Diploma / ITI", "डिप्लोमा / ITI", listOf("10th-pass", "12th-pass", "engineering-diploma")),
    GRADUATE("graduate", "Graduate", "स्नातक", listOf("10th-pass", "12th-pass", "graduate")),
    ENGINEER("engineer", "Engineering (B.E./B.Tech)", "इंजीनियरिंग (B.E./B.Tech)", listOf("10th-pass", "12th-pass", "graduate", "engineering-diploma")),
    PG("pg", "Post graduate", "स्नातकोत्तर", listOf("10th-pass", "12th-pass", "graduate", "post-graduate")),
    ANY("any", "Show all", "सभी दिखाएँ", listOf("10th-pass", "12th-pass", "graduate", "engineering-diploma", "post-graduate"));

    companion object { fun of(key: String?) = entries.firstOrNull { it.key == key } ?: ANY }
}

data class Settings(
    val hindi: Boolean = false,
    val onboarded: Boolean = false,
    val alerts: Boolean = true,
    val results: Boolean = true,
    val reminders: Boolean = true,
    val digest: Boolean = true,               // one evening summary of the day's biggest new jobs (topic "digest")
    val central: Boolean = true,              // central government (all-India) jobs: SSC, Railway, Bank, Defence, PSU
    val states: Set<String> = emptySet(),
    val qual: Qual = Qual.ANY,
    val saved: Set<String> = emptySet(),
    val subscribed: Set<String> = emptySet(),
    val follows: Set<String> = emptySet(),   // departments followed (as shown, e.g. "SSC")
    val dob: String = "",                     // date of birth, yyyy-mm-dd — kept only on the phone
    val category: String = "gen",             // gen | obc | scst — for upper-age relaxation
    val quizDays: Set<String> = emptySet(),   // yyyy-mm-dd of each daily quiz finished (only the last 60 are kept)
    val quizAlerts: Boolean = true,           // the morning "today's quiz is out" notification (topic "quiz")
    val tracked: Set<String> = emptySet(),    // "Remind me" on results / exam dates: "u:<updateId>" or "x:<jobId>" (a job's exam date)
    val applied: Set<String> = emptySet(),    // saved jobs the person marked as applied (no more last-date reminders)
    val quizScores: Map<String, String> = emptyMap(),   // quiz date (yyyy-mm-dd) -> "7/10", the last 60
) {
    /** Days in a row with a finished quiz, ending today (or yesterday, so the streak survives until tonight). */
    fun quizStreak(today: java.time.LocalDate = Dates.today()): Int {
        var d = if (today.toString() in quizDays) today else today.minusDays(1)
        var n = 0
        while (d.toString() in quizDays) { n++; d = d.minusDays(1) }
        return n
    }
    /** Age in whole years on [on] (notices count age on a cut-off date; the job's last date is the usual one). */
    fun age(on: java.time.LocalDate = Dates.today()): Int? = Dates.parse(dob)?.let { java.time.Period.between(it, on).years }
    fun ageFor(job: JobItem): Int? = age(Dates.parse(job.en) ?: Dates.today())
    /** Upper-age relaxation under central government rules (state rules can differ; the app says so). */
    fun relaxation(): Int = when (category) { "obc" -> 3; "scst" -> 5; else -> 0 }
    fun follows(o: String): Boolean = o.isNotBlank() && follows.any { orgSlug(it) == orgSlug(o) }
    /** Picked their own states, qualification or turned central jobs off — "For you" then means something. */
    fun hasProfile(): Boolean = states.isNotEmpty() || qual != Qual.ANY || !central
}

class Prefs(private val context: Context) {
    companion object {
        /** First run on a phone whose language is Hindi: Hindi UI and Hindi alerts until the person switches. */
        val DEFAULT_HINDI: Boolean = java.util.Locale.getDefault().language == "hi"
    }

    private object K {
        val hindi = booleanPreferencesKey("hindi")
        val onboarded = booleanPreferencesKey("onboarded")
        val alerts = booleanPreferencesKey("alerts")
        val results = booleanPreferencesKey("results")
        val reminders = booleanPreferencesKey("reminders")
        val digest = booleanPreferencesKey("digest")
        val central = booleanPreferencesKey("central")
        val states = stringSetPreferencesKey("states")
        val qual = stringPreferencesKey("qual")
        val saved = stringSetPreferencesKey("saved")
        val subscribed = stringSetPreferencesKey("subscribed")
        val follows = stringSetPreferencesKey("follows")
        val quizDays = stringSetPreferencesKey("quizDays")
        val dob = stringPreferencesKey("dob")
        val category = stringPreferencesKey("category")
        val quizAlerts = booleanPreferencesKey("quizAlerts")
        val tracked = stringSetPreferencesKey("tracked")
        val applied = stringSetPreferencesKey("applied")
        val quizScores = stringSetPreferencesKey("quizScores")   // "yyyy-mm-dd=7/10"
    }

    val flow: Flow<Settings> = context.store.data.catch { e -> if (e is IOException) emit(emptyPreferences()) else throw e }.map { p ->
        Settings(
            hindi = p[K.hindi] ?: DEFAULT_HINDI,
            onboarded = p[K.onboarded] ?: false,
            alerts = p[K.alerts] ?: true,
            results = p[K.results] ?: true,
            reminders = p[K.reminders] ?: true,
            digest = p[K.digest] ?: true,
            central = p[K.central] ?: true,
            states = p[K.states] ?: emptySet(),
            qual = Qual.of(p[K.qual]),
            saved = p[K.saved] ?: emptySet(),
            subscribed = p[K.subscribed] ?: emptySet(),
            follows = p[K.follows] ?: emptySet(),
            quizDays = p[K.quizDays] ?: emptySet(),
            dob = p[K.dob] ?: "",
            category = p[K.category] ?: "gen",
            quizAlerts = p[K.quizAlerts] ?: true,
            tracked = p[K.tracked] ?: emptySet(),
            applied = p[K.applied] ?: emptySet(),
            quizScores = (p[K.quizScores] ?: emptySet()).mapNotNull { e -> e.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }.toMap(),
        )
    }

    suspend fun current(): Settings = flow.first()

    suspend fun setHindi(v: Boolean) = context.store.edit { it[K.hindi] = v }
    suspend fun setOnboarded() = context.store.edit { it[K.onboarded] = true }
    suspend fun setAlerts(v: Boolean) = context.store.edit { it[K.alerts] = v }
    suspend fun setResults(v: Boolean) = context.store.edit { it[K.results] = v }
    suspend fun setReminders(v: Boolean) = context.store.edit { it[K.reminders] = v }
    suspend fun setDigest(v: Boolean) = context.store.edit { it[K.digest] = v }
    suspend fun setCentral(v: Boolean) = context.store.edit { it[K.central] = v }
    suspend fun setStates(v: Set<String>) = context.store.edit { it[K.states] = v }
    suspend fun setQual(q: Qual) = context.store.edit { it[K.qual] = q.key }
    suspend fun setSubscribed(v: Set<String>) = context.store.edit { it[K.subscribed] = v }
    suspend fun setDob(v: String) = context.store.edit { it[K.dob] = v }
    suspend fun setCategory(v: String) = context.store.edit { it[K.category] = v }
    suspend fun quizDone(date: String) = context.store.edit {
        it[K.quizDays] = ((it[K.quizDays] ?: emptySet()) + date).sortedDescending().take(60).toSet()
    }
    suspend fun setQuizAlerts(v: Boolean) = context.store.edit { it[K.quizAlerts] = v }
    /** The score of the quiz of [quizDate] (the first try counts; replaying keeps the first score). */
    suspend fun quizScore(quizDate: String, score: String) = context.store.edit {
        val cur = it[K.quizScores] ?: emptySet()
        if (cur.none { e -> e.startsWith("$quizDate=") }) it[K.quizScores] = (cur + "$quizDate=$score").sortedDescending().take(60).toSet()
    }
    /** Adds or removes a "Remind me" key ("u:<id>" / "x:<id>"); returns true when it is now tracked. */
    suspend fun toggleTracked(key: String): Boolean {
        var now = false
        context.store.edit {
            val cur = it[K.tracked] ?: emptySet()
            now = key !in cur
            it[K.tracked] = if (now) cur + key else cur - key
        }
        return now
    }
    suspend fun setTracked(v: Set<String>) = context.store.edit { it[K.tracked] = v }
    /** Marks a saved job as applied (or not); returns true when it is now marked. */
    suspend fun toggleApplied(id: String): Boolean {
        var now = false
        context.store.edit {
            val cur = it[K.applied] ?: emptySet()
            now = id !in cur
            it[K.applied] = if (now) cur + id else cur - id
        }
        return now
    }
    suspend fun dropApplied(id: String) = context.store.edit { it[K.applied] = (it[K.applied] ?: emptySet()) - id }
    suspend fun toggleFollow(org: String) = context.store.edit {
        val cur = it[K.follows] ?: emptySet()
        val match = cur.firstOrNull { f -> orgSlug(f) == orgSlug(org) }
        it[K.follows] = if (match != null) cur - match else cur + org
    }
    suspend fun toggleSaved(id: String): Boolean {
        var nowSaved = false
        context.store.edit {
            val cur = it[K.saved] ?: emptySet()
            nowSaved = id !in cur
            it[K.saved] = if (nowSaved) cur + id else cur - id
        }
        return nowSaved
    }
}
