package com.newsviews.app.data

import android.content.Context
import com.newsviews.app.BuildConfig
import com.newsviews.app.Stats
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** The feed answered 404: the job or update is no longer in the app feed (closed long ago, or retired). */
class NotInFeed(msg: String) : Exception(msg)

/**
 * Reads the site's static app feed. Everything is cached on the phone, so the app opens instantly and works
 * offline with the last data it saw; a refresh replaces the cache only after the new copy has been read.
 * The feed cache lives in cacheDir (not backed up, can be cleared by the system); saved-job snapshots in filesDir —
 * the list entry (saved_<id>.json) and the whole job page (detail_<id>.json), so a saved job opens without network.
 */
class Repository(context: Context) {
    private val appCtx = context.applicationContext
    private val dir = File(context.cacheDir, "feed").apply { mkdirs() }
    private val savedDir = File(context.filesDir, "saved").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false; isLenient = true }

    init {
        // one-time move of the old cache location (filesDir/feed) — it was included in backups and never pruned
        val old = File(context.filesDir, "feed")
        if (old.isDirectory) {
            old.listFiles()?.forEach { f -> if (f.name.startsWith("saved_")) f.renameTo(File(savedDir, f.name)) else f.delete() }
            old.delete()
        }
    }

    /** One download; [body] is null when the server answered 304 (unchanged since [etag]). */
    private class Resp(val body: String?, val etag: String?)

    /** [fast]: a job / result page — shorter timeouts, because a cached copy is usually already on screen. */
    private fun get(path: String, etag: String? = null, fast: Boolean = false): Resp {
        val conn = URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection
        conn.connectTimeout = if (fast) 8000 else 15000
        conn.readTimeout = if (fast) 12000 else 20000
        conn.setRequestProperty("User-Agent", "SarkariRadar/${BuildConfig.VERSION_NAME} (Android)")
        conn.setRequestProperty("Accept", "application/json")
        if (etag != null) conn.setRequestProperty("If-None-Match", etag)
        try {
            val code = conn.responseCode
            if (code == HttpURLConnection.HTTP_NOT_MODIFIED && etag != null) return Resp(null, etag)
            if (code == 404 || code == 410) throw NotInFeed("HTTP $code")
            if (code != 200) throw RuntimeException("HTTP $code")
            return Resp(conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }, conn.getHeaderField("ETag"))
        } finally {
            conn.disconnect()
        }
    }

    private fun cacheFile(name: String) = File(dir, name.replace('/', '_'))

    /** Writes through a temporary file and a rename, so a crash or a full disk mid-write never leaves half a file. */
    private fun writeAtomic(file: File, text: String) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) { file.delete(); if (!tmp.renameTo(file)) { tmp.delete(); file.writeText(text) } }
    }

    /** Decodes the index item by item: one malformed job or a typo in the ad switches can't empty the whole app.
        [report]: a fresh download — items that could not be read are reported to Crashlytics (count only). */
    private fun decodeIndex(text: String, report: Boolean = false): AppIndex {
        val root = json.parseToJsonElement(text).jsonObject
        var dropped = 0
        fun <T> list(key: String, ser: KSerializer<T>): List<T> =
            (root[key] as? JsonArray)?.mapNotNull { el -> try { json.decodeFromJsonElement(ser, el) } catch (e: Exception) { dropped++; null } } ?: emptyList()
        fun str(key: String) = (root[key] as? JsonPrimitive)?.contentOrNull ?: ""
        fun int(key: String) = (root[key] as? JsonPrimitive)?.intOrNull ?: 0
        val ads = root["ads"]?.let { try { json.decodeFromJsonElement(AdsConfig.serializer(), it) } catch (e: Exception) { dropped++; null } } ?: AdsConfig()
        val idx = AppIndex(
            api = (root["api"] as? JsonPrimitive)?.intOrNull ?: 1, built = str("built"), at = str("at"), site = str("site").ifBlank { "https://news-views.in" },
            states = list("states", Named.serializer()), quals = list("quals", Named.serializer()), types = list("types", Named.serializer()),
            jobs = list("jobs", JobItem.serializer()).filter { it.id.isNotBlank() && it.t.isNotBlank() },
            updates = list("updates", UpdateItem.serializer()).filter { it.id.isNotBlank() && it.t.isNotBlank() },
            cats = list("cats", Cat.serializer()), ads = ads,
            quizzes = list("quizzes", QuizRef.serializer()).filter { it.id.isNotBlank() && it.n > 0 },
            contact = str("contact").trim(), minVersion = int("minVersion").coerceAtLeast(0),
        )
        if (report && dropped > 0) Stats.nonFatal(IllegalStateException("decodeIndex dropped $dropped item(s)"), "decode_index")
        return idx
    }

    @Volatile private var lastIndex: AppIndex? = null   // the decoded copy of the cache file (a 304 answer reuses it)

    /** The last index seen, from the phone (call off the main thread: it is about 1 MB). */
    fun cachedIndex(): AppIndex? = try {
        cacheFile("index.json").takeIf { it.exists() }?.readText()?.let { decodeIndex(it) }?.also { lastIndex = it }
    } catch (e: Exception) { null }

    /** Downloads the index — conditionally: with the cached copy's ETag, an unchanged feed costs one small 304 answer
        instead of the whole ~1.3 MB file (the feed rebuilds a few times an hour; the app refreshes on every return). */
    suspend fun fetchIndex(): AppIndex = withContext(Dispatchers.IO) {
        val file = cacheFile("index.json")
        val etagFile = cacheFile("index.etag")
        val etag = if (file.exists() && etagFile.exists()) etagFile.readText().trim().ifBlank { null } else null
        val r = get("index.json", etag)
        if (r.body == null) {
            lastIndex ?: decodeIndex(file.readText()).also { lastIndex = it }
        } else {
            val idx = decodeIndex(r.body, report = true)   // read first: a broken download never replaces a good cache
            if (idx.jobs.isNotEmpty()) {
                writeAtomic(file, r.body)
                if (r.etag.isNullOrBlank()) etagFile.delete() else etagFile.writeText(r.etag)
                lastIndex = idx
            }
            idx
        }
    }

    private fun savedDetailFile(id: String) = File(savedDir, "detail_$id.json")

    /** The phone's copy of a page — the cache, else (for jobs) the saved-job copy — or null. Call off the main thread. */
    private fun <T> cachedDetail(name: String, ser: KSerializer<T>, savedId: String?): T? {
        fun read(f: File): T? = f.takeIf { it.exists() }?.let { try { json.decodeFromString(ser, it.readText()) } catch (_: Exception) { null } }
        return read(cacheFile(name)) ?: savedId?.let { read(savedDetailFile(it)) }
    }

    /**
     * One job / result / quiz page from the feed, revalidated with its ETag (an unchanged page costs a 304). A page the
     * feed no longer has (404) is dropped from the cache — but a saved job keeps its copy and opens from it. Without
     * network the cached (or saved) copy is used; failures other than "no network" / "not in the feed" go to Crashlytics.
     */
    private suspend fun <T> detail(name: String, ser: KSerializer<T>, savedId: String? = null): T = withContext(Dispatchers.IO) {
        val file = cacheFile(name)
        val etagFile = cacheFile("$name.etag")
        val etag = if (file.exists() && etagFile.exists()) etagFile.readText().trim().ifBlank { null } else null
        try {
            val r = get(name, etag, fast = true)
            val text = r.body ?: file.readText()
            val v = json.decodeFromString(ser, text)
            if (r.body != null) {
                writeAtomic(file, text)
                if (r.etag.isNullOrBlank()) etagFile.delete() else etagFile.writeText(r.etag)
            }
            // a saved job's offline copy follows the feed (extended dates, corrections)
            if (savedId != null && savedDetailFile(savedId).exists()) try { writeAtomic(savedDetailFile(savedId), text) } catch (_: Exception) { }
            v
        } catch (e: NotInFeed) {
            file.delete(); etagFile.delete()
            savedId?.let { id -> savedDetailFile(id).takeIf { it.exists() }?.let { f -> try { json.decodeFromString(ser, f.readText()) } catch (_: Exception) { null } } } ?: throw e
        } catch (e: Exception) {
            if (e !is IOException) Stats.nonFatal(e, "detail_load")
            cachedDetail(name, ser, savedId) ?: throw e
        }
    }

    suspend fun job(id: String): JobDetail = detail("j/$id.json", JobDetail.serializer(), savedId = id)
    suspend fun update(id: String): UpdateDetail = detail("u/$id.json", UpdateDetail.serializer())
    suspend fun quiz(id: String): Quiz = detail("q/$id.json", Quiz.serializer())

    /** The copy already on the phone, shown at once while the page is revalidated (stale-while-revalidate). */
    suspend fun cachedJob(id: String): JobDetail? = withContext(Dispatchers.IO) { cachedDetail("j/$id.json", JobDetail.serializer(), id) }
    suspend fun cachedUpdate(id: String): UpdateDetail? = withContext(Dispatchers.IO) { cachedDetail("u/$id.json", UpdateDetail.serializer(), null) }
    suspend fun cachedQuiz(id: String): Quiz? = withContext(Dispatchers.IO) { cachedDetail("q/$id.json", Quiz.serializer(), null) }

    /** Saved jobs keep their list entry even after the job leaves the feed. */
    fun saveSnapshot(item: JobItem) { try { File(savedDir, "saved_${item.id}.json").writeText(json.encodeToString(JobItem.serializer(), item)) } catch (_: Exception) {} }
    fun savedSnapshot(id: String): JobItem? = try {
        File(savedDir, "saved_$id.json").takeIf { it.exists() }?.let { json.decodeFromString(JobItem.serializer(), it.readText()) }
    } catch (e: Exception) { null }
    fun dropSnapshot(id: String) { File(savedDir, "saved_$id.json").delete(); savedDetailFile(id).delete() }

    /** Keeps the whole job page of a saved job (filesDir, so the system never clears it): from the cache when the page
        was opened, else downloaded once. Best effort — without network it is fetched the next time the page opens. */
    suspend fun saveDetail(id: String) = withContext(Dispatchers.IO) {
        try {
            val cached = cacheFile("j/$id.json")
            val text = if (cached.exists()) cached.readText() else get("j/$id.json", fast = true).body
            if (text != null) { json.decodeFromString(JobDetail.serializer(), text); writeAtomic(savedDetailFile(id), text) }
        } catch (_: Exception) { }
    }

    /** The saved job's page can be read without network. */
    fun hasOfflineCopy(id: String): Boolean = savedDetailFile(id).exists()
}
