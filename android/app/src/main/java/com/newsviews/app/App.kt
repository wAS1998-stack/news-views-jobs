package com.newsviews.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.newsviews.app.ads.Ads
import com.newsviews.app.play.PlayPrompts
import com.newsviews.app.push.Alerts

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Alerts.createChannels(this)
        Ads.restore(this)
        if (BuildConfig.HAS_FIREBASE) try {
            val rc = com.google.firebase.remoteconfig.FirebaseRemoteConfig.getInstance()
            rc.setConfigSettingsAsync(com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings.Builder().setMinimumFetchIntervalInSeconds(3600).build())
            rc.fetchAndActivate().addOnCompleteListener { Ads.setRemoteOverride(rc.getString("app_ads")) }
        } catch (_: Exception) { }
        // a downloaded Play update installs when the whole app goes to the background — not on rotation, a Custom Tab
        // (the application form) or the share sheet, which also stop the activity
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) { PlayPrompts.installIfDownloaded(); Ads.onProcessBackground() }
            override fun onStart(owner: LifecycleOwner) { Ads.onProcessForeground() }
        })
    }
}
