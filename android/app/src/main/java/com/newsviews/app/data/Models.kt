package com.newsviews.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/* Mirrors https://news-views.in/app/v1/ (written by build.js on every site build). */

@Serializable
data class Named(val slug: String = "", val name: String = "")

@Serializable
data class JobItem(
    val id: String = "",
    val t: String = "",
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
    val tc: String = "",               // short title for lists ("GSSSB Surveyor Recruitment 2026")
    val thc: String = "",
    val w: Int = 0,                    // walk-in interview
    val c: List<String> = emptyList(), // categories (railway, bank, ssc, …)
    val ph: String = "",               // post name in Hindi
    val m: String = "",                // apply mode: apply | page | form | walkin | email | careers | notice | website (newer feeds)
    val ns: String = "",               // notice status: "" | cancelled | postponed (newer feeds)
) {
    fun title(hindi: Boolean) = if (hindi && th.isNotBlank()) th else t
    fun post(hindi: Boolean) = if (hindi && ph.isNotBlank()) ph else p
    fun short(hindi: Boolean) = if (hindi && thc.isNotBlank()) thc else if (hindi && th.isNotBlank()) th else tc.ifBlank { t }
    /** null = the notice gives no upper age limit; otherwise whether [age] fits (with [extra] years of relaxation). */
    fun ageFits(age: Int, extra: Int): Boolean? = if (a1 <= 0.0) null else (a0 <= 0.0 || age >= a0) && age <= a1 + extra
}

@Serializable
data class UpdateItem(
    val id: String = "",
    val t: String = "",
    val th: String = "",
    val o: String = "",
    val ty: String = "",
    val d: String = "",
    val ev: String = "",
    val big: Int = 0,
    val tc: String = "",
    val thc: String = "",
    val c: List<String> = emptyList(),
) {
    fun title(hindi: Boolean) = if (hindi && th.isNotBlank()) th else t
    fun short(hindi: Boolean) = if (hindi && thc.isNotBlank()) thc else if (hindi && th.isNotBlank()) th else tc.ifBlank { t }
}

/** A browsable category, sent with the feed. */
@Serializable
data class Cat(val slug: String, val name: String, val hi: String = "")

/** Department key used for "Follow" and its alert topic — the same rule as build.js / push-notify.js. */
fun orgSlug(o: String): String = o.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

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
    val cats: List<Cat> = emptyList(),
    val quizzes: List<QuizRef> = emptyList(),
    val ads: AdsConfig = AdsConfig(),
    val contact: String = "",          // support e-mail for "Report a mistake" (newer feeds; the app falls back to contact@news-views.in)
    val minVersion: Int = 0,           // versions below this can't read the feed any more: "Update required" (0 = off)
)

/** Ad switches sent with the feed (config.json "appAds"), so placements can be tuned or turned off without an app update. */
@Serializable
data class AdsConfig(
    val on: Boolean = true,
    val banner: Boolean = true,        // anchored banner under the job / result / saved lists
    val bannerSize: String = "standard", // "standard" (~50-90 dp) or "large" (up to ~130 dp, can also carry video ads)
    val inline: Boolean = true,        // one in-content unit on job and result pages
    val interstitial: Boolean = true,  // full-screen ad when going back from a page, capped below
    val every: Int = 4,                // at most once per this many pages opened
    val gap: Int = 240,                // and at least this many seconds apart
    val rewarded: Boolean = true,      // the opt-in offer: watch one rewarded video, no ads for rewardHours hours
    val rewardHours: Int = 6,
    @SerialName("native") val nativeAds: Boolean = true,   // one native ad card inside the job and result lists
    val bannerOnPages: Boolean = true, // the anchored banner also under job / result / quiz pages
    val nativeEvery: Int = 8,          // (reserved) spacing for more native cards
    val pro: Boolean = false,          // "Pro" one-time purchase offered (needs the product in Play Console)
    val proProduct: String = "pro_lifetime",
    val appOpen: Boolean = true,       // app-open ad when coming back after a break (see Ads.maybeShowAppOpen)
    val appOpenGap: Int = 14400,       // at most once per this many seconds
    val appOpenAway: Int = 900,        // only after the app was in the background at least this long
)

/** The daily current-affairs quiz (the site's /quiz/), newest first in the index; questions in q/<id>.json. */
@Serializable
data class QuizRef(val id: String = "", val date: String = "", val title: String = "", val n: Int = 0)

@Serializable
data class QuizQ(val q: String = "", val options: List<String> = emptyList(), val answer: Int = 0, val why: String = "")

@Serializable
data class Quiz(val id: String = "", val date: String = "", val title: String = "", val questions: List<QuizQ> = emptyList())

@Serializable
data class Faq(val q: String = "", val a: String = "")

@Serializable
data class JobHi(
    val title: String = "",
    val summary: String = "",
    val overview: List<String> = emptyList(),
    val eligibility_notes: String = "",
    val selection_process: List<String> = emptyList(),
    val how_to_apply: List<String> = emptyList(),
    val faq: List<Faq> = emptyList(),
    val organization: String = "",
    val post_name: String = "",
    val qualification: String = "",
    val location: String = "",
    val salary: String = "",
    val fee: String = "",
    val preparation_tips: List<String> = emptyList(),
)

@Serializable
data class JobDetail(
    val id: String = "",
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
    val preparation_tips: List<String> = emptyList(),   // bonus content: shown with the pass (or freely when no rewarded ad is set up)
    val official_notification: String = "",
    val apply_link: String = "",
    val official_website: String = "",
    val hi: JobHi? = null,
    val cta: String = "",          // apply | form | walkin | notice | website (what the main button really opens)
    val cta_url: String = "",
    val apply_mode: String = "",
    val notice_status: String = "",   // "" | cancelled | postponed (newer feeds)
    val status_note: String = "",     // what the official update says, when notice_status is set
    val status_link: String = "",     // the official corrigendum / cancellation notice
    val src_host: String = "",        // host of the official source the details were taken from
    val upd: String = "",             // last checked / updated, YYYY-MM-DD
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
    val id: String = "",
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
    val src_host: String = "",
    val upd: String = "",
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
    val HINDI: Locale = Locale.forLanguageTag("hi-IN")
    private val fmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
    private val fmtShort = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
    private val fmtHi = DateTimeFormatter.ofPattern("d MMM yyyy", HINDI)
    private val fmtShortHi = DateTimeFormatter.ofPattern("d MMM", HINDI)
    /** "5 Nov 2026" (or the Hindi month names with [hindi]). */
    fun pretty(iso: String, hindi: Boolean = false): String = parse(iso)?.format(if (hindi) fmtHi else fmt) ?: ""
    fun short(iso: String, hindi: Boolean = false): String = parse(iso)?.format(if (hindi) fmtShortHi else fmtShort) ?: ""
}

/** CANCELLED / POSTPONED come from the feed's notice status (an official corrigendum), the rest from the last date. */
enum class Status { OPEN, SOON, CLOSED, CANCELLED, POSTPONED }

/** No application possible any more (last date passed, or the recruitment was cancelled). */
fun Status.isClosed(): Boolean = this == Status.CLOSED || this == Status.CANCELLED

fun JobItem.status(): Status {
    if (ns == "cancelled") return Status.CANCELLED
    if (ns == "postponed") return Status.POSTPONED      // the old dates no longer apply
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
    return age in 0..2 && !status().isClosed()
}
