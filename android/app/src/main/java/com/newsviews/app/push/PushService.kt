package com.newsviews.app.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.newsviews.app.data.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Receives job alerts. In the background Android shows them itself; in the foreground we show them here. */
class PushService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        // A new token starts with no topics: subscribe again from scratch.
        scope.launch {
            val prefs = Prefs(applicationContext)
            prefs.setSubscribed(emptySet())
            Alerts.sync(applicationContext, prefs)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification ?: return
        val kind = message.data["kind"] ?: "job"
        val id = message.data["id"] ?: return
        // the channel the server chose (e.g. "reminders" for "last date extended"), else by kind
        val channel = n.channelId?.takeIf { it in Alerts.CHANNELS } ?: when (kind) {
            "update" -> Alerts.CH_RESULTS
            "quiz" -> Alerts.CH_QUIZ
            else -> Alerts.CH_JOBS
        }
        Alerts.show(applicationContext, channel, "$kind-$id", n.title ?: "Sarkari Radar", n.body ?: "", kind, id)
    }
}
