package com.newsviews.app.data

import android.content.Context
import com.newsviews.app.BuildConfig
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
import java.net.HttpURLConnection
import java.net.URL

/** The feed answered 404: the job or update is no longer in the app feed (closed long ago, or retired). */
class NotInFeed(msg: String) : Exception(msg)

/**
 * Reads the site's static app feed. Everything is cached on the phone, so the app opens instantly and works
 * offline with the last data it saw; a refresh replaces the cache only after the new copy has been read.
 * The feed cache lives in cacheDir (not backed up, can be cleared by the system); saved-job snapshots in filesDir.
 */
class Repository(context: Context) {
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

    private fun get(path: String): String {
        val conn = URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 20000
        conn.setRequestProperty("User-Agent", "SarkariRadar/${BuildConfig.VERSION_NAME} (Android)")
        conn.setRequestProperty("Accept", "application/json")
        try {
            val code = conn.responseCode
            if (code == 404 || code == 410) throw NotInFeed("HTTP $code")
            if (code != 200) throw RuntimeException("HTTP $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun cacheFile(name: String) = File(dir, name.replace('/', '_'))

    /** Decodes the index item by item: one malformed job or a typo in the ad switches can't empty the whole app. */
    private fun decodeIndex(text: String): AppIndex {
        val root = json.parseToJsonElement(text).jsonObject
        fun <T> list(key: String, ser: KSerializer<T>): List<T> =
            (root[key] as? JsonArray)?.mapNotNull { el -> try { json.decodeFromJsonElement(ser, el) } catch (e: Exception) { null } } ?: emptyList()
        fun str(key: String) = (root[key] as? JsonPrimitive)?.contentOrNull ?: ""
        val ads = root["ads"]?.let { try { json.decodeFromJsonElement(AdsConfig.serializer(), it) } catch (e: Exception) { null } } ?: AdsConfig()
        return AppIndex(
            api = (root["api"] as? JsonPrimitive)?.intOrNull ?: 1, built = str("built"), at = str("at"), site = str("site").ifBlank { "https://news-views.in" },
            states = list("states", Named.serializer()), quals = list("quals", Named.serializer()), types = list("types", Named.serializer()),
            jobs = list("jobs", JobItem.serializer()).filter { it.id.isNotBlank() && it.t.isNotBlank() },
            updates = list("updates", UpdateItem.serializer()).filter { it.id.isNotBlank() && it.t.isNotBlank() },
            cats = list("cats", Cat.serializer()), ads = ads,
        )
    }

    /** The last index seen, from the phone (call off the main thread: it is about 1 MB). */
    fun cachedIndex(): AppIndex? = try {
        cacheFile("index.json").takeIf { it.exists() }?.readText()?.let { decodeIndex(it) }
    } catch (e: Exception) { null }

    suspend fun fetchIndex(): AppIndex = withContext(Dispatchers.IO) {
        val text = get("index.json")
        val idx = decodeIndex(text)                    // read first: a broken download never replaces a good cache
        if (idx.jobs.isNotEmpty()) cacheFile("index.json").writeText(text)
        idx
    }

    private suspend fun <T> detail(name: String, ser: KSerializer<T>): T = withContext(Dispatchers.IO) {
        try {
            val text = get(name)
            val v = json.decodeFromString(ser, text)
            cacheFile(name).writeText(text)
            v
        } catch (e: NotInFeed) {
            cacheFile(name).delete()
            throw e
        } catch (e: Exception) {
            cacheFile(name).takeIf { it.exists() }?.let { try { json.decodeFromString(ser, it.readText()) } catch (_: Exception) { null } } ?: throw e
        }
    }

    suspend fun job(id: String): JobDetail = detail("j/$id.json", JobDetail.serializer())
    suspend fun update(id: String): UpdateDetail = detail("u/$id.json", UpdateDetail.serializer())

    /** Saved jobs keep their list entry even after the job leaves the feed. */
    fun saveSnapshot(item: JobItem) { try { File(savedDir, "saved_${item.id}.json").writeText(json.encodeToString(JobItem.serializer(), item)) } catch (_: Exception) {} }
    fun savedSnapshot(id: String): JobItem? = try {
        File(savedDir, "saved_$id.json").takeIf { it.exists() }?.let { json.decodeFromString(JobItem.serializer(), it.readText()) }
    } catch (e: Exception) { null }
    fun dropSnapshot(id: String) { File(savedDir, "saved_$id.json").delete() }
}
