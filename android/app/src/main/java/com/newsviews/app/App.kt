package com.newsviews.app

import android.app.Application
import com.newsviews.app.push.Alerts

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Alerts.createChannels(this)
    }
}
