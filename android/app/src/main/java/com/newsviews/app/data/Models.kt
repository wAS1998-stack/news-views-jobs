package com.newsviews.app.data

import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/* Mirrors https://news-views.in/app/v1/ (written by build.js on every site build). */

@Serializable
data class Named(val slug: String, val name: String)

@Serializable
data class JobItem(
    val id: String,
    val t: String,
    val th: String = "",
    val o: String = "",
    val p: String = "",
    val v: Int = 0,
    val q: List<String> = emptyList(),
    val s: List<String> = emptyList(),
    val a0: Double = 0.0,
    val a1: Double = 0.0,
    val st: String = "",
    val en: String = "",
    val pub: String = "",
    val x: String = "",
    val ok: Int = 0,
) {
    fun title(hindi: Boolean) = if (hindi && th.isNotBlank()) th else t
}

@Serializable
data class UpdateItem(
    val id: String,
    val t: String,
    val th: String = "",
    val o: String = "",
    val ty: String = "",
    val d: String = "",
    val ev: String = "",
    val big: Int = 0,
) {
    fun title(hindi: Boolean) = if (hindi && th.isNotBlank()) th else t
}

@Serializable
data class AppIndex(
    val api: Int = 1,
    val built: String = "",
    val at: String = "",
    val site: String = "https://news-views.in",
    val states: List<Named> = emptyList(),
    val quals: List<Named> = emptyList(),
    val types: List<Named> = emptyList(),
    val jobs: List<JobItem> = emptyList(),
    val updates: List<UpdateItem> = emptyList(),
    val ads: AdsConfig = AdsConfig(),
)

/** Ad switches sent with the feed (config.json "appAds"), so placements can be tuned or turned off without an app update. */
@Serializable
data class AdsConfig(
    val on: Boolean = true,
    val banner: Boolean = true,        // anchored banner under the job / result / saved lists
    val inline: Boolean = true,        // one in-content unit on job and result pages
    val interstitial: Boolean = true,  // full-screen ad when going back from a page, capped below
    val every: Int = 4,                // at most once per this many pages opened
    val gap: Int = 240,                // and at least this many seconds apart
)

@Serializable
data class Faq(val q: String, val a: String)

@Serializable
data class JobHi(
    val title: String = "",
    val summary: String = "",
    val overview: List<String> = emptyList(),
    val eligibility_notes: String = "",
    val selection_process: List<String> = emptyList(),
    val how_to_apply: List<String> = emptyList(),
    val faq: List<Faq> = emptyList(),
)

@Serializable
data class JobDetail(
    val id: String,
    val url: String = "",
    val title: String = "",
    val organization: String = "",
    val org_short: String = "",
    val post_name: String = "",
    val total_vacancies: Int = 0,
    val qualification: String = "",
    val quals: List<String> = emptyList(),
    val states: List<String> = emptyList(),
    val age_min: Double = 0.0,
    val age_max: Double = 0.0,
    val salary: String = "",
    val fee: String = "",
    val application_start: String = "",
    val application_end: String = "",
    val exam_date: String = "",
    val location: String = "",
    val published: String = "",
    val verified: Boolean = false,
    val summary: String = "",
    val overview: List<String> = emptyList(),
    val eligibility_notes: String = "",
    val selection_process: List<String> = emptyList(),
    val how_to_apply: List<String> = emptyList(),
    val faq: List<Faq> = emptyList(),
    val official_notification: String = "",
    val apply_link: String = "",
    val official_website: String = "",
    val hi: JobHi? = null,
)

@Serializable
data class UpdateHi(
    val title: String = "",
    val summary: String = "",
    val steps: List<String> = emptyList(),
    val details: List<String> = emptyList(),
    val faq: List<Faq> = emptyList(),
)

@Serializable
data class UpdateDetail(
    val id: String,
    val url: String = "",
    val type: String = "",
    val type_name: String = "",
    val title: String = "",
    val organization: String = "",
    val org_short: String = "",
    val exam_name: String = "",
    val date: String = "",
    val event_date: String = "",
    val summary: String = "",
    val steps: List<String> = emptyList(),
    val details: List<String> = emptyList(),
    val faq: List<Faq> = emptyList(),
    val official_link: String = "",
    val official_website: String = "",
    val link: String = "",
    val hi: UpdateHi? = null,
)

/* Filter lists built into the app, so the welcome screen works before the first download. */
object Builtin {
    val states = listOf(
        "all-india" to "All India / Central", "andhra-pradesh" to "Andhra Pradesh", "arunachal-pradesh" to "Arunachal Pradesh", "assam" to "Assam",
        "bihar" to "Bihar", "chhattisgarh" to "Chhattisgarh", "delhi" to "Delhi (NCR)", "goa" to "Goa", "gujarat" to "Gujarat", "haryana" to "Haryana",
        "himachal-pradesh" to "Himachal Pradesh", "jharkhand" to "Jharkhand", "karnataka" to "Karnataka", "kerala" to "Kerala", "madhya-pradesh" to "Madhya Pradesh",
        "maharashtra" to "Maharashtra", "manipur" to "Manipur", "meghalaya" to "Meghalaya", "mizoram" to "Mizoram", "nagaland" to "Nagaland", "odisha" to "Odisha",
        "punjab" to "Punjab", "rajasthan" to "Rajasthan", "sikkim" to "Sikkim", "tamil-nadu" to "Tamil Nadu", "telangana" to "Telangana", "tripura" to "Tripura",
        "uttar-pradesh" to "Uttar Pradesh", "uttarakhand" to "Uttarakhand", "west-bengal" to "West Bengal", "jammu-kashmir" to "Jammu & Kashmir", "gulf" to "Gulf / abroad",
    ).map { Named(it.first, it.second) }
    val quals = listOf("10th-pass" to "10th Pass", "12th-pass" to "12th Pass", "graduate" to "Graduate", "engineering-diploma" to "Engineering / Diploma", "post-graduate" to "Post Graduate").map { Named(it.first, it.second) }
    val types = listOf("result" to "Results", "admit-card" to "Admit Cards", "answer-key" to "Answer Keys", "exam-date" to "Exam Dates").map { Named(it.first, it.second) }
}

/* ---- dates: every deadline is an Indian date ---- */
object Dates {
    val IST: ZoneId = ZoneId.of("Asia/Kolkata")
    fun today(): LocalDate = LocalDate.now(IST)
    fun parse(iso: String): LocalDate? = try { if (iso.length >= 10) LocalDate.parse(iso.substring(0, 10)) else null } catch (e: Exception) { null }
    fun daysLeft(iso: String): Long? = parse(iso)?.let { ChronoUnit.DAYS.between(today(), it) }
    private val fmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    private val fmtShort = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
    fun pretty(iso: String): String = parse(iso)?.format(fmt) ?: ""
    fun short(iso: String): String = parse(iso)?.format(fmtShort) ?: ""
}

enum class Status { OPEN, SOON, CLOSED }

fun JobItem.status(): Status {
    val d = Dates.daysLeft(en) ?: return Status.OPEN
    return when {
        d < 0 -> Status.CLOSED
        d <= 7 -> Status.SOON
        else -> Status.OPEN
    }
}

fun JobItem.isNew(): Boolean {
    val p = Dates.parse(pub) ?: return false
    val age = ChronoUnit.DAYS.between(p, Dates.today())
    return age in 0..2 && status() != Status.CLOSED
}
