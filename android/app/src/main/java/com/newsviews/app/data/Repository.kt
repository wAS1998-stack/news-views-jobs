package com.newsviews.app.data

import android.content.Context
import com.newsviews.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Reads the site's static app feed. Everything is cached on the phone, so the app opens instantly and works
 * offline with the last data it saw; a refresh replaces the cache.
 */
class Repository(context: Context) {
    private val dir = File(context.filesDir, "feed").apply { mkdirs() }
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

    private fun get(path: String): String {
        val conn = URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 20000
        conn.setRequestProperty("User-Agent", "NewsViewsApp/${BuildConfig.VERSION_NAME} (Android)")
        conn.setRequestProperty("Accept", "application/json")
        try {
            val code = conn.responseCode
            if (code != 200) throw RuntimeException("HTTP $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun cacheFile(name: String) = File(dir, name.replace('/', '_'))

    fun cachedIndex(): AppIndex? = try {
        cacheFile("index.json").takeIf { it.exists() }?.readText()?.let { json.decodeFromString<AppIndex>(it) }
    } catch (e: Exception) { null }

    suspend fun fetchIndex(): AppIndex = withContext(Dispatchers.IO) {
        val text = get("index.json")
        val idx = json.decodeFromString<AppIndex>(text)
        cacheFile("index.json").writeText(text)
        idx
    }

    suspend fun job(id: String): JobDetail = withContext(Dispatchers.IO) {
        val name = "j/$id.json"
        try {
            val text = get(name)
            cacheFile(name).writeText(text)
            json.decodeFromString<JobDetail>(text)
        } catch (e: Exception) {
            cacheFile(name).takeIf { it.exists() }?.let { json.decodeFromString<JobDetail>(it.readText()) } ?: throw e
        }
    }

    suspend fun update(id: String): UpdateDetail = withContext(Dispatchers.IO) {
        val name = "u/$id.json"
        try {
            val text = get(name)
            cacheFile(name).writeText(text)
            json.decodeFromString<UpdateDetail>(text)
        } catch (e: Exception) {
            cacheFile(name).takeIf { it.exists() }?.let { json.decodeFromString<UpdateDetail>(it.readText()) } ?: throw e
        }
    }

    /** Saved jobs keep their list entry even after the job leaves the feed. */
    fun saveSnapshot(item: JobItem) = cacheFile("saved_${item.id}.json").writeText(json.encodeToString(JobItem.serializer(), item))
    fun savedSnapshot(id: String): JobItem? = try {
        cacheFile("saved_$id.json").takeIf { it.exists() }?.let { json.decodeFromString<JobItem>(it.readText()) }
    } catch (e: Exception) { null }
    fun dropSnapshot(id: String) { cacheFile("saved_$id.json").delete() }
}
