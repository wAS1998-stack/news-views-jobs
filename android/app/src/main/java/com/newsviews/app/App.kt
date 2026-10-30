package com.newsviews.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.newsviews.app.play.PlayPrompts
import com.newsviews.app.push.Alerts

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Alerts.createChannels(this)
        // a downloaded Play update installs when the whole app goes to the background — not on rotation, a Custom Tab
        // (the application form) or the share sheet, which also stop the activity
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) { PlayPrompts.installIfDownloaded() }
        })
    }
}
