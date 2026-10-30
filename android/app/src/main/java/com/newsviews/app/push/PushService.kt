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
        val channel = if (kind == "update") Alerts.CH_RESULTS else Alerts.CH_JOBS
        Alerts.show(applicationContext, channel, "$kind-$id", n.title ?: "News-Views", n.body ?: "", kind, id)
    }
}
