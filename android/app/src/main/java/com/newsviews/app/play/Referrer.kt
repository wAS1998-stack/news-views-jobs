package com.newsviews.app.play

import android.content.Context
import android.util.Log
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.newsviews.app.ID_RE
import com.newsviews.app.Stats
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URLDecoder

/**
 * Google Play's install referrer, read once after install: which campaign or page brought the install (logged as the
 * Analytics event "install_source": source / medium / campaign only), and — when the Play link carried
 * utm_content=job:<id> (the site's "Get the app" link on a job page) — that job opens right after the welcome screen.
 */
object Referrer {
    private const val TAG = "NVReferrer"
    private const val PREFS = "install"
    private val _job = MutableStateFlow<String?>(null)
    /** A job to open once the welcome screen is done (from the install link), or null. */
    val pendingJob: StateFlow<String?> = _job.asStateFlow()

    fun consume() { _job.value = null }

    /** Call on a fresh start; does nothing after the referrer has been read once. */
    fun check(ctx: Context) {
        val app = ctx.applicationContext
        val p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (p.getBoolean("referrerRead", false)) return
        val client = try { InstallReferrerClient.newBuilder(app).build() } catch (e: Exception) { return }
        try {
            client.startConnection(object : InstallReferrerStateListener {
                override fun onInstallReferrerSetupFinished(responseCode: Int) {
                    when (responseCode) {
                        InstallReferrerClient.InstallReferrerResponse.OK -> {
                            val ref = try { client.installReferrer.installReferrer } catch (e: Exception) { null }
                            p.edit().putBoolean("referrerRead", true).apply()
                            handle(app, ref.orEmpty())
                        }
                        // not a Play install (or an old Play app): nothing to read, ever
                        InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED,
                        InstallReferrerClient.InstallReferrerResponse.DEVELOPER_ERROR -> p.edit().putBoolean("referrerRead", true).apply()
                        else -> Log.i(TAG, "referrer unavailable ($responseCode), next start")   // SERVICE_UNAVAILABLE etc.
                    }
                    try { client.endConnection() } catch (_: Exception) { }
                }
                override fun onInstallReferrerServiceDisconnected() { }
            })
        } catch (e: Exception) { Log.i(TAG, "referrer: ${e.message}") }
    }

    private fun handle(ctx: Context, referrer: String) {
        val params = referrer.split('&').mapNotNull { kv ->
            val i = kv.indexOf('=')
            if (i <= 0) null else kv.substring(0, i) to (try { URLDecoder.decode(kv.substring(i + 1), "UTF-8") } catch (e: Exception) { "" })
        }.toMap()
        Stats.event(ctx, "install_source", "source" to (params["utm_source"] ?: "none"), "medium" to (params["utm_medium"] ?: "none"),
            "campaign" to (params["utm_campaign"] ?: "none"))
        // only right after the install: someone updating from an older version is not arriving from that link now
        val installed = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).firstInstallTime } catch (e: Exception) { 0L }
        if (System.currentTimeMillis() - installed > 2 * 86_400_000L) return
        val content = params["utm_content"].orEmpty()
        if (content.startsWith("job:")) {
            val id = content.removePrefix("job:").trim().lowercase()
            if (ID_RE.matches(id)) _job.value = id
        }
    }
}
